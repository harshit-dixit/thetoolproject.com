import {
  applyRatio, BORDER_WIDTH, canSwap, circleSize, croppedName, defaultFormat, drawHandle, initialCrop, isImageFile, LIMITS, moveRect,
  ratioLabel, ratioValue, resizeRect, setField,
  type Background, type Border, type BorderColor, type CircleSize, type CropFormat, type CropShape, type Handle, type RatioChoice, type Rect, type Size,
} from '../lib/crop-image';
import type { CropOptions } from '../lib/crop-image-render';
import type { CropRequest, CropResponse, CropResult } from '../workers/crop-image';
import { i18nFrom } from '../i18n/client';
import { sizeBucket, trackResult } from '../lib/analytics';

const root = document.querySelector<HTMLElement>('#crop-tool')!;
const { t, formatNumber, formatBytes } = i18nFrom(root);
const shape = root.dataset.shape as CropShape;
const circle = shape === 'circle';
const prefix = circle ? 'circle' : 'crop';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = $<HTMLInputElement>('crop-file');
const empty = $('crop-empty');
const panel = $('crop-panel');
const status = $('crop-status');
const stage = $('crop-stage');
const image = $<HTMLImageElement>('crop-image');
const box = $('crop-box');
const convertButton = $<HTMLButtonElement>('crop-convert');
const result = $('crop-result');
const preview = $<HTMLImageElement>('crop-preview');
const download = $<HTMLButtonElement>('crop-download');
const swapButton = document.getElementById('crop-swap') as HTMLButtonElement | null;
const fields = (['width', 'height', 'x', 'y'] as const)
  .map(name => [name, document.getElementById(`crop-${name}`) as HTMLInputElement | null] as const)
  .filter((entry): entry is readonly [keyof Rect, HTMLInputElement] => !!entry[1]);
const TIMEOUT_MS = 120_000;
// A header this long holds the size of phone photos, even with a large EXIF thumbnail.
const HEADER_BYTES = 1024 * 1024;
const FORMAT_NAMES: Record<CropFormat, string> = { jpg: 'JPG', png: 'PNG', webp: 'WebP' };
const ERROR_KEYS: Record<string, string> = {
  tooLarge: 'crop.errTooLarge', tooManyPixels: 'crop.errTooManyPixels', decode: 'crop.errDecode', canvas: 'crop.errCanvas',
  unsupported: 'crop.errCanvas', encode: 'crop.errEncode', worker: 'crop.errWorker', timeout: 'crop.errTimeout',
};

let file: File | undefined;
let sourceUrl: string | undefined;
let natural: Size = { width: 1, height: 1 };
let rect: Rect = { x: 0, y: 0, width: 1, height: 1 };
let ratioChoice: RatioChoice = circle ? '1:1' : 'free';
let swapped = false;
let format: CropFormat = circle ? 'png' : 'jpg';
let quality = 0.95;
let circleOptions = { size: 'original' as CircleSize, background: 'transparent' as Background, border: 'none' as Border, borderColor: 'white' as BorderColor };
let firstOnly = false;
let cropped: { blob: Blob; url: string } | undefined;
let running = false;
let generation = 0;

const ratio = () => ratioValue(ratioChoice, natural, swapped);

function showStatus(message: string, error = false) {
  status.textContent = message;
  status.hidden = !message;
  status.classList.toggle('error', error);
}

// --- Worker: one crop at a time. A worker that hangs or crashes is replaced.
let worker: Worker | undefined;
let pending: { id: number; resolve: (response: CropResponse) => void; timer: number } | undefined;
let sequence = 0;

function stopWorker(code: string) {
  worker?.terminate();
  worker = undefined;
  if (!pending) return;
  clearTimeout(pending.timer);
  const { id, resolve } = pending;
  pending = undefined;
  resolve({ id, error: { code } });
}

