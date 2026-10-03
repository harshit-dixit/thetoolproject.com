import type { HarCookie, HarDetail, HarPair, HarRow, HarSummary, HarTimings } from '../lib/har';
import type { HarRequest } from '../workers/har-analyzer';
import { i18nFrom } from '../i18n/client';
import { trackResult } from '../lib/analytics';

const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const root = get<HTMLDivElement>('har-tool');
const fileInput = get<HTMLInputElement>('har-file');
const empty = get<HTMLDivElement>('har-empty');
const workspace = get<HTMLDivElement>('har-workspace');
const importStatus = get<HTMLParagraphElement>('har-import-status');
const status = get<HTMLParagraphElement>('har-status');
const scroll = get<HTMLDivElement>('har-scroll');
const tableHead = get<HTMLTableSectionElement>('har-thead');
const tableBody = get<HTMLTableSectionElement>('har-tbody');
const search = get<HTMLInputElement>('har-search');
const pageSelect = get<HTMLSelectElement>('har-page');
const tabs = get<HTMLDivElement>('har-tabs');
const panel = get<HTMLDivElement>('har-panel');

const { locale, t, counted, formatNumber, formatBytes } = i18nFrom(root);
const collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'medium' });

const MAX_BYTES = 200 * 1024 * 1024;
const ROW_HEIGHT = 38;
const START_BUTTONS = ['har-choose', 'har-example'];

type Column = { key: 'name' | 'status' | 'method' | 'type' | 'size' | 'time' | 'waterfall'; width: string; value: (row: HarRow) => string | number };
const columns: Column[] = [
  { key: 'name', width: '34%', value: row => row.name },
  { key: 'status', width: '9%', value: row => row.status || -1 },
  { key: 'method', width: '8%', value: row => row.method },
  { key: 'type', width: '10%', value: row => t(`har.type.${row.type}`) },
  { key: 'size', width: '10%', value: row => row.transferred },
  { key: 'time', width: '9%', value: row => row.time },
  { key: 'waterfall', width: '20%', value: row => row.start },
];

let worker: Worker | undefined;
let requestId = 0;
const pending = new Map<number, (data: Record<string, unknown>) => void>();
let summary: HarSummary | undefined;
let fileName = 'requests.har';
let visible: HarRow[] = [];
let sortKey: Column['key'] = 'waterfall';
let sortDirection = 1;
let typeFilter = 'all';
let statusFilter = 'all';
let selected = -1;
let detail: HarDetail | undefined;
let tab = 'headers';
let renderQueued = false;
let filterTimer: ReturnType<typeof setTimeout>;
let latestOpen = 0;

