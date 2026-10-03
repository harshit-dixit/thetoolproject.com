import type { PageSize } from '../lib/eml-to-pdf';
import type { MhtPage, MhtRequest, MhtResponse, MhtSummary } from '../workers/mht-to-pdf';
import { i18nFrom } from '../i18n/client';
import { sizeBucket, trackResult } from '../lib/analytics';

const root = document.querySelector<HTMLElement>('#mht-tool')!;
const { t, counted, formatBytes } = i18nFrom(root);
const strings = JSON.parse(root.dataset.strings!) as Record<string, string>;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = $<HTMLInputElement>('mht-file');
const status = $('mht-status');
const result = $('mht-result');
const download = $<HTMLButtonElement>('mht-download');
const printButton = $<HTMLButtonElement>('mht-print');
const preview = $('mht-preview');
const frame = $<HTMLIFrameElement>('mht-preview-frame');
// Phones mostly can't show a PDF inside a page, so they get the summary and the download only.
const canPreview = navigator.pdfViewerEnabled === true;
const MAX_BYTES = 50 * 1024 * 1024;
// A worker stuck on a damaged file is stopped rather than left spinning.
const TIMEOUT_MS = 90_000;
const ERROR_KEYS: Record<string, string> = {
  empty: 'mht.errEmpty', notMht: 'mht.errNotMht', noPage: 'mht.errNoPage', zipNoMht: 'mht.errZipNoMht', zipUnreadable: 'mht.errZipUnreadable',
  unsupportedScript: 'mht.errUnsupportedScript', tooManyPages: 'mht.errTooManyPages', font: 'mht.errFont', general: 'mht.errGeneral',
};

let file: File | undefined;
let worker: Worker | undefined;
let timer: number | undefined;
let nextId = 0;
let sequence = 0;
let pending: { id: number; resolve: (page: MhtPage | undefined) => void } | undefined;
let outputUrl: string | undefined;
let printer: typeof import('./mht-print') | undefined;
let pageSize = (root.querySelector<HTMLButtonElement>('[data-page-size][aria-pressed="true"]')?.dataset.pageSize ?? 'a4') as PageSize;
let header = true;

const showStatus = (message: string) => { status.textContent = message; status.hidden = !message; };
const press = (selector: string, active: (button: HTMLButtonElement) => boolean) =>
  root.querySelectorAll<HTMLButtonElement>(selector).forEach(button => button.setAttribute('aria-pressed', String(active(button))));
const baseName = () => (file?.name.replace(/\.(mht|mhtml|zip)$/i, '') || 'page');

// The preview and the download share one URL, released whenever the PDF is replaced.
function setOutput(next?: Blob) {
  if (outputUrl) URL.revokeObjectURL(outputUrl);
  outputUrl = next && URL.createObjectURL(next);
  preview.hidden = !(outputUrl && canPreview);
  // The reader's own toolbar would add a second download button, so it's hidden.
  if (canPreview) frame.src = outputUrl ? `${outputUrl}#toolbar=0&navpanes=0&view=FitH` : 'about:blank';
}

function stopWorker() {
  worker?.terminate();
  worker = undefined;
  clearTimeout(timer);
  pending?.resolve(undefined);
  pending = undefined;
}

function showSummary(summary: MhtSummary) {
  $('mht-title').textContent = summary.title || t('mht.untitled');
  $('mht-url').textContent = summary.url ? t('mht.savedFrom', { url: summary.url }) : summary.zipEntry ? t('mht.fromZip', { name: summary.zipEntry }) : '';
}

function fail(code: string, message = t(ERROR_KEYS[code] ?? 'mht.errGeneral'), printable = false) {
  setOutput();
  result.hidden = true;
  download.disabled = true;
  printButton.disabled = !printable;
  showStatus(message);
  trackResult('error', { code });
}

function chooseFile(next: File) {
  if (!/\.(mht|mhtml|zip)$/i.test(next.name) && !/^(multipart\/related|message\/rfc822|application\/x-mimearchive)$/.test(next.type)) { fail('wrongType', t('mht.errWrongType')); return; }
  if (next.size > MAX_BYTES) { fail('tooLarge', t('mht.errTooLarge')); return; }
  file = next;
  printer?.clearPrint();
  $('mht-name').textContent = next.name;
  $('mht-size').textContent = formatBytes(next.size);
  $('mht-title').textContent = '';
  $('mht-url').textContent = '';
  $('mht-empty').hidden = true;
  $('mht-panel').hidden = false;
  run();
}

function startTimer(id: number, onTimeout: () => void) {
  clearTimeout(timer);
  timer = window.setTimeout(() => { if (id === nextId) { stopWorker(); onTimeout(); } }, TIMEOUT_MS);
}