function ask(request: Omit<CropRequest, 'id'>): Promise<CropResponse> {
  if (!worker) {
    worker = new Worker(new URL('../workers/crop-image.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<CropResponse>) => {
      if (!pending || event.data.id !== pending.id) return;
      clearTimeout(pending.timer);
      const { resolve } = pending;
      pending = undefined;
      resolve(event.data);
    };
    // A worker that runs out of memory dies with the message.
    worker.onerror = () => stopWorker('worker');
  }
  const id = ++sequence;
  return new Promise(resolve => {
    pending = { id, resolve, timer: window.setTimeout(() => stopWorker('timeout'), TIMEOUT_MS) };
    worker!.postMessage({ ...request, id } satisfies CropRequest);
  });
}

// --- Showing the crop

/** The saved size: the box's, or for a circle the chosen size, never larger than the box. */
function savedSize(): Size {
  if (!circle) return { width: rect.width, height: rect.height };
  const side = circleSize(rect, circleOptions.size);
  return { width: side, height: side };
}

function render({ keepField }: { keepField?: HTMLInputElement } = {}) {
  box.style.left = `${(rect.x / natural.width) * 100}%`;
  box.style.top = `${(rect.y / natural.height) * 100}%`;
  box.style.width = `${(rect.width / natural.width) * 100}%`;
  box.style.height = `${(rect.height / natural.height) * 100}%`;
  // Edge handles crowd the corners once the box is under about 60 px on screen.
  const shown = image.getBoundingClientRect();
  box.classList.toggle('small', shown.width * rect.width / natural.width < 60 || shown.height * rect.height / natural.height < 60);
  if (circle) {
    // The corners and ring as they'll be saved; the ring is a share of the circle's width.
    Object.assign(box.dataset, { corners: circleOptions.background, ring: circleOptions.border, ringColor: circleOptions.borderColor });
    box.style.setProperty('--ring', `${BORDER_WIDTH[circleOptions.border] * shown.width * rect.width / natural.width}px`);
  }
  for (const [name, field] of fields) if (field !== keepField) field.value = String(rect[name]);
  const size = savedSize();
  const label = t(`${prefix}.convert`, { width: formatNumber(size.width), height: formatNumber(size.height) });
  if (convertButton.textContent !== label) convertButton.textContent = label;
  convertButton.disabled = running;
}

function refreshOptions() {
  root.querySelectorAll<HTMLButtonElement>('[data-ratio]').forEach(chip => {
    const value = chip.dataset.ratio as RatioChoice;
    if (value.includes(':')) chip.textContent = ratioLabel(value, value === ratioChoice && swapped);
  });
  if (swapButton) {
    swapButton.hidden = !canSwap(ratioChoice);
    if (canSwap(ratioChoice)) swapButton.textContent = t('crop.swap', { ratio: ratioLabel(ratioChoice, !swapped) });
  }
  $('crop-quality-group').hidden = format === 'png';
  if (circle) {
    $('crop-border-color-group').hidden = circleOptions.border === 'none';
    // JPG can't keep transparent corners, so its choices are white and black.
    const transparent = root.querySelector<HTMLButtonElement>('[data-background="transparent"]')!;
    transparent.hidden = format === 'jpg';
    if (format === 'jpg' && circleOptions.background === 'transparent') select('background', 'white');
  }
}

function select(attribute: string, value: string) {
  root.querySelectorAll<HTMLButtonElement>(`[data-${attribute}]`).forEach(chip => chip.setAttribute('aria-pressed', String(chip.getAttribute(`data-${attribute}`) === value)));
  if (attribute === 'background') circleOptions = { ...circleOptions, background: value as Background };
}

function clearResult() {
  if (cropped) URL.revokeObjectURL(cropped.url);
  cropped = undefined;
  preview.removeAttribute('src');
  result.hidden = true;
  convertButton.hidden = false;
}

/** A finished crop no longer matches once the box or an option changes. */
function outdated() {
  if (cropped || !result.hidden) { clearResult(); showStatus(''); }
}

function update(next: Rect, options?: { keepField?: HTMLInputElement }) {
  if (next.x === rect.x && next.y === rect.y && next.width === rect.width && next.height === rect.height) return;
  rect = next;
  render(options);
  outdated();
}

// --- Opening an image

function startOver() {
  generation++;
  if (pending) stopWorker('cancelled');
  running = false;
  clearResult();
  if (sourceUrl) URL.revokeObjectURL(sourceUrl);
  sourceUrl = undefined;
  file = undefined;
  image.removeAttribute('src');
  panel.hidden = true;
  empty.hidden = false;
}

function fail(code: string) {
  startOver();
  showStatus(t(ERROR_KEYS[code] ?? (code === 'wrongType' ? 'crop.errNoImage' : 'crop.errGeneral'), { size: formatNumber(LIMITS.fileBytes / 1024 / 1024), pixels: formatNumber(LIMITS.pixels / 1_000_000) }), true);
  trackResult('error', { code });
}

/** The first frame as a PNG, decoded as the export decodes it, so the preview never shows other frames. */
async function firstFrame(source: File): Promise<Blob> {
  const bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' }).catch(() => createImageBitmap(source));
  try {
    const canvas = Object.assign(document.createElement('canvas'), { width: bitmap.width, height: bitmap.height });
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
    canvas.width = canvas.height = 1;
    if (!blob) throw new Error('decode');
    return blob;
  } finally { bitmap.close(); }
}

async function open(files: File[]) {
  if (running || !files.length) return;
  const images = files.filter(isImageFile);
  if (!images.length) { fail('wrongType'); return; }
  startOver();
  const run = generation;
  const chosen = images[0];
  firstOnly = files.length > 1;
  if (chosen.size > LIMITS.fileBytes) { fail('tooLarge'); return; }
  // The header gives the size without decoding, so a huge image isn't opened only to be refused.
  // Loaded once a file is chosen, to keep the page's first load small.
  // Separate awaits: the bundler can't trim unused exports from imports inside Promise.all, and merge-jpg's chunk is
  // part of Merge JPG's first load.
  const { readImageInfo } = await import('../lib/merge-jpg');
  const { isAnimated, isGif } = await import('../lib/animated-image');
  const header = new Uint8Array(await chosen.slice(0, HEADER_BYTES).arrayBuffer());
  const info = readImageInfo(header);
  if (run !== generation) return;
  if (info && info.width * info.height > LIMITS.pixels) { fail('tooManyPixels'); return; }
  // A GIF's frames can only be counted by skipping through them.
  const animated = isAnimated(isGif(header) ? new Uint8Array(await chosen.arrayBuffer()) : header);
  if (run !== generation) return;
  let url: string;
  try {
    // An animated image is shown as its first frame, which is what gets cropped.
    url = URL.createObjectURL(animated ? await firstFrame(chosen) : chosen);
    if (run !== generation) { URL.revokeObjectURL(url); return; }
    image.src = url;
    await image.decode();
  } catch {
    if (run !== generation) return;
    if (image.src.startsWith('blob:')) URL.revokeObjectURL(image.src);
    fail('decode');
    return;
  }
  if (run !== generation) { URL.revokeObjectURL(url); return; }
  // The browser shows photos turned by their EXIF orientation, and the export decodes them the same way.
  natural = { width: image.naturalWidth, height: image.naturalHeight };
  if (!natural.width || !natural.height) { URL.revokeObjectURL(url); fail('decode'); return; }
  if (natural.width * natural.height > LIMITS.pixels) { URL.revokeObjectURL(url); fail('tooManyPixels'); return; }
  file = chosen;
  sourceUrl = url;
  if (!circle) {
    format = defaultFormat(chosen);
    select('format', format);
  }
  $('crop-name').textContent = chosen.name;
  $('crop-size').textContent = formatBytes(chosen.size);
  $('crop-advice').textContent = t(`${prefix}.advice`, { width: formatNumber(natural.width), height: formatNumber(natural.height) });
  $('crop-animated').hidden = !animated;
  empty.hidden = true;
  panel.hidden = false;
  rect = initialCrop(natural, ratio());
  refreshOptions();
  render();
  showStatus(firstOnly ? t('crop.noteFirst') : '');
}

// --- Dragging: the box moves, a handle resizes, and dragging on the image outside the box draws a new one.

type Drag = { pointer: number; startX: number; startY: number; start: Rect; scale: number; mode: 'move' | 'draw' | Handle; moved: boolean };
let drag: Drag | undefined;

stage.addEventListener('pointerdown', event => {
  if (running || !file || event.button !== 0) return;
  const target = event.target as HTMLElement;
  const handle = target.closest('.crop-handle')?.className.match(/crop-handle-(\w+)/)?.[1] as Handle | undefined;
  const onBox = !!target.closest('#crop-box');
  // A finger on the image outside the box scrolls the page instead.
  if (!handle && !onBox && event.pointerType === 'touch') return;
  const bounds = image.getBoundingClientRect();
  const scale = natural.width / bounds.width;
  let start = rect;
  if (!handle && !onBox) {
    const x = Math.max(0, Math.min(natural.width, Math.round((event.clientX - bounds.left) * scale)));
    const y = Math.max(0, Math.min(natural.height, Math.round((event.clientY - bounds.top) * scale)));
    start = { x, y, width: 0, height: 0 };
  }
  drag = { pointer: event.pointerId, startX: event.clientX, startY: event.clientY, start, scale, mode: handle ?? (onBox ? 'move' : 'draw'), moved: false };
  stage.setPointerCapture(event.pointerId);
  event.preventDefault();
  if (onBox) box.focus({ preventScroll: true });
});

stage.addEventListener('pointermove', event => {
  if (!drag || event.pointerId !== drag.pointer) return;
  const dx = (event.clientX - drag.startX) * drag.scale;
  const dy = (event.clientY - drag.startY) * drag.scale;
  // A click on the image shouldn't make a 1-pixel box.
  if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4) return;
  drag.moved = true;
  if (drag.mode === 'move') update(moveRect(drag.start, Math.round(dx), Math.round(dy), natural));
  else if (drag.mode === 'draw') update(resizeRect(drag.start, drawHandle(dx, dy), dx, dy, natural, ratio()));
  else update(resizeRect(drag.start, drag.mode, dx, dy, natural, ratio()));
});