function message(target: HTMLElement, value: string) { target.textContent = value; target.hidden = !value; }
function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function duration(ms: number) {
  if (ms < 0) return '–';
  if (ms >= 1000) return t('har.seconds', { value: formatNumber(ms / 1000, { maximumFractionDigits: 2 }) });
  return t('har.ms', { value: formatNumber(ms, { maximumFractionDigits: ms < 10 ? 1 : 0 }) });
}
function fileBase() { return (fileName.replace(/\.[^.]+$/, '') || 'requests').replace(/[\\/:*?"<>|]/g, '_'); }
function download(content: string, type: string, name: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a'); link.href = url; link.download = name;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function startWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('../workers/har-analyzer.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<Record<string, unknown> & { id: number }>) => {
    pending.get(event.data.id)?.(event.data);
    pending.delete(event.data.id);
  };
  // A worker that runs out of memory dies without a message, so every waiting request fails with the same error.
  worker.onerror = () => {
    worker?.terminate(); worker = undefined;
    for (const resolve of pending.values()) resolve({ ok: false, code: 'workerError' });
    pending.clear();
  };
  return worker;
}
// Omit doesn't distribute over a union, so each request shape keeps its own fields.
type Ask = HarRequest extends infer R ? R extends HarRequest ? Omit<R, 'id'> : never : never;
function ask(request: Ask): Promise<Record<string, unknown>> {
  const id = ++requestId;
  return new Promise(resolve => { pending.set(id, resolve); startWorker().postMessage({ ...request, id }); });
}

function errorText(code: string) {
  const keys: Record<string, string> = { empty: 'har.errEmpty', invalidJson: 'har.errInvalidJson', notHar: 'har.errNotHar', workerError: 'har.errWorker', tooLarge: 'har.errTooLarge', wrongType: 'har.errWrongType' };
  return t(keys[code] ?? 'har.errGeneral');
}
function fail(code: string) {
  workspace.hidden = true; empty.hidden = false;
  message(importStatus, errorText(code));
  trackResult('error', { code });
}

async function open(request: Ask, name: string) {
  const generation = ++latestOpen;
  for (const id of START_BUTTONS) get<HTMLButtonElement>(id).disabled = true;
  workspace.hidden = true; empty.hidden = false;
  message(importStatus, t('har.reading'));
  const reply = await ask(request);
  // A file dropped while another was loading wins, whichever finishes first.
  if (generation !== latestOpen) return;
  for (const id of START_BUTTONS) get<HTMLButtonElement>(id).disabled = false;
  if (!reply.ok) { fail(String(reply.code)); return; }
  summary = reply.summary as HarSummary;
  fileName = name;
  show(summary);
  trackResult('success', { requests: summary.totals.requests, pages: summary.pages.length, errors: summary.totals.errors });
}

function show(data: HarSummary) {
  selected = -1; detail = undefined; tab = 'headers'; sortKey = 'waterfall'; sortDirection = 1;
  typeFilter = 'all'; statusFilter = 'all'; search.value = '';
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-har-type], [data-har-status]')) {
    button.setAttribute('aria-pressed', String(button.dataset.harType === 'all' || button.dataset.harStatus === 'all'));
  }
  get('har-filename').textContent = fileName;
  const meta = [
    data.creator ? t('har.metaCreator', { creator: [data.browser || data.creator, data.version].filter(Boolean).join(' ') }) : '',
    data.started ? t('har.metaStarted', { date: dateFormat.format(data.started) }) : '',
    data.pages.length ? counted('har.metaPages', data.pages.length) : '',
  ];
  get('har-meta').textContent = meta.filter(Boolean).join(' ');
  get('har-stat-requests').textContent = formatNumber(data.totals.requests);
  get('har-stat-errors').textContent = formatNumber(data.totals.errors);
  get('har-stat-transferred').textContent = formatBytes(data.totals.transferred);
  get('har-stat-time').textContent = duration(data.totals.span);
  pageSelect.replaceChildren(new Option(t('har.allPages'), ''));
  data.pages.forEach(page => pageSelect.add(new Option(page.title || page.id || t('har.untitledPage'), page.id)));
  get('har-page-wrap').hidden = data.pages.length < 2;
  get('har-detail-hint').hidden = false; get('har-detail-body').hidden = true;
  message(importStatus, ''); message(status, '');
  empty.hidden = true; workspace.hidden = false;
  buildHeader(); applyFilters();
  scroll.scrollTop = 0;
}

function buildHeader() {
  const row = document.createElement('tr');
  for (const column of columns) {
    const th = el('th'); th.scope = 'col'; th.style.width = column.width;
    th.setAttribute('aria-sort', sortKey === column.key ? (sortDirection === 1 ? 'ascending' : 'descending') : 'none');
    const label = t(`har.col.${column.key}`);
    const button = el('button', `${label}${sortKey === column.key ? (sortDirection === 1 ? ' ↑' : ' ↓') : ''}`);
    button.type = 'button'; button.title = t('har.sortHeader', { header: label });
    button.addEventListener('click', () => {
      if (sortKey === column.key) sortDirection *= -1; else { sortKey = column.key; sortDirection = 1; }
      buildHeader(); applyFilters(); scroll.scrollTop = 0;
    });
    th.append(button); row.append(th);
  }
  tableHead.replaceChildren(row);
}

function matchesStatus(row: HarRow) {
  const failed = row.status === 0 || !!row.error;
  if (statusFilter === 'all') return true;
  if (statusFilter === 'failed') return failed;
  if (statusFilter === 'errors') return failed || row.status >= 400;
  return !failed && Math.floor(row.status / 100) === Number(statusFilter[0]);
}

function applyFilters() {
  if (!summary) return;
  const query = search.value.trim().toLowerCase();
  const page = pageSelect.value;
  visible = summary.rows.filter(row => (typeFilter === 'all' || row.type === typeFilter) && matchesStatus(row)
    && (!page || row.page === page) && (!query || row.url.toLowerCase().includes(query)));
  const column = columns.find(item => item.key === sortKey)!;
  visible.sort((a, b) => {
    const x = column.value(a); const y = column.value(b);
    const order = typeof x === 'number' && typeof y === 'number' ? x - y : collator.compare(String(x), String(y));
    return sortDirection * order || a.index - b.index;
  });
  get('har-showing').textContent = counted('har.showing', summary.rows.length, { shown: formatNumber(visible.length) });
  get('har-none').hidden = visible.length !== 0;
  scroll.style.height = `${Math.min(440, Math.max(160, (visible.length + 1) * ROW_HEIGHT + 4))}px`;
  scheduleRender();
}