function run() {
  if (!file) return;
  const id = sequence = ++nextId;
  setOutput();
  result.hidden = true;
  download.disabled = true;
  printButton.disabled = true;
  showStatus(t('mht.reading'));
  worker ??= createWorker();
  startTimer(id, () => fail('timeout', t('mht.errTimeout')));
  worker.postMessage({ id, kind: 'pdf', file, pageSize, header, strings, locale: root.dataset.locale || 'en' } satisfies MhtRequest);
}

function requestPage(): Promise<MhtPage | undefined> {
  if (!file) return Promise.resolve(undefined);
  const id = ++nextId;
  worker ??= createWorker();
  startTimer(id, () => {});
  return new Promise(resolve => {
    pending = { id, resolve };
    worker!.postMessage({ id, kind: 'page', file: file! } satisfies MhtRequest);
  });
}

function createWorker() {
  const next = new Worker(new URL('../workers/mht-to-pdf.ts', import.meta.url), { type: 'module' });
  next.onmessage = (event: MessageEvent<MhtResponse>) => {
    const data = event.data;
    if (pending?.id === data.id) {
      clearTimeout(timer);
      pending.resolve('page' in data ? data.page : undefined);
      pending = undefined;
      return;
    }
    if (data.id !== sequence) return;
    clearTimeout(timer);
    if ('error' in data) {
      if (data.summary) showSummary(data.summary);
      // A page the PDF can't hold can still be printed with its own layout.
      fail(data.error.code, undefined, !!data.summary);
      return;
    }
    if (!('result' in data)) return;
    const { result: output, summary } = data;
    const pdf = new Blob([output.pdf as BlobPart], { type: 'application/pdf' });
    setOutput(pdf);
    showSummary(summary);
    $('mht-summary').textContent = t('mht.summary', { pages: counted('eml.pages', output.pages), size: formatBytes(pdf.size) });
    const notes: string[] = [];
    if (output.images) notes.push(counted('mht.noteImages', output.images));
    if (output.remoteImages) notes.push(counted('mht.noteRemoteImages', output.remoteImages));
    if (output.skippedImages) notes.push(counted('mht.noteSkippedImages', output.skippedImages));
    if (output.droppedCharacters) notes.push(counted('eml.noteDropped', output.droppedCharacters));
    if (summary.charsetFallback) notes.push(t('mht.noteCharset'));
    $('mht-note').textContent = notes.join(' ');
    result.hidden = false;
    download.disabled = false;
    printButton.disabled = false;
    showStatus(t('mht.ready'));
    trackResult('success', { pages: output.pages, images: output.images, remote_images: output.remoteImages, header, page_size: pageSize, zip: !!summary.zipEntry, output_size: sizeBucket(pdf.size) });
  };
  // A worker that runs out of memory dies with the message.
  next.onerror = () => { stopWorker(); fail('workerError', t('mht.errWorker')); };
  return next;
}

const choose = () => { input.value = ''; input.click(); };
$('mht-choose').addEventListener('click', choose);
$('mht-change').addEventListener('click', choose);
input.addEventListener('change', () => { if (input.files?.[0]) chooseFile(input.files[0]); });

root.querySelectorAll<HTMLButtonElement>('[data-page-size]').forEach(button => button.addEventListener('click', () => {
  pageSize = button.dataset.pageSize as PageSize;
  press('[data-page-size]', item => item === button);
  run();
}));
root.querySelectorAll<HTMLButtonElement>('[data-header]').forEach(button => button.addEventListener('click', () => {
  header = button.dataset.header === 'on';
  press('[data-header]', item => item === button);
  run();
}));

download.addEventListener('click', () => {
  if (!outputUrl || !file) return;
  const link = document.createElement('a');
  link.href = outputUrl;
  link.download = `${baseName()}.pdf`;
  link.click();
});

printButton.addEventListener('click', async () => {
  if (!file) return;
  printButton.disabled = true;
  const before = status.textContent ?? '';
  showStatus(t('mht.printPreparing'));
  try {
    const [module, page] = await Promise.all([import('./mht-print'), requestPage()]);
    printer = module;
    if (!page) throw new Error('page');
    showStatus(before);
    await module.printPage(page, baseName(), t('mht.printFrameTitle'));
  } catch {
    showStatus(t('mht.errPrint'));
  } finally {
    printButton.disabled = false;
  }
});

// A page kept for the back button keeps its PDF, so Download still works on return.
window.addEventListener('pagehide', event => { if (!event.persisted) setOutput(); });

root.addEventListener('dragover', event => { event.preventDefault(); root.classList.add('over'); });
root.addEventListener('dragleave', event => { if (!root.contains(event.relatedTarget as Node)) root.classList.remove('over'); });
root.addEventListener('drop', event => {
  event.preventDefault();
  root.classList.remove('over');
  if (event.dataTransfer?.files[0]) chooseFile(event.dataTransfer.files[0]);
});
