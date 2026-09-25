import type { JsonBeautifierError, JsonBeautifierResult, JsonIndent } from '../lib/json-beautifier';
import type { JsonBeautifierRequest } from '../workers/json-beautifier';

const root = document.querySelector<HTMLElement>('#json-beautifier-tool')!;
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

const formatSize = (bytes: number) => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} bytes`;
function announce(message: string) { status.hidden = false; status.textContent = message; }
function clearStatus() { status.hidden = true; status.textContent = ''; }
function hideResult() { current = undefined; result.hidden = true; placeholder.hidden = false; output.value = ''; copyButton.textContent = 'Copy JSON'; }
function stopWorker() { if (busy) { worker?.terminate(); worker = undefined; busy = false; formatButton.disabled = false; } }
function showResult(data: JsonBeautifierResult) {
  current = data; output.value = data.json; result.hidden = false; placeholder.hidden = true;
  $('beautifier-summary').textContent = `Valid JSON · ${formatSize(data.bytes)}`;
  copyButton.textContent = 'Copy JSON'; clearStatus();
}
function errorMessage(error: JsonBeautifierError | { code: 'workerError' }) {
  if (error.code === 'workerError') return 'Formatting stopped. Try a smaller JSON file or start over.';
  if (error.code === 'empty') return 'Paste JSON or choose a file first.';
  const reason: Record<string, string> = {
    trailingComma: 'Remove the trailing comma.',
    singleQuote: 'Use double quotes for strings and keys.',
    unquotedKey: 'Put double quotes around the key.',
    comment: 'Remove the comment. JSON does not allow comments.',
    jsonLines: 'This looks like JSON Lines. Wrap the values in an array with commas between them.',
    syntax: 'Check the JSON syntax at this position.',
    depth: 'This JSON is too deeply nested.',
  };
  return `Line ${error.line}, column ${error.column}: ${reason[error.code] ?? reason.syntax}`;
}
function run() {
  const source = fileText ?? input.value;
  if (!source.trim()) { hideResult(); announce('Paste JSON or choose a file first.'); input.focus(); return; }
  if (new Blob([source]).size > MAX_BYTES) { hideResult(); announce('This JSON is over 10 MB. Choose a smaller file.'); return; }
  ++sequence; stopWorker(); busy = true; formatButton.disabled = true; announce('Formatting JSON…');
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
  worker.onerror = () => { worker?.terminate(); worker = undefined; busy = false; formatButton.disabled = false; hideResult(); announce('Formatting stopped. Try a smaller JSON file or start over.'); };
  worker.postMessage({ id, source, spacing } satisfies JsonBeautifierRequest);
}
async function loadFile(file: File) {
  if (!/\.(json|txt)$/i.test(file.name)) { announce('Choose a .json or .txt file.'); return; }
  if (file.size > MAX_BYTES) { announce('This JSON is over 10 MB. Choose a smaller file.'); return; }
  const id = ++sequence; stopWorker(); announce('Reading file…');
  try {
    const content = await file.text();
    if (id !== sequence) return;
    fileName = file.name;
    if (file.size > TEXTAREA_LIMIT) { input.value = ''; fileText = content; $('beautifier-hint').textContent = `${file.name} is too large to show in the editor. You can still format it.`; }
    else { input.value = content; fileText = undefined; $('beautifier-hint').textContent = 'Paste JSON, drop a file here, or choose a .json or .txt file. Your data stays in this browser.'; }
    $('beautifier-file-name').textContent = file.name; $('beautifier-file-size').textContent = formatSize(file.size); $('beautifier-file-line').hidden = false;
    hideResult(); announce(`Loaded ${file.name}, ${formatSize(file.size)}.`);
  } catch { if (id === sequence) announce('This file could not be read. Choose it again or paste its JSON.'); }
}
function clearFile() { fileText = undefined; fileName = undefined; fileInput.value = ''; $('beautifier-file-line').hidden = true; $('beautifier-hint').textContent = 'Paste JSON, drop a file here, or choose a .json or .txt file. Your data stays in this browser.'; }
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
  try { if (!navigator.clipboard?.writeText) throw Error(); await navigator.clipboard.writeText(data.json); if (current === data) { copyButton.textContent = 'Copied'; announce('Copied JSON to clipboard.'); } }
  catch { if (current === data) { output.focus(); output.select(); announce('Clipboard unavailable. The JSON is selected; copy it with your keyboard.'); } }
});
$('beautifier-reset').addEventListener('click', () => { ++sequence; stopWorker(); clearFile(); input.value = ''; hideResult(); clearStatus(); input.focus(); });
root.addEventListener('dragover', event => { event.preventDefault(); root.classList.add('over'); });
root.addEventListener('dragleave', event => { if (!root.contains(event.relatedTarget as Node)) root.classList.remove('over'); });
root.addEventListener('drop', event => { event.preventDefault(); root.classList.remove('over'); if (event.dataTransfer?.files[0]) void loadFile(event.dataTransfer.files[0]); });
