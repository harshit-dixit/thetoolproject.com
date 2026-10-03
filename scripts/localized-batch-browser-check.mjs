// Smoke a Phase 4 batch against Astro preview or Wrangler assets.
// node scripts/localized-batch-browser-check.mjs --locale=de --kind=tool --base=http://127.0.0.1:8787
import assert from 'node:assert/strict';
import { base, launch } from './browser-env.mjs';
import { loadPathResolver } from './routing-paths.mjs';

const locale = process.argv.find(arg => arg.startsWith('--locale='))?.split('=')[1];
const kind = process.argv.find(arg => arg.startsWith('--kind='))?.split('=')[1] ?? 'tool';
assert.ok(['de', 'es', 'pt', 'fr'].includes(locale));
assert.ok(['tool', 'page'].includes(kind));
const { toolPath, pagePath } = await loadPathResolver();
const browser = await launch();
try {
  const page = await browser.newPage();
  const direct = async path => {
    const response = await page.goto(new URL(path, base).href);
    assert.equal(response.status(), 200, path);
    assert.equal(response.request().redirectedFrom(), null, `${path} direct navigation`);
    assert.equal(new URL(page.url()).pathname, path);
  };
  const switchTo = async path => {
    await page.locator('#language-select').selectOption(path);
    const [response] = await Promise.all([page.waitForNavigation(), page.locator('.language-go').click()]);
    assert.equal(response.status(), 200);
    assert.equal(response.request().redirectedFrom(), null);
    assert.equal(new URL(page.url()).pathname, path);
  };
  if (kind === 'tool') {
    await direct(pagePath('home', locale));
    const wordPath = toolPath('word-counter', locale);
    const [response] = await Promise.all([page.waitForNavigation(), page.locator(`main a[href="${wordPath}"]`).click()]);
    assert.equal(response.request().redirectedFrom(), null);
    for (const loc of [locale, 'en', locale]) {
      if (loc !== locale || new URL(page.url()).pathname !== wordPath) await switchTo(toolPath('word-counter', loc));
      assert.equal(await page.locator('html').getAttribute('data-tool'), 'word-counter');
      await page.locator('#word-counter-input').fill('Hello world four words');
      await page.waitForFunction(() => document.querySelector('[data-stat="words"]')?.textContent === '4');
    }
    await direct(toolPath('gpa-calculator', locale));
    const related = toolPath('high-school-gpa-calculator', locale);
    const [next] = await Promise.all([page.waitForNavigation(), page.locator(`main a[href="${related}"]`).first().click()]);
    assert.equal(next.status(), 200);
    assert.equal(next.request().redirectedFrom(), null);
    assert.equal(new URL(page.url()).pathname, related);
    assert.equal(await page.locator('html').getAttribute('data-tool'), 'high-school-gpa-calculator');
  } else {
    for (const id of ['about', 'contact', 'privacy', 'terms']) {
      await direct(pagePath('home', locale));
      const path = pagePath(id, locale);
      const [response] = await Promise.all([page.waitForNavigation(), page.locator(`footer nav a[href="${path}"]`).click()]);
      assert.equal(response.status(), 200);
      assert.equal(response.request().redirectedFrom(), null);
      assert.equal(new URL(page.url()).pathname, path);
      await switchTo(pagePath(id, 'en'));
      await switchTo(path);
      assert.equal(await page.locator('html').getAttribute('data-page-type'), 'page');
    }
  }
  console.log(`${kind}:${locale} batch passed: direct navigation, ${kind === 'tool' ? 'sample counts, related-tool link' : 'four footer links'}, English/localized same-page switching.`);
} finally {
  await browser.close();
}