const endDrag = (event: PointerEvent) => { if (drag && event.pointerId === drag.pointer) drag = undefined; };
stage.addEventListener('pointerup', endDrag);
stage.addEventListener('pointercancel', endDrag);

// Arrow keys move the box by a screen pixel, Shift + arrow by ten; the fields set exact sizes.
box.addEventListener('keydown', event => {
  const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
  if (!step || running || !file) return;
  event.preventDefault();
  const pixels = Math.max(1, Math.round(natural.width / image.getBoundingClientRect().width)) * (event.shiftKey ? 10 : 1);
  update(moveRect(rect, step[0] * pixels, step[1] * pixels, natural));
});

// --- Typed sizes: applied while typing when the number is whole; the field is tidied when it loses focus.

function parseField(value: string) {
  // Full-width digits, as Japanese keyboards type them.
  const ascii = value.trim().replace(/[０-９]/g, digit => String.fromCharCode(digit.charCodeAt(0) - 0xfee0));
  return /^\d+$/.test(ascii) ? Number(ascii) : undefined;
}

for (const [name, field] of fields) {
  field.addEventListener('input', () => {
    if (running || !file) return;
    const value = parseField(field.value);
    if (value === undefined || ((name === 'width' || name === 'height') && value < 1)) return;
    update(setField(rect, name, value, natural, ratio()), { keepField: field });
  });
  // Only the field is tidied: the box is already drawn. Changing the Crop button here, as the field loses focus to a
  // click on it, makes WebKit drop that click.
  field.addEventListener('change', () => { field.value = String(rect[name]); });
}

