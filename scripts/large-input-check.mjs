import { base, browserName, launch, positional } from './browser-env.mjs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync, unlinkSync } from 'node:fs';
import assert from 'node:assert/strict';

const count = Number(positional[0] || 10000);
const payload = 'x'.repeat(2000);
const path = join(tmpdir(), `json-to-html-large-${process.pid}.json`);
writeFileSync(path, `[${Array.from({ length: count }, () => JSON.stringify(payload)).join(',')}]`);
const browser = await launch();
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, ...(browserName === 'firefox' ? {} : { isMobile: true }) });
  await page.addInitScript(() => {
    window.__layoutShift = 0;
    window.__shiftDetails = [];
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) if (!entry.hadRecentInput) {
        window.__layoutShift += entry.value;
        window.__shiftDetails.push({ value: entry.value, time: entry.startTime, sources: entry.sources?.map(source => ({ node: source.node?.outerHTML?.slice(0, 180), previousRect: source.previousRect, currentRect: source.currentRect })) });
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
  await page.goto(base);
  await page.locator('#json-file').setInputFiles(path);
  await page.waitForFunction(() => document.querySelector('#file-name')?.textContent?.startsWith('json-to-html-large-'), { timeout: 30000 });
  const start = Date.now();
  await page.locator('#convert').click();
  const controlStart = Date.now();
  assert.equal(await page.locator('#convert').isDisabled(), true);
  const responsiveMs = Date.now() - controlStart;
  await page.locator('#result:not([hidden])').waitFor({ timeout: 120000 });
  assert.match(await page.locator('#result-summary').textContent(), new RegExp(count.toLocaleString('en-US') + ' rows'));
  assert.match(await page.locator('#preview-note').textContent(), /first 500/);
  assert.match(await page.locator('#code-note').textContent(), /start of the HTML/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const cls = await page.evaluate(() => window.__layoutShift);
  if (cls >= 0.05) console.log(JSON.stringify(await page.evaluate(() => window.__shiftDetails)));
  assert.ok(cls < 0.05, `CLS ${cls} exceeds 0.05`);
  assert.equal(await page.locator('#json-input').inputValue(), '', 'large files stay out of the textarea');
  assert.match(await page.locator('#input-hint').textContent(), /too large to show here/);
  // Switching layout starts a slow re-conversion; starting over must cancel it and free the Convert button.
  await page.locator('[data-layout="list"]').click();
  assert.equal(await page.locator('#convert').isDisabled(), true);
  await page.locator('#start-over').click();
  await page.locator('#json-input').fill('[{"a":1}]');
  assert.equal(await page.locator('#convert').isDisabled(), false, 'Convert stays usable after cancelling');
  await page.locator('#convert').click();
  await page.locator('#result:not([hidden])').waitFor({ timeout: 10000 });
  assert.match(await page.locator('#result-summary').textContent(), /^1 row, 1 column,/);
  console.log(`${browserName}: ${count} rows, ${((count * 2003 + 2) / 1048576).toFixed(1)} MB JSON: ${Date.now() - start} ms conversion, ${responsiveMs} ms control check, CLS ${cls.toFixed(3)}`);
} finally { await browser.close(); unlinkSync(path); }
