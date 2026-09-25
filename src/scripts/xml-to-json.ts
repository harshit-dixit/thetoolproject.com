import type { XmlJsonConversion, XmlJsonError, XmlJsonOptions } from '../lib/xml-to-json';
import type { XmlJsonRequest } from '../workers/xml-to-json';

const root = document.querySelector<HTMLElement>('#xml-json-tool')!;
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
const formatSize = (bytes: number) => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} bytes`;
function announce(message: string) { status.hidden = false; status.textContent = message; }
function clearStatus() { status.hidden = true; status.textContent = ''; }
function hideResult() { current = undefined; result.hidden = true; placeholder.hidden = false; output.value = ''; copyButton.textContent = 'Copy JSON'; }
function stopWorker() { if (busy) { worker?.terminate(); worker = undefined; busy = false; convertButton.disabled = false; } }
function showResult(data: XmlJsonConversion) {
  current = data; output.value = data.json; result.hidden = false; placeholder.hidden = true;
  $('xml-json-summary').textContent = `${new Intl.NumberFormat().format(data.elements)} elements · ${formatSize(data.bytes)}`;
  copyButton.textContent = 'Copy JSON'; clearStatus();
}
function errorMessage(error: XmlJsonError | { code: 'workerError' }) {
  if (error.code === 'doctype') return 'This XML contains a DOCTYPE. Remove the DTD declaration and try again.';
  if (error.code === 'tooDeep') return 'This XML is nested more than 100 levels deep. Reduce the nesting and try again.';
  if (error.code === 'empty') return 'Paste XML or choose a file first.';
  if (error.code === 'invalidXml') return `Line ${error.line ?? 1}, column ${error.column ?? 1}: ${error.detail || 'Check the XML syntax.'}`;
  return 'The conversion stopped. Try a smaller XML file or start over.';
}
function run() {
  const source = fileText ?? input.value;
  if (!source.trim()) { hideResult(); announce('Paste XML or choose a file first.'); input.focus(); return; }
  if (new Blob([source]).size > MAX_BYTES) { hideResult(); announce('This XML is over 10 MB. Choose a smaller file.'); return; }
  stopWorker(); busy = true; convertButton.disabled = true; announce('Converting XML…');
  const id = ++sequence;
  worker ??= new Worker(new URL('../workers/xml-to-json.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<{ id: number; result?: XmlJsonConversion; error?: XmlJsonError | { code: 'workerError' } }>) => {
    if (event.data.id !== sequence) return;
    busy = false; convertButton.disabled = false;
    if (event.data.result) showResult(event.data.result);
    else { hideResult(); announce(errorMessage(event.data.error ?? { code: 'workerError' })); }
  };
  worker.onerror = () => { worker?.terminate(); worker = undefined; busy = false; convertButton.disabled = false; hideResult(); announce('The conversion stopped. Try a smaller XML file or start over.'); };
  worker.postMessage({ id, source, options } satisfies XmlJsonRequest);
}
async function loadFile(file: File) {
  if (!/\.(xml|txt)$/i.test(file.name)) { announce('Choose a .xml or .txt file.'); return; }
  if (file.size > MAX_BYTES) { announce('This XML is over 10 MB. Choose a smaller file.'); return; }
  const id = ++sequence; stopWorker(); announce('Reading file…');
  try {
    const content = await file.text();
    if (id !== sequence) return;
    fileName = file.name;
    if (file.size > TEXTAREA_LIMIT) { input.value = ''; fileText = content; announce(`${file.name} is too large to show in the editor. It will still be converted.`); }
    else { input.value = content; fileText = undefined; announce(`Loaded ${file.name}, ${formatSize(file.size)}`); }
    $('xml-json-file-name').textContent = file.name; $('xml-json-file-size').textContent = formatSize(file.size); $('xml-json-file-line').hidden = false; hideResult();
  } catch { if (id === sequence) announce('This file could not be read. Choose it again or paste its XML.'); }
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
  try { if (!navigator.clipboard?.writeText) throw Error(); await navigator.clipboard.writeText(data.json); if (current === data) { copyButton.textContent = 'Copied'; announce('Copied JSON to clipboard.'); } }
  catch { if (current === data) { output.focus(); output.select(); announce('Clipboard unavailable. The JSON is selected; copy it with your keyboard.'); } }
});
$('xml-json-start-over').addEventListener('click', () => { ++sequence; stopWorker(); fileText = undefined; fileName = undefined; input.value = ''; fileInput.value = ''; $('xml-json-file-line').hidden = true; hideResult(); clearStatus(); input.focus(); });
root.addEventListener('dragover', event => { event.preventDefault(); root.classList.add('over'); });
root.addEventListener('dragleave', event => { if (!root.contains(event.relatedTarget as Node)) root.classList.remove('over'); });
root.addEventListener('drop', event => { event.preventDefault(); root.classList.remove('over'); if (event.dataTransfer?.files[0]) void loadFile(event.dataTransfer.files[0]); });
