// Run against Wrangler assets after a fresh build:
// node scripts/localized-url-pilot-check.mjs --base=http://127.0.0.1:8787
import assert from 'node:assert/strict';
import { base, launch } from './browser-env.mjs';
import { loadRoutingRegistries } from './localized-redirects.mjs';

const { tools } = await loadRoutingRegistries();
const canonical = '/de/woerterzaehler/';
assert.equal(tools.wordCounter.locales.de.path, canonical, 'independent pilot slug');
const aliases = ['/de/word-counter/', '/de/word-counter', '/de/word-counter/index.html'];
const request = (url, method = 'GET') => fetch(url, { method, redirect: 'manual', signal: AbortSignal.timeout(15000) });
for (const alias of aliases) {
  for (const query of ['', '?source=pilot&text=Gr%C3%BC%C3%9Fe&source=second']) {
    for (const method of ['GET', 'HEAD']) {
      const oldUrl = new URL(alias + query, base);
      const response = await request(oldUrl, method);
      assert.equal(response.status, 301, `${method} ${oldUrl} is permanent`);
      assert.ok(response.headers.get('location'), 'redirect includes Location');
      const destination = new URL(response.headers.get('location'), oldUrl);
      assert.equal(destination.href, new URL(canonical + query, base).href, 'direct destination preserves query');
      await response.arrayBuffer();
      const final = await request(destination, method);
      assert.equal(final.status, 200, `${method} destination has no redirect chain`);
      assert.equal(final.headers.get('location'), null);
      const html = await final.text();
      if (method === 'HEAD') assert.equal(html, '');
      else {
        assert.match(html, /<html lang="de"[^>]*data-tool="word-counter"/);
        assert.ok(html.includes(`rel="canonical" href="https://thetoolproject.com${canonical}"`));
      }
    }
  }
}

const browser = await launch();
try {
  const context = await browser.newContext();
  // Queue GA debug configuration locally without sending analytics to Google.
  await context.route(/https:\/\/(?:www\.googletagmanager\.com|[^/]*google-analytics\.com)\//, route => route.abort());
  const page = await context.newPage();
  await page.goto(new URL('/de/', base).href);
  const homeLink = page.locator(`main a[href="${canonical}"]`);
  assert.equal(await homeLink.count(), 1);
  const navigation = await Promise.all([page.waitForNavigation(), homeLink.click()]);
  assert.equal(navigation[0].status(), 200);
  assert.equal(navigation[0].request().redirectedFrom(), null, 'homepage uses final URL');
  assert.equal(new URL(page.url()).pathname, canonical);

  for (const locale of ['en', 'de']) {
    const path = tools.wordCounter.locales[locale].path;
    await page.locator('#language-select').selectOption(path);
    const [response] = await Promise.all([page.waitForNavigation(), page.locator('.language-go').click()]);
    assert.equal(response.status(), 200);
    assert.equal(response.request().redirectedFrom(), null, 'language selector uses final URL');
    assert.equal(new URL(page.url()).pathname, path);
    assert.deepEqual(await page.evaluate(() => ({ ...document.documentElement.dataset })),
      { locale, pageType: 'tool', tool: 'word-counter' });
    await page.locator('#word-counter-input').fill('Hallo Welt guten Tag');
    await page.waitForFunction(() => document.querySelector('[data-stat="words"]')?.textContent === '4');
    assert.equal(await page.locator('[data-stat="characters"]').textContent(), '20');
  }

  // Hashes never reach the server. Navigate old links in a browser to verify retention and targeting.
  for (const alias of aliases) {
    const response = await page.goto(new URL(`${alias}?source=fragment#word-counter-input`, base).href);
    assert.equal(response.status(), 200);
    const url = new URL(page.url());
    assert.equal(url.pathname, canonical);
    assert.equal(url.search, '?source=fragment');
    assert.equal(url.hash, '#word-counter-input');
    assert.equal(await page.locator('#word-counter-input').evaluate(element => element.matches(':target')), true);
    await page.waitForFunction(() => {
      const rect = document.querySelector('#word-counter-input').getBoundingClientRect();
      return rect.top < innerHeight && rect.bottom > 0;
    });
  }

  await page.goto(new URL(`${canonical}?ga_debug=1`, base).href);
  const settings = await page.evaluate(() => Array.from(window.dataLayer.find(entry => entry[0] === 'config'))[2]);
  assert.equal(settings.tool_id, 'word-counter');
  assert.equal(settings.page_locale, 'de');
  assert.equal(settings.content_group, 'tool');
  await page.locator('#word-counter-input').fill('Hallo Welt');
  await page.waitForFunction(() => document.querySelector('[data-stat="words"]')?.textContent === '2');
  await context.close();
  console.log('German pilot passed: 12 direct 301/200 GET/HEAD checks, queries, homepage, EN/DE switching, counts, three legacy fragments and analytics identity.');
} finally {
  await browser.close();
}
