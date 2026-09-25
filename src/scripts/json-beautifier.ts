import type { JsonBeautifierError, JsonBeautifierResult, JsonIndent } from '../lib/json-beautifier';
import type { JsonBeautifierRequest } from '../workers/json-beautifier';
import { i18nFrom } from '../i18n/client';

const root = document.querySelector<HTMLElement>('#json-beautifier-tool')!;
const { t, formatNumber, formatBytes } = i18nFrom(root);

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = $<HTMLTextAreaElement>('beautifier-input');
const output = $<HTMLTextAreaElement>('beautifier-output');
const fileInput = $<HTMLInputElement>('beautifier-file');
const status = $('beautifier-status');
const result = $('beautifier-result');
const placeholder = $('beautifier-placeholder');
const formatButton = $<HTMLButtonElement>('beautifier-format');
const copyButton = $<HTMLButtonElement>('beautifier-copy');
const MAX_BYTES = 10 * 1024 * 1024;
const TEXTAREA_LIMIT = 2 * 1024 * 1024;
let worker: Worker | undefined;
let sequence = 0;
let busy = false;
let fileText: string | undefined;
let fileName: string | undefined;
let current: JsonBeautifierResult | undefined;
let spacing: JsonIndent = 2;

function announce(message: string) { status.hidden = false; status.textContent = message; }
function clearStatus() { status.hidden = true; status.textContent = ''; }
function hideResult() { current = undefined; result.hidden = true; placeholder.hidden = false; output.value = ''; copyButton.textContent = t('jsonBeautifier.copy'); }
function stopWorker() { if (busy) { worker?.terminate(); worker = undefined; busy = false; formatButton.disabled = false; } }
function showResult(data: JsonBeautifierResult) {
  current = data; output.value = data.json; result.hidden = false; placeholder.hidden = true;
  $('beautifier-summary').textContent = t('jsonBeautifier.summary', { size: formatBytes(data.bytes) });
  copyButton.textContent = t('jsonBeautifier.copy'); clearStatus();
}
function errorMessage(error: JsonBeautifierError | { code: 'workerError' }) {
  if (error.code === 'workerError') return t('jsonBeautifier.errWorker');
  if (error.code === 'empty') return t('jsonBeautifier.errEmpty');
  const reasonMap: Record<string, string> = {
    trailingComma: t('jsonBeautifier.reasonTrailingComma'),
    singleQuote: t('jsonBeautifier.reasonSingleQuote'),
    unquotedKey: t('jsonBeautifier.reasonUnquotedKey'),
    comment: t('jsonBeautifier.reasonComment'),
    jsonLines: t('jsonBeautifier.reasonJsonLines'),
    syntax: t('jsonBeautifier.reasonSyntax'),
    depth: t('jsonBeautifier.reasonDepth'),
  };
  const detail = reasonMap[error.code] ?? reasonMap.syntax;
  return t('jsonBeautifier.errSyntax', {
    line: formatNumber(error.line),
    column: formatNumber(error.column),
    detail,
  });
}
function run() {
  const source = fileText ?? input.value;
  if (!source.trim()) { hideResult(); announce(t('jsonBeautifier.errEmpty')); input.focus(); return; }
  if (new Blob([source]).size > MAX_BYTES) { hideResult(); announce(t('jsonBeautifier.errTooLarge')); return; }
  ++sequence; stopWorker(); busy = true; formatButton.disabled = true; announce(t('jsonBeautifier.working'));
  const id = sequence;
  worker ??= new Worker(new URL('../workers/json-beautifier.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<{ id: number; result?: JsonBeautifierResult; error?: JsonBeautifierError | { code: 'workerError' } }>) => {
    if (event.data.id !== sequence) return;
    busy = false; formatButton.disabled = false;
    if (event.data.result) showResult(event.data.result);
    else {
      hideResult(); const error = event.data.error ?? { code: 'workerError' as const }; announce(errorMessage(error));
      if (fileText === undefined && 'position' in error && error.code !== 'depth') { input.focus(); input.setSelectionRange(error.position, error.position); }
    }
  };
  worker.onerror = () => { worker?.terminate(); worker = undefined; busy = false; formatButton.disabled = false; hideResult(); announce(t('jsonBeautifier.errWorker')); };
  worker.postMessage({ id, source, spacing } satisfies JsonBeautifierRequest);
}
async function loadFile(file: File) {
  if (!/\.(json|txt)$/i.test(file.name)) { announce(t('jsonBeautifier.errWrongType')); return; }
  if (file.size > MAX_BYTES) { announce(t('jsonBeautifier.errTooLarge')); return; }
  const id = ++sequence; stopWorker(); announce(t('jsonBeautifier.reading'));
  try {
    const content = await file.text();
    if (id !== sequence) return;
    fileName = file.name;
    if (file.size > TEXTAREA_LIMIT) { input.value = ''; fileText = content; $('beautifier-hint').textContent = t('jsonBeautifier.fileTooLarge', { name: file.name }); }
    else { input.value = content; fileText = undefined; $('beautifier-hint').textContent = t('jsonBeautifier.inputHint'); }
    $('beautifier-file-name').textContent = file.name; $('beautifier-file-size').textContent = formatBytes(file.size); $('beautifier-file-line').hidden = false;
    hideResult(); announce(t('jsonBeautifier.fileLoaded', { name: file.name, size: formatBytes(file.size) }));
  } catch { if (id === sequence) announce(t('jsonBeautifier.errRead')); }
}
function clearFile() { fileText = undefined; fileName = undefined; fileInput.value = ''; $('beautifier-file-line').hidden = true; $('beautifier-hint').textContent = t('jsonBeautifier.inputHint'); }
$('beautifier-choose').addEventListener('click', () => { fileInput.value = ''; fileInput.click(); });
fileInput.addEventListener('change', () => { if (fileInput.files?.[0]) void loadFile(fileInput.files[0]); });
$('beautifier-example').addEventListener('click', () => {
  ++sequence; stopWorker(); clearFile(); input.value = '{"order":"A-104","customer":{"name":"Maya Chen","city":"Portland"},"items":[{"sku":"NB-01","qty":2},{"sku":"DL-02","qty":1}],"paid":true}';
  hideResult(); clearStatus(); input.focus();
});
input.addEventListener('input', () => { ++sequence; stopWorker(); clearFile(); hideResult(); clearStatus(); });
root.querySelectorAll<HTMLButtonElement>('[data-spacing]').forEach(button => button.addEventListener('click', () => {
  spacing = button.dataset.spacing === '2' ? 2 : button.dataset.spacing === '4' ? 4 : button.dataset.spacing as JsonIndent;
  root.querySelectorAll<HTMLButtonElement>('[data-spacing]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  if (current || busy) run();
}));
formatButton.addEventListener('click', run);
$('beautifier-download').addEventListener('click', () => {
  if (!current) return;
  const url = URL.createObjectURL(new Blob([current.json + '\n'], { type: 'application/json;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = (fileName?.replace(/\.[^.]+$/, '') || 'formatted') + '.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
});
copyButton.addEventListener('click', async () => {
  if (!current) return;
  const data = current;
  try { if (!navigator.clipboard?.writeText) throw Error(); await navigator.clipboard.writeText(data.json); if (current === data) { copyButton.textContent = t('jsonBeautifier.copied'); announce(t('jsonBeautifier.copiedClipboard')); } }
  catch { if (current === data) { output.focus(); output.select(); announce(t('jsonBeautifier.errClipboard')); } }
});
$('beautifier-reset').addEventListener('click', () => { ++sequence; stopWorker(); clearFile(); input.value = ''; hideResult(); clearStatus(); input.focus(); });
root.addEventListener('dragover', event => { event.preventDefault(); root.classList.add('over'); });
root.addEventListener('dragleave', event => { if (!root.contains(event.relatedTarget as Node)) root.classList.remove('over'); });
root.addEventListener('drop', event => { event.preventDefault(); root.classList.remove('over'); if (event.dataTransfer?.files[0]) void loadFile(event.dataTransfer.files[0]); });
