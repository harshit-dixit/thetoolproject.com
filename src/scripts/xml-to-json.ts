import type { XmlJsonConversion, XmlJsonError, XmlJsonOptions } from '../lib/xml-to-json';
import type { XmlJsonRequest } from '../workers/xml-to-json';
import { i18nFrom } from '../i18n/client';

const root = document.querySelector<HTMLElement>('#xml-json-tool')!;
const { t, counted, formatNumber, formatBytes } = i18nFrom(root);

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = $<HTMLTextAreaElement>('xml-json-input');
const output = $<HTMLTextAreaElement>('xml-json-output');
const fileInput = $<HTMLInputElement>('xml-json-file');
const status = $('xml-json-status');
const result = $('xml-json-result');
const placeholder = $('xml-json-placeholder');
const convertButton = $<HTMLButtonElement>('xml-json-convert');
const copyButton = $<HTMLButtonElement>('xml-json-copy');
const MAX_BYTES = 10 * 1024 * 1024;
const TEXTAREA_LIMIT = 2 * 1024 * 1024;
let worker: Worker | undefined;
let sequence = 0;
let busy = false;
let fileText: string | undefined;
let fileName: string | undefined;
let current: XmlJsonConversion | undefined;
let options: XmlJsonOptions = { attributePrefix: '@_', alwaysArray: false, pretty: true };

