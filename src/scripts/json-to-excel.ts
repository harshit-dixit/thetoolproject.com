import type { ExcelConversion, ExcelError, Nested } from '../lib/json-to-excel';
import type { ExcelRequest } from '../workers/json-to-excel';

const root = document.querySelector<HTMLElement>('#json-excel-tool')!;
const strings = JSON.parse(root.dataset.strings!) as Record<string, string>;
const locale = root.dataset.locale || 'en';
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const textarea = $<HTMLTextAreaElement>('json-input');
const fileInput = $<HTMLInputElement>('json-file');
const result = $('result');
const placeholder = $('preview-placeholder');
const status = $('status');
const convert = $<HTMLButtonElement>('convert');
const table = $<HTMLTableElement>('preview-table');
const note = $('preview-note');
const hint = $('input-hint');
// Files above this size stay out of the textarea, which gets slow on phones with multi-MB text.
const TEXTAREA_LIMIT = 2 * 1024 * 1024;
const MAX_BYTES = 50 * 1024 * 1024;
const LIMITS = { tooManyRows: 1048576, tooManyColumns: 16384, truncated: 32767 };
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
let worker: Worker | undefined;
let busy = false;
let sequence = 0;
let fileText: string | undefined;
let fileName: string | undefined;
let nested: Nested = 'sheets';
let current: ExcelConversion | undefined;
let blob: Blob | undefined;
let sheet = 0;
const formatter = new Intl.NumberFormat(locale);
const plurals = new Intl.PluralRules(locale);
const substitute = (template: string, values: Record<string, string | number>) => template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ''));
const counted = (key: string, count: number, values: Record<string, string> = {}) => substitute(strings[`${key}.${plurals.select(count)}`] ?? strings[`${key}.other`], { ...values, count: formatter.format(count) });
const size = (bytes: number) => {
  const unit = bytes >= 1048576 ? 'unit.mb' : bytes >= 1024 ? 'unit.kb' : 'unit.bytes';
  const n = unit === 'unit.mb' ? bytes / 1048576 : unit === 'unit.kb' ? bytes / 1024 : bytes;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: unit === 'unit.bytes' ? 0 : 1 }).format(n)} ${strings[unit]}`;
};
// The first sheet is named after the file; the converter turns it into a name Excel accepts.
const rootName = () => fileName?.replace(/\.[^.]+$/, '') || strings['jsonExcel.defaultSheet'];
function announce(message: string) { status.hidden = false; status.textContent = message; }
function clearStatus() { status.textContent = ''; status.hidden = true; }
function setWorking(working: boolean) { busy = working; convert.disabled = working; if (working) announce(strings['jsonExcel.working']); }
// A worker can't drop a conversion midway, so replace it instead of queueing behind it.
function stopWorker() { if (busy) { worker?.terminate(); worker = undefined; setWorking(false); clearStatus(); } }
function useTextarea() { fileText = undefined; hint.textContent = defaultHint; }
function hideResult() { result.hidden = true; placeholder.hidden = false; current = undefined; blob = undefined; }

function showResult(data: ExcelConversion) {
  current = data;
  blob = new Blob([data.xlsx], { type: XLSX_TYPE });
  sheet = 0;
  placeholder.hidden = true;
  result.hidden = false;
  $('sheet-chips').replaceChildren(...data.sheets.map((item, i) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.sheet = item.name;
    button.textContent = item.name;
    button.setAttribute('aria-pressed', String(i === sheet));
    button.addEventListener('click', () => { sheet = i; renderSheet(); });
    return button;
  }));
  renderSheet();
  clearStatus();
}

function renderSheet() {
  if (!current || !blob) return;
  const data = current.sheets[sheet];
  root.querySelectorAll<HTMLButtonElement>('[data-sheet]').forEach((button, i) => button.setAttribute('aria-pressed', String(i === sheet)));
  const counts = { rows: counted('tool.rows', data.rows), columns: counted('tool.columns', data.columns), size: size(blob.size) };
  $('result-summary').textContent = current.sheets.length > 1
    ? substitute(strings['jsonExcel.summaryMulti'], { ...counts, sheets: counted('jsonExcel.sheetCount', current.sheets.length) })
    : substitute(strings['jsonExcel.summary'], counts);
  const [first, ...rest] = data.preview;
  const head = document.createElement('thead');
  if (data.header && first) {
    const tr = head.insertRow();
    for (const value of first) { const th = document.createElement('th'); th.scope = 'col'; th.textContent = value; tr.append(th); }
  }
  const body = document.createElement('tbody');
  for (const row of data.header ? rest : data.preview) {
    const tr = body.insertRow();
    for (const value of row) tr.insertCell().textContent = value;
  }
  table.replaceChildren(head, body);
  $('sheet-preview').scrollTo(0, 0);
  const shownRows = data.preview.length - (data.header ? 1 : 0);
  const notes: string[] = [];
  if (current.jsonLines) notes.push(strings['jsonExcel.jsonLinesNote']);
  if (data.rows > shownRows) notes.push(substitute(strings['jsonExcel.previewCap'], { shown: formatter.format(shownRows), total: formatter.format(data.rows) }));
  const shownColumns = data.preview[0]?.length ?? 0;
  if (data.columns > shownColumns) notes.push(substitute(strings['jsonExcel.columnsCap'], { shown: formatter.format(shownColumns), total: formatter.format(data.columns) }));
  if (current.textNumbers) notes.push(counted('jsonExcel.textNumbers', current.textNumbers));
  if (current.truncated) notes.push(counted('jsonExcel.truncated', current.truncated, { limit: formatter.format(LIMITS.truncated) }));
  note.textContent = notes.join(' ');
}

function errorMessage(error: ExcelError) {
  if (error.code === 'empty') return strings['tool.empty'];
  if ('sheet' in error) {
    if (error.code === 'noData') return strings['jsonExcel.noData'];
    const key = error.code === 'tooManyColumns' && nested === 'columns' ? 'jsonExcel.tooManyColumnsNumbered' : `jsonExcel.${error.code}`;
    return substitute(strings[key], { sheet: error.sheet, limit: formatter.format(LIMITS[error.code]) });
  }
  return substitute(strings['error.location'], { line: formatter.format(error.line), column: formatter.format(error.column), reason: strings[`error.${error.code}`] || strings['error.syntax'] });
}

function run() {
  const source = fileText ?? textarea.value;
  if (!source.trim()) { announce(strings['tool.empty']); hideResult(); textarea.focus(); return; }
  stopWorker();
  setWorking(true);
  const id = ++sequence;
  worker ??= new Worker(new URL('../workers/json-to-excel.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<{ id: number; result?: ExcelConversion; error?: ExcelError }>) => {
    if (event.data.id !== sequence) return;
    setWorking(false);
    if (event.data.result) { showResult(event.data.result); return; }
    const error = event.data.error;
    if (!error?.code) { announce(strings['jsonExcel.workerError']); return; }
    hideResult();
    announce(errorMessage(error));
    if (fileText === undefined && 'position' in error && error.code !== 'depth') { textarea.focus(); textarea.setSelectionRange(error.position, error.position); }
  };
  // A worker that runs out of memory dies without a message, so start a fresh one next time.
  worker.onerror = () => { worker?.terminate(); worker = undefined; setWorking(false); hideResult(); announce(strings['jsonExcel.workerError']); };
  worker.postMessage({ id, source, options: { nested, rootName: rootName(), valueHeader: strings['jsonExcel.value'] } } satisfies ExcelRequest);
}

async function loadFile(file: File) {
  if (!/\.(json|jsonl|ndjson|txt)$/i.test(file.name)) { announce(strings['jsonExcel.wrongType']); return; }
  if (file.size > MAX_BYTES) { announce(strings['jsonExcel.tooLarge']); return; }
  stopWorker();
  announce(strings['tool.reading']);
  try {
    const text = await file.text();
    if (file.size > TEXTAREA_LIMIT) { textarea.value = ''; fileText = text; hint.textContent = substitute(strings['tool.largeFileHint'], { name: file.name }); }
    else { textarea.value = text; useTextarea(); }
    fileName = file.name;
    $('file-name').textContent = file.name;
    $('file-size').textContent = size(file.size);
    $('file-line').hidden = false;
    hideResult();
    announce(substitute(strings['tool.fileLoaded'], { name: file.name, size: size(file.size) }));
  } catch { announce(strings['tool.readError']); }
}

$('choose-file').addEventListener('click', () => { fileInput.value = ''; fileInput.click(); });
fileInput.addEventListener('change', () => { if (fileInput.files?.[0]) void loadFile(fileInput.files[0]); });
$('try-example').addEventListener('click', () => {
  stopWorker(); useTextarea();
  textarea.value = JSON.stringify([
    { order: 'A-104', date: '2024-01-15', customer: 'Maya Chen', total: 84.5, shipping: { city: 'Portland', method: 'Express' }, items: [{ sku: 'NB-01', name: 'Notebook', qty: 2 }, { sku: 'PN-07', name: 'Pen', qty: 3 }] },
    { order: 'A-105', date: '2024-01-16', customer: 'Luis Ortega', total: 42, shipping: { city: 'Austin', method: 'Standard' }, items: [{ sku: 'DL-02', name: 'Desk lamp', qty: 1 }] },
    { order: 'A-106', date: '2024-01-18', customer: 'Amira Haddad', total: 125, shipping: { city: 'Toronto', method: 'Pickup' }, items: [{ sku: 'CH-11', name: 'Chair', qty: 1 }, { sku: 'CU-03', name: 'Cushion', qty: 2 }] },
  ], null, 2);
  fileName = undefined; $('file-line').hidden = true; hideResult(); clearStatus(); textarea.setSelectionRange(0, 0); textarea.scrollTop = 0; textarea.focus();
});
textarea.addEventListener('input', () => { stopWorker(); useTextarea(); fileName = undefined; $('file-line').hidden = true; if (current) hideResult(); });
root.querySelectorAll<HTMLButtonElement>('[data-nested]').forEach(button => button.addEventListener('click', () => {
  nested = button.dataset.nested as Nested;
  root.querySelectorAll<HTMLButtonElement>('[data-nested]').forEach(x => x.setAttribute('aria-pressed', String(x === button)));
  if (current || busy) run();
}));
convert.addEventListener('click', run);
$('download').addEventListener('click', () => {
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = fileName ? fileName.replace(/\.[^.]+$/, '') + '.xlsx' : 'converted.xlsx';
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
});
$('start-over').addEventListener('click', () => { ++sequence; stopWorker(); useTextarea(); textarea.value = ''; fileInput.value = ''; fileName = undefined; hideResult(); $('file-line').hidden = true; clearStatus(); textarea.focus(); });
const defaultHint = matchMedia('(pointer: coarse)').matches ? strings['tool.inputHintTouch'] : hint.textContent!;
hint.textContent = defaultHint;
root.addEventListener('dragover', event => { event.preventDefault(); root.classList.add('over'); });
root.addEventListener('dragleave', event => { if (!root.contains(event.relatedTarget as Node)) root.classList.remove('over'); });
root.addEventListener('drop', event => { event.preventDefault(); root.classList.remove('over'); if (event.dataTransfer?.files[0]) void loadFile(event.dataTransfer.files[0]); });
