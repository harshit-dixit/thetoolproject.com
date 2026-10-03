import { checkClip, DEFAULT_SETTINGS, formatTime, frameDelays, frameTimes, gifName, gifRepeat, isVideoFile, LIMITS, parseTime, type GifSettings, type GifWidth, type Loop } from '../lib/video-gif';
import type { VideoGifRequest, VideoGifResponse } from '../workers/video-to-gif';
import { i18nFrom } from '../i18n/client';
import { sizeBucket, trackResult } from '../lib/analytics';

const root = document.querySelector<HTMLElement>('#vgif-tool')!;
const { t, counted, formatNumber, formatBytes } = i18nFrom(root);
const decimal = new Intl.NumberFormat(root.dataset.locale).formatToParts(1.5).find(part => part.type === 'decimal')?.value ?? '.';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = $<HTMLInputElement>('vgif-file');
const empty = $('vgif-empty');
const panel = $('vgif-panel');
const editor = $('vgif-editor');
const video = $<HTMLVideoElement>('vgif-video');
const startField = $<HTMLInputElement>('vgif-start');
const endField = $<HTMLInputElement>('vgif-end');
const clipLine = $('vgif-clip');
const convertButton = $<HTMLButtonElement>('vgif-convert');
// Locked while converting, so the part shown always matches the GIF being made.
const timeControls = [startField, endField, $<HTMLButtonElement>('vgif-start-here'), $<HTMLButtonElement>('vgif-end-here')];
const result = $('vgif-result');
const preview = $<HTMLImageElement>('vgif-preview');
const status = $('vgif-status');

// A seek that never finishes means the browser gave up on the video.
const SEEK_TIMEOUT_MS = 15_000;
const LOAD_TIMEOUT_MS = 30_000;
// Frames sent to the worker but not yet encoded. A few keep it busy while the next frame is read.
const MAX_IN_FLIGHT = 3;

let settings: GifSettings = { ...DEFAULT_SETTINGS };
let file: File | undefined;
let sourceUrl: string | undefined;
let duration = 0;
let start = 0;
let end = 0;
let generation = 0;
let running = false;
let worker: Worker | undefined;
let output: { blob: Blob; url: string; name: string } | undefined;
// Wakes a conversion that is waiting on the worker, so choosing another video ends it.
let cancel: (() => void) | undefined;

class GifError extends Error { constructor(public code: string) { super(code); } }

function showStatus(message: string, error = false) {
  status.textContent = message;
  status.hidden = !message;
  status.classList.toggle('error', error);
}

function clearOutput() {
  if (output) URL.revokeObjectURL(output.url);
  output = undefined;
  preview.removeAttribute('src');
  result.hidden = true;
  convertButton.hidden = false;
}

function reset() {
  generation++;
  setRunning(false);
  cancel?.();
  cancel = undefined;
  worker?.terminate();
  worker = undefined;
  clearOutput();
  video.removeAttribute('src');
  video.load();
  if (sourceUrl) URL.revokeObjectURL(sourceUrl);
  sourceUrl = undefined;
  file = undefined;
  editor.hidden = true;
  showStatus('');
}

const ERROR_KEYS: Record<string, string> = {
  wrongType: 'vgif.errWrongType', tooLarge: 'vgif.errTooLarge', unplayable: 'vgif.errUnplayable', noVideo: 'vgif.errNoVideo',
  seek: 'vgif.errSeek', canvas: 'vgif.errCanvas', worker: 'vgif.errWorker',
};
const errorText = (code: string) => t(ERROR_KEYS[code] ?? 'vgif.errWorker', { size: formatNumber(LIMITS.fileBytes / 1024 ** 3) });

/** The video can't be used at all: back to the empty drop zone, with the reason. */
function failVideo(code: string) {
  reset();
  panel.hidden = true;
  empty.hidden = false;
  showStatus(errorText(code), true);
  trackResult('error', { code });
}

/** Resolves on the first of the events, rejects on `error` or after the timeout. */
function once(target: HTMLMediaElement, events: string[], code: string, timeout: number) {
  return new Promise<void>((resolve, reject) => {
    const done = (ok: boolean) => {
      clearTimeout(timer);
      events.forEach(name => target.removeEventListener(name, success));
      target.removeEventListener('error', failure);
      if (ok) resolve(); else reject(new GifError(code));
    };
    const success = () => done(true);
    const failure = () => done(false);
    const timer = window.setTimeout(failure, timeout);
    events.forEach(name => target.addEventListener(name, success));
    target.addEventListener('error', failure);
  });
}