function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; renderRows(); });
}

function spacer(height: number) {
  const tr = el('tr', undefined, 'har-spacer'); tr.setAttribute('aria-hidden', 'true');
  const td = el('td'); td.colSpan = columns.length; td.style.height = `${height}px`; tr.append(td);
  return tr;
}

function sizeCell(row: HarRow) {
  if (row.cache === 'memory') return t('har.cacheMemory');
  if (row.cache === 'disk') return t('har.cacheDisk');
  return row.transferred < 0 ? '–' : formatBytes(row.transferred);
}

function renderRows() {
  if (!summary) return;
  const span = Math.max(1, summary.totals.span);
  const start = Math.max(0, Math.floor(scroll.scrollTop / ROW_HEIGHT) - 8);
  const end = Math.min(visible.length, start + Math.ceil(scroll.clientHeight / ROW_HEIGHT) + 16);
  const fragment = document.createDocumentFragment();
  if (start) fragment.append(spacer(start * ROW_HEIGHT));
  for (let position = start; position < end; position++) {
    const row = visible[position];
    const tr = el('tr');
    if (row.index === selected) tr.dataset.selected = '';
    if (row.status === 0 || row.status >= 400 || row.error) tr.dataset.error = '';
    const name = el('td'); const button = el('button', row.name || row.url); button.type = 'button'; button.title = row.url; button.dataset.harRow = String(row.index);
    name.append(button);
    const statusText = row.status ? String(row.status) : t('har.failed');
    const cells = [
      name,
      el('td', statusText, 'har-num'),
      el('td', row.method, 'har-fmt'),
      el('td', t(`har.type.${row.type}`), 'har-muted-cell'),
      el('td', sizeCell(row), 'har-num har-fmt'),
      el('td', duration(row.time), 'har-num har-fmt'),
    ];
    cells[1].title = row.error || row.statusText || statusText;
    cells[4].title = row.size >= 0 ? `${t('har.fieldSize')}: ${formatBytes(row.size)}` : '';
    const waterfall = el('td'); const track = el('div', undefined, 'har-bar-track'); const bar = el('div', undefined, 'har-bar');
    bar.style.insetInlineStart = `${(row.start / span) * 100}%`;
    bar.style.width = `${(Math.max(0, row.time) / span) * 100}%`;
    track.append(bar); waterfall.append(track);
    tr.append(...cells, waterfall);
    tr.addEventListener('click', () => select(row.index));
    fragment.append(tr);
  }
  if (end < visible.length) fragment.append(spacer((visible.length - end) * ROW_HEIGHT));
  // Rows are rebuilt on every render, so keyboard focus moves to the same request's new button.
  const focused = tableBody.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.harRow : undefined;
  tableBody.replaceChildren(fragment);
  if (focused) tableBody.querySelector<HTMLButtonElement>(`[data-har-row="${focused}"]`)?.focus({ preventScroll: true });
}

async function select(index: number) {
  selected = index;
  scheduleRender();
  const reply = await ask({ type: 'detail', index });
  if (selected !== index) return;
  if (!reply.ok) { message(status, errorText(String(reply.code))); return; }
  detail = reply.detail as HarDetail;
  get('har-detail-hint').hidden = true; get('har-detail-body').hidden = false;
  get('har-detail-url').textContent = `${detail.method} ${detail.url}`;
  renderTabs();
  get('har-detail').scrollIntoView({ block: 'nearest' });
}

function availableTabs(item: HarDetail) {
  return ['headers', ...(item.query.length || item.post ? ['payload'] : []), 'response', ...(item.requestCookies.length || item.responseCookies.length ? ['cookies'] : []), 'timing'];
}

function renderTabs() {
  if (!detail) return;
  const list = availableTabs(detail);
  if (!list.includes(tab)) tab = 'headers';
  const hadFocus = tabs.contains(document.activeElement);
  tabs.replaceChildren(...list.map(name => {
    const button = el('button', t(`har.tab.${name}`)); button.type = 'button';
    button.dataset.harTab = name; button.setAttribute('aria-pressed', String(name === tab));
    button.addEventListener('click', () => { tab = name; renderTabs(); });
    return button;
  }));
  if (hadFocus) tabs.querySelector<HTMLButtonElement>(`[data-har-tab="${tab}"]`)?.focus();
  const render = { headers: renderHeaders, payload: renderPayload, response: renderResponse, cookies: renderCookies, timing: renderTiming }[tab as 'headers'];
  panel.replaceChildren(...render(detail));
}

