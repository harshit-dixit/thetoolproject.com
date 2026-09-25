import type { CsvTable, Encoding, Separator } from '../lib/csv-viewer';
import type { CsvViewerRequest } from '../workers/csv-viewer';
import { serializeCsv } from '../lib/csv-viewer';
import { i18nFrom } from '../i18n/client';

const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const root = get<HTMLDivElement>('csv-viewer');
const fileInput = get<HTMLInputElement>('viewer-file');
const paste = get<HTMLTextAreaElement>('viewer-paste');
const importStatus = get<HTMLParagraphElement>('viewer-import-status');
const status = get<HTMLParagraphElement>('viewer-status');
const workspace = get<HTMLDivElement>('viewer-workspace');
const importPanel = get<HTMLDivElement>('viewer-import');
const scroll = get<HTMLDivElement>('viewer-scroll');
const tableHead = get<HTMLTableSectionElement>('viewer-thead');
const tableBody = get<HTMLTableSectionElement>('viewer-tbody');
const search = get<HTMLInputElement>('viewer-search');
const filter = get<HTMLInputElement>('viewer-filter');
const filterColumn = get<HTMLSelectElement>('viewer-filter-column');
const irregular = get<HTMLInputElement>('viewer-irregular');
const inspectColumn = get<HTMLSelectElement>('viewer-inspect-column');
const separator = get<HTMLSelectElement>('viewer-separator');
const encoding = get<HTMLSelectElement>('viewer-encoding');
const headers = get<HTMLInputElement>('viewer-headers');
const exportScope = get<HTMLSelectElement>('viewer-export-scope');

const { locale, t, counted, formatNumber } = i18nFrom(root);
const collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });

const rowHeight = 38;
const maxBytes = 10 * 1024 * 1024;
let worker: Worker | undefined;
let requestId = 0;
let table: CsvTable | undefined;
let visible: number[] = [];
let sortColumn = -1;
let sortDirection = 1;
let fileName = 'pasted.csv';
let fileEncoding = 'pasted';
const originals = new Map<string, string>();
let renderQueued = false;
let filterTimer: ReturnType<typeof setTimeout>;

function message(target: HTMLElement, value: string) { target.textContent = value; target.hidden = !value; }
function labelSeparator(value: string) {
  const map: Record<string, string> = {
    comma: t('csvViewer.sepComma'),
    semicolon: t('csvViewer.sepSemicolon'),
    tab: t('csvViewer.sepTab'),
    pipe: t('csvViewer.sepPipe'),
  };
  return map[value] || value;
}
function errorText(code: string, row?: number) {
  if (code === 'empty') return t('csvViewer.errEmpty');
  if (code === 'tooManyColumns') return t('csvViewer.errTooManyColumns');
  if (row) return t('csvViewer.errReadRow', { row: formatNumber(row) });
  return t('csvViewer.errReadGeneric');
}

