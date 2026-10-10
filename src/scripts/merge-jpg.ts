import { byName, isImageFile, LIMITS, mergedName, type ImageOptions, type MergeOutput, type PdfOptions, type Size } from '../lib/merge-jpg';
import type { MergeRequest, MergeResponse, MergeResult } from '../workers/merge-jpg';
import { i18nFrom } from '../i18n/client';
import { sizeBucket, trackResult } from '../lib/analytics';

const root = document.querySelector<HTMLElement>('#merge-tool')!;
const { t, counted, formatNumber, formatBytes } = i18nFrom(root);
const fixed = root.dataset.fixed === 'true';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = $<HTMLInputElement>('merge-files');
const panel = $('merge-panel');
const empty = $('merge-empty');
const status = $('merge-status');
const list = $('merge-list');
const inputNote = $('merge-input-note');
const result = $('merge-result');
const preview = $<HTMLImageElement>('merge-preview');
const convertButton = $<HTMLButtonElement>('merge-convert');
const download = $<HTMLButtonElement>('merge-download');
// Reading one image is quick; a merge reports progress after every image, and each report restarts the clock.
const MEASURE_TIMEOUT_MS = 60_000;
const IDLE_TIMEOUT_MS = 120_000;
const ERROR_KEYS: Record<string, string> = {
  decode: 'merge.errDecode', canvas: 'merge.errCanvas', worker: 'merge.errWorker', timeout: 'merge.errTimeout',
  tooLarge: 'merge.errDecode', tooManyPixels: 'merge.errDecode', unsupported: 'merge.errCanvas',
};
const ICONS = {
  up: '<path d="M10 15V5M5 10l5-5 5 5"/>',
  down: '<path d="M10 5v10M5 10l5 5 5-5"/>',
  remove: '<path d="M5 5l10 10M15 5L5 15"/>',
};

type Item = { file: File; url: string; size?: Size; row: HTMLLIElement };

let output = root.dataset.initialOutput as MergeOutput;
let imageOptions: ImageOptions = { layout: 'vertical', columns: 2, fit: 'match', gap: 0, background: 'white', quality: 0.9 };
let pdfOptions: PdfOptions = { pageSize: root.dataset.paper as PdfOptions['pageSize'], orientation: 'auto', margin: 'small' };
let items: Item[] = [];
let merged: { blob: Blob; url: string; output: MergeOutput } | undefined;
let generation = 0;
let measuring = false;
let running = false;
// Input notes, kept until the next fresh start: files left out, and why.
let skipped = 0;
let limited = 0;
let unreadable: string[] = [];
let tooBig: string[] = [];

function showStatus(message: string, error = false) {
  status.textContent = message;
  status.hidden = !message;
  status.classList.toggle('error', error);
}

// --- Worker: one request at a time. A worker that hangs or crashes is replaced.
let worker: Worker | undefined;
let pending: { id: number; resolve: (response: MergeResponse) => void; onProgress?: (done: number) => void; timer: number; timeout: number } | undefined;
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

type Outgoing = MergeRequest extends infer R ? (R extends MergeRequest ? Omit<R, 'id'> : never) : never;

