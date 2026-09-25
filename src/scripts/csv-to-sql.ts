import type { CsvSqlOptions, CsvSqlResult, CsvSqlErrorCode } from '../lib/csv-to-sql';
import type { CsvSqlRequest } from '../workers/csv-to-sql';

const root = document.querySelector<HTMLElement>('#csv-sql-tool')!;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = $<HTMLTextAreaElement>('csv-sql-input');
const fileInput = $<HTMLInputElement>('csv-sql-file');
const status = $('csv-sql-status');
const result = $('csv-sql-result');
const placeholder = $('csv-sql-placeholder');
const code = $<HTMLPreElement>('csv-sql-code');
const preview = $('csv-sql-preview');
const copy = $<HTMLButtonElement>('csv-sql-copy');
const convert = $<HTMLButtonElement>('csv-sql-convert');
const formatter = new Intl.NumberFormat('en');
const MAX_BYTES = 10 * 1024 * 1024;
const TEXTAREA_LIMIT = 2 * 1024 * 1024;
const CODE_LIMIT = 100000;
let worker: Worker | undefined;
let sequence = 0;
let busy = false;
let fileText: string | undefined;
let fileName: string | undefined;
let current: CsvSqlResult | undefined;
let view: 'sql' | 'table' = 'sql';

function announce(message: string) { status.hidden = false; status.textContent = message; }
function clearStatus() { status.hidden = true; status.textContent = ''; }
function size(bytes: number) { return bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`; }
function stopWorker() { if (busy) { worker?.terminate(); worker = undefined; busy = false; convert.disabled = false; } }
function hideResult() { current = undefined; result.hidden = true; placeholder.hidden = false; code.textContent = ''; }
function options(): CsvSqlOptions {
  return {
    dialect: $<HTMLSelectElement>('csv-sql-dialect').value as CsvSqlOptions['dialect'],
    delimiter: $<HTMLSelectElement>('csv-sql-delimiter').value as CsvSqlOptions['delimiter'],
    tableName: $<HTMLInputElement>('csv-sql-table').value,
    firstRowHeaders: $<HTMLInputElement>('csv-sql-headers').checked,
    createTable: $<HTMLInputElement>('csv-sql-create').checked,
    batchInsert: $<HTMLInputElement>('csv-sql-batch').checked,
    emptyAsNull: $<HTMLInputElement>('csv-sql-null').checked,
    detectTypes: $<HTMLInputElement>('csv-sql-types').checked,
  };
}
function showView(next: 'sql' | 'table') {
  view = next;
  root.querySelectorAll<HTMLButtonElement>('[data-csv-sql-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.csvSqlView === view)));
  code.hidden = view !== 'sql';
  preview.hidden = view !== 'table';
  $('csv-sql-note').textContent = !current ? '' : view === 'sql'
    ? current.sql.length > CODE_LIMIT ? 'Showing the start of the SQL. Copy or download for the complete output.' : 'Copy or download the complete SQL.'
    : `Showing ${formatter.format(current.preview.length)} of ${formatter.format(current.rows)} rows and up to 30 of ${formatter.format(current.columns)} columns. The SQL includes every row.`;
}
function showResult(data: CsvSqlResult) {
  current = data;
  result.hidden = false; placeholder.hidden = true;
  $('csv-sql-summary').textContent = `${formatter.format(data.rows)} rows, ${formatter.format(data.columns)} columns · ${size(new Blob([data.sql]).size)} SQL · ${data.delimiter} input`;
  const head = document.createElement('thead');
  const headerRow = head.insertRow();
  for (const [index, value] of data.headers.slice(0, 30).entries()) {
    const th = document.createElement('th'); th.scope = 'col'; th.textContent = value; th.title = data.types[index]; headerRow.append(th);
  }
  const body = document.createElement('tbody');
  for (const row of data.preview) {
    const tr = body.insertRow();
    for (const value of row) tr.insertCell().textContent = value;
  }
  $<HTMLTableElement>('csv-sql-preview-table').replaceChildren(head, body);
  code.textContent = data.sql.slice(0, CODE_LIMIT);
  code.scrollTo(0, 0); preview.scrollTo(0, 0);
  copy.textContent = 'Copy SQL';
  showView('sql'); clearStatus();
}
function errorMessage(error: { code: CsvSqlErrorCode | 'workerError'; row?: number }): string {
  switch (error.code) {
    case 'empty': return 'Paste CSV or choose a file first.';
    case 'invalidCsv': return `The CSV has an unmatched or misplaced quote near row ${formatter.format(error.row ?? 1)}. Check that quoted fields use two quotes for a literal quote.`;
    case 'noRows': return 'No data rows were found. Add at least one row below the header, or turn off “First row contains column names”.';
    case 'tooManyColumns': return 'This CSV has more than 500 columns. Split it into narrower files.';
    case 'invalidTable': return 'Enter a table name, optionally with one schema prefix (schema.table).';
    default: return 'The conversion stopped. Try a smaller CSV file or use a computer with more memory.';
  }
}
function run() {
  const source = fileText ?? input.value;
  if (!source.trim()) { hideResult(); announce(errorMessage({ code: 'empty' })); input.focus(); return; }
  if (new Blob([source]).size > MAX_BYTES) { hideResult(); announce('This file is over 10 MB. Choose a smaller CSV file.'); return; }
  ++sequence; stopWorker();
  const id = sequence;
  busy = true; convert.disabled = true; announce('Converting to SQL…');
  worker ??= new Worker(new URL('../workers/csv-to-sql.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<{ id: number; result?: CsvSqlResult; error?: { code: CsvSqlErrorCode | 'workerError'; row?: number } }>) => {
    if (event.data.id !== sequence) return;
    busy = false; convert.disabled = false;
    if (event.data.result) showResult(event.data.result);
    else { hideResult(); announce(errorMessage(event.data.error ?? { code: 'workerError' })); }
  };
  worker.onerror = () => { worker?.terminate(); worker = undefined; busy = false; convert.disabled = false; hideResult(); announce(errorMessage({ code: 'workerError' })); };
  worker.postMessage({ id, source, options: options() } satisfies CsvSqlRequest);
}
async function loadFile(file: File) {
  if (!/\.(csv|tsv|txt)$/i.test(file.name)) { announce('Choose a .csv, .tsv or .txt file.'); return; }
  if (file.size > MAX_BYTES) { announce('This file is over 10 MB. Choose a smaller CSV file.'); return; }
  ++sequence; stopWorker();
  const id = sequence; announce('Reading file…');
  try {
    const content = await file.text();
    if (id !== sequence) return;
    if (file.size > TEXTAREA_LIMIT) { input.value = ''; fileText = content; $('csv-sql-hint').textContent = `Loaded ${file.name}. The file is too large to show in the text box.`; }
    else { input.value = content; fileText = undefined; $('csv-sql-hint').textContent = 'Edit the CSV here, or choose another file.'; }
    fileName = file.name; $('csv-sql-file-name').textContent = file.name; $('csv-sql-file-size').textContent = size(file.size); $('csv-sql-file-line').hidden = false;
    hideResult(); announce(`Loaded ${file.name} (${size(file.size)}). Select Convert to SQL.`);
  } catch { if (id === sequence) announce('The file could not be read. Try choosing it again.'); }
}
$('csv-sql-choose').addEventListener('click', () => { fileInput.value = ''; fileInput.click(); });
fileInput.addEventListener('change', () => { if (fileInput.files?.[0]) void loadFile(fileInput.files[0]); });
$('csv-sql-example').addEventListener('click', () => {
  ++sequence; stopWorker(); fileText = undefined; fileName = undefined;
  input.value = 'id,name,city,active\n001,Ada Lovelace,London,true\n002,"Grace, Jr.",New York,false\n003,O\'Neil,Dublin,true';
  $('csv-sql-file-line').hidden = true; $('csv-sql-hint').textContent = 'Edit the CSV here, or choose a local file.';
  hideResult(); clearStatus(); input.focus();
});
input.addEventListener('input', () => { ++sequence; stopWorker(); fileText = undefined; fileName = undefined; $('csv-sql-file-line').hidden = true; if (current) hideResult(); clearStatus(); });
convert.addEventListener('click', run);
root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('.csv-sql-options input, .csv-sql-options select').forEach(element => element.addEventListener('change', () => { if (current || busy) run(); }));
$<HTMLInputElement>('csv-sql-table').addEventListener('input', () => { ++sequence; stopWorker(); if (current) hideResult(); clearStatus(); });
root.querySelectorAll<HTMLButtonElement>('[data-csv-sql-view]').forEach(button => button.addEventListener('click', () => showView(button.dataset.csvSqlView as 'sql' | 'table')));
$('csv-sql-download').addEventListener('click', () => {
  if (!current) return;
  const url = URL.createObjectURL(new Blob([current.sql], { type: 'application/sql;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = (fileName?.replace(/\.[^.]+$/, '') || 'converted') + '.sql'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
});
copy.addEventListener('click', async () => {
  if (!current) return;
  const selected = current;
  try {
    if (!navigator.clipboard?.writeText) throw Error();
    await navigator.clipboard.writeText(current.sql);
    if (current !== selected) return;
    copy.textContent = 'Copied'; announce('SQL copied.');
  } catch {
    if (current !== selected) return;
    showView('sql'); code.textContent = current.sql;
    const selection = window.getSelection(); const range = document.createRange(); range.selectNodeContents(code);
    selection?.removeAllRanges(); selection?.addRange(range); announce('Clipboard unavailable. The full SQL is selected; copy it with your keyboard.');
  }
});
$('csv-sql-reset').addEventListener('click', () => {
  ++sequence; stopWorker(); fileText = undefined; fileName = undefined; fileInput.value = ''; input.value = '';
  $('csv-sql-file-line').hidden = true; $('csv-sql-hint').textContent = 'Paste CSV or choose a local .csv or .tsv file. You can also drop a file here.';
  hideResult(); clearStatus(); input.focus();
});
root.addEventListener('dragover', event => { event.preventDefault(); root.classList.add('over'); });
root.addEventListener('dragleave', event => { if (!root.contains(event.relatedTarget as Node)) root.classList.remove('over'); });
root.addEventListener('drop', event => { event.preventDefault(); root.classList.remove('over'); if (event.dataTransfer?.files[0]) void loadFile(event.dataTransfer.files[0]); });