function parseSource(source: string | ArrayBuffer, name: string) {
  const size = typeof source === 'string' ? new Blob([source]).size : source.byteLength;
  if (size > maxBytes) { message(importStatus, t('csvViewer.errLargeMemory')); return; }
  fileName = name;
  message(importStatus, t('csvViewer.reading'));
  get<HTMLButtonElement>('viewer-choose').disabled = true;
  get<HTMLButtonElement>('viewer-open-paste').disabled = true;
  worker ??= new Worker(new URL('../workers/csv-viewer.ts', import.meta.url), { type: 'module' });
  const id = ++requestId;
  worker.onmessage = (event: MessageEvent<{ id: number; ok: boolean; table?: CsvTable; encoding?: string; code?: string; row?: number }>) => {
    if (event.data.id !== requestId) return;
    get<HTMLButtonElement>('viewer-choose').disabled = false;
    get<HTMLButtonElement>('viewer-open-paste').disabled = false;
    if (!event.data.ok || !event.data.table) { message(importStatus, errorText(event.data.code || 'invalid', event.data.row)); return; }
    table = event.data.table;
    fileEncoding = event.data.encoding || 'pasted';
    originals.clear(); sortColumn = -1; sortDirection = 1;
    search.value = ''; filter.value = ''; filterColumn.value = ''; exportScope.value = 'all';
    irregular.checked = false;
    get<HTMLElement>('viewer-irregular-wrap').hidden = table.irregularRows === 0;
    fillColumnOptions();
    get<HTMLElement>('viewer-filename').textContent = name;
    const irregularText = table.irregularRows ? ` · ${counted('csvViewer.metaIrregular', table.irregularRows)}` : '';
    const encodingText = fileEncoding === 'pasted' ? t('csvViewer.metaPasted') : fileEncoding.toUpperCase();
    get<HTMLElement>('viewer-filemeta').textContent = `${t('csvViewer.metaSeparated', { separator: labelSeparator(table.separator) })} · ${encodingText}${irregularText}`;
    get<HTMLElement>('viewer-row-count').textContent = formatNumber(table.rows.length);
    get<HTMLElement>('viewer-column-count').textContent = formatNumber(table.headers.length);
    scroll.style.height = `${Math.min(440, Math.max(180, (table.rows.length + 1) * rowHeight + 2))}px`;
    updateEditCount();
    buildHeader();
    applyFilters();
    importPanel.hidden = true; workspace.hidden = false;
    message(importStatus, ''); message(status, '');
    scroll.scrollTop = 0;
    scheduleRender();
  };
  // A worker that runs out of memory dies without a message, so re-enable the import buttons and say so.
  worker.onerror = () => {
    worker?.terminate(); worker = undefined;
    if (id !== requestId) return;
    get<HTMLButtonElement>('viewer-choose').disabled = false;
    get<HTMLButtonElement>('viewer-open-paste').disabled = false;
    message(importStatus, t('csvViewer.errWorker'));
  };
  const request: CsvViewerRequest = { id, source, separator: separator.value as Separator, encoding: encoding.value as Encoding, firstRowHeaders: headers.checked };
  worker.postMessage(request);
}

function fillColumnOptions() {
  if (!table) return;
  for (const select of [filterColumn, inspectColumn]) {
    select.replaceChildren();
    if (select === filterColumn) select.add(new Option(t('csvViewer.allColumns'), ''));
    table.headers.forEach((header, index) => select.add(new Option(header, String(index))));
  }
}

function buildHeader() {
  if (!table) return;
  const row = document.createElement('tr');
  const index = document.createElement('th'); index.scope = 'col'; index.textContent = '#'; row.append(index);
  table.headers.forEach((header, column) => {
    const th = document.createElement('th'); th.scope = 'col';
    th.setAttribute('aria-sort', sortColumn === column ? (sortDirection === 1 ? 'ascending' : 'descending') : 'none');
    const button = document.createElement('button'); button.type = 'button';
    button.textContent = `${header}${sortColumn === column ? (sortDirection === 1 ? ' ↑' : ' ↓') : ''}`;
    button.title = t('csvViewer.sortHeader', { header });
    button.addEventListener('click', () => {
      if (sortColumn === column) sortDirection *= -1; else { sortColumn = column; sortDirection = 1; }
      buildHeader(); applyFilters(); scroll.scrollTop = 0; scheduleRender();
    });
    th.append(button); row.append(th);
  });
  tableHead.replaceChildren(row);
}

function applyFilters() {
  if (!table) return;
  const query = search.value.trim().toLocaleLowerCase();
  const columnQuery = filter.value.trim().toLocaleLowerCase();
  const selectedColumn = filterColumn.value === '' ? -1 : Number(filterColumn.value);
  const irregularSet = irregular.checked ? new Set(table.irregularIndices) : undefined;
  visible = [];
  table.rows.forEach((row, index) => {
    if (irregularSet && !irregularSet.has(index)) return;
    if (query && !row.some(value => value.toLocaleLowerCase().includes(query))) return;
    if (columnQuery && !(selectedColumn < 0 ? row.some(value => value.toLocaleLowerCase().includes(columnQuery)) : row[selectedColumn].toLocaleLowerCase().includes(columnQuery))) return;
    visible.push(index);
  });
  if (sortColumn >= 0) visible.sort((a, b) => sortDirection * (collator.compare(table!.rows[a][sortColumn], table!.rows[b][sortColumn]) || a - b));
  get<HTMLElement>('viewer-showing').textContent = counted('csvViewer.showingRows', table.rows.length, { shown: formatNumber(visible.length) });
  get<HTMLElement>('viewer-empty').hidden = visible.length !== 0;
  profile();
  scheduleRender();
}

