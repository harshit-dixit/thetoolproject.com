import type { ExcelErrorCode, NumberMode, Separator, SheetInfo } from '../lib/excel-to-csv';
import type { ConvertedSheet, ExcelRequest } from '../workers/excel-to-csv';

type ErrorKey = ExcelErrorCode | 'wrongType' | 'tooLarge' | 'workerError';
type Pending = { resolve: (data: any) => void; reject: (code: ErrorKey) => void };
type Draft<T> = T extends unknown ? Omit<T, 'id'> : never;

const root = document.querySelector<HTMLElement>('#excel-tool')!;
const strings = JSON.parse(root.dataset.strings!) as Record<string, string>;
const locale = root.dataset.locale || 'en';
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

const formatter = new Intl.NumberFormat(locale);
const plurals = new Intl.PluralRules(locale);
const substitute = (template: string, values: Record<string, string | number>) => template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ''));
const count = (key: string, n: number) => substitute(strings[`${key}.${plurals.select(n)}`] ?? strings[`${key}.other`], { count: formatter.format(n) });
const size = (bytes: number) => {
  const unit = bytes >= 1048576 ? 'unit.mb' : bytes >= 1024 ? 'unit.kb' : 'unit.bytes';
  const n = unit === 'unit.mb' ? bytes / 1048576 : unit === 'unit.kb' ? bytes / 1024 : bytes;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: unit === 'unit.bytes' ? 0 : 1 }).format(n)} ${strings[unit]}`;
};
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

function showError(code: ErrorKey) {
  ++generation;
  result = undefined;
  blob = undefined;
  setReady(false);
  panel.hidden = true;
  empty.hidden = false;
  $('drop-title').textContent = strings[`excel.${code}Title`];
  $('drop-hint').textContent = strings[`excel.${code}`];
  $('choose-file').textContent = strings['excel.chooseAgain'];
  announce(`${strings[`excel.${code}Title`]}. ${strings[`excel.${code}`]}`);
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
  $('file-size').textContent = size(file.size);
  $('sheet-chips').replaceChildren();
  downloadZip.hidden = true;
  table.replaceChildren();
  csvView.textContent = '';
  $('result-summary').textContent = strings['excel.reading'];
  note.textContent = '';
  setReady(false);
  
  empty.hidden = true;
  panel.hidden = false;
  announce(strings['excel.reading']);
  try {
    const data = await send<{ sheets: SheetInfo[] }>({ type: 'open', file });
    if (ticket !== generation) return;
    sheets = data.sheets;
    sheet = (sheets.find(item => !item.hidden) ?? sheets[0]).name;
    renderSheetChips();
    downloadZip.hidden = sheets.length < 2;
    downloadZip.textContent = substitute(strings['excel.downloadZip'], { count: formatter.format(sheets.length) });
    announce(substitute(strings['excel.fileLoaded'], { name: file.name, sheets: count('excel.sheets', sheets.length) }));
    $('panel-title').focus({ preventScroll: true });
    await convert(false);
  } catch (code) {
    if (ticket === generation) showError(code as ErrorKey);
  }
}

function renderSheetChips() {
  const group = $('sheet-chips');
  group.replaceChildren(...sheets.map(item => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.sheet = item.name;
    button.textContent = item.hidden ? substitute(strings['excel.hiddenSheet'], { name: item.name }) : item.name;
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
  
  const slow = setTimeout(() => { if (ticket === generation) { announce(strings['excel.working']); $('result-summary').textContent = strings['excel.working']; } }, 200);
  try {
    const data = await send<{ result: ConvertedSheet }>({ type: 'convert', sheet, options: { separator, numbers } });
    if (ticket !== generation) return;
    result = data.result;
    renderResult();
    if (announceResult) announce($('result-summary').textContent!);
  } catch (code) {
    if (ticket === generation) showError(code as ErrorKey);
  } finally { clearTimeout(slow); }
}

function renderResult() {
  if (!result) return;
  blob = new Blob([bom ? BOM : '', result.csv], { type: separator === 'tab' ? 'text/tab-separated-values;charset=utf-8' : 'text/csv;charset=utf-8' });
  $('result-summary').textContent = substitute(strings['excel.summary'], { rows: count('excel.rows', result.rows), columns: count('excel.columns', result.columns), size: size(blob.size) });
  const body = document.createElement('tbody');
  for (const row of result.preview) {
    const tr = body.insertRow();
    for (const value of row) tr.insertCell().textContent = value;
  }
  table.replaceChildren(body);
  csvView.textContent = result.previewText;
  const notes = [];
  if (!result.rows) notes.push(strings['excel.emptySheet']);
  if (result.rows > result.preview.length) notes.push(substitute(strings['excel.previewCap'], { shown: formatter.format(result.preview.length), total: formatter.format(result.rows) }));
  if (result.columns > (result.preview[0]?.length ?? 0) && result.rows) notes.push(substitute(strings['excel.columnsCap'], { shown: formatter.format(result.preview[0].length), total: formatter.format(result.columns) }));
  note.textContent = notes.join(' ');
  download.textContent = strings[separator === 'tab' ? 'excel.downloadTsv' : 'excel.download'];
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
  announce(strings['excel.zipping']);
  try {
    const data = await send<{ zip: Uint8Array<ArrayBuffer> }>({ type: 'zip', options: { separator, numbers }, bom });
    if (file !== fileId) return;
    if (version !== settingsVersion) { announce($('result-summary').textContent ?? ''); return; }
    save(new Blob([data.zip], { type: 'application/zip' }), `${baseName()}-${extension()}.zip`);
    announce('');
  } catch (code) { if (file === fileId && version === settingsVersion) showError(code as ErrorKey); }
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
  $('drop-title').textContent = strings['excel.dropTitleTouch'];
  $('drop-hint').textContent = strings['excel.dropHintTouch'];
}
root.addEventListener('dragover', event => { event.preventDefault(); root.classList.add('over'); });
root.addEventListener('dragleave', event => { if (!root.contains(event.relatedTarget as Node)) root.classList.remove('over'); });
root.addEventListener('drop', event => { event.preventDefault(); root.classList.remove('over'); if (event.dataTransfer?.files[0]) void loadFile(event.dataTransfer.files[0]); });