function announce(message: string) { status.hidden = false; status.textContent = message; }
function clearStatus() { status.hidden = true; status.textContent = ''; }
function hideResult() { current = undefined; result.hidden = true; placeholder.hidden = false; output.value = ''; copyButton.textContent = t('xmlJson.copy'); }
function stopWorker() { if (busy) { worker?.terminate(); worker = undefined; busy = false; convertButton.disabled = false; } }
function showResult(data: XmlJsonConversion) {
  current = data; output.value = data.json; result.hidden = false; placeholder.hidden = true;
  $('xml-json-summary').textContent = t('xmlJson.summary', {
    elements: counted('xmlJson.elements', data.elements),
    size: formatBytes(data.bytes),
  });
  copyButton.textContent = t('xmlJson.copy'); clearStatus();
}
function errorMessage(error: XmlJsonError | { code: 'workerError' }) {
  if (error.code === 'doctype') return t('xmlJson.errDoctype');
  if (error.code === 'tooDeep') return t('xmlJson.errTooDeep');
  if (error.code === 'empty') return t('xmlJson.errEmpty');
  if (error.code === 'noRoot') return t('xmlJson.errNoRoot');
  // The parser's own message is English, so only the position is shown with a translated reason.
  if (error.code === 'invalidXml') return error.line ? t('xmlJson.errSyntax', {
    line: formatNumber(error.line),
    column: formatNumber(error.column ?? 1),
    detail: t('xmlJson.syntaxCheck'),
  }) : t('xmlJson.syntaxCheck');
  return t('xmlJson.errWorker');
}
function run() {
  const source = fileText ?? input.value;
  if (!source.trim()) { hideResult(); announce(t('xmlJson.errEmpty')); input.focus(); return; }
  if (new Blob([source]).size > MAX_BYTES) { hideResult(); announce(t('xmlJson.errTooLarge')); return; }
  stopWorker(); busy = true; convertButton.disabled = true; announce(t('xmlJson.working'));
  const id = ++sequence;
  worker ??= new Worker(new URL('../workers/xml-to-json.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<{ id: number; result?: XmlJsonConversion; error?: XmlJsonError | { code: 'workerError' } }>) => {
    if (event.data.id !== sequence) return;
    busy = false; convertButton.disabled = false;
    if (event.data.result) showResult(event.data.result);
    else { hideResult(); announce(errorMessage(event.data.error ?? { code: 'workerError' })); }
  };
  worker.onerror = () => { worker?.terminate(); worker = undefined; busy = false; convertButton.disabled = false; hideResult(); announce(t('xmlJson.errWorker')); };
  worker.postMessage({ id, source, options } satisfies XmlJsonRequest);
}
async function loadFile(file: File) {
  if (!/\.(xml|txt)$/i.test(file.name)) { announce(t('xmlJson.errWrongType')); return; }
  if (file.size > MAX_BYTES) { announce(t('xmlJson.errTooLarge')); return; }
  const id = ++sequence; stopWorker(); announce(t('xmlJson.reading'));
  try {
    const content = await file.text();
    if (id !== sequence) return;
    fileName = file.name;
    if (file.size > TEXTAREA_LIMIT) { input.value = ''; fileText = content; announce(t('xmlJson.fileTooLargeText', { name: file.name })); }
    else { input.value = content; fileText = undefined; announce(t('xmlJson.fileLoaded', { name: file.name, size: formatBytes(file.size) })); }
    $('xml-json-file-name').textContent = file.name; $('xml-json-file-size').textContent = formatBytes(file.size); $('xml-json-file-line').hidden = false; hideResult();
  } catch { if (id === sequence) announce(t('xmlJson.errRead')); }
}
$('xml-json-choose').addEventListener('click', () => { fileInput.value = ''; fileInput.click(); });
fileInput.addEventListener('change', () => { if (fileInput.files?.[0]) void loadFile(fileInput.files[0]); });
$('xml-json-example').addEventListener('click', () => {
  ++sequence; stopWorker(); fileText = undefined; fileName = undefined; $('xml-json-file-line').hidden = true;
  input.value = '<orders>\n  <order id="A-104"><customer>Maya Chen</customer><tag>new</tag><tag>gift</tag></order>\n  <order id="A-105"><customer>Luis Ortega</customer><note><![CDATA[Ready & packed]]></note></order>\n</orders>';
  hideResult(); clearStatus(); input.focus();
});
input.addEventListener('input', () => { ++sequence; stopWorker(); fileText = undefined; fileName = undefined; $('xml-json-file-line').hidden = true; hideResult(); clearStatus(); });
root.querySelectorAll<HTMLButtonElement>('[data-xml-json-prefix]').forEach(button => button.addEventListener('click', () => {
  options = { ...options, attributePrefix: button.dataset.xmlJsonPrefix as '@_' | '@' };
  root.querySelectorAll<HTMLButtonElement>('[data-xml-json-prefix]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  if (current || busy) run();
}));
$<HTMLInputElement>('xml-json-arrays').addEventListener('change', event => { options = { ...options, alwaysArray: (event.target as HTMLInputElement).checked }; if (current || busy) run(); });
$<HTMLInputElement>('xml-json-pretty').addEventListener('change', event => { options = { ...options, pretty: (event.target as HTMLInputElement).checked }; if (current || busy) run(); });
convertButton.addEventListener('click', run);
$('xml-json-download').addEventListener('click', () => {
  if (!current) return;
  const url = URL.createObjectURL(new Blob([current.json + '\n'], { type: 'application/json;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = (fileName?.replace(/\.[^.]+$/, '') || 'converted') + '.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
});
copyButton.addEventListener('click', async () => {
  if (!current) return;
  const data = current;
  try { if (!navigator.clipboard?.writeText) throw Error(); await navigator.clipboard.writeText(data.json); if (current === data) { copyButton.textContent = t('xmlJson.copied'); announce(t('xmlJson.copiedAria')); } }
  catch { if (current === data) { output.focus(); output.select(); announce(t('xmlJson.errClipboard')); } }
});
$('xml-json-start-over').addEventListener('click', () => { ++sequence; stopWorker(); fileText = undefined; fileName = undefined; input.value = ''; fileInput.value = ''; $('xml-json-file-line').hidden = true; hideResult(); clearStatus(); input.focus(); });
root.addEventListener('dragover', event => { event.preventDefault(); root.classList.add('over'); });
root.addEventListener('dragleave', event => { if (!root.contains(event.relatedTarget as Node)) root.classList.remove('over'); });
root.addEventListener('drop', event => { event.preventDefault(); root.classList.remove('over'); if (event.dataTransfer?.files[0]) void loadFile(event.dataTransfer.files[0]); });
