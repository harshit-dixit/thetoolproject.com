// Build first. HTTP mode requires Wrangler assets or an authorized production origin:
// node scripts/localized-routing-check.mjs --base=http://127.0.0.1:8787
// node scripts/localized-routing-check.mjs --artifact-only
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateLocalizedRedirects, loadRoutingRegistries, projectRoot } from './localized-redirects.mjs';
import { htmlLang } from '../src/i18n/locales.mjs';
import { historicalPathForms } from '../src/data/localized-path-validation.mjs';

export const site = 'https://thetoolproject.com';
const absolute = path => new URL(path, site).href;
const sorted = values => [...values].sort();
const decode = value => value.replace(/&(?:amp|quot|apos|lt|gt|#(\d+)|#x([\da-f]+));/gi,
  (entity, decimal, hex) => decimal || hex ? String.fromCodePoint(parseInt(decimal || hex, hex ? 16 : 10))
    : ({ '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' })[entity.toLowerCase()]);
const attributes = tag => Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)]
  .map(([, key, double, single, bare]) => [key.toLowerCase(), decode(double ?? single ?? bare)]));
const markup = html => html.replace(/<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
const tags = (html, name) => [...markup(html).matchAll(new RegExp(`<${name}\\b[^>]*>`, 'gi'))].map(([tag]) => attributes(tag));
const noindex = html => tags(html, 'meta').some(tag => tag.name === 'robots' && /\bnoindex\b/i.test(tag.content));
const htmlFile = path => path.endsWith('/') ? `${path.slice(1)}index.html` : path.slice(1);

export function createVerificationModel({ tools, pages }, guidePaths, rules) {
  const routes = new Map();
  const errors = new Map();
  const drafts = [];
  for (const [kind, registry] of [['tool', tools], ['page', pages]]) {
    for (const item of Object.values(registry)) {
      const entries = Object.entries(item.locales).filter(([, entry]) => entry.reviewed);
      const alternates = Object.fromEntries(entries.map(([locale, entry]) => [htmlLang[locale], absolute(entry.path)]));
      alternates['x-default'] = absolute(item.locales.en.path);
      for (const [locale, entry] of Object.entries(item.locales)) {
        const route = { kind, id: item.id, locale, path: entry.path, alternates };
        if (!entry.reviewed) { drafts.push(route); continue; }
        const target = item.id === 'notFound' ? errors : routes;
        assert.ok(!target.has(entry.path), `Duplicate verification route: ${entry.path}`);
        target.set(entry.path, route);
      }
    }
  }
  for (const path of guidePaths) {
    assert.ok(!routes.has(path), `Duplicate guide: ${path}`);
    routes.set(path, { kind: 'guide', id: path, locale: 'en', path,
      alternates: { en: absolute(path), 'x-default': absolute(path) } });
  }
  const historical = new Set(rules.map(rule => rule.source));
  for (const rule of rules) assert.ok(routes.has(rule.destination), `Unpublished redirect destination: ${rule.destination}`);
  const forbidden = new Set([...historical, ...drafts.flatMap(route => historicalPathForms(route.path)), ...errors.keys()]);
  return { routes, errors, drafts, rules, historical, forbidden };
}

/** Validate actual generated tags rather than relying on attribute order. */
export function verifyPage(html, route, model) {
  const label = route.path;
  const root = tags(html, 'html');
  assert.equal(root.length, 1, `${label} one html element`);
  assert.equal(root[0].lang, htmlLang[route.locale], `${label} html lang`);
  assert.equal(root[0]['data-locale'], route.locale, `${label} locale identity`);
  const pageType = route.kind === 'tool' ? 'tool' : route.kind === 'guide' ? 'guide' : route.id === 'home' ? 'home' : 'page';
  assert.equal(root[0]['data-page-type'], pageType, `${label} page identity`);
  if (route.kind === 'tool') assert.equal(root[0]['data-tool'], route.id, `${label} stable tool identity`);
  assert.ok(!noindex(html), `${label} canonical must be indexable`);
  const links = tags(html, 'link');
  assert.deepEqual(links.filter(tag => tag.rel === 'canonical').map(tag => tag.href), [absolute(label)], `${label} self-canonical`);
  const alternates = links.filter(tag => tag.rel === 'alternate' && tag.hreflang);
  assert.equal(alternates.length, Object.keys(route.alternates).length, `${label} unique applicable alternates`);
  assert.deepEqual(Object.fromEntries(alternates.map(tag => [tag.hreflang, tag.href])), route.alternates, `${label} reciprocal alternates / x-default`);
  const data = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter(([, attrs]) => attributes(attrs).type === 'application/ld+json').flatMap(([, , json]) => {
      const value = JSON.parse(json);
      return Array.isArray(value) ? value : value['@graph'] ?? [value];
    });
  if (route.kind === 'tool') {
    const applications = data.filter(value => value['@type'] === 'WebApplication');
    assert.equal(applications.length, 1, `${label} WebApplication`);
    assert.equal(applications[0].url, absolute(label), `${label} WebApplication URL`);
  }
  const breadcrumbs = data.filter(value => value['@type'] === 'BreadcrumbList');
  if (route.kind === 'tool' || route.kind === 'guide') assert.equal(breadcrumbs.length, 1, `${label} breadcrumbs`);
  for (const breadcrumb of breadcrumbs) {
    assert.equal(breadcrumb.itemListElement.at(-1).item, absolute(label), `${label} breadcrumb page URL`);
    const home = route.locale === 'en' ? '/' : `/${route.locale}/`;
    assert.equal(breadcrumb.itemListElement[0].item, absolute(home), `${label} breadcrumb home URL`);
  }
  // Every public metadata URL on our domain must name a published canonical page.
  const checkMetadata = value => {
    if (typeof value === 'string' && /^https?:\/\//.test(value)) {
      const url = new URL(value);
      if (url.origin === site) {
        assert.ok(model.routes.has(url.pathname) && !url.search && !model.forbidden.has(url.pathname), `${label} noncanonical metadata URL: ${value}`);
      }
    } else if (value && typeof value === 'object') Object.values(value).forEach(checkMetadata);
  };
  for (const tag of links.filter(tag => ['canonical', 'alternate'].includes(tag.rel))) checkMetadata(tag.href);
  for (const tag of tags(html, 'meta').filter(tag => /(?:^og:url$|^twitter:url$)/.test(tag.property ?? tag.name))) checkMetadata(tag.content);
  data.forEach(checkMetadata);
}

export function verifyError(html, route) {
  const root = tags(html, 'html');
  assert.equal(root.length, 1, `${route.path} one html element`);
  assert.equal(root[0].lang, htmlLang[route.locale], `${route.path} error language`);
  assert.equal(root[0]['data-locale'], route.locale, `${route.path} error locale`);
  assert.equal(root[0]['data-page-type'], 'not_found', `${route.path} error identity`);
  assert.ok(noindex(html), `${route.path} error noindex`);
  assert.ok(!tags(html, 'link').some(tag => tag.rel === 'canonical' || tag.hreflang), `${route.path} error has no canonical / alternates`);
}

/** Same-domain navigation must use final pages; English guide/fallback links are valid. */
export function auditLinks(html, path, model, files) {
  const assets = new Set();
  const navigationMarkup = markup(html);
  const destinations = [];
  for (const [, , text] of navigationMarkup.matchAll(/<(a|link|img|source)\b([^>]*)>/gi)) {
    const attrs = attributes(text);
    destinations.push(attrs.href ?? attrs.src);
  }
  for (const [, attrs, contents] of navigationMarkup.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
    if (attributes(attrs).id === 'language-select') destinations.push(...tags(contents, 'option').map(tag => tag.value));
  }
  for (const value of destinations) {
    if (!value) continue;
    const url = new URL(value, absolute(path));
    if (url.origin !== site) continue;
    // Error-page selectors retain their current error file for the selected locale.
    const selfError = model.errors.has(path) && url.pathname === path;
    assert.ok(selfError || !model.forbidden.has(url.pathname), `${path} stale or unpublished link: ${value}`);
    if (model.routes.has(url.pathname) || selfError) continue;
    assert.ok(files.has(url.pathname.slice(1)), `${path} missing internal link: ${value}`);
    assets.add(url.pathname);
  }
  // Scripts are removed from markup to avoid treating source strings as HTML attributes.
  for (const [, text] of html.matchAll(/<script\b([^>]*)>/gi)) {
    const src = attributes(text).src;
    if (!src) continue;
    const url = new URL(src, absolute(path));
    if (url.origin !== site) continue;
    assert.ok(files.has(url.pathname.slice(1)), `${path} missing script: ${src}`);
    assets.add(url.pathname);
  }
  return assets;
}

/** Follow every referenced chunk, including nested indexes; reject cycles and duplicates. */
export async function readSitemap(read, indexPath = '/sitemap-index.xml') {
  const chunks = new Set();
  const urls = [];
  async function visit(path) {
    assert.ok(!chunks.has(path), `Repeated sitemap chunk or cycle: ${path}`);
    chunks.add(path);
    const xml = await read(path);
    const locations = [...xml.matchAll(/<loc\b[^>]*>([^<]+)<\/loc>/g)].map(([, value]) => decode(value.trim()));
    assert.ok(locations.length, `Empty sitemap: ${path}`);
    if (/<sitemapindex\b/.test(xml)) {
      for (const location of locations) {
        const url = new URL(location);
        assert.equal(url.origin, site, `Sitemap chunk origin: ${location}`);
        assert.ok(!url.search && !url.hash, `Sitemap chunk must have no query or fragment: ${location}`);
        await visit(url.pathname);
      }
    } else {
      assert.match(xml, /<urlset\b/, `Invalid sitemap: ${path}`);
      urls.push(...locations);
    }
  }
  await visit(indexPath);
  assert.equal(new Set(urls).size, urls.length, 'Duplicate sitemap URL');
  return { chunks, urls };
}

export function verifySitemap(sitemap, model) {
  assert.deepEqual(sorted(sitemap.urls), sorted([...model.routes.keys()].map(absolute)), 'Sitemap equals published registries plus separately built guides');
}

export async function checkArtifact(root = projectRoot) {
  const rules = await generateLocalizedRedirects({ root, distCheck: true });
  const registries = await loadRoutingRegistries(root);
  const dist = join(root, 'dist');
  const files = new Set(readdirSync(dist, { recursive: true, withFileTypes: true }).filter(file => file.isFile())
    .map(file => join(file.parentPath, file.name).slice(dist.length + 1).replaceAll('\\', '/')));
  const guides = [...files].filter(file => /^guides\/.+\/index\.html$/.test(file)).map(file => `/${file.slice(0, -10)}`);
  const model = createVerificationModel(registries, guides, rules);
  // Preserve all out-of-scope baseline URLs, while allowing added guides/pages.
  const baseline = JSON.parse(readFileSync(join(root, 'docs/localized-url-baseline.json'), 'utf8'));
  for (const row of baseline.publishedRoutes.filter(row => !row.migrationScope)) {
    const route = (row.kind === 'error' ? model.errors : model.routes).get(row.oldCanonicalPath);
    assert.ok(route, `Out-of-scope baseline path changed: ${row.oldCanonicalPath}`);
    assert.equal(route.locale, row.locale);
    if (row.kind !== 'guide') assert.equal(route.id, row.stableId);
  }
  const expectedFiles = [...model.routes.keys(), ...model.errors.keys()].map(htmlFile);
  assert.deepEqual(sorted([...files].filter(file => file.endsWith('.html'))), sorted(expectedFiles), 'No extra, legacy or draft HTML artifacts');
  const read = path => readFileSync(join(dist, htmlFile(path)), 'utf8');
  const assets = new Set(['/robots.txt', '/favicon.ico', '/favicon.svg', '/fonts/archivo-latin-var.woff2']);
  // Include workers and lazy chunks that do not appear directly in HTML.
  for (const file of files) if (/^(?:_astro|fonts)\//.test(file) && !file.endsWith('.html')) assets.add(`/${file}`);
  for (const route of [...model.routes.values(), ...model.errors.values()]) {
    const html = read(route.path);
    if (route.id === 'notFound') verifyError(html, route);
    else verifyPage(html, route, model);
    auditLinks(html, route.path, model, files).forEach(path => assets.add(path));
  }
  const sitemap = await readSitemap(path => readFileSync(join(dist, path.slice(1)), 'utf8'));
  verifySitemap(sitemap, model);
  return { model, files, assets, sitemap, htmlFiles: expectedFiles.length };
}

const queryCases = ['', '?source=phase5&text=Gr%C3%BC%C3%9Fe&source=second&empty=&encoded=%26%3D%2B'];
async function request(url, method, fetcher) {
  const response = await fetcher(url, { method, redirect: 'manual', signal: AbortSignal.timeout(15000) });
  const body = await response.text();
  if (method === 'HEAD') assert.equal(body, '', `HEAD ${url} empty body`);
  return { response, body };
}
function direct(response, url, status = 200) {
  assert.equal(response.status, status, `${url} status ${status}`);
  assert.equal(response.headers.get('location'), null, `${url} must not redirect`);
}

export async function verifyAlias(rule, model, base, fetcher = fetch) {
  const route = model.routes.get(rule.destination);
  assert.ok(route, `Unpublished alias destination: ${rule.destination}`);
  for (const query of queryCases) {
    for (const method of ['GET', 'HEAD']) {
      const url = new URL(rule.source + query, base);
      const { response } = await request(url, method, fetcher);
      assert.equal(response.status, 301, `${method} ${url} permanent redirect`);
      assert.ok(response.headers.get('location'), `${url} Location header`);
      const destination = new URL(response.headers.get('location'), url);
      assert.equal(destination.href, new URL(rule.destination + query, base).href, `${url} direct Location / exact query preservation`);
      const final = await request(destination, method, fetcher);
      direct(final.response, destination);
      if (method === 'GET') verifyPage(final.body, route, model);
    }
  }
  return queryCases.length * 2;
}

// Bound production traffic, await the whole batch, and propagate failures before
// scheduling more work. Each alias's redirect/destination requests stay ordered.
export async function runHttpChecks(values, check) {
  const items = [...values];
  const results = [];
  for (let start = 0; start < items.length; start += 8) {
    const batch = await Promise.allSettled(items.slice(start, start + 8).map(async item => check(item)));
    const failure = batch.find(result => result.status === 'rejected');
    if (failure) throw failure.reason;
    results.push(...batch.map(result => result.value));
  }
  return results;
}

export async function checkHttp(artifact, base, fetcher = fetch) {
  const { model } = artifact;
  await runHttpChecks(model.routes.values(), async route => {
    const url = new URL(route.path, base);
    const { response, body } = await request(url, 'GET', fetcher);
    direct(response, url);
    verifyPage(body, route, model);
    auditLinks(body, route.path, model, artifact.files);
  });
  console.log(`HTTP canonical pages passed: ${model.routes.size}; checking ${model.rules.length} aliases with GET/HEAD and exact query preservation.`);
  const aliasCases = (await runHttpChecks(model.rules, rule => verifyAlias(rule, model, base, fetcher)))
    .reduce((total, count) => total + count, 0);
  const sitemap = await readSitemap(async path => {
    const url = new URL(path, base);
    const { response, body } = await request(url, 'GET', fetcher);
    direct(response, url);
    return body;
  });
  verifySitemap(sitemap, model);
  // Probe nested missing paths to establish nearest-locale error behavior, not just files.
  const negatives = [...model.errors.values()].map(route => ({ route, path: `${route.locale === 'en' ? '/' : `/${route.locale}/`}__phase5-missing__/nested/` }));
  negatives.push(...model.drafts.flatMap(draft => historicalPathForms(draft.path).map(path => ({ path,
    route: [...model.errors.values()].find(error => error.locale === draft.locale) }))));
  for (const { path, route } of negatives) {
    for (const method of ['GET', 'HEAD']) {
      const url = new URL(path, base);
      const { response, body } = await request(url, method, fetcher);
      direct(response, url, 404);
      if (method === 'GET') verifyError(body, route);
    }
  }
  for (const route of model.errors.values()) {
    const url = new URL(route.path, base);
    const { response } = await request(url, 'GET', fetcher);
    // auto-trailing-slash normalizes *.html files to extensionless URLs, including 404.
    assert.equal(response.status, 307, `${url} platform HTML normalization`);
    assert.ok(response.headers.get('location'), `${url} normalization Location`);
    const destination = new URL(response.headers.get('location'), url);
    assert.equal(destination.href, new URL(route.path.slice(0, -5), base).href, `${url} extensionless error path`);
    const final = await request(destination, 'GET', fetcher);
    // This explicitly requested asset is 200/noindex; unknown paths must be 404 above.
    direct(final.response, destination);
    verifyError(final.body, route);
  }
  await runHttpChecks(artifact.assets, async path => {
    const url = new URL(path, base);
    const { response } = await request(url, 'HEAD', fetcher);
    direct(response, url);
    assert.ok(!/text\/html/i.test(response.headers.get('content-type') ?? ''), `${path} asset is not a fallback HTML page`);
  });
  return { canonicals: model.routes.size, aliases: model.rules.length, aliasCases, sitemapUrls: sitemap.urls.length,
    sitemapFiles: sitemap.chunks.size, negativePaths: negatives.length, errorFiles: model.errors.size, assets: artifact.assets.size };
}

export async function main(args = process.argv.slice(2)) {
  assert.ok(args.every(arg => arg === '--artifact-only' || arg.startsWith('--base=')), 'Use --artifact-only or --base=http://127.0.0.1:8787');
  assert.ok(args.length <= 1, 'Choose exactly one verification mode');
  const artifact = await checkArtifact();
  console.log(`Artifact passed: ${artifact.htmlFiles} HTML files, ${artifact.model.routes.size} canonicals, ${artifact.model.rules.length} aliases, ${artifact.model.drafts.length} excluded drafts, ${artifact.assets.size} assets.`);
  if (args.includes('--artifact-only')) return;
  const base = new URL(args[0]?.slice('--base='.length) ?? 'http://127.0.0.1:8787');
  assert.ok(['http:', 'https:'].includes(base.protocol) && base.pathname === '/' && !base.search && !base.hash && !base.username && !base.password,
    'Base must be an HTTP(S) origin without a path, credentials, query or fragment');
  console.log(`HTTP verification passed at ${base.origin}: ${JSON.stringify(await checkHttp(artifact, base))}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