function pairTable(rows: string[][], head?: string[]) {
  const table = el('table', undefined, 'har-pairs');
  if (head) {
    const tr = el('tr'); for (const label of head) if (label) { const th = el('th', label); th.scope = 'col'; tr.append(th); }
    table.append(el('thead')); table.tHead!.append(tr);
  }
  const body = el('tbody');
  for (const values of rows) {
    const tr = el('tr'); const th = el('th', values[0]); th.scope = 'row'; tr.append(th);
    for (const value of values.slice(1)) tr.append(el('td', value));
    body.append(tr);
  }
  table.append(body);
  return table;
}

function headerSection(title: string, headers: HarPair[]) {
  return [el('h4', `${title} (${formatNumber(headers.length)})`), headers.length ? pairTable(headers.map(pair => [pair.name, pair.value])) : el('p', t('har.noHeaders'))];
}

function renderHeaders(item: HarDetail): Node[] {
  const cache = summary?.rows[item.index]?.cache;
  const general: [string, string][] = [
    [t('har.fieldUrl'), item.url],
    [t('har.fieldMethod'), item.method],
    [t('har.fieldStatus'), item.status ? `${item.status} ${item.statusText}`.trim() : t('har.failed')],
  ];
  if (item.error) general.push([t('har.fieldError'), item.error]);
  if (item.httpVersion) general.push([t('har.fieldHttp'), item.httpVersion]);
  if (item.serverIp) general.push([t('har.fieldIp'), item.serverIp]);
  if (item.started) general.push([t('har.fieldStarted'), dateFormat.format(item.started)]);
  if (item.initiator) general.push([t('har.fieldInitiator'), item.initiator]);
  if (cache) general.push([t('har.fieldCache'), t({ memory: 'har.cacheMemory', disk: 'har.cacheDisk', revalidated: 'har.cacheRevalidated' }[cache])]);
  if (item.content.size >= 0) general.push([t('har.fieldSize'), t('har.sizeValue', { size: formatBytes(item.content.size), mime: item.content.mime || '–' })]);
  return [el('h4', t('har.general')), pairTable(general), ...headerSection(t('har.resHeaders'), item.responseHeaders), ...headerSection(t('har.reqHeaders'), item.requestHeaders)];
}

function codeView(text: string) { const pre = el('pre', text, 'code-view'); pre.tabIndex = 0; return pre; }

