import { decodeCsv, type Encoding, type Separator } from '../lib/csv-viewer';
import type { CsvJsonOptions, CsvJsonResult } from '../lib/csv-to-json';
import type { CsvJsonRequest } from '../workers/csv-to-json';
import { i18nFrom } from '../i18n/client';
import { sizeBucket, trackResult } from '../lib/analytics';

const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const root = get<HTMLDivElement>('csv-json-tool');
const input = get<HTMLTextAreaElement>('csv-json-input');
const fileInput = get<HTMLInputElement>('csv-json-file');
const code = get<HTMLPreElement>('csv-json-code');
const status = get<HTMLParagraphElement>('csv-json-status');
const copy = get<HTMLButtonElement>('csv-json-copy');
const download = get<HTMLButtonElement>('csv-json-download');

const { t, counted, formatNumber, formatBytes } = i18nFrom(root);
// Separator codes from the converter, shown as part of the result summary.
const separatedLabels = { comma: 'csvJson.separatedComma', semicolon: 'csvJson.separatedSemicolon', tab: 'csvJson.separatedTab', pipe: 'csvJson.separatedPipe' } as const;

const maxBytes = 10 * 1024 * 1024;
const displayLimit = 100000;
let worker: Worker | undefined;
let requestId = 0;
let timer: ReturnType<typeof setTimeout>;
let fileBuffer: ArrayBuffer | undefined;
let fileName = '';
let fileSource = '';
let current: CsvJsonResult | undefined;
let reportTimer: ReturnType<typeof setTimeout> | undefined;

function message(value: string) { status.textContent = value; status.hidden = !value; }
// Conversion reruns as the user types, so only the outcome the input settles on is reported.
function report(...args: Parameters<typeof trackResult>) { clearTimeout(reportTimer); reportTimer = setTimeout(() => trackResult(...args), 1500); }

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
  code.textContent = t('csvJson.codePlaceholder');
  get<HTMLElement>('csv-json-details').hidden = true;
  get<HTMLElement>('csv-json-output-label').textContent = t('csvJson.outputLabel');
  copy.disabled = true; download.disabled = true;
}

function show(data: CsvJsonResult) {
  current = data;
  code.textContent = data.json.length > displayLimit ? `${data.json.slice(0, displayLimit)}\n…` : data.json || t('csvJson.noDataRows');
  const format = settings().format;
  get<HTMLElement>('csv-json-output-label').textContent = data.json.length > displayLimit
    ? t('csvJson.codeTruncated')
    : t(format === 'lines' ? 'csvJson.outputSizeLines' : 'csvJson.outputSize', { size: formatBytes(new Blob([data.json]).size) });
  copy.disabled = false; download.disabled = false;
  download.textContent = format === 'lines' ? t('csvJson.downloadJsonl') : t('csvJson.download');
  get<HTMLElement>('csv-json-state').textContent = counted('csvJson.stateConverted', data.rows);
  get<HTMLElement>('csv-json-summary').textContent = t('csvJson.summaryMeta', {
    rows: counted('tool.rows', data.rows),
    columns: counted('tool.columns', data.columns),
    separated: t(separatedLabels[data.separator])
  });
  const diagnostics: string[] = [];
  if (data.irregularRows) {
    // The converter reports the first five irregular rows.
    const list = data.irregularIndices.map(index => formatNumber(index + 1)).join(', ') + (data.irregularRows > data.irregularIndices.length ? ', …' : '');
    diagnostics.push(counted('csvJson.diagDifferingWidths', data.irregularRows, { list }));
  }
  if (data.renamedHeaders) {
    diagnostics.push(counted('csvJson.diagRenamedHeaders', data.renamedHeaders));
  }
  get<HTMLElement>('csv-json-diagnostics').textContent = diagnostics.join(' ');
  get<HTMLElement>('csv-json-diagnostics').hidden = !diagnostics.length;
  const head = document.createElement('thead');
  const heading = head.insertRow();
  data.headers.slice(0, 25).forEach(value => { const th = document.createElement('th'); th.scope = 'col'; th.textContent = value; heading.append(th); });
  const body = document.createElement('tbody');
  data.preview.forEach(row => { const tr = body.insertRow(); row.slice(0, 25).forEach(value => { const td = tr.insertCell(); td.textContent = value; td.title = value; }); });
  get<HTMLTableElement>('csv-json-table').replaceChildren(head, body);
  get<HTMLElement>('csv-json-preview-note').textContent = counted(data.columns > 25 ? 'csvJson.previewNoteColumns' : 'csvJson.previewNote', data.rows, { shown: formatNumber(data.preview.length) });
  get<HTMLElement>('csv-json-details').hidden = false;
  message('');
  report('success', { rows: data.rows, columns: data.columns, separator: data.separator, format, output_size: sizeBucket(new Blob([data.json]).size) });
}

