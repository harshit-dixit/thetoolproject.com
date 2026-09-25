import type { Conversion, ConversionError, Layout, Output } from '../lib/json-to-html';
import { i18nFrom } from '../i18n/client';

const root = document.querySelector<HTMLElement>('#json-tool')!;
const { t, counted, formatNumber, formatBytes } = i18nFrom(root);
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const textarea = $<HTMLTextAreaElement>('json-input');
const fileInput = $<HTMLInputElement>('json-file');
const frame = $<HTMLIFrameElement>('preview-frame');
const code = $<HTMLPreElement>('code-view');
const result = $('result');
const status = $('status');
const convert = $<HTMLButtonElement>('convert');
const copy = $<HTMLButtonElement>('copy');
const previewNote = $('preview-note');
const codeNote = $('code-note');
const unsafeNote = $('unsafe-note');
// Files above this size stay out of the textarea, which gets slow on phones with multi-MB text.
const TEXTAREA_LIMIT = 2 * 1024 * 1024;
let worker: Worker | undefined;
let busy = false;
let sequence = 0;
let fileText: string | undefined;
let layout: Layout = 'table';
let output: Output = 'fragment';
let current: Conversion | undefined;
let fileName: string | undefined;
let view: 'preview' | 'code' = 'preview';
const wrapJsonLines = (source: string) => `[\n${source.split('\n').filter(line => line.trim()).map(line => `  ${line.trim()}`).join(',\n')}\n]`;
function announce(message: string) { status.hidden = false; status.textContent = message; }
function clearStatus() { status.textContent = ''; status.hidden = true; }
function setWorking(working: boolean) { busy = working; convert.disabled = working; if (working) announce(t('tool.working')); }
// A worker can't drop a conversion midway, so replace it instead of queueing behind it.
function stopWorker() { if (busy) { worker?.terminate(); worker = undefined; setWorking(false); clearStatus(); } }
const hint = $('input-hint');
function useTextarea() { fileText = undefined; hint.textContent = defaultHint; }
function showView(next: 'preview' | 'code') {
  view = next;
  root.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === view)));
  frame.hidden = view !== 'preview';
  code.hidden = view !== 'code';
  previewNote.hidden = view !== 'preview' || !current || current.rows <= current.previewRows;
  codeNote.hidden = view !== 'code' || !current || current.html.length <= 100000;
}
function showResult(data: Conversion) {
  current = data;
  $('preview-placeholder').hidden = true;
  result.hidden = false;
  frame.srcdoc = data.previewHtml;
  code.textContent = data.html.length > 100000 ? data.html.slice(0, 100000) : data.html;
  $('result-summary').textContent = t('tool.summary', { rows: counted('tool.rows', data.rows), columns: counted('tool.columns', data.columns), size: formatBytes(new Blob([data.html], { type: 'text/html;charset=utf-8' }).size) });
  previewNote.textContent = t('tool.previewCap', { shown: formatNumber(data.previewRows), total: formatNumber(data.rows) });
  codeNote.textContent = t('tool.codeCap');
  unsafeNote.textContent = t('tool.unsafeWarning');
  unsafeNote.hidden = !data.unsafeNumberFallback;
  copy.textContent = t('tool.copy');
  showView('preview');
  clearStatus();
}
function errorMessage(error: ConversionError) {
  if (error.code === 'empty') return t('tool.empty');
  return t('error.location', { line: formatNumber(error.line), column: formatNumber(error.column), reason: t(`error.${error.code}`) });
}
function run() {
  const source = fileText ?? textarea.value;
  if (!source.trim()) { announce(t('tool.empty')); result.hidden = true; $('preview-placeholder').hidden = false; textarea.focus(); return; }
  stopWorker();
  setWorking(true);
  $('json-lines-help').hidden = true;
  const id = ++sequence;
  worker ??= new Worker(new URL('../workers/json-to-html.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<{ id: number; result?: Conversion; error?: ConversionError }>) => {
    if (event.data.id !== sequence) return;
    setWorking(false);
    if (event.data.result) { showResult(event.data.result); return; }
    const error = event.data.error;
    if (!error || !error.code) { announce(t('tool.workerError')); return; }
    result.hidden = true; $('preview-placeholder').hidden = false; current = undefined;
    announce(errorMessage(error));
    $('json-lines-help').hidden = error.code !== 'jsonLines';
    if (fileText === undefined) { textarea.focus(); textarea.setSelectionRange(error.position, error.position); }
  };
  worker.onerror = () => { setWorking(false); announce(t('tool.workerError')); };
  worker.postMessage({ id, source, layout, output });
}
async function loadFile(file: File) {
  const extension = file.name.split('.').at(-1)?.toLowerCase();
  if (extension !== 'json' && extension !== 'txt') { announce(t('tool.wrongType')); return; }
  if (file.size > 50 * 1024 * 1024) { announce(t('tool.tooLarge')); return; }
  stopWorker();
  announce(t('tool.reading'));
  try {
    const text = await file.text();
    if (file.size > TEXTAREA_LIMIT) { textarea.value = ''; fileText = text; hint.textContent = t('tool.largeFileHint', { name: file.name }); }
    else { textarea.value = text; useTextarea(); }
    fileName = file.name;
    $('file-name').textContent = file.name;
    $('file-size').textContent = formatBytes(file.size);
    $('file-line').hidden = false;
    result.hidden = true; $('preview-placeholder').hidden = false; current = undefined;
    announce(t('tool.fileLoaded', { name: file.name, size: formatBytes(file.size) }));
    // Keep the file button focused; moving focus here scrolls the mobile page.
  } catch { announce(t('tool.readError')); }
}
$('choose-file').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => { if (fileInput.files?.[0]) void loadFile(fileInput.files[0]); });
$('try-example').addEventListener('click', () => {
  stopWorker(); useTextarea();
  textarea.value = JSON.stringify([
    { order: 'A-104', customer: 'Maya Chen', total: 84.5, shipping: { city: 'Portland', method: 'Express' }, items: ['Notebook', 'Pen'] },
    { order: 'A-105', customer: 'Luis Ortega', total: 42, shipping: { city: 'Austin', method: 'Standard' }, items: ['Desk lamp'] },
    { order: 'A-106', customer: 'Amira Haddad', total: 125, shipping: { city: 'Toronto', method: 'Pickup' }, items: ['Chair', 'Cushion'] },
  ], null, 2);
  fileName = undefined; $('file-line').hidden = true; result.hidden = true; $('preview-placeholder').hidden = false; current = undefined; clearStatus(); textarea.setSelectionRange(0, 0); textarea.scrollTop = 0; textarea.focus();
});
textarea.addEventListener('input', () => { stopWorker(); useTextarea(); fileName = undefined; $('file-line').hidden = true; if (current) { result.hidden = true; $('preview-placeholder').hidden = false; current = undefined; } });
root.querySelectorAll<HTMLButtonElement>('[data-layout]').forEach(button => button.addEventListener('click', () => {
  layout = button.dataset.layout as Layout;
  root.querySelectorAll<HTMLButtonElement>('[data-layout]').forEach(x => x.setAttribute('aria-pressed', String(x === button)));
  convert.textContent = t(layout === 'table' ? 'tool.convertTable' : 'tool.convertList');
  if (current || convert.disabled) run();
}));
root.querySelectorAll<HTMLButtonElement>('[data-output]').forEach(button => button.addEventListener('click', () => {
  output = button.dataset.output as Output;
  root.querySelectorAll<HTMLButtonElement>('[data-output]').forEach(x => x.setAttribute('aria-pressed', String(x === button)));
  if (current || convert.disabled) run();
}));
root.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => button.addEventListener('click', () => showView(button.dataset.view as 'preview' | 'code')));
convert.addEventListener('click', run);
$('wrap-lines').addEventListener('click', () => { if (fileText !== undefined) fileText = wrapJsonLines(fileText); else textarea.value = wrapJsonLines(textarea.value); $('json-lines-help').hidden = true; clearStatus(); textarea.focus(); });
$('download').addEventListener('click', () => {
  if (!current) return;
  const blob = new Blob([current.html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = fileName ? fileName.replace(/\.[^.]+$/, '') + '.html' : 'converted.html';
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
});
copy.addEventListener('click', async () => {
  if (!current) return;
  try { if (!navigator.clipboard?.writeText) throw Error(); await navigator.clipboard.writeText(current.html); copy.textContent = t('tool.copied'); announce(t('tool.copied')); }
  catch {
    showView('code'); code.textContent = current.html;
    const selection = window.getSelection(); const range = document.createRange(); range.selectNodeContents(code); selection?.removeAllRanges(); selection?.addRange(range);
    announce(t('tool.selectCode'));
  }
});
$('start-over').addEventListener('click', () => { ++sequence; stopWorker(); useTextarea(); textarea.value = ''; fileInput.value = ''; fileName = undefined; current = undefined; result.hidden = true; $('preview-placeholder').hidden = false; $('file-line').hidden = true; $('json-lines-help').hidden = true; clearStatus(); textarea.focus(); });
const defaultHint = matchMedia('(pointer: coarse)').matches ? t('tool.inputHintTouch') : hint.textContent!;
hint.textContent = defaultHint;
root.addEventListener('dragover', event => { event.preventDefault(); root.classList.add('over'); });
root.addEventListener('dragleave', event => { if (!root.contains(event.relatedTarget as Node)) root.classList.remove('over'); });
root.addEventListener('drop', event => { event.preventDefault(); root.classList.remove('over'); if (event.dataTransfer?.files[0]) void loadFile(event.dataTransfer.files[0]); });