function renderPayload(item: HarDetail): Node[] {
  const nodes: Node[] = [];
  if (item.query.length) nodes.push(el('h4', t('har.query')), pairTable(item.query.map(pair => [pair.name, pair.value]), [t('har.pairName'), t('har.pairValue')]));
  if (item.post) {
    nodes.push(el('h4', item.post.mime ? `${t('har.body')} (${item.post.mime})` : t('har.body')));
    if (item.post.params.length) nodes.push(pairTable(item.post.params.map(pair => [pair.name, pair.value]), [t('har.pairName'), t('har.pairValue')]));
    if (item.post.text) {
      let text = item.post.text;
      try { if (/^\s*[[{]/.test(text)) text = JSON.stringify(JSON.parse(text), null, 2); } catch { /* Shown as it is. */ }
      nodes.push(codeView(text));
    }
  }
  return nodes.length ? nodes : [el('p', t('har.noPayload'))];
}

function renderResponse(item: HarDetail): Node[] {
  const content = item.content;
  if (content.kind === 'none') return [el('p', t('har.resNone'))];
  if (content.kind === 'binary') return [el('p', t('har.resBinary', { size: formatBytes(Math.max(0, content.size)) }))];
  if (content.kind === 'image') {
    const image = el('img'); image.alt = ''; image.src = `data:${content.mime};base64,${content.base64}`;
    return [image];
  }
  const nodes: Node[] = [];
  if (content.json) nodes.push(el('p', t('har.resJson'), 'har-muted'));
  if (content.truncated) nodes.push(el('p', t('har.resTruncated', { size: formatBytes(content.text.length) }), 'har-muted'));
  nodes.push(codeView(content.text));
  const button = el('button', t('har.downloadBody'), 'text-button'); button.type = 'button'; button.id = 'har-download-body';
  button.addEventListener('click', async () => {
    const reply = await ask({ type: 'body', index: item.index });
    if (!reply.ok) { message(status, errorText(String(reply.code))); return; }
    const name = (summary?.rows[item.index]?.name.split('?')[0] || 'response').replace(/[\\/:*?"<>|]/g, '_');
    download(String(reply.text), content.mime || 'text/plain', /\.[a-z0-9]{1,8}$/i.test(name) ? name : `${name}.txt`);
    message(status, t('har.bodyDownloaded'));
  });
  nodes.push(button);
  return nodes;
}

function cookieSection(title: string, list: HarCookie[]) {
  return list.length ? [el('h4', `${title} (${formatNumber(list.length)})`), pairTable(list.map(cookie => [cookie.name, cookie.value, cookie.details]), [t('har.pairName'), t('har.pairValue'), t('har.cookieDetails')])] : [];
}

function renderCookies(item: HarDetail): Node[] {
  const nodes = [...cookieSection(t('har.cookiesReq'), item.requestCookies), ...cookieSection(t('har.cookiesRes'), item.responseCookies)];
  return nodes.length ? nodes : [el('p', t('har.noCookies'))];
}

function renderTiming(item: HarDetail): Node[] {
  const phases: (keyof HarTimings)[] = ['blocked', 'dns', 'connect', 'ssl', 'send', 'wait', 'receive'];
  const timings = item.timings;
  const total = Math.max(1, item.time, phases.filter(phase => phase !== 'ssl').reduce((sum, phase) => sum + Math.max(0, timings[phase]), 0));
  const grid = el('div', undefined, 'har-timing');
  let offset = 0;
  let shown = 0;
  for (const phase of phases) {
    const value = timings[phase];
    // TLS happens inside the initial connection, so its bar sits at the end of the connection bar.
    const left = phase === 'ssl' ? offset - Math.max(0, value) : offset;
    if (phase !== 'ssl') offset += Math.max(0, value);
    if (value < 0) continue;
    shown++;
    const track = el('div', undefined, 'har-bar-track'); const bar = el('div', undefined, 'har-bar');
    bar.style.insetInlineStart = `${(left / total) * 100}%`; bar.style.width = `${(value / total) * 100}%`;
    track.append(bar);
    grid.append(el('span', t(`har.timing.${phase}`)), el('strong', duration(value)), track);
  }
  if (!shown) return [el('p', t('har.noTiming'))];
  grid.append(el('span', t('har.timingTotal')), el('strong', duration(item.time)), el('span'));
  return timings.ssl >= 0 ? [grid, el('p', t('har.timingNote'), 'har-muted')] : [grid];
}

function choose(file: File) {
  message(status, '');
  if (!/\.(har|json)$/i.test(file.name)) { fail('wrongType'); return; }
  if (file.size > MAX_BYTES) { fail('tooLarge'); return; }
  open({ type: 'open', file }, file.name);
}

get('har-choose').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => { const file = fileInput.files?.[0]; if (file) choose(file); fileInput.value = ''; });
get('har-example').addEventListener('click', () => open({ type: 'example' }, 'example.har'));
get('har-change').addEventListener('click', () => { workspace.hidden = true; empty.hidden = false; message(importStatus, ''); get('har-choose').focus(); });
scroll.addEventListener('scroll', scheduleRender, { passive: true });
search.addEventListener('input', () => { clearTimeout(filterTimer); filterTimer = setTimeout(() => { applyFilters(); scroll.scrollTop = 0; }, 120); });
pageSelect.addEventListener('change', () => { applyFilters(); scroll.scrollTop = 0; });
for (const [group, attribute] of [['har-types', 'harType'], ['har-statuses', 'harStatus']] as const) {
  get(group).addEventListener('click', event => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button');
    if (!button) return;
    for (const other of get(group).querySelectorAll('button')) other.setAttribute('aria-pressed', String(other === button));
    if (attribute === 'harType') typeFilter = button.dataset.harType!; else statusFilter = button.dataset.harStatus!;
    applyFilters(); scroll.scrollTop = 0;
  });
}
get('har-download-sanitized').addEventListener('click', async () => {
  const reply = await ask({ type: 'sanitize' });
  if (!reply.ok) { message(status, errorText(String(reply.code))); return; }
  download(String(reply.har), 'application/json', `${fileBase()}-sanitized.har`);
  message(status, counted('har.sanitizeDone', Number(reply.removed)));
});
root.addEventListener('dragover', event => { if (event.dataTransfer?.types.includes('Files')) { event.preventDefault(); root.classList.add('over'); } });
root.addEventListener('dragleave', () => root.classList.remove('over'));
root.addEventListener('drop', event => {
  root.classList.remove('over');
  const file = event.dataTransfer?.files[0]; if (!file) return;
  event.preventDefault();
  choose(file);
});
