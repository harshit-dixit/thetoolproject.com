import type { CsvConversion, CsvError, CsvOptions, CsvSeparator } from '../lib/json-to-csv';
import type { CsvRequest } from '../workers/json-to-csv';

const root = document.querySelector<HTMLElement>('#json-csv-tool')!;
const strings = JSON.parse(root.dataset.strings!) as Record<string, string>;
const locale = root.dataset.locale || 'en';
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const textarea = $<HTMLTextAreaElement>('json-input');
const fileInput = $<HTMLInputElement>('json-file');
const status = $('status');
const result = $('result');
const placeholder = $('preview-placeholder');
const convert = $<HTMLButtonElement>('convert');
const table = $<HTMLTableElement>('preview-table');
const csvView = $<HTMLPreElement>('csv-view');
const previewNote = $('preview-note');
const codeNote = $('code-note');
const conversionNote = $('conversion-note');
const copy = $<HTMLButtonElement>('copy');
const hint = $('input-hint');
const formatter = new Intl.NumberFormat(locale);
const plurals = new Intl.PluralRules(locale);
const TEXTAREA_LIMIT = 2 * 1024 * 1024;
const TEXT_VIEW_LIMIT = 100000;
const MAX_BYTES = 50 * 1024 * 1024;
let worker: Worker | undefined;
let busy = false;
let sequence = 0;
let fileText: string | undefined;
let fileName: string | undefined;
let current: CsvConversion | undefined;
let view: 'table' | 'text' = 'table';
let options: CsvOptions = { separator: 'comma', bom: false, spreadsheetSafe: true };
const substitute = (template: string, values: Record<string, string | number>) => template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ''));
const counted = (key: string, count: number) => substitute(strings[`${key}.${plurals.select(count)}`] ?? strings[`${key}.other`], { count: formatter.format(count) });
const size = (bytes: number) => {
  const unit = bytes >= 1048576 ? 'unit.mb' : bytes >= 1024 ? 'unit.kb' : 'unit.bytes';
  const n = unit === 'unit.mb' ? bytes / 1048576 : unit === 'unit.kb' ? bytes / 1024 : bytes;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: unit === 'unit.bytes' ? 0 : 1 }).format(n)} ${strings[unit]}`;
};
function announce(message: string) { status.hidden = false; status.textContent = message; }
function clearStatus() { status.hidden = true; status.textContent = ''; }
function setWorking(working: boolean) { busy = working; convert.disabled = working; if (working) announce(strings['jsonCsv.working']); }
function stopWorker() { if (busy) { worker?.terminate(); worker = undefined; setWorking(false); clearStatus(); } }
function hideResult() { result.hidden = true; placeholder.hidden = false; current = undefined; csvView.textContent = ''; }
function useTextarea() { fileText = undefined; hint.textContent = defaultHint; }
const csvText = (data: CsvConversion) => data.csv.charCodeAt(0) === 0xfeff ? data.csv.slice(1) : data.csv;
function showView(next: 'table' | 'text') {
  view = next;
  root.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === view)));
  $('csv-preview').hidden = view !== 'table';
  csvView.hidden = view !== 'text';
  previewNote.hidden = view !== 'table' || !previewNote.textContent;
  codeNote.hidden = view !== 'text' || !current || current.csv.length - (current.csv.charCodeAt(0) === 0xfeff ? 1 : 0) <= TEXT_VIEW_LIMIT;
}
function showResult(data: CsvConversion) {
  current = data;
  placeholder.hidden = true; result.hidden = false;
  const bytes = new Blob([data.csv]).size;
  $('result-summary').textContent = substitute(strings[options.separator === 'tab' ? 'jsonCsv.summaryTsv' : 'jsonCsv.summary'], { rows: counted('tool.rows', data.rows), columns: counted('tool.columns', data.columns), size: size(bytes) });
  const head = document.createElement('thead');
  if (!data.headerless) {
    const tr = head.insertRow();
    for (const value of data.headers) { const th = document.createElement('th'); th.scope = 'col'; th.textContent = value; tr.append(th); }
  }
  const body = document.createElement('tbody');
  for (const row of data.preview) { const tr = body.insertRow(); for (const value of row) tr.insertCell().textContent = value; }
  table.replaceChildren(head, body);
  $('csv-preview').scrollTo(0, 0);
  const textStart = data.csv.charCodeAt(0) === 0xfeff ? 1 : 0;
  csvView.textContent = data.csv.slice(textStart, textStart + TEXT_VIEW_LIMIT);
  csvView.scrollTo(0, 0);
  const previewNotes: string[] = [];
  const conversionNotes: string[] = [];
  if (data.jsonLines) conversionNotes.push(strings['jsonCsv.jsonLinesNote']);
  if (data.rows > data.preview.length) previewNotes.push(substitute(strings['jsonCsv.previewCap'], { shown: formatter.format(data.preview.length), total: formatter.format(data.rows) }));
  if (data.columns > data.headers.length) previewNotes.push(substitute(strings['jsonCsv.columnsCap'], { shown: formatter.format(data.headers.length), total: formatter.format(data.columns) }));
  if (data.protectedCells) conversionNotes.push(substitute(strings['jsonCsv.protectedNote'], { count: formatter.format(data.protectedCells) }));
  if (data.unsafeNumberFallback) conversionNotes.push(strings['jsonCsv.largeIntegerNote']);
  previewNote.textContent = previewNotes.join(' ');
  conversionNote.textContent = conversionNotes.join(' ');
  conversionNote.hidden = !conversionNotes.length;
  copy.textContent = strings[options.separator === 'tab' ? 'jsonCsv.copyTsv' : 'jsonCsv.copy'];
  showView('table');
  clearStatus();
}
function errorMessage(error: CsvError | { code: 'workerError' }) {
  if (error.code === 'empty') return strings['tool.empty'];
  if (error.code === 'noData' || error.code === 'tooManyColumns' || error.code === 'workerError') return strings[`jsonCsv.${error.code}`];
  if ('line' in error) return substitute(strings['error.location'], { line: formatter.format(error.line), column: formatter.format(error.column), reason: strings[`error.${error.code}`] || strings['error.syntax'] });
  return strings['jsonCsv.workerError'];
}
function run() {
  const source = fileText ?? textarea.value;
  if (!source.trim()) { announce(strings['tool.empty']); hideResult(); textarea.focus(); return; }
  stopWorker(); setWorking(true);
  const id = ++sequence;
  worker ??= new Worker(new URL('../workers/json-to-csv.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<{ id: number; result?: CsvConversion; error?: CsvError | { code: 'workerError' } }>) => {
    if (event.data.id !== sequence) return;
    setWorking(false);
    if (event.data.result) { showResult(event.data.result); return; }
    hideResult();
    const error = event.data.error;
    announce(error ? errorMessage(error) : strings['jsonCsv.workerError']);
    if (fileText === undefined && error && 'position' in error && error.code !== 'depth') { textarea.focus(); textarea.setSelectionRange(error.position, error.position); }
  };
  worker.onerror = () => { worker?.terminate(); worker = undefined; setWorking(false); hideResult(); announce(strings['jsonCsv.workerError']); };
  worker.postMessage({ id, source, options } satisfies CsvRequest);
}
async function loadFile(file: File) {
  if (!/\.(json|jsonl|ndjson|txt)$/i.test(file.name)) { announce(strings['jsonCsv.wrongType']); return; }
  if (file.size > MAX_BYTES) { announce(strings['jsonCsv.tooLarge']); return; }
  stopWorker(); announce(strings['tool.reading']);
  try {
    const content = await file.text();
    if (file.size > TEXTAREA_LIMIT) { textarea.value = ''; fileText = content; hint.textContent = substitute(strings['tool.largeFileHint'], { name: file.name }); }
    else { textarea.value = content; useTextarea(); }
    fileName = file.name; $('file-name').textContent = file.name; $('file-size').textContent = size(file.size); $('file-line').hidden = false;
    hideResult(); announce(substitute(strings['tool.fileLoaded'], { name: file.name, size: size(file.size) }));
  } catch { announce(strings['tool.readError']); }
}
$('choose-file').addEventListener('click', () => { fileInput.value = ''; fileInput.click(); });
fileInput.addEventListener('change', () => { if (fileInput.files?.[0]) void loadFile(fileInput.files[0]); });
$('try-example').addEventListener('click', () => {
  stopWorker(); useTextarea();
  textarea.value = JSON.stringify([
    { order: 'A-104', customer: 'Maya Chen', total: 84.5, shipping: { city: 'Portland' }, items: [{ sku: 'NB-01', qty: 2 }] },
    { order: 'A-105', customer: 'Luis Ortega', total: 42, shipping: { city: 'Austin' }, items: [{ sku: 'DL-02', qty: 1 }] },
  ], null, 2);
  fileName = undefined; $('file-line').hidden = true; hideResult(); clearStatus(); textarea.setSelectionRange(0, 0); textarea.scrollTop = 0; textarea.focus();
});
textarea.addEventListener('input', () => { stopWorker(); useTextarea(); fileName = undefined; $('file-line').hidden = true; if (current) hideResult(); });
root.querySelectorAll<HTMLButtonElement>('[data-separator]').forEach(button => button.addEventListener('click', () => {
  options = { ...options, separator: button.dataset.separator as CsvSeparator };
  root.querySelectorAll<HTMLButtonElement>('[data-separator]').forEach(x => x.setAttribute('aria-pressed', String(x === button)));
  $('download').textContent = strings[options.separator === 'tab' ? 'jsonCsv.downloadTsv' : 'jsonCsv.download'];
  copy.textContent = strings[options.separator === 'tab' ? 'jsonCsv.copyTsv' : 'jsonCsv.copy'];
  root.querySelector<HTMLButtonElement>('[data-view="text"]')!.textContent = strings[options.separator === 'tab' ? 'jsonCsv.tsvText' : 'jsonCsv.textView'];
  if (current || busy) run();
}));
root.querySelectorAll<HTMLButtonElement>('[data-bom]').forEach(button => button.addEventListener('click', () => {
  options = { ...options, bom: button.dataset.bom === 'true' };
  root.querySelectorAll<HTMLButtonElement>('[data-bom]').forEach(x => x.setAttribute('aria-pressed', String(x === button)));
  if (current || busy) run();
}));
$<HTMLInputElement>('spreadsheet-safe').addEventListener('change', event => { options = { ...options, spreadsheetSafe: (event.target as HTMLInputElement).checked }; if (current || busy) run(); });
root.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => button.addEventListener('click', () => showView(button.dataset.view as 'table' | 'text')));
convert.addEventListener('click', run);
$('download').addEventListener('click', () => {
  if (!current) return;
  const blob = new Blob([current.csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url;
  link.download = (fileName?.replace(/\.[^.]+$/, '') || 'converted') + (options.separator === 'tab' ? '.tsv' : '.csv');
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
});
copy.addEventListener('click', async () => {
  if (!current) return;
  const copiedResult = current;
  const fullText = csvText(copiedResult);
  try {
    if (!navigator.clipboard?.writeText) throw Error();
    await navigator.clipboard.writeText(fullText);
    if (current !== copiedResult) return;
    copy.textContent = strings['jsonCsv.copied'];
    announce(strings['jsonCsv.copied']);
  } catch {
    if (current !== copiedResult) return;
    showView('text');
    csvView.textContent = fullText;
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(csvView);
    selection?.removeAllRanges();
    selection?.addRange(range);
    announce(strings['jsonCsv.selectText']);
  }
});
$('start-over').addEventListener('click', () => { ++sequence; stopWorker(); useTextarea(); textarea.value = ''; fileInput.value = ''; fileName = undefined; hideResult(); $('file-line').hidden = true; clearStatus(); textarea.focus(); });
const defaultHint = matchMedia('(pointer: coarse)').matches ? strings['tool.inputHintTouch'] : hint.textContent!;
hint.textContent = defaultHint;
root.addEventListener('dragover', event => { event.preventDefault(); root.classList.add('over'); });
root.addEventListener('dragleave', event => { if (!root.contains(event.relatedTarget as Node)) root.classList.remove('over'); });
root.addEventListener('drop', event => { event.preventDefault(); root.classList.remove('over'); if (event.dataTransfer?.files[0]) void loadFile(event.dataTransfer.files[0]); });
