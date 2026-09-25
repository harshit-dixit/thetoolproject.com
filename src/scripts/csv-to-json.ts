import { decodeCsv, type Encoding, type Separator } from '../lib/csv-viewer';
import type { CsvJsonOptions, CsvJsonResult } from '../lib/csv-to-json';
import type { CsvJsonRequest } from '../workers/csv-to-json';

const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const root = get<HTMLDivElement>('csv-json-tool');
const input = get<HTMLTextAreaElement>('csv-json-input');
const fileInput = get<HTMLInputElement>('csv-json-file');
const code = get<HTMLPreElement>('csv-json-code');
const status = get<HTMLParagraphElement>('csv-json-status');
const copy = get<HTMLButtonElement>('csv-json-copy');
const download = get<HTMLButtonElement>('csv-json-download');
const formatter = new Intl.NumberFormat('en');
const maxBytes = 10 * 1024 * 1024;
const displayLimit = 100000;
let worker: Worker | undefined;
let requestId = 0;
let timer: ReturnType<typeof setTimeout>;
let fileBuffer: ArrayBuffer | undefined;
let fileName = '';
let fileSource = '';
let current: CsvJsonResult | undefined;

function message(value: string) { status.textContent = value; status.hidden = !value; }
function size(bytes: number) { return bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`; }
function settings(): CsvJsonOptions {
  return {
    separator: get<HTMLSelectElement>('csv-json-separator').value as Separator,
    firstRowHeaders: get<HTMLInputElement>('csv-json-headers').checked,
    detectTypes: get<HTMLInputElement>('csv-json-types').checked,
    emptyAsNull: get<HTMLInputElement>('csv-json-null').checked,
    format: get<HTMLSelectElement>('csv-json-format').value as CsvJsonOptions['format'],
  };
}
function clearOutput() {
  current = undefined;
  code.textContent = 'Your JSON will appear here as you type.';
  get<HTMLElement>('csv-json-details').hidden = true;
  get<HTMLElement>('csv-json-output-label').textContent = 'All conversion happens in your browser';
  copy.disabled = true; download.disabled = true;
}
function show(data: CsvJsonResult) {
  current = data;
  code.textContent = data.json.length > displayLimit ? `${data.json.slice(0, displayLimit)}\n…` : data.json || '(No data rows)';
  const format = settings().format;
  get<HTMLElement>('csv-json-output-label').textContent = data.json.length > displayLimit ? 'Showing the start; copy or download all' : `${size(new Blob([data.json]).size)} ${format === 'lines' ? 'JSON Lines' : 'JSON'}`;
  copy.disabled = false; download.disabled = false;
  download.textContent = format === 'lines' ? 'Download .jsonl' : 'Download .json';
  get<HTMLElement>('csv-json-state').textContent = `${formatter.format(data.rows)} rows converted`;
  get<HTMLElement>('csv-json-summary').textContent = `${formatter.format(data.rows)} rows · ${formatter.format(data.columns)} columns · ${data.separator} separated`;
  const diagnostics: string[] = [];
  if (data.irregularRows) diagnostics.push(`${formatter.format(data.irregularRows)} ${data.irregularRows === 1 ? 'row has' : 'rows have'} a different field count${data.irregularIndices.length ? ` (data ${data.irregularIndices.length === 1 ? 'row' : 'rows'} ${data.irregularIndices.map(index => formatter.format(index + 1)).join(', ')}${data.irregularRows > 5 ? ', …' : ''})` : ''}. Missing cells are empty; extra cells get generated column names.`);
  if (data.renamedHeaders) diagnostics.push(`${formatter.format(data.renamedHeaders)} blank or duplicate ${data.renamedHeaders === 1 ? 'header was' : 'headers were'} given a unique name.`);
  get<HTMLElement>('csv-json-diagnostics').textContent = diagnostics.join(' ');
  get<HTMLElement>('csv-json-diagnostics').hidden = !diagnostics.length;
  const head = document.createElement('thead');
  const heading = head.insertRow();
  data.headers.slice(0, 25).forEach(value => { const th = document.createElement('th'); th.scope = 'col'; th.textContent = value; heading.append(th); });
  const body = document.createElement('tbody');
  data.preview.forEach(row => { const tr = body.insertRow(); row.slice(0, 25).forEach(value => { const td = tr.insertCell(); td.textContent = value; td.title = value; }); });
  get<HTMLTableElement>('csv-json-table').replaceChildren(head, body);
  get<HTMLElement>('csv-json-preview-note').textContent = `Showing ${formatter.format(data.preview.length)} of ${formatter.format(data.rows)} rows${data.columns > 25 ? ' and the first 25 columns' : ''}. The JSON includes every row and column.`;
  get<HTMLElement>('csv-json-details').hidden = false;
  message('');
}
function convert() {
  const source = fileBuffer && !input.value ? fileSource : input.value;
  if (!source.trim()) { ++requestId; clearOutput(); get<HTMLElement>('csv-json-state').textContent = 'Ready for data'; message(''); return; }
  if (new Blob([source]).size > maxBytes) { clearOutput(); message('The CSV is over 10 MB. Choose a smaller file.'); return; }
  const id = ++requestId;
  get<HTMLElement>('csv-json-state').textContent = 'Converting…';
  worker ??= new Worker(new URL('../workers/csv-to-json.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<{ id: number; result?: CsvJsonResult; error?: { code: string; row?: number } }>) => {
    if (event.data.id !== requestId) return;
    if (event.data.result) show(event.data.result);
    else {
      clearOutput(); get<HTMLElement>('csv-json-state').textContent = 'Check CSV input';
      const error = event.data.error;
      message(error?.code === 'tooManyColumns' ? 'This CSV has more than 500 columns. Choose a narrower file.' : error?.code === 'invalid' ? `The CSV has an unmatched or misplaced quote near row ${formatter.format(error.row ?? 1)}. Check quoted fields and the selected separator.` : 'Conversion stopped. Check the CSV and try again.');
    }
  };
  worker.onerror = () => { worker?.terminate(); worker = undefined; clearOutput(); message('Conversion stopped. Try a smaller CSV file.'); };
  worker.postMessage({ id, source, options: settings() } satisfies CsvJsonRequest);
}
function schedule() { clearTimeout(timer); ++requestId; worker?.terminate(); worker = undefined; clearOutput(); timer = setTimeout(convert, 220); }
function decodeFile() {
  if (!fileBuffer) return;
  try {
    const decoded = decodeCsv(fileBuffer, get<HTMLSelectElement>('csv-json-encoding').value as Encoding);
    fileSource = decoded.text;
    if (fileBuffer.byteLength <= 2 * 1024 * 1024) input.value = fileSource;
    else input.value = '';
    get<HTMLElement>('csv-json-source-label').textContent = `${fileName} · ${size(fileBuffer.byteLength)} · ${decoded.encoding.toUpperCase()}${input.value ? '' : ' · too large to show in editor'}`;
    schedule();
  } catch { message('The file could not be decoded. Try another encoding.'); }
}
async function loadFile(file: File) {
  if (!/\.(csv|tsv|tab|txt)$/i.test(file.name)) { message('Choose a .csv, .tsv, .tab or .txt file.'); return; }
  if (file.size > maxBytes) { message('Choose a file under 10 MB.'); return; }
  const id = ++requestId;
  message('Reading file…');
  try {
    const buffer = await file.arrayBuffer();
    if (id !== requestId) return;
    fileBuffer = buffer; fileName = file.name;
    decodeFile();
  } catch { if (id === requestId) message('The file could not be read. Choose it again.'); }
}
input.addEventListener('input', () => {
  if (fileBuffer) { fileBuffer = undefined; fileSource = ''; fileName = ''; }
  get<HTMLElement>('csv-json-source-label').textContent = 'Pasted CSV';
  schedule();
});
fileInput.addEventListener('change', () => { if (fileInput.files?.[0]) void loadFile(fileInput.files[0]); });
get<HTMLButtonElement>('csv-json-choose').addEventListener('click', () => { fileInput.value = ''; fileInput.click(); });
get<HTMLButtonElement>('csv-json-example').addEventListener('click', () => {
  fileBuffer = undefined; fileName = ''; fileSource = '';
  input.value = 'id,name,city,visits,active\n001,Ada Lovelace,London,12,true\n002,"Grace, Jr.",New York,8,false\n003,"Lin\nChen",Taipei,,true';
  get<HTMLElement>('csv-json-source-label').textContent = 'Example CSV · edit it here';
  schedule(); input.focus();
});
get<HTMLButtonElement>('csv-json-clear').addEventListener('click', () => {
  clearTimeout(timer); ++requestId; worker?.terminate(); worker = undefined; fileBuffer = undefined; fileName = ''; fileSource = ''; input.value = '';
  get<HTMLElement>('csv-json-source-label').textContent = 'Paste CSV or drop a file here';
  get<HTMLElement>('csv-json-state').textContent = 'Ready for data'; clearOutput(); message(''); input.focus();
});
get<HTMLSelectElement>('csv-json-encoding').addEventListener('change', () => { if (fileBuffer) decodeFile(); });
root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('.csv-json-settings input, .csv-json-settings select:not(#csv-json-encoding)').forEach(element => element.addEventListener('change', schedule));
root.addEventListener('dragover', event => { if (event.dataTransfer?.types.includes('Files')) { event.preventDefault(); root.classList.add('over'); } });
root.addEventListener('dragleave', event => { if (!root.contains(event.relatedTarget as Node)) root.classList.remove('over'); });
root.addEventListener('drop', event => { event.preventDefault(); root.classList.remove('over'); if (event.dataTransfer?.files[0]) void loadFile(event.dataTransfer.files[0]); });
copy.addEventListener('click', async () => {
  if (!current) return;
  try { await navigator.clipboard.writeText(current.json); copy.textContent = 'Copied'; setTimeout(() => { copy.textContent = 'Copy JSON'; }, 1800); }
  catch { code.focus(); const selection = window.getSelection(); const range = document.createRange(); range.selectNodeContents(code); selection?.removeAllRanges(); selection?.addRange(range); message('Clipboard unavailable. Select Copy in your browser to copy the visible JSON, or use Download for the complete result.'); }
});
download.addEventListener('click', () => {
  if (!current) return;
  const lines = settings().format === 'lines';
  const url = URL.createObjectURL(new Blob([current.json], { type: 'application/json;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `${fileName.replace(/\.[^.]+$/, '') || 'converted'}.${lines ? 'jsonl' : 'json'}`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
});
