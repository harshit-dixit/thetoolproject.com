import type { PhraseCount, TextStats } from '../lib/word-counter';
import type { WordCounterRequest, WordCounterResponse } from '../workers/word-counter';
import { i18nFrom } from '../i18n/client';
import { sizeBucket, trackResult } from '../lib/analytics';

const root = document.querySelector<HTMLElement>('#word-counter-tool')!;
const { t, counted, formatNumber, formatPercent, formatBytes } = i18nFrom(root);
const locale = root.dataset.locale || 'en';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = $<HTMLTextAreaElement>('word-counter-input');
const fileInput = $<HTMLInputElement>('word-counter-file');
const status = $('word-counter-status');
const limitInput = $<HTMLInputElement>('word-counter-limit');
const limitStatus = $('word-counter-limit-status');
const stopWordsBox = $<HTMLInputElement>('word-counter-stop-words');
const topTable = $<HTMLTableElement>('word-counter-top');
const topEmpty = $('word-counter-top-empty');
const live = $('word-counter-live');
const MAX_BYTES = 5 * 1024 * 1024;
const EMPTY: TextStats = { words: 0, characters: 0, charactersNoSpaces: 0, letters: 0, sentences: 0, paragraphs: 0, lines: 0, readingSeconds: 0, speakingSeconds: 0 };

let worker: Worker | undefined;
let sequence = 0;
let busy = false;
let queued = false;
let textDirty = true;
let size: 1 | 2 | 3 = 1;
let limitUnit: 'characters' | 'words' = 'characters';
let stats = EMPTY;
let countingTimer: ReturnType<typeof setTimeout> | undefined;
let liveTimer: ReturnType<typeof setTimeout> | undefined;
let reportTimer: ReturnType<typeof setTimeout> | undefined;

function announce(message: string) { status.hidden = false; status.textContent = message; }
function clearStatus() { status.hidden = true; status.textContent = ''; }

const unit = (value: number, name: 'hour' | 'minute' | 'second') => formatNumber(value, { style: 'unit', unit: name, unitDisplay: 'short' });
function duration(seconds: number) {
  if (seconds < 60) return unit(seconds, 'second');
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (hours) return minutes ? `${unit(hours, 'hour')} ${unit(minutes, 'minute')}` : unit(hours, 'hour');
  return rest ? `${unit(minutes, 'minute')} ${unit(rest, 'second')}` : unit(minutes, 'minute');
}

function renderLimit() {
  const limit = Number(limitInput.value);
  if (!limitInput.value || !Number.isFinite(limit) || limit < 1) {
    limitStatus.textContent = t('wordCounter.limitEmpty'); limitStatus.classList.add('is-empty'); return;
  }
  const used = limitUnit === 'words' ? stats.words : stats.characters;
  const left = Math.floor(limit) - used;
  const base = `wordCounter.${limitUnit}${left < 0 ? 'Over' : 'Left'}`;
  limitStatus.textContent = counted(base, Math.abs(left));
  limitStatus.classList.remove('is-empty');
}

function renderTop(top: PhraseCount[]) {
  const body = topTable.tBodies[0];
  body.replaceChildren(...top.map(entry => {
    const row = document.createElement('tr');
    for (const text of [entry.phrase, formatNumber(entry.count), formatPercent(entry.share, 1)]) {
      const cell = document.createElement('td'); cell.textContent = text; row.append(cell);
    }
    return row;
  }));
  $('word-counter-top-head').textContent = t(size === 1 ? 'wordCounter.colWord' : 'wordCounter.colPhrase');
  topTable.hidden = !top.length;
  topEmpty.hidden = !!top.length;
  topEmpty.textContent = t(stats.words && size > 1 ? 'wordCounter.noPhrases' : 'wordCounter.topEmpty');
}

function render(next: TextStats, top: PhraseCount[]) {
  stats = next;
  root.querySelectorAll<HTMLElement>('[data-stat]').forEach(cell => {
    const key = cell.dataset.stat as keyof TextStats;
    cell.textContent = key.endsWith('Seconds') ? duration(next[key]) : formatNumber(next[key]);
  });
  renderLimit();
  renderTop(top);
  // Screen readers hear the totals once typing pauses, not on every keystroke.
  clearTimeout(liveTimer);
  liveTimer = setTimeout(() => { live.textContent = t('wordCounter.liveSummary', { words: formatNumber(stats.words), characters: formatNumber(stats.characters) }); }, 1000);
}

