import type { ExcelErrorCode, NumberMode, Separator, SheetInfo } from '../lib/excel-to-csv';
import type { ConvertedSheet, ExcelRequest } from '../workers/excel-to-csv';
import { i18nFrom } from '../i18n/client';
import { sizeBucket, trackResult } from '../lib/analytics';

type ErrorKey = ExcelErrorCode | 'wrongType' | 'tooLarge' | 'workerError';
type Pending = { resolve: (data: any) => void; reject: (code: ErrorKey) => void };
type Draft<T> = T extends unknown ? Omit<T, 'id'> : never;

const root = document.querySelector<HTMLElement>('#excel-tool')!;
const { t, counted, formatNumber, formatBytes } = i18nFrom(root);
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const fileInput = $<HTMLInputElement>('excel-file');
const empty = $('excel-empty');
const panel = $('excel-panel');
const status = $('status');
const table = $<HTMLTableElement>('preview-table');
const preview = $('sheet-preview');
const csvView = $<HTMLPreElement>('csv-view');
const note = $('preview-note');
const download = $<HTMLButtonElement>('download');
const downloadZip = $<HTMLButtonElement>('download-zip');
const MAX_BYTES = 50 * 1024 * 1024;
const BOM = String.fromCharCode(0xfeff);
const EXTENSIONS = /\.(xlsx|xlsm|xlsb|xls|ods)$/i;

let worker: Worker | undefined;
let sequence = 0;
let generation = 0;
// Counts chosen files, so a ZIP built for an earlier file is dropped.
let fileId = 0;
let settingsVersion = 0;
const pending = new Map<number, Pending>();
let fileName = '';
let sheets: SheetInfo[] = [];
let sheet = '';
let separator = (root.querySelector<HTMLButtonElement>('[data-separator][aria-pressed="true"]')?.dataset.separator ?? 'comma') as Separator;
let numbers: NumberMode = 'formatted';
let bom = false;
let result: ConvertedSheet | undefined;
let blob: Blob | undefined;

const extension = () => (separator === 'tab' ? 'tsv' : 'csv');
const baseName = () => fileName.replace(/\.[^.]+$/, '') || 'converted';
const safeName = (name: string) => {
  const base = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/^[\s.]+|[\s.]+$/g, '') || 'Sheet';
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(base) ? `${base}-Sheet` : base;
};
const announce = (message: string) => { status.textContent = message; };
const press = (selector: string, active: (button: HTMLButtonElement) => boolean) =>
  root.querySelectorAll<HTMLButtonElement>(selector).forEach(button => button.setAttribute('aria-pressed', String(active(button))));

function send<T>(message: Draft<ExcelRequest>): Promise<T> {
  worker ??= createWorker();
  const id = ++sequence;
  return new Promise<T>((resolve, reject) => { pending.set(id, { resolve, reject }); worker!.postMessage({ ...message, id }); });
}

function createWorker() {
  const next = new Worker(new URL('../workers/excel-to-csv.ts', import.meta.url), { type: 'module' });
  next.onmessage = (event: MessageEvent<{ id: number; error?: { code: ExcelErrorCode } }>) => {
    const request = pending.get(event.data.id);
    pending.delete(event.data.id);
    if (event.data.error) request?.reject(event.data.error.code);
    else request?.resolve(event.data);
  };
  // A worker that runs out of memory dies with the workbook, so everything waiting on it fails.
  next.onerror = () => { resetWorker(); showError('workerError'); };
  return next;
}

function resetWorker() {
  worker?.terminate();
  worker = undefined;
  pending.forEach(request => request.reject('workerError'));
  pending.clear();
}

const ERROR_KEYS: readonly ErrorKey[] = ['passwordProtected', 'unreadable', 'noSheets', 'wrongType', 'tooLarge', 'workerError'];
// A rejected promise can also carry an unexpected exception; show that as a stopped conversion.
const errorKey = (value: unknown): ErrorKey => ERROR_KEYS.includes(value as ErrorKey) ? value as ErrorKey : 'workerError';

