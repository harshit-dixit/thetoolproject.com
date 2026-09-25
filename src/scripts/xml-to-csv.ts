import type { XmlCsvConversion, XmlCsvError, XmlCsvOptions, XmlCsvSeparator } from '../lib/xml-to-csv';
import type { XmlCsvRequest } from '../workers/xml-to-csv';

const root = document.querySelector<HTMLElement>('#xml-csv-tool')!;
const strings = JSON.parse(root.dataset.strings!) as Record<string, string>;
const locale = root.dataset.locale || 'en';
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const textarea = $<HTMLTextAreaElement>('xml-input');
const fileInput = $<HTMLInputElement>('xml-file');
const status = $('xml-status');
const result = $('xml-result');
const placeholder = $('xml-placeholder');
const convert = $<HTMLButtonElement>('xml-convert');
const table = $<HTMLTableElement>('xml-preview-table');
const csvView = $<HTMLPreElement>('xml-csv-view');
const recordPath = $<HTMLSelectElement>('xml-record-path');
const previewNote = $('xml-preview-note');
const codeNote = $('xml-code-note');
const conversionNote = $('xml-conversion-note');
const copy = $<HTMLButtonElement>('xml-copy');
const hint = $('xml-input-hint');
const formatter = new Intl.NumberFormat(locale);
const plurals = new Intl.PluralRules(locale);
const MAX_BYTES = 10 * 1024 * 1024;
const TEXTAREA_LIMIT = 2 * 1024 * 1024;
const TEXT_VIEW_LIMIT = 100000;
let worker: Worker | undefined;
let busy = false;
let sequence = 0;
let fileText: string | undefined;
let fileName: string | undefined;
let current: XmlCsvConversion | undefined;
let view: 'table' | 'text' = 'table';
let options: XmlCsvOptions = { separator: 'comma', bom: false, spreadsheetSafe: true };
const substitute = (template: string, values: Record<string, string | number>) => template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ''));
const counted = (key: string, count: number) => substitute(strings[`${key}.${plurals.select(count)}`] ?? strings[`${key}.other`], { count: formatter.format(count) });
const size = (bytes: number) => {
  const unit = bytes >= 1048576 ? 'unit.mb' : bytes >= 1024 ? 'unit.kb' : 'unit.bytes';
  const n = unit === 'unit.mb' ? bytes / 1048576 : unit === 'unit.kb' ? bytes / 1024 : bytes;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: unit === 'unit.bytes' ? 0 : 1 }).format(n)} ${strings[unit]}`;
};
function announce(message: string) { status.hidden = false; status.textContent = message; }
function clearStatus() { status.hidden = true; status.textContent = ''; }
function setWorking(working: boolean) { busy = working; convert.disabled = working; if (working) announce(strings['xmlCsv.working']); }
function stopWorker() { if (busy) { worker?.terminate(); worker = undefined; setWorking(false); clearStatus(); } }
function hideResult() { result.hidden = true; placeholder.hidden = false; current = undefined; csvView.textContent = ''; }
function useTextarea() { fileText = undefined; hint.textContent = defaultHint; }
function showView(next: 'table' | 'text') {
  view = next;
  root.querySelectorAll<HTMLButtonElement>('[data-xml-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.xmlView === view)));
  $('xml-preview').hidden = view !== 'table';
  csvView.hidden = view !== 'text';
  previewNote.hidden = view !== 'table' || !previewNote.textContent;
  codeNote.hidden = view !== 'text' || !current || current.csv.length - (current.csv.charCodeAt(0) === 0xfeff ? 1 : 0) <= TEXT_VIEW_LIMIT;
}
function showResult(data: XmlCsvConversion) {
  current = data;
  placeholder.hidden = true; result.hidden = false;
  const selectedPath = recordPath.value;
  recordPath.replaceChildren(...data.paths.map(path => {
    const option = document.createElement('option'); option.value = path; option.textContent = path; return option;
  }));
  recordPath.value = data.paths.includes(selectedPath) && options.recordPath ? selectedPath : data.recordPath;
  $('xml-record-group').hidden = data.paths.length < 2;
  $('xml-summary').textContent = substitute(strings[options.separator === 'tab' ? 'xmlCsv.summaryTsv' : 'xmlCsv.summary'], { rows: counted('tool.rows', data.rows), columns: counted('tool.columns', data.columns), size: size(new Blob([data.csv]).size) });
  const head = document.createElement('thead');
  const tr = head.insertRow();
  for (const value of data.headers) { const th = document.createElement('th'); th.scope = 'col'; th.textContent = value; tr.append(th); }
  const body = document.createElement('tbody');
  for (const row of data.preview) { const rowElement = body.insertRow(); for (const value of row) rowElement.insertCell().textContent = value; }
  table.replaceChildren(head, body);
  $('xml-preview').scrollTo(0, 0);
  csvView.textContent = data.csv.slice(data.csv.charCodeAt(0) === 0xfeff ? 1 : 0, TEXT_VIEW_LIMIT);
  csvView.scrollTo(0, 0);
  const notes: string[] = [];
  if (data.rows > data.preview.length) notes.push(substitute(strings['xmlCsv.previewCap'], { shown: formatter.format(data.preview.length), total: formatter.format(data.rows) }));
  if (data.columns > data.headers.length) notes.push(substitute(strings['xmlCsv.columnsCap'], { shown: formatter.format(data.headers.length), total: formatter.format(data.columns) }));
  previewNote.textContent = notes.join(' ');
  conversionNote.textContent = data.protectedCells ? substitute(strings['xmlCsv.protectedNote'], { count: formatter.format(data.protectedCells) }) : '';
  conversionNote.hidden = !data.protectedCells;
  copy.textContent = strings[options.separator === 'tab' ? 'xmlCsv.copyTsv' : 'xmlCsv.copy'];
  showView('table'); clearStatus();
}
function errorMessage(error: XmlCsvError | { code: 'workerError' }) {
  if (error.code === 'invalidXml' && error.line) return `Line ${formatter.format(error.line)}, column ${formatter.format(error.column ?? 1)}: ${error.detail || strings['xmlCsv.invalidXml']}`;
  return strings[`xmlCsv.${error.code}`] || strings['xmlCsv.workerError'];
}
function run() {
  const source = fileText ?? textarea.value;
  if (!source.trim()) { announce(strings['xmlCsv.empty']); hideResult(); textarea.focus(); return; }
  if (new Blob([source]).size > MAX_BYTES) { announce(strings['xmlCsv.tooLarge']); hideResult(); return; }
  stopWorker(); setWorking(true);
  const id = ++sequence;
  worker ??= new Worker(new URL('../workers/xml-to-csv.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<{ id: number; result?: XmlCsvConversion; error?: XmlCsvError | { code: 'workerError' } }>) => {
    if (event.data.id !== sequence) return;
    setWorking(false);
    if (event.data.result) { showResult(event.data.result); return; }
    hideResult(); announce(errorMessage(event.data.error ?? { code: 'workerError' }));
  };
  worker.onerror = () => { worker?.terminate(); worker = undefined; setWorking(false); hideResult(); announce(strings['xmlCsv.workerError']); };
  worker.postMessage({ id, source, options } satisfies XmlCsvRequest);
}
async function loadFile(file: File) {
  if (!/\.(xml|txt)$/i.test(file.name)) { announce(strings['xmlCsv.wrongType']); return; }
  if (file.size > MAX_BYTES) { announce(strings['xmlCsv.tooLarge']); return; }
  const id = ++sequence;
  stopWorker(); announce(strings['tool.reading']);
  try {
    const content = await file.text();
    if (id !== sequence) return;
    options = { ...options, recordPath: undefined };
    $('xml-record-group').hidden = true;
    if (file.size > TEXTAREA_LIMIT) { textarea.value = ''; fileText = content; hint.textContent = substitute(strings['tool.largeFileHint'], { name: file.name }); }
    else { textarea.value = content; useTextarea(); }
    fileName = file.name; $('xml-file-name').textContent = file.name; $('xml-file-size').textContent = size(file.size); $('xml-file-line').hidden = false;
    hideResult(); announce(substitute(strings['tool.fileLoaded'], { name: file.name, size: size(file.size) }));
  } catch { if (id === sequence) announce(strings['tool.readError']); }
}
$('xml-choose-file').addEventListener('click', () => { fileInput.value = ''; fileInput.click(); });
fileInput.addEventListener('change', () => { if (fileInput.files?.[0]) void loadFile(fileInput.files[0]); });
$('xml-example').addEventListener('click', () => {
  ++sequence; stopWorker(); useTextarea(); options = { ...options, recordPath: undefined };
  textarea.value = '<orders>\n  <order id="A-104"><customer>Maya Chen</customer><shipping><city>Portland</city></shipping><tag>new</tag><tag>gift</tag></order>\n  <order id="A-105"><customer>Luis Ortega</customer><shipping><city>Austin</city></shipping><tag>returning</tag></order>\n</orders>';
  fileName = undefined; $('xml-file-line').hidden = true; $('xml-record-group').hidden = true; hideResult(); clearStatus(); textarea.setSelectionRange(0, 0); textarea.scrollTop = 0; textarea.focus();
});
textarea.addEventListener('input', () => { ++sequence; stopWorker(); useTextarea(); options = { ...options, recordPath: undefined }; fileName = undefined; $('xml-file-line').hidden = true; $('xml-record-group').hidden = true; if (current) hideResult(); });
recordPath.addEventListener('change', () => { options = { ...options, recordPath: recordPath.value }; run(); });
root.querySelectorAll<HTMLButtonElement>('[data-xml-separator]').forEach(button => button.addEventListener('click', () => {
  options = { ...options, separator: button.dataset.xmlSeparator as XmlCsvSeparator };
  root.querySelectorAll<HTMLButtonElement>('[data-xml-separator]').forEach(x => x.setAttribute('aria-pressed', String(x === button)));
  $('xml-download').textContent = strings[options.separator === 'tab' ? 'xmlCsv.downloadTsv' : 'xmlCsv.download'];
  copy.textContent = strings[options.separator === 'tab' ? 'xmlCsv.copyTsv' : 'xmlCsv.copy'];
  root.querySelector<HTMLButtonElement>('[data-xml-view="text"]')!.textContent = strings[options.separator === 'tab' ? 'xmlCsv.tsvText' : 'xmlCsv.textView'];
  if (current || busy) run();
}));
root.querySelectorAll<HTMLButtonElement>('[data-xml-bom]').forEach(button => button.addEventListener('click', () => {
  options = { ...options, bom: button.dataset.xmlBom === 'true' };
  root.querySelectorAll<HTMLButtonElement>('[data-xml-bom]').forEach(x => x.setAttribute('aria-pressed', String(x === button)));
  if (current || busy) run();
}));
$<HTMLInputElement>('xml-spreadsheet-safe').addEventListener('change', event => { options = { ...options, spreadsheetSafe: (event.target as HTMLInputElement).checked }; if (current || busy) run(); });
root.querySelectorAll<HTMLButtonElement>('[data-xml-view]').forEach(button => button.addEventListener('click', () => showView(button.dataset.xmlView as 'table' | 'text')));
convert.addEventListener('click', run);
$('xml-download').addEventListener('click', () => {
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
  const fullText = current.csv.charCodeAt(0) === 0xfeff ? current.csv.slice(1) : current.csv;
  try {
    if (!navigator.clipboard?.writeText) throw Error();
    await navigator.clipboard.writeText(fullText);
    if (current !== copiedResult) return;
    copy.textContent = strings['xmlCsv.copied']; announce(strings['xmlCsv.copied']);
  } catch {
    if (current !== copiedResult) return;
    showView('text'); csvView.textContent = fullText;
    const selection = window.getSelection(); const range = document.createRange(); range.selectNodeContents(csvView);
    selection?.removeAllRanges(); selection?.addRange(range); announce(strings['xmlCsv.selectText']);
  }
});
$('xml-start-over').addEventListener('click', () => { ++sequence; stopWorker(); useTextarea(); options = { ...options, recordPath: undefined }; textarea.value = ''; fileInput.value = ''; fileName = undefined; hideResult(); $('xml-file-line').hidden = true; $('xml-record-group').hidden = true; clearStatus(); textarea.focus(); });
const defaultHint = matchMedia('(pointer: coarse)').matches ? strings['tool.inputHintTouch'] : hint.textContent!;
hint.textContent = defaultHint;
root.addEventListener('dragover', event => { event.preventDefault(); root.classList.add('over'); });
root.addEventListener('dragleave', event => { if (!root.contains(event.relatedTarget as Node)) root.classList.remove('over'); });
root.addEventListener('drop', event => { event.preventDefault(); root.classList.remove('over'); if (event.dataTransfer?.files[0]) void loadFile(event.dataTransfer.files[0]); });
