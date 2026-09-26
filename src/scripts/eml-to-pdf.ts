import type { AttachmentMode, BodyChoice, PageSize } from '../lib/eml-to-pdf';
import type { EmlRequest, EmlResponse } from '../workers/eml-to-pdf';
import { i18nFrom } from '../i18n/client';
import { sizeBucket, trackResult } from '../lib/analytics';

const root = document.querySelector<HTMLElement>('#eml-tool')!;
const { t, counted, formatBytes } = i18nFrom(root);
const strings = JSON.parse(root.dataset.strings!) as Record<string, string>;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = $<HTMLInputElement>('eml-file');
const status = $('eml-status');
const result = $('eml-result');
const download = $<HTMLButtonElement>('eml-download');
const bodyGroup = $('eml-body-group');
const attachmentsGroup = $('eml-attachments-group');
const MAX_BYTES = 50 * 1024 * 1024;
// A worker stuck on a damaged file is stopped rather than left spinning.
const TIMEOUT_MS = 90_000;
const ERROR_KEYS: Record<string, string> = {
  empty: 'eml.errEmpty', outlookMsg: 'eml.errOutlookMsg', notEmail: 'eml.errNotEmail', unsupportedScript: 'eml.errUnsupportedScript',
  tooManyPages: 'eml.errTooManyPages', font: 'eml.errFont', general: 'eml.errGeneral',
};

let file: File | undefined;
let worker: Worker | undefined;
let timer: number | undefined;
let sequence = 0;
let output: Blob | undefined;
let pageSize = (root.querySelector<HTMLButtonElement>('[data-page-size][aria-pressed="true"]')?.dataset.pageSize ?? 'a4') as PageSize;
let body: BodyChoice = 'html';
let attachments: AttachmentMode = 'embed';

const showStatus = (message: string) => { status.textContent = message; status.hidden = !message; };
const press = (selector: string, active: (button: HTMLButtonElement) => boolean) =>
  root.querySelectorAll<HTMLButtonElement>(selector).forEach(button => button.setAttribute('aria-pressed', String(active(button))));

function stopWorker() {
  worker?.terminate();
  worker = undefined;
  clearTimeout(timer);
}

function fail(code: string, message = t(ERROR_KEYS[code] ?? 'eml.errGeneral')) {
  output = undefined;
  result.hidden = true;
  download.disabled = true;
  showStatus(message);
  trackResult('error', { code });
}

function chooseFile(next: File) {
  if (!/\.(eml|emlx|msg)$/i.test(next.name) && next.type !== 'message/rfc822') { fail('wrongType', t('eml.errWrongType')); return; }
  if (next.size > MAX_BYTES) { fail('tooLarge', t('eml.errTooLarge')); return; }
  file = next;
  body = 'html';
  attachments = 'embed';
  press('[data-body]', button => button.dataset.body === body);
  press('[data-attachments]', button => button.dataset.attachments === attachments);
  bodyGroup.hidden = true;
  attachmentsGroup.hidden = true;
  $('eml-name').textContent = next.name;
  $('eml-size').textContent = formatBytes(next.size);
  $('eml-subject').textContent = '';
  $('eml-from').textContent = '';
  $('eml-empty').hidden = true;
  $('eml-panel').hidden = false;
  run();
}

function run() {
  if (!file) return;
  const id = ++sequence;
  output = undefined;
  result.hidden = true;
  download.disabled = true;
  showStatus(t('eml.reading'));
  worker ??= createWorker();
  clearTimeout(timer);
  timer = window.setTimeout(() => { if (id === sequence) { stopWorker(); fail('timeout', t('eml.errTimeout')); } }, TIMEOUT_MS);
  worker.postMessage({ id, file, pageSize, body, attachments, strings, locale: root.dataset.locale || 'en' } satisfies EmlRequest);
}

function createWorker() {
  const next = new Worker(new URL('../workers/eml-to-pdf.ts', import.meta.url), { type: 'module' });
  next.onmessage = (event: MessageEvent<EmlResponse>) => {
    if (event.data.id !== sequence) return;
    clearTimeout(timer);
    if ('error' in event.data) { fail(event.data.error.code); return; }
    const { result: data, summary } = event.data;
    output = new Blob([data.pdf as BlobPart], { type: 'application/pdf' });
    $('eml-subject').textContent = summary.subject || t('eml.noSubject');
    $('eml-from').textContent = summary.from ? t('eml.fromLine', { from: summary.from }) : '';
    bodyGroup.hidden = !(summary.hasHtml && summary.hasText);
    attachmentsGroup.hidden = !data.attachments;
    $('eml-summary').textContent = t('eml.summary', { pages: counted('eml.pages', data.pages), size: formatBytes(output.size) });
    const notes: string[] = [];
    if (data.attachments) notes.push(counted(attachments === 'embed' ? 'eml.noteEmbedded' : 'eml.noteListed', data.attachments));
    if (data.remoteImages) notes.push(counted('eml.noteRemoteImages', data.remoteImages));
    if (data.skippedImages) notes.push(counted('eml.noteSkippedImages', data.skippedImages));
    if (data.droppedCharacters) notes.push(counted('eml.noteDropped', data.droppedCharacters));
    if (summary.encrypted) notes.push(t('eml.noteEncrypted'));
    if (summary.charsetFallback) notes.push(t('eml.noteCharset'));
    $('eml-note').textContent = notes.join(' ');
    result.hidden = false;
    download.disabled = false;
    showStatus(t('eml.ready'));
    trackResult('success', { pages: data.pages, body: data.body, attachments: data.attachments, attachment_mode: data.attachments ? attachments : undefined, page_size: pageSize, remote_images: data.remoteImages, output_size: sizeBucket(output.size) });
  };
  // A worker that runs out of memory dies with the message.
  next.onerror = () => { stopWorker(); fail('workerError', t('eml.errWorker')); };
  return next;
}

const choose = () => { input.value = ''; input.click(); };
$('eml-choose').addEventListener('click', choose);
$('eml-change').addEventListener('click', choose);
input.addEventListener('change', () => { if (input.files?.[0]) chooseFile(input.files[0]); });

root.querySelectorAll<HTMLButtonElement>('[data-page-size]').forEach(button => button.addEventListener('click', () => {
  pageSize = button.dataset.pageSize as PageSize;
  press('[data-page-size]', item => item === button);
  run();
}));
root.querySelectorAll<HTMLButtonElement>('[data-body]').forEach(button => button.addEventListener('click', () => {
  body = button.dataset.body as BodyChoice;
  press('[data-body]', item => item === button);
  run();
}));
root.querySelectorAll<HTMLButtonElement>('[data-attachments]').forEach(button => button.addEventListener('click', () => {
  attachments = button.dataset.attachments as AttachmentMode;
  press('[data-attachments]', item => item === button);
  run();
}));

download.addEventListener('click', () => {
  if (!output || !file) return;
  const url = URL.createObjectURL(output);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${file.name.replace(/\.(eml|emlx|msg)$/i, '') || 'email'}.pdf`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
});

root.addEventListener('dragover', event => { event.preventDefault(); root.classList.add('over'); });
root.addEventListener('dragleave', event => { if (!root.contains(event.relatedTarget as Node)) root.classList.remove('over'); });
root.addEventListener('drop', event => {
  event.preventDefault();
  root.classList.remove('over');
  if (event.dataTransfer?.files[0]) chooseFile(event.dataTransfer.files[0]);
});