// --- Options: changing one clears a finished crop, since it no longer matches.

function chipGroup(attribute: string, apply: (value: string) => void) {
  const chips = root.querySelectorAll<HTMLButtonElement>(`[data-${attribute}]`);
  chips.forEach(chip => chip.addEventListener('click', () => {
    if (running) return;
    select(attribute, chip.getAttribute(`data-${attribute}`)!);
    apply(chip.getAttribute(`data-${attribute}`)!);
    refreshOptions();
    if (file) render();
    outdated();
  }));
}

chipGroup('ratio', value => {
  ratioChoice = value as RatioChoice;
  swapped = false;
  if (file) rect = applyRatio(rect, natural, ratio());
});
chipGroup('format', value => { format = value as CropFormat; });
chipGroup('quality', value => { quality = Number(value); });
chipGroup('output-size', value => { circleOptions = { ...circleOptions, size: (value === 'original' ? value : Number(value)) as CircleSize }; });
chipGroup('background', value => { circleOptions = { ...circleOptions, background: value as Background }; });
chipGroup('border', value => { circleOptions = { ...circleOptions, border: value as Border }; });
chipGroup('border-color', value => { circleOptions = { ...circleOptions, borderColor: value as BorderColor }; });

swapButton?.addEventListener('click', () => {
  if (running || !canSwap(ratioChoice)) return;
  swapped = !swapped;
  if (file) rect = applyRatio(rect, natural, ratio());
  refreshOptions();
  if (file) render();
  outdated();
});