function showError(code: ErrorKey) {
  ++generation;
  result = undefined;
  blob = undefined;
  setReady(false);
  panel.hidden = true;
  empty.hidden = false;
  $('drop-title').textContent = t(`excel.${code}Title`);
  $('drop-hint').textContent = t(`excel.${code}`);
  $('choose-file').textContent = t('excel.chooseAgain');
  announce(`${t(`excel.${code}Title`)}. ${t(`excel.${code}`)}`);
  trackResult('error', { code });
}

function setReady(ready: boolean) {
  download.disabled = !ready;
  downloadZip.disabled = !ready;
}

async function loadFile(file: File) {
  const ticket = ++generation;
  ++fileId;
  resetWorker();
  result = undefined;
  blob = undefined;
  if (!EXTENSIONS.test(file.name)) return showError('wrongType');
  if (file.size > MAX_BYTES) return showError('tooLarge');
  fileName = file.name;
  sheets = [];
  $('file-name').textContent = file.name;
  $('file-size').textContent = formatBytes(file.size);
  $('sheet-chips').replaceChildren();
  downloadZip.hidden = true;
  table.replaceChildren();
  csvView.textContent = '';
  $('result-summary').textContent = t('excel.reading');
  note.textContent = '';
  setReady(false);
  // Show the panel straight away, while the click still counts as input, so the layout change isn't a shift.
  empty.hidden = true;
  panel.hidden = false;
  announce(t('excel.reading'));
  try {
    const data = await send<{ sheets: SheetInfo[] }>({ type: 'open', file });
    if (ticket !== generation) return;
    sheets = data.sheets;
    sheet = (sheets.find(item => !item.hidden) ?? sheets[0]).name;
    renderSheetChips();
    downloadZip.hidden = sheets.length < 2;
    downloadZip.textContent = t('excel.downloadZip', { count: formatNumber(sheets.length) });
    announce(t('excel.fileLoaded', { name: file.name, sheets: counted('excel.sheets', sheets.length) }));
    $('panel-title').focus({ preventScroll: true });
    await convert(false);
  } catch (code) {
    if (ticket === generation) showError(errorKey(code));
  }
}

function renderSheetChips() {
  const group = $('sheet-chips');
  group.replaceChildren(...sheets.map(item => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.sheet = item.name;
    button.textContent = item.hidden ? t('excel.hiddenSheet', { name: item.name }) : item.name;
    button.setAttribute('aria-pressed', String(item.name === sheet));
    button.addEventListener('click', () => { sheet = item.name; press('[data-sheet]', x => x.dataset.sheet === sheet); void convert(); });
    return button;
  }));
}

async function convert(announceResult = true) {
  if (!sheets.length) return;
  const ticket = ++generation;
  result = undefined;
  blob = undefined;
  setReady(false);
  // Most sheets convert in a few milliseconds; only say "Converting" when it takes long enough to notice.
  const slow = setTimeout(() => { if (ticket === generation) { announce(t('excel.working')); $('result-summary').textContent = t('excel.working'); } }, 200);
  try {
    const data = await send<{ result: ConvertedSheet }>({ type: 'convert', sheet, options: { separator, numbers } });
    if (ticket !== generation) return;
    result = data.result;
    renderResult();
    trackResult('success', { rows: data.result.rows, columns: data.result.columns, sheets: sheets.length, separator, numbers, output_size: sizeBucket(data.result.csv.size) });
    if (announceResult) announce($('result-summary').textContent!);
  } catch (code) {
    if (ticket === generation) showError(errorKey(code));
  } finally { clearTimeout(slow); }
}

