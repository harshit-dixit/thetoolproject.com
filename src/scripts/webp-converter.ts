import { baseName, LIMITS, MIME, outputPath, uniquePaths, type Background, type ConvertOptions, type OutputFormat, type SvgMode } from '../lib/webp-convert';
import type { ConvertResult, WebpRequest, WebpResponse } from '../workers/webp-converter';
import { createZipBlob } from '../lib/zip';
import { i18nFrom } from '../i18n/client';
import { sizeBucket, trackResult } from '../lib/analytics';

const root = document.querySelector<HTMLElement>('#webp-tool')!;
const { t, counted, formatNumber, formatBytes } = i18nFrom(root);
const fixed = root.dataset.fixed === 'true';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = $<HTMLInputElement>('webp-files');
const panel = $('webp-panel');
const empty = $('webp-empty');
const status = $('webp-status');
const result = $('webp-result');
const list = $('webp-list');
const convertButton = $<HTMLButtonElement>('webp-convert');
const download = $<HTMLButtonElement>('webp-download');
// Tracing a large image or reading a long animation can take a while on a phone; a damaged file shouldn't spin forever.
const CONVERT_TIMEOUT_MS = 120_000;
const UNZIP_TIMEOUT_MS = 300_000;
const REASON_KEYS: Record<string, string> = {
  decode: 'webp.reasonDecode', tooLarge: 'webp.reasonTooLarge', tooManyPixels: 'webp.reasonTooManyPixels',
  animationTooLong: 'webp.reasonAnimationTooLong', canvas: 'webp.reasonCanvas', timeout: 'webp.reasonTimeout', worker: 'webp.reasonWorker',
};
const BATCH_ERROR_KEYS: Record<string, string> = {
  notZip: 'webp.errNotZip', zipUnsupported: 'webp.errZipUnsupported', zipTooLarge: 'webp.errZipTooLarge', worker: 'webp.errWorker', timeout: 'webp.errWorker',
};

type Item = { path: string; blob: Blob };
type Output = ConvertResult & { path: string; blob: Blob; url: string };

let options: ConvertOptions = { format: root.dataset.initialFormat as OutputFormat, quality: 0.9, background: 'white', svgMode: 'trace', colors: 16 };
let items: Item[] = [];
let outputs: Output[] = [];
let skipped = 0;
let locked = 0;
let zipName: string | undefined;
let generation = 0;
let running = false;

const formatLabel = () => options.format.toUpperCase();

function showStatus(message: string, error = false) {
  status.textContent = message;
  status.hidden = !message;
  status.classList.toggle('error', error);
}

// --- Worker: one request at a time, each with its own timeout. A worker that hangs or crashes is replaced.
let worker: Worker | undefined;
let pending: { id: number; resolve: (response: WebpResponse) => void; timer: number } | undefined;
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

// Omit on each member of the union, so a request keeps the fields of its own type.
type Outgoing = WebpRequest extends infer R ? (R extends WebpRequest ? Omit<R, 'id'> : never) : never;