/**
 * Some videos, such as browser screen recordings, don't store their duration, and the browser reports Infinity until it
 * has read to the end. Seeking far past the end makes it find out.
 */
async function knownDuration(element: HTMLVideoElement) {
  if (Number.isFinite(element.duration)) return element.duration;
  const found = once(element, ['durationchange', 'seeked'], 'unplayable', LOAD_TIMEOUT_MS);
  element.currentTime = 1e7;
  await found;
  if (!Number.isFinite(element.duration)) await once(element, ['durationchange'], 'unplayable', LOAD_TIMEOUT_MS);
  element.currentTime = 0;
  return element.duration;
}

async function choose(chosen: File | undefined) {
  if (!chosen) return;
  reset();
  const run = generation;
  if (!isVideoFile(chosen)) { failVideo('wrongType'); return; }
  if (chosen.size > LIMITS.fileBytes) { failVideo('tooLarge'); return; }
  file = chosen;
  empty.hidden = true;
  panel.hidden = false;
  $('vgif-name').textContent = chosen.name;
  $('vgif-size').textContent = formatBytes(chosen.size);
  $('vgif-meta').textContent = '';
  showStatus(t('vgif.loading'));
  sourceUrl = URL.createObjectURL(chosen);
  try {
    const loaded = once(video, ['loadedmetadata'], 'unplayable', LOAD_TIMEOUT_MS);
    video.src = sourceUrl;
    await loaded;
    if (run !== generation) return;
    if (!video.videoWidth || !video.videoHeight) throw new GifError('noVideo');
    duration = await knownDuration(video);
    if (run !== generation) return;
    if (!(duration > 0)) throw new GifError('unplayable');
  } catch (error) {
    if (run === generation) failVideo(error instanceof GifError ? error.code : 'unplayable');
    return;
  }
  $('vgif-meta').textContent = t('vgif.meta', { width: formatNumber(video.videoWidth), height: formatNumber(video.videoHeight), duration: formatTime(duration, decimal) });
  start = 0;
  end = Math.min(duration, LIMITS.defaultSeconds);
  startField.value = formatTime(start, decimal);
  endField.value = formatTime(end, decimal);
  editor.hidden = false;
  showStatus('');
  updateClip();
}

// --- The part of the video and the settings

type Clip = { ok: true; frames: number; width: number; height: number } | { ok: false };

function readClip(): Clip {
  const typedStart = parseTime(startField.value);
  const typedEnd = parseTime(endField.value);
  startField.setAttribute('aria-invalid', String(typedStart === undefined));
  endField.setAttribute('aria-invalid', String(typedEnd === undefined));
  const fail = (message: string): Clip => {
    clipLine.textContent = message;
    clipLine.classList.add('error');
    return { ok: false };
  };
  if (typedStart === undefined || typedEnd === undefined) return fail(t('vgif.errTime'));
  // Typed times are cut to tenths, so a value within a tenth of the end means the end.
  if (typedStart >= duration || typedEnd > duration + 0.1) return fail(t('vgif.errOutside', { duration: formatTime(duration, decimal) }));
  // Keep the exact times from the player or the video's end while the field still shows them as written; any edit wins.
  if (startField.value !== formatTime(start, decimal)) start = typedStart;
  if (endField.value !== formatTime(end, decimal)) end = Math.min(typedEnd, duration);
  const check = checkClip(start, end, { width: video.videoWidth, height: video.videoHeight }, settings);
  if (!check.ok) return fail(check.code === 'order' ? t('vgif.errOrder') : t('vgif.errTooLong', { frames: formatNumber(check.frames), max: formatNumber(LIMITS.frames) }));
  clipLine.classList.remove('error');
  clipLine.textContent = counted('vgif.clipSummary', check.frames, {
    length: t('vgif.seconds', { seconds: formatNumber(end - start, { maximumFractionDigits: 1 }) }),
    width: formatNumber(check.width), height: formatNumber(check.height),
  });
  return check;
}