function convert() {
  const source = fileBuffer && !input.value ? fileSource : input.value;
  if (!source.trim()) { ++requestId; clearTimeout(reportTimer); clearOutput(); get<HTMLElement>('csv-json-state').textContent = t('csvJson.stateReady'); message(''); return; }
  if (new Blob([source]).size > maxBytes) { clearOutput(); message(t('csvJson.errTooLarge')); report('error', { code: 'tooLarge' }); return; }
  const id = ++requestId;
  get<HTMLElement>('csv-json-state').textContent = t('csvJson.stateWorking');
  worker ??= new Worker(new URL('../workers/csv-to-json.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<{ id: number; result?: CsvJsonResult; error?: { code: string; row?: number } }>) => {
    if (event.data.id !== requestId) return;
    if (event.data.result) show(event.data.result);
    else {
      clearOutput(); get<HTMLElement>('csv-json-state').textContent = t('csvJson.stateReady');
      const error = event.data.error;
      message(error?.code === 'tooManyColumns'
        ? t('csvJson.errTooManyColumns')
        : error?.code === 'invalid'
          ? t('csvJson.errInvalidQuote', { row: formatNumber(error.row ?? 1) })
          : t('csvJson.errWorker'));
      report('error', { code: error?.code === 'tooManyColumns' || error?.code === 'invalid' ? error.code : 'workerError' });
    }
  };
  worker.onerror = () => { worker?.terminate(); worker = undefined; clearOutput(); message(t('csvJson.errWorker')); report('error', { code: 'workerError' }); };
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
    get<HTMLElement>('csv-json-source-label').textContent = `${fileName} · ${formatBytes(fileBuffer.byteLength)} · ${decoded.encoding.toUpperCase()}${input.value ? '' : ` · ${t('csvJson.tooLargeEditor')}`}`;
    schedule();
  } catch { message(t('csvJson.errDecode')); trackResult('error', { code: 'decodeError' }); }
}

async function loadFile(file: File) {
  if (!/\.(csv|tsv|tab|txt)$/i.test(file.name)) { message(t('csvJson.errFileType')); trackResult('error', { code: 'wrongType' }); return; }
  if (file.size > maxBytes) { message(t('csvJson.errTooLarge')); trackResult('error', { code: 'tooLarge' }); return; }
  const id = ++requestId;
  message(t('csvJson.reading'));
  try {
    const buffer = await file.arrayBuffer();
    if (id !== requestId) return;
    fileBuffer = buffer; fileName = file.name;
    decodeFile();
  } catch { if (id === requestId) { message(t('csvJson.errRead')); trackResult('error', { code: 'readError' }); } }
}

input.addEventListener('input', () => {
  if (fileBuffer) { fileBuffer = undefined; fileSource = ''; fileName = ''; }
  get<HTMLElement>('csv-json-source-label').textContent = t('csvJson.pastedCsv');
  schedule();
});
fileInput.addEventListener('change', () => { if (fileInput.files?.[0]) void loadFile(fileInput.files[0]); });
get<HTMLButtonElement>('csv-json-choose').addEventListener('click', () => { fileInput.value = ''; fileInput.click(); });
get<HTMLButtonElement>('csv-json-example').addEventListener('click', () => {
  fileBuffer = undefined; fileName = ''; fileSource = '';
  input.value = 'id,name,city,visits,active\n001,Ada Lovelace,London,12,true\n002,"Grace, Jr.",New York,8,false\n003,"Lin\nChen",Taipei,,true';
  get<HTMLElement>('csv-json-source-label').textContent = t('csvJson.exampleCsv');
  schedule(); input.focus();
});
get<HTMLButtonElement>('csv-json-clear').addEventListener('click', () => {
  clearTimeout(timer); clearTimeout(reportTimer); ++requestId; worker?.terminate(); worker = undefined; fileBuffer = undefined; fileName = ''; fileSource = ''; input.value = '';
  get<HTMLElement>('csv-json-source-label').textContent = t('csvJson.sourceLabel');
  get<HTMLElement>('csv-json-state').textContent = t('csvJson.stateReady'); clearOutput(); message(''); input.focus();
});
get<HTMLSelectElement>('csv-json-encoding').addEventListener('change', () => { if (fileBuffer) decodeFile(); });
root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('.csv-json-settings input, .csv-json-settings select:not(#csv-json-encoding)').forEach(element => element.addEventListener('change', schedule));
root.addEventListener('dragover', event => { if (event.dataTransfer?.types.includes('Files')) { event.preventDefault(); root.classList.add('over'); } });
root.addEventListener('dragleave', event => { if (!root.contains(event.relatedTarget as Node)) root.classList.remove('over'); });
root.addEventListener('drop', event => { event.preventDefault(); root.classList.remove('over'); if (event.dataTransfer?.files[0]) void loadFile(event.dataTransfer.files[0]); });
copy.addEventListener('click', async () => {
  if (!current) return;
  try { await navigator.clipboard.writeText(current.json); copy.textContent = t('csvJson.copied'); setTimeout(() => { copy.textContent = t('csvJson.copy'); }, 1800); }
  catch { code.focus(); const selection = window.getSelection(); const range = document.createRange(); range.selectNodeContents(code); selection?.removeAllRanges(); selection?.addRange(range); message(t('csvJson.errClipboard')); }
});
download.addEventListener('click', () => {
  if (!current) return;
  const lines = settings().format === 'lines';
  const url = URL.createObjectURL(new Blob([current.json], { type: 'application/json;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `${fileName.replace(/\.[^.]+$/, '') || 'converted'}.${lines ? 'jsonl' : 'json'}`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
});
