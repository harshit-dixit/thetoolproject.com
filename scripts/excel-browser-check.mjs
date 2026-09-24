

import { base as jsonBase, launch } from './browser-env.mjs';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSync, ftruncateSync, closeSync, unlinkSync, readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';

const base = new URL('/excel-to-csv/', jsonBase).href;
let assertions = 0;
const check = (condition, message) => { assert.ok(condition, message); assertions++; };

function workbook(sheets, hidden = []) {
  const book = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    const sheet = XLSX.utils.aoa_to_sheet([]);
    rows.forEach((row, r) => row.forEach((value, c) => {
      if (value === null) return;
      sheet[XLSX.utils.encode_cell({ r, c })] = typeof value === 'object' ? value : typeof value === 'number' ? { t: 'n', v: value } : { t: 's', v: String(value) };
    }));
    sheet['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length - 1, c: Math.max(...rows.map(row => row.length)) - 1 } });
    XLSX.utils.book_append_sheet(book, sheet, name);
  }
  book.Workbook = { Sheets: book.SheetNames.map(name => ({ name, Hidden: hidden.includes(name) ? 1 : 0 })) };
  return book;
}
const orders = [['Order', 'Date', 'Total', 'Note'], ...Array.from({ length: 140 }, (_, i) => [`A-${100 + i}`, { t: 'n', v: 45306 + i, z: 'm/d/yy' }, { t: 'n', v: 1234.5 + i, z: '$#,##0.00' }, i === 0 ? 'Zoë, "VIP"' : 'ok'])];
const multi = { name: 'sales report.xlsx', mimeType: 'application/octet-stream', buffer: XLSX.write(workbook({ Orders: orders, 'Q1 "East" 東京': [['a', 'b'], [1, 2]], Archive: [['old']] }, ['Archive']), { type: 'buffer', bookType: 'xlsx' }) };
const single = { name: 'contacts.xls', mimeType: 'application/vnd.ms-excel', buffer: XLSX.write(workbook({ Contacts: [['Name', 'City'], ['Maya Chen', 'Portland']] }), { type: 'buffer', bookType: 'xls' }) };
const ods = { name: 'budget.ods', mimeType: 'application/vnd.oasis.opendocument.spreadsheet', buffer: XLSX.write(workbook({ Budget: [['Item', 'Cost'], ['Rent', 900]] }), { type: 'buffer', bookType: 'ods' }) };
const encrypted = (() => {
  const container = XLSX.CFB.utils.cfb_new();
  XLSX.CFB.utils.cfb_add(container, '/EncryptionInfo', new Uint8Array([4, 0, 4, 0, 0x40, 0, 0, 0]));
  XLSX.CFB.utils.cfb_add(container, '/EncryptedPackage', new Uint8Array(64));
  return { name: 'locked.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.from(XLSX.CFB.write(container, { type: 'array' })) };
})();
const noScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const loaded = page => page.waitForFunction(() => !document.querySelector('#download')?.disabled && document.querySelector('#result-summary')?.textContent?.includes('of CSV'));
const downloadText = async download => readFileSync(await download.path());

const browser = await launch();
try {
  for (const [width, height] of [[360, 800], [390, 844], [768, 900], [1280, 900]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto(base);
    check(await noScroll(page), `no horizontal scroll at ${width}`);
    await page.locator('#excel-file').setInputFiles(multi);
    await loaded(page);
    check(await noScroll(page), `no horizontal scroll with a result at ${width}`);
    await page.locator('[data-view="text"]').click();
    check(await noScroll(page), `CSV text stays inside the page at ${width}`);
    if (width === 390 || width === 1280) await page.screenshot({ path: join(tmpdir(), `excel-to-csv-${width}.png`), fullPage: true });
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
  check((await page.locator('#drop-title').textContent()) === 'Drop an Excel file here', 'empty drop zone title');
  check(await page.locator('#status').getAttribute('aria-live') === 'polite', 'live status region');

  await page.locator('#excel-file').setInputFiles(multi);
  await loaded(page);
  check((await page.locator('#file-name').textContent()) === 'sales report.xlsx', 'file name shown');
  check((await page.locator('[data-sheet]').count()) === 3, 'sheet chips');
  check((await page.locator('[data-sheet="Archive"]').textContent()) === 'Archive (hidden)', 'hidden sheet marked');
  check((await page.locator('[data-sheet="Orders"]').getAttribute('aria-pressed')) === 'true', 'first visible sheet selected');
  check((await page.locator('#result-summary').textContent()).startsWith('141 rows, 4 columns'), 'summary counts');
  check((await page.locator('#preview-table tr').count()) === 100, 'preview capped at 100 rows');
  check((await page.locator('#preview-note').textContent()).includes('first 100 of 141 rows'), 'preview cap note');
  check((await page.locator('#preview-table td').nth(5).textContent()) === '2024-01-15', 'ISO date in preview');
  check((await page.locator('#status').textContent()).includes('3 sheets'), 'load announced');
  check((await page.locator('#download-zip').textContent()) === 'Download all 3 sheets as ZIP', 'ZIP button label');
  check(await page.evaluate(() => window.__shift) < 0.05, 'layout shift under 0.05');

  await page.locator('[data-view="text"]').click();
  check((await page.locator('#csv-view').textContent()).startsWith('Order,Date,Total,Note\r\nA-100,2024-01-15,"$1,234.50","Zoë, ""VIP"""'), 'CSV text quoting and formats');
  await page.locator('[data-numbers="plain"]').click();
  await page.waitForFunction(() => document.querySelector('#csv-view')?.textContent?.includes('A-100,2024-01-15,1234.5,'));
  check(true, 'plain numbers chip re-converts');
  await page.locator('[data-separator="semicolon"]').click();
  await page.waitForFunction(() => document.querySelector('#csv-view')?.textContent?.startsWith('Order;Date;Total;Note'));
  check(true, 'semicolon chip');

  let [download] = await Promise.all([page.waitForEvent('download'), page.locator('#download').click()]);
  check(download.suggestedFilename() === 'sales report-Orders.csv', 'sheet download name');
  let bytes = await downloadText(download);
  check(bytes[0] === 0x4f && bytes.toString('utf8').startsWith('Order;Date;Total;Note\r\nA-100;2024-01-15;1234.5;'), 'downloaded CSV content without BOM');
  const shownSize = await page.locator('#result-summary').textContent();
  check(shownSize.includes(new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(bytes.length / 1024) + ' KB'), 'shown size matches the download');

  await page.locator('[data-bom="true"]').click();
  [download] = await Promise.all([page.waitForEvent('download'), page.locator('#download').click()]);
  bytes = await downloadText(download);
  check(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf, 'BOM chip adds a byte order mark');

  await page.locator('[data-separator="tab"]').click();
  await page.waitForFunction(() => document.querySelector('#download')?.textContent === 'Download TSV');
  await page.locator(`[data-sheet='Q1 "East" 東京']`).click();
  await page.waitForFunction(() => document.querySelector('#result-summary')?.textContent?.startsWith('2 rows, 2 columns'));
  [download] = await Promise.all([page.waitForEvent('download'), page.locator('#download').click()]);
  check(download.suggestedFilename() === 'sales report-Q1 -East- 東京.tsv', 'TSV download name from an unsafe sheet name');
  check((await downloadText(download)).toString('utf8') === '﻿a\tb\r\n1\t2\r\n', 'TSV content');

  [download] = await Promise.all([page.waitForEvent('download'), page.locator('#download-zip').click()]);
  check(download.suggestedFilename() === 'sales report-tsv.zip', 'ZIP download name');
  const archive = XLSX.CFB.read(await downloadText(download), { type: 'buffer' });
  const names = archive.FileIndex.filter(file => file.name.endsWith('.tsv')).map(file => Buffer.from(file.name, 'latin1').toString('utf8'));
  check(JSON.stringify(names) === JSON.stringify(['Orders.tsv', 'Q1 -East- 東京.tsv', 'Archive.tsv']), 'ZIP has one file per sheet');

  await page.locator('#excel-file').setInputFiles(single);
  await loaded(page);
  check((await page.locator('[data-sheet]').count()) === 1 && (await page.locator('[data-sheet]').textContent()) === 'Contacts', 'one sheet chip names the only sheet');
  check(await page.locator('#download-zip').isHidden(), 'no ZIP button for one sheet');
  check((await page.locator('#panel-title').textContent()) === 'Convert this workbook to CSV', 'panel title');
  [download] = await Promise.all([page.waitForEvent('download'), page.locator('#download').click()]);
  check(download.suggestedFilename() === 'contacts.tsv', 'single sheet download name keeps the chosen separator');
  check(requests.some(request => request.url().includes('cpexcel')), 'code pages load for .xls');

  await page.locator('#excel-file').setInputFiles(ods);
  await loaded(page);
  check((await page.locator('#preview-table td').first().textContent()) === 'Item', 'ODS file');

  await page.locator('#excel-file').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  check((await page.locator('#drop-title').textContent()) === 'This isn’t an Excel file', 'wrong type error');
  check((await page.locator('#choose-file').textContent()) === 'Choose a different file', 'error offers another file');
  await page.locator('#excel-file').setInputFiles(encrypted);
  await page.waitForFunction(() => document.querySelector('#drop-title')?.textContent?.includes('password'));
  check((await page.locator('#drop-hint').textContent()).includes('remove the password'), 'password error');
  await page.locator('#excel-file').setInputFiles({ name: 'broken.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.from([0x50, 0x4b, 3, 4, 1, 2, 3, 4, 5]) });
  await page.waitForFunction(() => document.querySelector('#drop-title')?.textContent?.includes('couldn’t be read'));
  check(true, 'damaged file error');
  const largePath = join(tmpdir(), `oversize-${process.pid}.xlsx`);
  const handle = openSync(largePath, 'w');
  ftruncateSync(handle, 50 * 1024 * 1024 + 1);
  closeSync(handle);
  await page.locator('#excel-file').setInputFiles(largePath);
  unlinkSync(largePath);
  check((await page.locator('#drop-title').textContent()) === 'This file is over 50 MB', 'size limit');

  await page.evaluate(async buffer => {
    const data = new DataTransfer();
    data.items.add(new File([new Uint8Array(buffer)], 'dropped.xlsx'));
    const zone = document.querySelector('#excel-tool');
    zone.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: data }));
    zone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }));
  }, [...multi.buffer]);
  await loaded(page);
  check((await page.locator('#file-name').textContent()) === 'dropped.xlsx', 'drag and drop');

  await page.locator('[data-sheet="Orders"]').focus();
  await page.keyboard.press('Tab');
  check(await page.evaluate(() => document.activeElement?.dataset.sheet === 'Q1 "East" 東京'), 'keyboard moves between chips');
  check(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle !== 'none'), 'visible keyboard focus');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('#result-summary')?.textContent?.startsWith('2 rows'));
  check(true, 'keyboard chip selection');

  const origin = new URL(base).origin;
  // Downloads are local blob: URLs, which WebKit reports as requests.
  check(requests.every(request => request.method() === 'GET' && (request.url().startsWith(origin) || request.url().startsWith('blob:'))), 'no uploads and no third-party requests');
  await context.close();

  const fresh = await browser.newPage();
  const freshRequests = [];
  fresh.on('request', request => freshRequests.push(request.url()));
  await fresh.goto(base);
  check(!freshRequests.some(url => /excel-to-csv-.*\.js|cpexcel/.test(url)), 'SheetJS is not loaded before a file is chosen');
  await fresh.locator('#excel-file').setInputFiles(multi);
  await loaded(fresh);
  check(!freshRequests.some(url => url.includes('cpexcel')), 'code pages are skipped for .xlsx');
  await fresh.close();

  const touch = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await touch.goto(base);
  check((await touch.locator('#drop-title').textContent()) === 'Choose an Excel file', 'touch wording');
  await touch.close();

  const reduced = await browser.newPage({ reducedMotion: 'reduce' });
  await reduced.goto(base);
  check(await reduced.locator('#excel-tool').evaluate(el => getComputedStyle(el).transitionDuration === '0s'), 'reduced motion');
  await reduced.close();
  console.log(`Excel to CSV browser checks passed: ${assertions} assertions`);
} finally { await browser.close(); }