function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; renderRows(); });
}

function spacer(height: number) {
  const tr = document.createElement('tr'); tr.className = 'viewer-spacer'; tr.setAttribute('aria-hidden', 'true');
  const td = document.createElement('td'); td.colSpan = (table?.headers.length || 0) + 1; td.style.height = `${height}px`; tr.append(td);
  return tr;
}

function renderRows() {
  if (!table) return;
  const start = Math.max(0, Math.floor(scroll.scrollTop / rowHeight) - 8);
  const count = Math.ceil(scroll.clientHeight / rowHeight) + 16;
  const end = Math.min(visible.length, start + count);
  const fragment = document.createDocumentFragment();
  if (start) fragment.append(spacer(start * rowHeight));
  for (let display = start; display < end; display++) {
    const rowIndex = visible[display]; const values = table.rows[rowIndex];
    const tr = document.createElement('tr');
    const numberCell = document.createElement('td'); numberCell.textContent = formatNumber(rowIndex + 1); tr.append(numberCell);
    values.forEach((value, column) => {
      const td = document.createElement('td');
      if (originals.has(`${rowIndex}:${column}`)) { td.dataset.edited = ''; tr.dataset.edited = ''; }
      const button = document.createElement('button'); button.type = 'button'; button.textContent = value || ' ';
      button.title = value || t('csvViewer.emptyCell');
      button.setAttribute('aria-label', t('csvViewer.cellAria', {
        row: formatNumber(rowIndex + 1),
        header: table!.headers[column],
        value: value || t('csvViewer.cellEmpty')
      }));
      button.addEventListener('click', () => editCell(td, rowIndex, column));
      td.append(button); tr.append(td);
    });
    fragment.append(tr);
  }
  if (end < visible.length) fragment.append(spacer((visible.length - end) * rowHeight));
  tableBody.replaceChildren(fragment);
}

function editCell(cell: HTMLTableCellElement, row: number, column: number) {
  if (!table) return;
  const input = document.createElement('input'); input.type = 'text'; input.value = table.rows[row][column];
  input.setAttribute('aria-label', t('csvViewer.editCellAria', { row: formatNumber(row + 1), header: table.headers[column] }));
  let done = false;
  const finish = (save: boolean) => {
    if (done || !table) return; done = true;
    if (save && input.value !== table.rows[row][column]) {
      const key = `${row}:${column}`;
      if (!originals.has(key)) originals.set(key, table.rows[row][column]);
      table.rows[row][column] = input.value;
      if (table.rows[row][column] === originals.get(key)) originals.delete(key);
      updateEditCount(); applyFilters();
    } else scheduleRender();
  };
  input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); input.blur(); } else if (event.key === 'Escape') { event.preventDefault(); finish(false); } });
  input.addEventListener('blur', () => finish(true));
  cell.replaceChildren(input); input.focus(); input.select();
}

function updateEditCount() {
  get<HTMLElement>('viewer-edit-count').textContent = formatNumber(originals.size);
  get<HTMLButtonElement>('viewer-revert').disabled = originals.size === 0;
}

function profile() {
  if (!table) return;
  const column = Number(inspectColumn.value || 0);
  const values = visible.map(index => table!.rows[index][column]);
  const blanks = values.filter(value => value === '').length;
  const distinct = new Set(values).size;
  const examples = [...new Set(values.filter(Boolean))].slice(0, 3).join(' · ') || t('csvViewer.profileNone');
  const dl = get<HTMLDListElement>('viewer-profile'); dl.replaceChildren();
  for (const [term, value] of [
    [t('csvViewer.profileValues'), formatNumber(values.length)],
    [t('csvViewer.profileBlanks'), formatNumber(blanks)],
    [t('csvViewer.profileDistinct'), formatNumber(distinct)],
    [t('csvViewer.profileExamples'), examples]
  ]) {
    const item = document.createElement('div'); const dt = document.createElement('dt'); dt.textContent = term;
    const dd = document.createElement('dd'); dd.textContent = value; item.append(dt, dd); dl.append(item);
  }
}