function updateClip() {
  const clip = readClip();
  convertButton.disabled = !clip.ok || running;
  if (output) { clearOutput(); showStatus(''); }
  return clip;
}

function setRunning(value: boolean) {
  running = value;
  timeControls.forEach(control => { control.disabled = value; });
}

function setTime(which: 'start' | 'end') {
  if (running || editor.hidden) return;
  const now = video.currentTime;
  if (which === 'start') {
    start = now;
    startField.value = formatTime(start, decimal);
    // Starting after the end moves the end along, so the part stays usable.
    if (end <= start) { end = Math.min(duration, start + LIMITS.defaultSeconds); endField.value = formatTime(end, decimal); }
  } else {
    end = now;
    endField.value = formatTime(end, decimal);
  }
  updateClip();
}

for (const field of [startField, endField]) {
  field.addEventListener('input', () => { if (!running) updateClip(); });
  // Once the visitor leaves a valid field, show it in the same form as the player's times.
  field.addEventListener('change', () => {
    const value = parseTime(field.value);
    if (value !== undefined && value <= duration + 0.1) field.value = formatTime(Math.min(value, duration), decimal);
  });
}
$('vgif-start-here').addEventListener('click', () => setTime('start'));
$('vgif-end-here').addEventListener('click', () => setTime('end'));

function chipGroup(attribute: string, apply: (value: string) => void) {
  const buttons = root.querySelectorAll<HTMLButtonElement>(`[data-${attribute}]`);
  buttons.forEach(button => button.addEventListener('click', () => {
    if (running) return;
    buttons.forEach(other => other.setAttribute('aria-pressed', String(other === button)));
    apply(button.getAttribute(`data-${attribute}`)!);
    if (!editor.hidden) updateClip();
  }));
}
chipGroup('gif-width', value => { settings = { ...settings, width: (value === 'original' ? value : Number(value)) as GifWidth }; });
chipGroup('fps', value => { settings = { ...settings, fps: Number(value) }; });
chipGroup('speed', value => { settings = { ...settings, speed: Number(value) }; });
chipGroup('loop', value => { settings = { ...settings, loop: value as Loop }; });

// --- Converting: a second, hidden video is seeked frame by frame, so the visible player stays where the visitor left it.

function encoder(run: number) {
  const gifWorker = new Worker(new URL('../workers/video-to-gif.ts', import.meta.url), { type: 'module' });
  worker = gifWorker;
  let inFlight = 0;
  let failure: string | undefined;
  let wake: (() => void) | undefined;
  let finished: ((data: Uint8Array) => void) | undefined;
  const stop = (code: string) => { failure ??= code; wake?.(); };
  cancel = () => stop('cancelled');
  gifWorker.onmessage = (event: MessageEvent<VideoGifResponse>) => {
    const message = event.data;
    if (message.type === 'frame') { inFlight--; wake?.(); }
    else if (message.type === 'done') finished?.(message.data);
    else stop('worker');
  };
  // A worker that runs out of memory dies with the error event.
  gifWorker.onerror = () => stop('worker');
  const post = (request: VideoGifRequest, transfer: Transferable[] = []) => gifWorker.postMessage(request, transfer);
  const waitUntil = async (ready: () => boolean) => {
    while (!ready() && !failure && run === generation) await new Promise<void>(resolve => { wake = resolve; });
    if (failure) throw new GifError(failure);
  };
  return {
    start: (width: number, height: number, repeat: number) => post({ type: 'start', width, height, repeat }),
    async frame(pixels: ArrayBuffer, delay: number) {
      await waitUntil(() => inFlight < MAX_IN_FLIGHT);
      inFlight++;
      post({ type: 'frame', pixels, delay }, [pixels]);
    },
    async finish() {
      await waitUntil(() => inFlight === 0);
      let data: Uint8Array | undefined;
      finished = bytes => { data = bytes; wake?.(); };
      post({ type: 'finish' });
      await waitUntil(() => data !== undefined);
      return data;
    },
  };
}