function send() {
  busy = true; queued = false;
  worker ??= createWorker();
  const request: WordCounterRequest = { id: ++sequence, locale, size, stopWords: stopWordsBox.checked ? t('wordCounter.stopWords') : undefined, text: textDirty ? input.value : undefined };
  textDirty = false;
  clearTimeout(countingTimer);
  countingTimer = setTimeout(() => announce(t('wordCounter.counting')), 300);
  worker.postMessage(request);
}

function createWorker() {
  const created = new Worker(new URL('../workers/word-counter.ts', import.meta.url), { type: 'module' });
  created.onmessage = (event: MessageEvent<WordCounterResponse>) => {
    if (event.data.id !== sequence) return;
    busy = false; clearTimeout(countingTimer);
    if (status.textContent === t('wordCounter.counting')) clearStatus();
    render(event.data.stats, event.data.top);
    if (queued) send();
    else if (event.data.stats.words || event.data.stats.characters) report();
  };
  created.onerror = () => {
    created.terminate(); worker = undefined; busy = false; queued = false; textDirty = true; clearTimeout(countingTimer);
    announce(t('wordCounter.errWorker')); trackResult('error', { code: 'workerError' });
  };
  return created;
}

// Counts rerun as the user types, so only the text the input settles on is reported.
function report() {
  clearTimeout(reportTimer);
  reportTimer = setTimeout(() => trackResult('success', { text_size: sizeBucket(new Blob([input.value]).size), phrase: size, limit_unit: limitInput.value ? limitUnit : undefined }), 1500);
}

function schedule(textChanged: boolean) {
  if (textChanged) textDirty = true;
  if (!input.value && !busy) { textDirty = true; render(EMPTY, []); return; }
  if (busy) { queued = true; return; }
  send();
}

function decode(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 2));
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(buffer);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(buffer);
  // Text saved by older Windows programs is often Windows-1252 rather than UTF-8.
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); } catch { return new TextDecoder('windows-1252').decode(buffer); }
}

async function loadFile(file: File) {
  if (!/\.(txt|text|md|markdown)$/i.test(file.name)) { announce(t('wordCounter.errWrongType')); trackResult('error', { code: 'wrongType' }); return; }
  if (file.size > MAX_BYTES) { announce(t('wordCounter.errTooLarge')); trackResult('error', { code: 'tooLarge' }); return; }
  announce(t('wordCounter.reading'));
  try {
    input.value = decode(await file.arrayBuffer());
    announce(t('wordCounter.fileLoaded', { name: file.name, size: formatBytes(file.size) }));
    schedule(true);
  } catch { announce(t('wordCounter.errRead')); trackResult('error', { code: 'readError' }); }
}

input.addEventListener('input', () => { if (!status.hidden && status.textContent !== t('wordCounter.counting')) clearStatus(); schedule(true); });
limitInput.addEventListener('input', renderLimit);
stopWordsBox.addEventListener('change', () => schedule(false));
root.querySelectorAll<HTMLButtonElement>('[data-limit-unit]').forEach(button => button.addEventListener('click', () => {
  limitUnit = button.dataset.limitUnit === 'words' ? 'words' : 'characters';
  root.querySelectorAll<HTMLButtonElement>('[data-limit-unit]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  renderLimit();
}));
root.querySelectorAll<HTMLButtonElement>('[data-phrase]').forEach(button => button.addEventListener('click', () => {
  size = Number(button.dataset.phrase) as 1 | 2 | 3;
  root.querySelectorAll<HTMLButtonElement>('[data-phrase]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  schedule(false);
}));
$('word-counter-choose').addEventListener('click', () => { fileInput.value = ''; fileInput.click(); });
fileInput.addEventListener('change', () => { if (fileInput.files?.[0]) void loadFile(fileInput.files[0]); });
$('word-counter-clear').addEventListener('click', () => { input.value = ''; clearStatus(); schedule(true); input.focus(); });
// Only files are handled here; text dragged into the box is left to the browser.
const hasFiles = (event: DragEvent) => !!event.dataTransfer?.types.includes('Files');
root.addEventListener('dragover', event => { if (!hasFiles(event)) return; event.preventDefault(); root.classList.add('over'); });
root.addEventListener('dragleave', event => { if (!root.contains(event.relatedTarget as Node)) root.classList.remove('over'); });
root.addEventListener('drop', event => {
  if (!hasFiles(event)) return;
  event.preventDefault(); root.classList.remove('over');
  if (event.dataTransfer?.files[0]) void loadFile(event.dataTransfer.files[0]);
});
// The browser may restore the text after a back navigation.
if (input.value) schedule(true);
