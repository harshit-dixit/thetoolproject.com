// Browser checks for /json-to-excel/. Run `npm run build && npm run preview` first, then:
//   node scripts/json-excel-browser-check.mjs [--browser=chromium|webkit|firefox] [--base=http://localhost:4321]
import { base as jsonBase, launch } from './browser-env.mjs';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSync, ftruncateSync, closeSync, unlinkSync, readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';

const base = new URL('/json-to-excel/', jsonBase).href;
let assertions = 0;
const check = (condition, message) => { assert.ok(condition, message); assertions++; };
const noScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const converted = page => page.locator('#result:not([hidden])').waitFor();
const readBook = async download => XLSX.read(readFileSync(await download.path()), { type: 'buffer' });
const rows = (book, sheet) => XLSX.utils.sheet_to_json(book.Sheets[sheet], { header: 1, raw: true, defval: null });
const records = JSON.stringify(Array.from({ length: 140 }, (_, i) => ({ id: `R-${i}`, amount: i + 0.5, when: '2024-01-15', meta: { ok: i % 2 === 0 }, lines: [{ sku: `S${i}` }] })));

const browser = await launch();
try {
  for (const [width, height] of [[360, 800], [390, 844], [768, 900], [1280, 900]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto(base);
    check(await noScroll(page), `no horizontal scroll at ${width}`);
    await page.locator('#try-example').click();
    await page.locator('#convert').click();
    await converted(page);
    check(await noScroll(page), `no horizontal scroll with a result at ${width}`);
    if (width === 390 || width === 1280) await page.screenshot({ path: join(tmpdir(), `json-to-excel-${width}.png`), fullPage: true });
    await page.close();
  }

  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  const requests = [];
  page.on('request', request => requests.push(request));
  await page.addInitScript(() => {
    window.__shift = 0;
    new PerformanceObserver(list => { for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__shift += entry.value; }).observe({ type: 'layout-shift', buffered: true });
  });
  await page.goto(base);
  const workerLoaded = () => requests.some(request => /\/_astro\/json-to-excel-[^/]+\.js/.test(request.url()));
  check(!workerLoaded(), 'SheetJS is not loaded before converting');
  await page.locator('#convert').click();
  check((await page.locator('#status').textContent()).includes('Paste some JSON'), 'empty input message');
  check(await page.locator('#status').getAttribute('aria-live') === 'polite', 'live status region');

  await page.locator('#json-input').fill('{\n  "a": 1,\n}');
  await page.locator('#convert').click();
  await page.waitForFunction(() => document.querySelector('#status')?.textContent?.includes('Line 2'));
  check((await page.locator('#status').textContent()).includes('Remove the comma'), 'syntax error with a fix');

  await page.locator('#try-example').click();
  await page.locator('#convert').click();
  await converted(page);
  check(workerLoaded(), 'SheetJS loads on the first conversion');
  check((await page.locator('[data-sheet]').count()) === 2, 'example has a sheet for the line items');
  check((await page.locator('[data-sheet]').first().getAttribute('aria-pressed')) === 'true', 'first sheet selected');
  check((await page.locator('#result-summary').textContent()).startsWith('This sheet: 3 rows, 7 columns. Workbook: 2 sheets,'), 'summary counts');
  check((await page.locator('#preview-table th').allTextContents()).join('|') === '#|order|date|customer|total|shipping.city|shipping.method', 'preview header row');
  check((await page.locator('#preview-table tbody tr').count()) === 3, 'preview rows');
  await page.locator('[data-sheet="items"]').click();
  check((await page.locator('#preview-table th').allTextContents()).join('|') === 'Sheet1 #|sku|name|qty', 'items sheet preview');
  check((await page.locator('#result-summary').textContent()).startsWith('This sheet: 5 rows, 4 columns'), 'summary follows the sheet');
  check(await page.evaluate(() => window.__shift) < 0.05, 'layout shift under 0.05');

  let [download] = await Promise.all([page.waitForEvent('download'), page.locator('#download').click()]);
  check(download.suggestedFilename() === 'converted.xlsx', 'pasted input download name');
  let bytes = readFileSync(await download.path());
  check(bytes[0] === 0x50 && bytes[1] === 0x4b, 'download is an XLSX (ZIP) file');
  const shown = await page.locator('#result-summary').textContent();
  check(shown.includes(new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(bytes.length / 1024) + ' KB'), 'shown size matches the download');
  let book = XLSX.read(bytes, { type: 'buffer', cellNF: true });
  check(JSON.stringify(book.SheetNames) === '["Sheet1","items"]', 'sheet names');
  check(JSON.stringify(rows(book, 'items')[1]) === '[1,"NB-01","Notebook",2]', 'items linked to their order');
  check(book.Sheets.Sheet1.C2.t === 'n' && book.Sheets.Sheet1.C2.z === 'yyyy-mm-dd', 'dates are Excel dates');

  await page.locator('[data-nested="columns"]').click();
  await page.waitForFunction(() => !document.querySelector('#convert')?.disabled && document.querySelectorAll('[data-sheet]').length === 1);
  check((await page.locator('#preview-table th').allTextContents()).includes('items.2.sku'), 'numbered columns chip re-converts');
  check((await page.locator('#result-summary').textContent()).includes('of XLSX'), 'one-sheet summary');

  await page.locator('#json-file').setInputFiles({ name: 'orders.jsonl', mimeType: 'application/octet-stream', buffer: Buffer.from('{"a":1}\n{"a":2,"b":"x"}\n') });
  await page.waitForFunction(() => document.querySelector('#file-name')?.textContent === 'orders.jsonl');
  await page.locator('#convert').click();
  await converted(page);
  check((await page.locator('#preview-note').textContent()).includes('JSON Lines'), 'JSON Lines note');
  [download] = await Promise.all([page.waitForEvent('download'), page.locator('#download').click()]);
  check(download.suggestedFilename() === 'orders.xlsx', 'file download name');
  book = await readBook(download);
  check(JSON.stringify(book.SheetNames) === '["orders"]', 'first sheet named after the file');

  await page.locator('#json-file').setInputFiles({ name: 'big.json', mimeType: 'application/json', buffer: Buffer.from(records) });
  await page.waitForFunction(() => document.querySelector('#file-name')?.textContent === 'big.json');
  await page.locator('[data-nested="sheets"]').click();
  await page.locator('#convert').click();
  await converted(page);
  check((await page.locator('#preview-table tbody tr').count()) === 100, 'preview capped at 100 rows');
  check((await page.locator('#preview-note').textContent()).includes('first 100 of 140 rows'), 'preview cap note');

  await page.locator('#json-input').fill('[{"id":12345678901234567890}]');
  await page.locator('#convert').click();
  await converted(page);
  check((await page.locator('#preview-table td').first().textContent()) === '12345678901234567890', 'large integer keeps its digits');
  check((await page.locator('#preview-note').textContent()).includes('saved as text'), 'large integer note');
  await page.locator('#start-over').click();
  check((await page.locator('#json-input').inputValue()) === '' && await page.locator('#result').isHidden(), 'start over clears the input and result');

  await page.locator('#json-input').fill('[]');
  await page.locator('#convert').click();
  await page.waitForFunction(() => document.querySelector('#status')?.textContent?.includes('no values'));
  check(await page.locator('#result').isHidden(), 'empty JSON has no result');

  await page.locator('#json-file').setInputFiles({ name: 'notes.csv', mimeType: 'text/csv', buffer: Buffer.from('a,b') });
  check((await page.locator('#status').textContent()).includes('Choose a .json, .jsonl or .txt file'), 'wrong type message');
  const largePath = join(tmpdir(), `oversize-${process.pid}.json`);
  const handle = openSync(largePath, 'w');
  ftruncateSync(handle, 50 * 1024 * 1024 + 1);
  closeSync(handle);
  await page.locator('#json-file').setInputFiles(largePath);
  unlinkSync(largePath);
  check((await page.locator('#status').textContent()).includes('over 50 MB'), 'size limit');

  await page.evaluate(() => {
    const data = new DataTransfer();
    data.items.add(new File(['[{"dropped":true}]'], 'dropped.json'));
    const zone = document.querySelector('#json-excel-tool');
    zone.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: data }));
    zone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }));
  });
  await page.waitForFunction(() => document.querySelector('#file-name')?.textContent === 'dropped.json');
  check(true, 'drag and drop');

  await page.locator('[data-nested="sheets"]').focus();
  await page.keyboard.press('Tab');
  check(await page.evaluate(() => document.activeElement?.dataset.nested === 'columns'), 'keyboard moves between chips');
  check(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle !== 'none'), 'visible keyboard focus');

  const origin = new URL(base).origin;
  check(requests.every(request => request.method() === 'GET' && (request.url().startsWith(origin) || request.url().startsWith('blob:'))), 'no uploads and no third-party requests');
  await context.close();

  const touch = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await touch.goto(base);
  check((await touch.locator('#input-hint').textContent()) === 'Paste or choose a file from your device.', 'touch wording');
  await touch.close();
  console.log(`JSON to Excel browser checks passed: ${assertions} assertions`);
} finally { await browser.close(); }
