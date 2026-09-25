import type { DbfEncoding, DbfError, DbfResult } from '../lib/dbf-to-excel';
import type { DbfRequest } from '../workers/dbf-to-excel';

const root = document.querySelector<HTMLElement>('#dbf-tool')!;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = $<HTMLInputElement>('dbf-file');
const encoding = $<HTMLSelectElement>('dbf-encoding');
const convert = $<HTMLButtonElement>('dbf-convert');
const status = $('dbf-status');
const result = $('dbf-result');
const formatter = new Intl.NumberFormat('en');
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAX_BYTES = 20 * 1024 * 1024;
const errors: Record<string, string> = {
  invalid: 'This file does not have a valid DBF table structure. Check the source file and try again.',
  unsupported: 'This DBF uses a version or field type this converter cannot read.',
  memo: 'This DBF has memo fields that need a companion .dbt or .fpt file. Memo conversion is not supported here.',
  tooManyRows: 'This DBF has more rows than one Excel worksheet can hold.',
  tooManyColumns: 'This DBF has more columns than one Excel worksheet can hold.',
  encoding: 'This text encoding is unavailable in your browser. Choose another encoding.',
};
let file: File | undefined;
let worker: Worker | undefined;
let sequence = 0;
let output: Blob | undefined;
const showStatus = (message: string) => { status.textContent = message; status.hidden = !message; };
const size = (bytes: number) => bytes >= 1024 * 1024
  ? `${new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(bytes / 1024 / 1024)} MB`
  : `${new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(bytes / 1024)} KB`;
function resetResult() { output = undefined; result.hidden = true; }
function chooseFile(next: File) {
  if (!/\.dbf$/i.test(next.name)) { showStatus('Choose a .dbf file.'); return; }
  if (next.size > MAX_BYTES) { showStatus('Choose a DBF file no larger than 20 MB.'); return; }
  worker?.terminate(); worker = undefined; ++sequence; convert.disabled = false;
  file = next; resetResult(); showStatus('');
  $('dbf-name').textContent = next.name;
  $('dbf-size').textContent = size(next.size);
  $('dbf-empty').hidden = true; $('dbf-panel').hidden = false;
  void run();
}
function run() {
  if (!file) return;
  worker?.terminate();
  const id = ++sequence;
  resetResult(); convert.disabled = true; showStatus('Reading DBF and building XLSX in your browser…');
  worker = new Worker(new URL('../workers/dbf-to-excel.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<{ id: number; result?: DbfResult; error?: DbfError }>) => {
    if (event.data.id !== id) return;
    convert.disabled = false; worker?.terminate(); worker = undefined;
    if (event.data.error) { showStatus(errors[event.data.error.code] || errors.invalid); return; }
    const data = event.data.result!;
    output = new Blob([data.xlsx], { type: XLSX_TYPE });
    $('dbf-summary').textContent = `${formatter.format(data.rows)} records · ${formatter.format(data.columns)} columns · ${size(output.size)} XLSX`;
    const table = $<HTMLTableElement>('dbf-preview');
    const head = document.createElement('thead');
    const header = head.insertRow();
    for (const name of data.preview[0]) { const th = document.createElement('th'); th.scope = 'col'; th.textContent = name; header.append(th); }
    const body = document.createElement('tbody');
    for (const row of data.preview.slice(1)) { const tr = body.insertRow(); for (const value of row) tr.insertCell().textContent = value; }
    table.replaceChildren(head, body);
    const notes = [`Text decoded as ${data.encoding}.`];
    if (data.skipped) notes.push(`${formatter.format(data.skipped)} deleted records skipped.`);
    if (data.textNumbers) notes.push(`${formatter.format(data.textNumbers)} long numbers kept as text to avoid rounding.`);
    if (data.rows > data.preview.length - 1 || data.columns > data.preview[0].length) notes.push('Preview is limited; the download includes all records and columns.');
    $('dbf-note').textContent = notes.join(' ');
    result.hidden = false; showStatus('Conversion ready.');
  };
  worker.onerror = () => { if (id !== sequence) return; worker?.terminate(); worker = undefined; convert.disabled = false; showStatus('The conversion could not finish. Try a smaller DBF file.'); };
  worker.postMessage({ id, file, encoding: encoding.value as DbfEncoding } satisfies DbfRequest);
}
const choose = () => { input.value = ''; input.click(); };
$('dbf-choose').addEventListener('click', choose);
$('dbf-change').addEventListener('click', choose);
input.addEventListener('change', () => { if (input.files?.[0]) chooseFile(input.files[0]); });
convert.addEventListener('click', run);
encoding.addEventListener('change', () => { if (file) void run(); });
$('dbf-download').addEventListener('click', () => {
  if (!output || !file) return;
  const url = URL.createObjectURL(output);
  const link = document.createElement('a'); link.href = url; link.download = file.name.replace(/\.dbf$/i, '') + '.xlsx'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
});
root.addEventListener('dragover', event => { event.preventDefault(); root.classList.add('over'); });
root.addEventListener('dragleave', event => { if (!root.contains(event.relatedTarget as Node)) root.classList.remove('over'); });
root.addEventListener('drop', event => { event.preventDefault(); root.classList.remove('over'); if (event.dataTransfer?.files[0]) chooseFile(event.dataTransfer.files[0]); });