async function seek(element: HTMLVideoElement, time: number) {
  if (Math.abs(element.currentTime - time) < 1e-4 && element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return;
  const seeked = once(element, ['seeked'], 'seek', SEEK_TIMEOUT_MS);
  element.currentTime = time;
  await seeked;
}

async function convert() {
  if (running || !file || !sourceUrl) return;
  const clip = readClip();
  if (!clip.ok) return;
  const run = generation;
  const current = { ...settings };
  const name = gifName(file.name);
  clearOutput();
  setRunning(true);
  convertButton.disabled = true;
  const times = frameTimes(start, end, current.fps);
  const delays = frameDelays(times.length, current.fps, current.speed);
  const grabber = document.createElement('video');
  grabber.muted = true;
  grabber.playsInline = true;
  grabber.preload = 'auto';
  grabber.className = 'visually-hidden';
  grabber.setAttribute('aria-hidden', 'true');
  root.append(grabber);
  try {
    const gif = encoder(run);
    showStatus(t('vgif.converting', { current: formatNumber(1), total: formatNumber(times.length) }));
    const ready = once(grabber, ['loadeddata'], 'unplayable', LOAD_TIMEOUT_MS);
    grabber.src = sourceUrl;
    await ready;
    const canvas = document.createElement('canvas');
    canvas.width = clip.width;
    canvas.height = clip.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new GifError('canvas');
    context.imageSmoothingQuality = 'high';
    gif.start(clip.width, clip.height, gifRepeat(current.loop));
    for (let i = 0; i < times.length; i++) {
      // The last frame of a video can sit a moment before its reported duration.
      await seek(grabber, Math.min(times[i], duration - 0.001));
      if (run !== generation) return;
      let pixels: ImageData;
      try {
        context.drawImage(grabber, 0, 0, clip.width, clip.height);
        pixels = context.getImageData(0, 0, clip.width, clip.height);
      } catch { throw new GifError('canvas'); }
      await gif.frame(pixels.data.buffer, delays[i]);
      if (run !== generation) return;
      showStatus(t('vgif.converting', { current: formatNumber(Math.min(i + 2, times.length)), total: formatNumber(times.length) }));
    }
    showStatus(t('vgif.finishing'));
    const data = await gif.finish();
    if (run !== generation || !data) return;
    const blob = new Blob([data as BlobPart], { type: 'image/gif' });
    output = { blob, url: URL.createObjectURL(blob), name };
    preview.src = output.url;
    $('vgif-summary').textContent = counted('vgif.summary', times.length, { width: formatNumber(clip.width), height: formatNumber(clip.height), size: formatBytes(blob.size) });
    $('vgif-note').textContent = blob.size > LIMITS.largeBytes ? t('vgif.noteLarge', { size: formatNumber(LIMITS.largeBytes / 1024 / 1024) }) : '';
    result.hidden = false;
    convertButton.hidden = true;
    showStatus(t('vgif.done'));
    trackResult('success', { width: current.width, fps: current.fps, speed: current.speed, loop: current.loop, frames: times.length, output_size: sizeBucket(blob.size) });
  } catch (error) {
    if (run !== generation) return;
    const code = error instanceof GifError ? error.code : 'worker';
    showStatus(errorText(code), true);
    trackResult('error', { code });
  } finally {
    grabber.removeAttribute('src');
    grabber.load();
    grabber.remove();
    if (run === generation) {
      worker?.terminate();
      worker = undefined;
      cancel = undefined;
      setRunning(false);
      convertButton.disabled = !readClip().ok;
    }
  }
}

convertButton.addEventListener('click', () => { void convert(); });
$('vgif-download').addEventListener('click', () => {
  if (!output) return;
  const link = document.createElement('a');
  link.href = output.url;
  link.download = output.name;
  link.click();
});

const pick = () => { input.value = ''; input.click(); };
$('vgif-choose').addEventListener('click', pick);
$('vgif-change').addEventListener('click', pick);
input.addEventListener('change', () => { void choose(input.files?.[0]); });
root.addEventListener('dragover', event => { event.preventDefault(); root.classList.add('over'); });
root.addEventListener('dragleave', event => { if (!root.contains(event.relatedTarget as Node)) root.classList.remove('over'); });
root.addEventListener('drop', event => {
  event.preventDefault();
  root.classList.remove('over');
  void choose(event.dataTransfer?.files?.[0]);
});
window.addEventListener('pagehide', () => { if (output) URL.revokeObjectURL(output.url); });