function ask(request: Outgoing, timeout: number, onProgress?: (done: number) => void): Promise<MergeResponse> {
  if (!worker) {
    worker = new Worker(new URL('../workers/merge-jpg.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<MergeResponse>) => {
      if (!pending || event.data.id !== pending.id) return;
      clearTimeout(pending.timer);
      if ('progress' in event.data) {
        pending.timer = window.setTimeout(() => stopWorker('timeout'), pending.timeout);
        pending.onProgress?.(event.data.progress);
        return;
      }
      const { resolve } = pending;
      pending = undefined;
      resolve(event.data);
    };
    // A worker that runs out of memory dies with the message.
    worker.onerror = () => stopWorker('worker');
  }
  const id = ++sequence;
  return new Promise(resolve => {
    pending = { id, resolve, onProgress, timeout, timer: window.setTimeout(() => stopWorker('timeout'), timeout) };
    worker!.postMessage({ ...request, id } as MergeRequest);
  });
}

// --- The list of images

const ready = () => items.filter(item => item.size);

function icon(name: keyof typeof ICONS) {
  return `<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" aria-hidden="true">${ICONS[name]}</svg>`;
}

function rowButton(name: keyof typeof ICONS, label: string, action: () => void) {
  const button = document.createElement('button');
  button.type = 'button';
  // A class, not a data attribute: the page-wide analytics would report a data attribute as an option.
  button.className = `merge-icon merge-${name}`;
  button.setAttribute('aria-label', label);
  button.innerHTML = icon(name);
  button.addEventListener('click', () => { if (!running) action(); });
  return button;
}

function createRow(item: Item) {
  const row = document.createElement('li');
  row.className = 'merge-row';
  const image = document.createElement('img');
  image.src = item.url;
  image.alt = '';
  image.loading = 'lazy';
  image.decoding = 'async';
  const text = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = item.file.name;
  const meta = document.createElement('span');
  meta.textContent = t('merge.rowReading');
  text.append(title, meta);
  const buttons = document.createElement('div');
  buttons.className = 'merge-row-buttons';
  buttons.append(
    rowButton('up', t('merge.moveUp', { name: item.file.name }), () => move(item, -1)),
    rowButton('down', t('merge.moveDown', { name: item.file.name }), () => move(item, 1)),
    rowButton('remove', t('merge.remove', { name: item.file.name }), () => remove(item)),
  );
  row.append(image, text, buttons);
  return row;
}

function move(item: Item, step: number) {
  const from = items.indexOf(item);
  const to = from + step;
  if (to < 0 || to >= items.length) return;
  items.splice(from, 1);
  items.splice(to, 0, item);
  if (step < 0) list.insertBefore(item.row, items[to + 1].row);
  else list.insertBefore(item.row, items[to - 1].row.nextSibling);
  // Keep focus on the arrow that was pressed, unless the row reached the end and the arrow is now disabled.
  const button = item.row.querySelector<HTMLButtonElement>(`.merge-${step < 0 ? 'up' : 'down'}`)!;
  refresh();
  (button.disabled ? item.row.querySelector<HTMLButtonElement>(`.merge-${step < 0 ? 'down' : 'up'}`)! : button).focus();
  outdated();
}

function remove(item: Item) {
  const index = items.indexOf(item);
  items.splice(index, 1);
  item.row.remove();
  URL.revokeObjectURL(item.url);
  if (!items.length) { startOver(); return; }
  refresh();
  (items[Math.min(index, items.length - 1)].row.querySelector<HTMLButtonElement>('.merge-remove'))!.focus();
  outdated();
}

function clearResult() {
  if (merged) URL.revokeObjectURL(merged.url);
  merged = undefined;
  preview.removeAttribute('src');
  result.hidden = true;
  convertButton.hidden = false;
}

/** A finished merge no longer matches once the images or options change. */
function outdated() {
  if (merged || !result.hidden) { clearResult(); showStatus(''); }
}

function startOver() {
  generation++;
  if (pending) stopWorker('cancelled');
  running = false;
  measuring = false;
  items.forEach(item => URL.revokeObjectURL(item.url));
  items = [];
  list.replaceChildren();
  skipped = limited = 0;
  unreadable = [];
  tooBig = [];
  clearResult();
  panel.hidden = true;
  empty.hidden = false;
  showStatus('');
}

function refresh() {
  const count = items.length;
  const total = items.reduce((sum, item) => sum + item.file.size, 0);
  $('merge-name').textContent = counted('merge.fileCount', count);
  $('merge-size').textContent = formatBytes(total);
  $('merge-title').textContent = counted(output === 'pdf' ? 'merge.titlePdf' : 'merge.titleImage', Math.max(count, 1));
  $('merge-advice').textContent = t(output === 'pdf' ? 'merge.advicePdf' : 'merge.adviceImage');
  convertButton.textContent = t(output === 'pdf' ? 'merge.convertPdf' : 'merge.convertImage');
  convertButton.disabled = running || measuring || !ready().length;
  items.forEach((item, index) => {
    item.row.querySelector<HTMLButtonElement>('.merge-up')!.disabled = index === 0;
    item.row.querySelector<HTMLButtonElement>('.merge-down')!.disabled = index === count - 1;
  });
  root.querySelectorAll<HTMLElement>('[data-show]').forEach(group => {
    const show = group.dataset.show;
    group.hidden = !(show === output
      || (show === 'grid' && output === 'image' && imageOptions.layout === 'grid')
      || (show === 'paper' && output === 'pdf' && pdfOptions.pageSize !== 'fit'));
  });
  const notes: string[] = [];
  if (limited) notes.push(counted('merge.noteLimit', limited, { files: formatNumber(LIMITS.files), size: formatNumber(LIMITS.totalBytes / 1024 / 1024) }));
  if (skipped) notes.push(counted('merge.noteSkipped', skipped));
  if (unreadable.length) notes.push(counted('merge.noteUnreadable', unreadable.length, { names: unreadable.join(', ') }));
  if (tooBig.length) notes.push(counted('merge.noteTooBig', tooBig.length, { names: tooBig.join(', ') }));
  inputNote.textContent = notes.join(' ');
  inputNote.hidden = !notes.length;
}

function add(files: File[], fresh: boolean) {
  if (!files.length || running) return;
  if (fresh) startOver();
  const images = files.filter(isImageFile);
  skipped += files.length - images.length;
  let total = items.reduce((sum, item) => sum + item.file.size, 0);
  const accepted: File[] = [];
  // Files the browser picked in an unknown order are added by name, after the ones already in the list.
  for (const file of byName(images)) {
    if (items.length + accepted.length >= LIMITS.files || total + file.size > LIMITS.totalBytes) { limited++; continue; }
    accepted.push(file);
    total += file.size;
  }
  for (const file of accepted) {
    const item: Item = { file, url: URL.createObjectURL(file), row: undefined as unknown as HTMLLIElement };
    item.row = createRow(item);
    items.push(item);
    list.append(item.row);
  }
  if (!items.length) {
    showStatus(t(root.dataset.source === 'jfif' ? 'jfifPdf.errNoImages' : 'merge.errNoImages'), true);
    trackResult('error', { code: 'wrongType' });
    skipped = limited = 0;
    return;
  }
  empty.hidden = true;
  panel.hidden = false;
  showStatus('');
  outdated();
  refresh();
  void measureAll();
}

async function measureAll() {
  if (measuring) return;
  measuring = true;
  const run = generation;
  refresh();
  for (let item = items.find(entry => !entry.size); item; item = items.find(entry => !entry.size)) {
    const done = ready().length;
    showStatus(t('merge.reading', { current: formatNumber(done + 1), total: formatNumber(items.length) }));
    const response = await ask({ type: 'measure', file: item.file }, MEASURE_TIMEOUT_MS);
    if (run !== generation) return;
    // The image may have been removed while it was being read.
    if (!items.includes(item)) continue;
    if ('size' in response) {
      item.size = response.size;
      item.row.querySelector('span')!.textContent = t('merge.rowMeta', { width: formatNumber(response.size.width), height: formatNumber(response.size.height), size: formatBytes(item.file.size) });
      continue;
    }
    const code = 'error' in response ? response.error.code : 'general';
    (code === 'tooLarge' || code === 'tooManyPixels' ? tooBig : unreadable).push(item.file.name);
    items.splice(items.indexOf(item), 1);
    item.row.remove();
    URL.revokeObjectURL(item.url);
  }
  measuring = false;
  if (!items.length) {
    const notes = inputNote.textContent;
    startOver();
    showStatus(`${t(root.dataset.source === 'jfif' ? 'jfifPdf.errNoImages' : 'merge.errNoImages')} ${notes ?? ''}`.trim(), true);
    trackResult('error', { code: 'readError' });
    return;
  }
  showStatus('');
  refresh();
}

// --- Merging

async function merge() {
  const images = ready();
  if (!images.length || running || measuring) return;
  const run = generation;
  const current = output;
  const options = current === 'pdf' ? { ...pdfOptions } : { ...imageOptions };
  clearResult();
  running = true;
  refresh();
  const total = formatNumber(images.length);
  const onProgress = (done: number) => showStatus(done < images.length
    ? t('merge.merging', { current: formatNumber(done + 1), total })
    : t(current === 'pdf' ? 'merge.savingPdf' : 'merge.savingImage'));
  onProgress(0);
  const files = images.map(item => item.file);
  const sizes = images.map(item => item.size!);
  let response = current === 'pdf'
    ? await ask({ type: 'pdf', files, options: options as PdfOptions }, IDLE_TIMEOUT_MS, onProgress)
    : await ask({ type: 'image', files, sizes, options: options as ImageOptions }, IDLE_TIMEOUT_MS, onProgress);
  if (run !== generation) return;
  // The worker can't draw in this browser: draw on the page instead, slower but the same result.
  if ('error' in response && response.error.code === 'unsupported') response = await mergeHere(current, files, sizes, options, onProgress);
  if (run !== generation) return;
  running = false;
  const trackParams = current === 'pdf'
    ? { output: current, image_count: images.length, page_size: pdfOptions.pageSize, orientation: pdfOptions.pageSize === 'fit' ? undefined : pdfOptions.orientation, margin: pdfOptions.pageSize === 'fit' ? undefined : pdfOptions.margin }
    : { output: current, image_count: images.length, layout: imageOptions.layout, columns: imageOptions.layout === 'grid' ? imageOptions.columns : undefined, fit: imageOptions.fit, gap: imageOptions.gap, background: imageOptions.background, quality: imageOptions.quality };
  if (!('result' in response)) {
    const code = 'error' in response ? response.error.code : 'general';
    showStatus(t(ERROR_KEYS[code] ?? 'merge.errGeneral'), true);
    refresh();
    trackResult('error', { code, ...trackParams });
    return;
  }
  finish(response.result, current, images[0].file.name, trackParams);
}

async function mergeHere(current: MergeOutput, files: File[], sizes: Size[], options: ImageOptions | PdfOptions, onProgress: (done: number) => void): Promise<MergeResponse> {
  try {
    const { mergeImage, mergePdf } = await import('../lib/merge-jpg-render');
    const result = current === 'pdf'
      ? await mergePdf(files, options as PdfOptions, onProgress)
      : await mergeImage(files, sizes, options as ImageOptions, onProgress);
    return { id: 0, result };
  } catch (error) {
    const code = error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : 'general';
    return { id: 0, error: { code } };
  }
}

function finish(done: MergeResult, current: MergeOutput, firstName: string, trackParams: Record<string, string | number | undefined>) {
  const blob = new Blob([done.data as BlobPart], { type: current === 'pdf' ? 'application/pdf' : 'image/jpeg' });
  merged = { blob, url: URL.createObjectURL(blob), output: current };
  download.dataset.name = mergedName(firstName, current, root.dataset.source === 'jfif' && items.length === 1);
  const notes: string[] = [];
  if (current === 'pdf') {
    $('merge-summary').textContent = counted('merge.summaryPdf', done.pages ?? 0, { size: formatBytes(blob.size) });
    preview.hidden = true;
    if (done.reencoded) notes.push(counted('merge.noteReencoded', done.reencoded));
  } else {
    $('merge-summary').textContent = t('merge.summaryImage', { width: formatNumber(done.width!), height: formatNumber(done.height!), size: formatBytes(blob.size) });
    preview.src = merged.url;
    preview.hidden = false;
    if (done.scale !== undefined && done.scale < 1) notes.push(t('merge.noteScaled', { width: formatNumber(done.width!), height: formatNumber(done.height!) }));
  }
  $('merge-note').textContent = notes.join(' ');
  download.textContent = t(current === 'pdf' ? 'merge.downloadPdf' : 'merge.downloadImage');
  result.hidden = false;
  convertButton.hidden = true;
  showStatus(t(current === 'pdf' ? 'merge.donePdf' : 'merge.doneImage'));
  refresh();
  trackResult('success', { ...trackParams, scaled: done.scale !== undefined && done.scale < 1 ? true : undefined, reencoded: done.reencoded || undefined, output_size: sizeBucket(blob.size) });
}

download.addEventListener('click', () => {
  if (!merged) return;
  const link = document.createElement('a');
  link.href = merged.url;
  link.download = download.dataset.name ?? '';
  link.click();
});

// --- Options: changing one clears a finished merge, since it no longer matches.

function chipGroup(attribute: string, apply: (value: string) => void) {
  const buttons = root.querySelectorAll<HTMLButtonElement>(`[data-${attribute}]`);
  buttons.forEach(button => button.addEventListener('click', () => {
    if (running) return;
    buttons.forEach(other => other.setAttribute('aria-pressed', String(other === button)));
    apply(button.getAttribute(`data-${attribute}`)!);
    refresh();
    outdated();
  }));
}

if (!fixed) chipGroup('output', value => { output = value as MergeOutput; });
chipGroup('layout', value => { imageOptions = { ...imageOptions, layout: value as ImageOptions['layout'] }; });
chipGroup('columns', value => { imageOptions = { ...imageOptions, columns: Number(value) }; });
chipGroup('fit', value => { imageOptions = { ...imageOptions, fit: value as ImageOptions['fit'] }; });
chipGroup('gap', value => { imageOptions = { ...imageOptions, gap: Number(value) }; });
chipGroup('background', value => { imageOptions = { ...imageOptions, background: value as ImageOptions['background'] }; });
chipGroup('quality', value => { imageOptions = { ...imageOptions, quality: Number(value) }; });
chipGroup('page-size', value => { pdfOptions = { ...pdfOptions, pageSize: value as PdfOptions['pageSize'] }; });
chipGroup('orientation', value => { pdfOptions = { ...pdfOptions, orientation: value as PdfOptions['orientation'] }; });
chipGroup('margin', value => { pdfOptions = { ...pdfOptions, margin: value as PdfOptions['margin'] }; });

let appending = false;
const pick = (append: boolean) => { appending = append; input.value = ''; input.click(); };
$('merge-choose').addEventListener('click', () => pick(false));
$('merge-change').addEventListener('click', () => pick(false));
$('merge-add').addEventListener('click', () => pick(true));
convertButton.addEventListener('click', () => { void merge(); });
input.addEventListener('change', () => add(Array.from(input.files ?? []), !appending));

root.addEventListener('dragover', event => { event.preventDefault(); root.classList.add('over'); });
root.addEventListener('dragleave', event => { if (!root.contains(event.relatedTarget as Node)) root.classList.remove('over'); });
root.addEventListener('drop', event => {
  event.preventDefault();
  root.classList.remove('over');
  // Dropping onto a list adds to it; dropping onto the empty zone starts a new one.
  add(Array.from(event.dataTransfer?.files ?? []), !items.length);
});
window.addEventListener('pagehide', () => { items.forEach(item => URL.revokeObjectURL(item.url)); if (merged) URL.revokeObjectURL(merged.url); });
refresh();