function renderResult() {
  if (!result) return;
  blob = new Blob([bom ? BOM : '', result.csv], { type: separator === 'tab' ? 'text/tab-separated-values;charset=utf-8' : 'text/csv;charset=utf-8' });
  $('result-summary').textContent = t('excel.summary', { rows: counted('excel.rows', result.rows), columns: counted('excel.columns', result.columns), size: formatBytes(blob.size) });
  const body = document.createElement('tbody');
  for (const row of result.preview) {
    const tr = body.insertRow();
    for (const value of row) tr.insertCell().textContent = value;
  }
  table.replaceChildren(body);
  csvView.textContent = result.previewText;
  const notes = [];
  if (!result.rows) notes.push(t('excel.emptySheet'));
  if (result.rows > result.preview.length) notes.push(t('excel.previewCap', { shown: formatNumber(result.preview.length), total: formatNumber(result.rows) }));
  if (result.columns > (result.preview[0]?.length ?? 0) && result.rows) notes.push(t('excel.columnsCap', { shown: formatNumber(result.preview[0].length), total: formatNumber(result.columns) }));
  note.textContent = notes.join(' ');
  download.textContent = t(separator === 'tab' ? 'excel.downloadTsv' : 'excel.download');
  setReady(true);
}

function save(data: Blob, name: string) {
  const url = URL.createObjectURL(data);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

download.addEventListener('click', () => {
  if (!blob) return;
  save(blob, sheets.length > 1 ? `${baseName()}-${safeName(sheet)}.${extension()}` : `${baseName()}.${extension()}`);
});
downloadZip.addEventListener('click', async () => {
  const file = fileId;
  const version = settingsVersion;
  downloadZip.disabled = true;
  announce(t('excel.zipping'));
  try {
    const data = await send<{ zip: Uint8Array<ArrayBuffer> }>({ type: 'zip', options: { separator, numbers }, bom });
    if (file !== fileId) return;
    if (version !== settingsVersion) { announce($('result-summary').textContent ?? ''); return; }
    save(new Blob([data.zip], { type: 'application/zip' }), `${baseName()}-${extension()}.zip`);
    announce('');
  } catch (code) { if (file === fileId && version === settingsVersion) showError(errorKey(code)); }
  finally { downloadZip.disabled = !result; }
});
root.querySelectorAll<HTMLButtonElement>('[data-separator]').forEach(button => button.addEventListener('click', () => {
  separator = button.dataset.separator as Separator;
  ++settingsVersion;
  press('[data-separator]', x => x === button);
  void convert();
}));
root.querySelectorAll<HTMLButtonElement>('[data-numbers]').forEach(button => button.addEventListener('click', () => {
  numbers = button.dataset.numbers as NumberMode;
  ++settingsVersion;
  press('[data-numbers]', x => x === button);
  void convert();
}));
// The BOM only changes the downloaded bytes, so there is nothing to convert again.
root.querySelectorAll<HTMLButtonElement>('[data-bom]').forEach(button => button.addEventListener('click', () => {
  bom = button.dataset.bom === 'true';
  ++settingsVersion;
  press('[data-bom]', x => x === button);
  renderResult();
}));
root.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => button.addEventListener('click', () => {
  press('[data-view]', x => x === button);
  preview.hidden = button.dataset.view !== 'table';
  csvView.hidden = button.dataset.view !== 'text';
}));

const choose = () => { fileInput.value = ''; fileInput.click(); };
$('choose-file').addEventListener('click', choose);
$('choose-again').addEventListener('click', choose);
fileInput.addEventListener('change', () => { if (fileInput.files?.[0]) void loadFile(fileInput.files[0]); });
if (matchMedia('(pointer: coarse)').matches) {
  $('drop-title').textContent = t('excel.dropTitleTouch');
  $('drop-hint').textContent = t('excel.dropHintTouch');
}
root.addEventListener('dragover', event => { event.preventDefault(); root.classList.add('over'); });
root.addEventListener('dragleave', event => { if (!root.contains(event.relatedTarget as Node)) root.classList.remove('over'); });
root.addEventListener('drop', event => { event.preventDefault(); root.classList.remove('over'); if (event.dataTransfer?.files[0]) void loadFile(event.dataTransfer.files[0]); });