$('crop-reset').addEventListener('click', () => {
  if (running || !file) return;
  update(initialCrop(natural, ratio()));
});

// --- Cropping

async function crop() {
  if (!file || running) return;
  const run = generation;
  const options: CropOptions = { format, quality, circle: circle ? { ...circleOptions } : undefined };
  const area = { ...rect };
  clearResult();
  running = true;
  render();
  showStatus(t('crop.cropping'));
  let response = await ask({ file, shown: natural, rect: area, options });
  if (run !== generation) return;
  // The worker can't draw in this browser: draw on the page instead, slower but the same result.
  if ('error' in response && response.error.code === 'unsupported') response = await cropHere(file, area, options);
  if (run !== generation) return;
  running = false;
  render();
  const trackParams = circle
    ? { format, quality: format === 'png' ? undefined : quality, output_width: circleOptions.size, background: circleOptions.background, border: circleOptions.border, border_color: circleOptions.border === 'none' ? undefined : circleOptions.borderColor }
    : { format, quality: format === 'png' ? undefined : quality, ratio: ratioLabel(ratioChoice, swapped) };
  if (!('result' in response)) {
    const code = 'error' in response ? response.error.code : 'general';
    showStatus(t(ERROR_KEYS[code] ?? 'crop.errGeneral', { size: formatNumber(LIMITS.fileBytes / 1024 / 1024), pixels: formatNumber(LIMITS.pixels / 1_000_000) }), true);
    trackResult('error', { code, ...trackParams });
    return;
  }
  finish(response.result, area, trackParams);
}

async function cropHere(source: File, area: Rect, options: CropOptions): Promise<CropResponse> {
  try {
    const { cropImage } = await import('../lib/crop-image-render');
    return { id: 0, result: await cropImage(source, natural, area, options) };
  } catch (error) {
    const code = error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : 'general';
    return { id: 0, error: { code } };
  }
}

function finish(done: CropResult, area: Rect, trackParams: Record<string, string | number | undefined>) {
  const blob = new Blob([done.data as BlobPart], { type: { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[format] });
  cropped = { blob, url: URL.createObjectURL(blob) };
  download.dataset.name = croppedName(file!.name, format, shape);
  $('crop-summary').textContent = t('crop.summary', { width: formatNumber(done.width), height: formatNumber(done.height), size: formatBytes(blob.size) });
  preview.src = cropped.url;
  const notes: string[] = [];
  if (done.scale < 1) notes.push(t('crop.noteScaled', { width: formatNumber(done.width), height: formatNumber(done.height) }));
  else if (circle && circleOptions.size !== 'original' && circleOptions.size > area.width) notes.push(t('circle.noteSmaller', { size: formatNumber(area.width) }));
  $('crop-note').textContent = notes.join(' ');
  download.textContent = t(`${prefix}.download`, { format: FORMAT_NAMES[format] });
  result.hidden = false;
  convertButton.hidden = true;
  showStatus(t('crop.done'));
  trackResult('success', { ...trackParams, scaled: done.scale < 1 ? true : undefined, output_size: sizeBucket(blob.size) });
}

download.addEventListener('click', () => {
  if (!cropped) return;
  const link = document.createElement('a');
  link.href = cropped.url;
  link.download = download.dataset.name ?? '';
  link.click();
});

const pick = () => { input.value = ''; input.click(); };
$('crop-choose').addEventListener('click', pick);
$('crop-change').addEventListener('click', pick);
convertButton.addEventListener('click', () => { void crop(); });
input.addEventListener('change', () => { void open(Array.from(input.files ?? [])); });

root.addEventListener('dragover', event => { event.preventDefault(); root.classList.add('over'); });
root.addEventListener('dragleave', event => { if (!root.contains(event.relatedTarget as Node)) root.classList.remove('over'); });
root.addEventListener('drop', event => {
  event.preventDefault();
  root.classList.remove('over');
  void open(Array.from(event.dataTransfer?.files ?? []));
});
// The box is drawn in percentages, but whether the edge handles fit depends on the shown size.
window.addEventListener('resize', () => { if (file) render(); });
window.addEventListener('pagehide', () => { if (sourceUrl) URL.revokeObjectURL(sourceUrl); if (cropped) URL.revokeObjectURL(cropped.url); });
refreshOptions();