function selectedRows() { return (exportScope.value === 'visible' ? visible : table!.rows.map((_, index) => index)).map(index => table!.rows[index]); }
function fileBase() { return (fileName.replace(/\.[^.]+$/, '') || 'data').replace(/[\\/:*?"<>|]/g, '_'); }
function download(content: string, type: string, extension: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a'); link.href = url; link.download = `${fileBase()}-viewed.${extension}`;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

get<HTMLButtonElement>('viewer-choose').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0]; if (!file) return;
  if (file.size > maxBytes) { message(importStatus, t('csvViewer.errLargeMemory')); return; }
  parseSource(await file.arrayBuffer(), file.name);
});
get<HTMLButtonElement>('viewer-paste-toggle').addEventListener('click', event => {
  const panel = get<HTMLDivElement>('viewer-paste-panel'); panel.hidden = !panel.hidden;
  (event.currentTarget as HTMLButtonElement).setAttribute('aria-expanded', String(!panel.hidden));
  if (!panel.hidden) paste.focus();
});
get<HTMLButtonElement>('viewer-open-paste').addEventListener('click', () => parseSource(paste.value, 'pasted.csv'));
get<HTMLButtonElement>('viewer-example').addEventListener('click', () => parseSource('order_id,customer,city,amount,status\n1001,Ada Lovelace,London,125.50,Paid\n1002,Grace Hopper,New York,89.00,Pending\n1003,Alan Turing,Manchester,210.75,Paid\n1004,Katherine Johnson,White Sulphur Springs,156.20,Refunded\n1005,Radia Perlman,Portsmouth,42.99,Paid', 'sample-orders.csv'));
get<HTMLButtonElement>('viewer-replace').addEventListener('click', () => {
  if (originals.size && !window.confirm(t('csvViewer.confirmDiscard'))) return;
  workspace.hidden = true; importPanel.hidden = false; fileInput.value = ''; table = undefined; originals.clear();
  get<HTMLButtonElement>('viewer-choose').focus();
});
scroll.addEventListener('scroll', scheduleRender, { passive: true });
for (const control of [search, filter, filterColumn]) control.addEventListener('input', () => {
  clearTimeout(filterTimer); filterTimer = setTimeout(() => { applyFilters(); scroll.scrollTop = 0; }, 120);
});
irregular.addEventListener('change', () => { applyFilters(); scroll.scrollTop = 0; });
inspectColumn.addEventListener('change', profile);
get<HTMLButtonElement>('viewer-revert').addEventListener('click', () => {
  if (!table) return;
  for (const [key, value] of originals) { const [row, column] = key.split(':').map(Number); table.rows[row][column] = value; }
  originals.clear(); updateEditCount(); applyFilters(); message(status, t('csvViewer.statusReverted'));
});
get<HTMLButtonElement>('viewer-download-csv').addEventListener('click', () => {
  if (!table) return;
  download(serializeCsv(table.headers, selectedRows(), ',', true), 'text/csv;charset=utf-8', 'csv');
  message(status, t('csvViewer.statusCsvDownloaded'));
});
get<HTMLButtonElement>('viewer-download-json').addEventListener('click', () => {
  if (!table) return;
  const objects = selectedRows().map(row => Object.fromEntries(table!.headers.map((header, index) => [header, row[index]])));
  download(JSON.stringify(objects, null, 2) + '\n', 'application/json;charset=utf-8', 'json');
  message(status, t('csvViewer.statusJsonDownloaded'));
});
get<HTMLButtonElement>('viewer-copy').addEventListener('click', async () => {
  if (!table) return;
  try {
    await navigator.clipboard.writeText(serializeCsv(table.headers, selectedRows(), '\t', true));
    message(status, t('csvViewer.statusCopied'));
  } catch { message(status, t('csvViewer.errClipboard')); }
});
const drop = get<HTMLDivElement>('csv-viewer');
drop.addEventListener('dragover', event => { if (event.dataTransfer?.types.includes('Files')) { event.preventDefault(); drop.classList.add('over'); } });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', async event => {
  drop.classList.remove('over');
  const file = event.dataTransfer?.files[0]; if (!file) return;
  event.preventDefault();
  if (originals.size && !window.confirm(t('csvViewer.confirmDiscard'))) return;
  if (file.size > maxBytes) { message(importStatus, t('csvViewer.errLargeMemory')); return; }
  workspace.hidden = true; importPanel.hidden = false;
  parseSource(await file.arrayBuffer(), file.name);
});