function ask(request: Outgoing, timeout: number): Promise<WebpResponse> {
  if (!worker) {
    worker = new Worker(new URL('../workers/webp-converter.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<WebpResponse>) => {
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
    pending = { id, resolve, timer: window.setTimeout(() => stopWorker('timeout'), timeout) };
    worker!.postMessage({ ...request, id } as WebpRequest);
  });
}

// --- Choosing files

const isZip = (file: File) => /\.zip$/i.test(file.name) || /^application\/(x-)?zip(-compressed)?$/.test(file.type);
const isWebpFile = (file: File) => /\.webp$/i.test(file.name) || file.type === 'image/webp';
const stripExtension = (name: string) => name.replace(/\.[^.]*$/, '') || 'images';

function clearOutputs() {
  outputs.forEach(output => URL.revokeObjectURL(output.url));
  outputs = [];
  list.replaceChildren();
  result.hidden = true;
  convertButton.hidden = false;
  convertButton.disabled = !items.length || running;
}

function reset() {
  generation++;
  if (pending) stopWorker('cancelled');
  running = false;
  items = [];
  skipped = 0;
  locked = 0;
  zipName = undefined;
  clearOutputs();
  showStatus('');
}

function failBatch(code: string, message: string) {
  items = [];
  panel.hidden = true;
  empty.hidden = false;
  showStatus(message, true);
  trackResult('error', { code });
}

async function choose(files: File[]) {
  if (!files.length) return;
  reset();
  const run = generation;
  const zips = files.filter(isZip);
  const images = files.filter(file => !isZip(file));
  const direct = images.filter(isWebpFile);
  skipped = images.length - direct.length;
  const found: Item[] = direct.map(file => ({ path: file.name, blob: file }));
  // Open the panel right away so the frame doesn't jump when the list arrives.
  empty.hidden = true;
  panel.hidden = false;
  showPanel(found);
  if (zips.length) {
    $('webp-name').textContent = files.length === 1 ? files[0].name : counted('webp.fileCount', files.length);
    $('webp-size').textContent = formatBytes(files.reduce((sum, file) => sum + file.size, 0));
  }
  for (const zip of zips) {
    showStatus(t('webp.reading'));
    convertButton.disabled = true;
    const response = await ask({ type: 'unzip', file: zip }, UNZIP_TIMEOUT_MS);
    if (run !== generation) return;
    if ('error' in response) {
      failBatch(response.error.code, t(BATCH_ERROR_KEYS[response.error.code] ?? 'webp.errNotZip'));
      return;
    }
    if (!('entries' in response)) return;
    // With several sources, each ZIP's files go in a folder named after it so names from different ZIPs can't collide.
    const prefix = files.length > 1 ? `${stripExtension(zip.name)}/` : '';
    found.push(...response.entries.map(entry => ({ path: prefix + entry.path, blob: entry.blob })));
    skipped += response.other;
    locked += response.locked;
  }
  if (zips.length === 1 && !images.length) zipName = stripExtension(zips[0].name);
  if (!found.length) { failBatch(locked ? 'zipLocked' : 'noWebp', t(locked ? 'webp.errZipLocked' : 'webp.errNoWebp')); return; }
  if (found.length > LIMITS.files) { failBatch('tooMany', t('webp.errTooMany', { max: formatNumber(LIMITS.files) })); return; }
  items = found;
  showPanel(items);
  showStatus('');
}

function showPanel(current: Item[]) {
  const total = current.reduce((sum, item) => sum + item.blob.size, 0);
  $('webp-name').textContent = current.length === 1 ? baseName(current[0].path) : counted('webp.fileCount', current.length);
  $('webp-size').textContent = current.length ? formatBytes(total) : '';
  updateLabels(current.length);
  convertButton.disabled = !current.length;
}

function updateLabels(count = items.length) {
  $('webp-title').textContent = counted('webp.title', Math.max(count, 1), { format: formatLabel() });
  const advice = options.format === 'svg' ? (options.svgMode === 'trace' ? 'webp.adviceTrace' : 'webp.adviceEmbed')
    : ({ png: 'webp.advicePng', jpg: 'webp.adviceJpg', gif: 'webp.adviceGif' } as const)[options.format];
  $('webp-advice').textContent = t(advice);
  convertButton.textContent = t('webp.convertButton', { format: formatLabel() });
  root.querySelectorAll<HTMLElement>('[data-show]').forEach(group => {
    const show = group.dataset.show;
    group.hidden = !(show === options.format || (show === 'trace' && options.format === 'svg' && options.svgMode === 'trace'));
  });
}

// --- Converting

function row(name: string, detail: string, output?: Output) {
  const item = document.createElement('li');
  item.className = output ? 'webp-row' : 'webp-row failed';
  if (output) {
    const image = document.createElement('img');
    image.src = output.url;
    image.alt = '';
    image.loading = 'lazy';
    image.decoding = 'async';
    item.append(image);
  }
  const text = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = name;
  const meta = document.createElement('span');
  meta.textContent = detail;
  text.append(title, meta);
  item.append(text);
  if (output) {
    const link = document.createElement('a');
    link.href = output.url;
    link.download = baseName(output.path);
    link.textContent = t('webp.download');
    item.append(link);
  }
  return item;
}

async function convertAll() {
  if (!items.length || running) return;
  const run = generation;
  const current = { ...options };
  clearOutputs();
  running = true;
  convertButton.disabled = true;
  const paths = uniquePaths(items.map(item => outputPath(item.path, current.format)));
  const failures: string[] = [];
  result.hidden = false;
  download.hidden = true;
  $('webp-summary').textContent = '';
  $('webp-note').textContent = '';
  for (let i = 0; i < items.length; i++) {
    showStatus(t('webp.converting', { current: formatNumber(i + 1), total: formatNumber(items.length) }));
    const response = await ask({ type: 'convert', file: items[i].blob, options: current }, CONVERT_TIMEOUT_MS);
    if (run !== generation) return;
    if ('result' in response) {
      const blob = new Blob([response.result.data as BlobPart], { type: MIME[current.format] });
      const output: Output = { ...response.result, path: paths[i], blob, url: URL.createObjectURL(blob) };
      outputs.push(output);
      list.append(row(baseName(paths[i]), t('webp.rowMeta', { width: formatNumber(output.width), height: formatNumber(output.height), size: formatBytes(blob.size) }), output));
    } else {
      const code = 'error' in response ? response.error.code : 'general';
      failures.push(code);
      list.append(row(baseName(items[i].path), t(REASON_KEYS[code] ?? 'webp.reasonGeneral')));
    }
  }
  running = false;
  finish(current, failures);
}

function finish(current: ConvertOptions, failures: string[]) {
  const size = outputs.reduce((sum, output) => sum + output.blob.size, 0);
  const notes: string[] = [];
  const firstFrame = outputs.filter(output => output.firstFrameOnly).length;
  if (firstFrame) notes.push(counted(current.format === 'gif' ? 'webp.noteNoAnimation' : 'webp.noteFirstFrame', firstFrame, { format: current.format.toUpperCase() }));
  const traced = outputs.filter(output => output.tracedAt).length;
  if (traced) notes.push(counted('webp.noteTraced', traced));
  if (outputs.some(output => output.partialAlpha)) notes.push(t('webp.notePartialAlpha'));
  if (failures.length && outputs.length) notes.push(counted('webp.noteFailed', failures.length));
  if (skipped) notes.push(counted('webp.noteSkipped', skipped));
  if (locked) notes.push(counted('webp.noteLocked', locked));
  $('webp-note').textContent = notes.join(' ');
  const trackParams = {
    format: current.format, image_count: outputs.length, failed: failures.length || undefined, skipped: skipped + locked || undefined,
    animated: outputs.filter(output => output.frames > 1).length || undefined, zip_input: zipName ? true : undefined,
    quality: current.format === 'jpg' ? current.quality : undefined, background: current.format === 'jpg' ? current.background : undefined,
    svg_mode: current.format === 'svg' ? current.svgMode : undefined, colors: current.format === 'svg' && current.svgMode === 'trace' ? current.colors : undefined,
  };
  if (!outputs.length) {
    $('webp-summary').textContent = '';
    showStatus(t('webp.errNoneConverted'), true);
    convertButton.disabled = false;
    trackResult('error', { code: failures[0] ?? 'general', ...trackParams });
    return;
  }
  $('webp-summary').textContent = counted('webp.summary', outputs.length, { format: current.format.toUpperCase(), size: formatBytes(size) });
  download.textContent = outputs.length === 1 ? t('webp.downloadOne', { format: current.format.toUpperCase() }) : t('webp.downloadZip');
  download.hidden = false;
  convertButton.hidden = true;
  showStatus(counted('webp.converted', outputs.length));
  trackResult('success', { ...trackParams, output_size: sizeBucket(size) });
}

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

download.addEventListener('click', () => {
  if (!outputs.length) return;
  if (outputs.length === 1) { save(outputs[0].blob, baseName(outputs[0].path)); return; }
  const format = outputs[0].path.slice(outputs[0].path.lastIndexOf('.') + 1);
  save(createZipBlob(outputs.map(output => ({ name: output.path, blob: output.blob, crc: output.crc }))), `${zipName ?? 'webp'}-${format}.zip`);
});

// --- Options: changing one clears finished results, since they no longer match.

function chipGroup(attribute: string, apply: (value: string) => void) {
  const buttons = root.querySelectorAll<HTMLButtonElement>(`[data-${attribute}]`);
  buttons.forEach(button => button.addEventListener('click', () => {
    if (running) return;
    buttons.forEach(other => other.setAttribute('aria-pressed', String(other === button)));
    apply(button.getAttribute(`data-${attribute}`)!);
    updateLabels();
    if (outputs.length || !result.hidden) { clearOutputs(); showStatus(''); }
  }));
}

if (!fixed) chipGroup('format', value => { options = { ...options, format: value as OutputFormat }; });
chipGroup('quality', value => { options = { ...options, quality: Number(value) }; });
chipGroup('background', value => { options = { ...options, background: value as Background }; });
chipGroup('svg-mode', value => { options = { ...options, svgMode: value as SvgMode }; });
chipGroup('colors', value => { options = { ...options, colors: Number(value) }; });

const pick = () => { input.value = ''; input.click(); };
$('webp-choose').addEventListener('click', pick);
$('webp-change').addEventListener('click', pick);
convertButton.addEventListener('click', () => { void convertAll(); });
input.addEventListener('change', () => { void choose(Array.from(input.files ?? [])); });

root.addEventListener('dragover', event => { event.preventDefault(); root.classList.add('over'); });
root.addEventListener('dragleave', event => { if (!root.contains(event.relatedTarget as Node)) root.classList.remove('over'); });
root.addEventListener('drop', event => {
  event.preventDefault();
  root.classList.remove('over');
  void choose(Array.from(event.dataTransfer?.files ?? []));
});
window.addEventListener('pagehide', () => outputs.forEach(output => URL.revokeObjectURL(output.url)));
updateLabels(0);
