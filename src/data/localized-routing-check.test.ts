import { describe, expect, it } from 'vitest';
import { auditLinks, createVerificationModel, readSitemap, runHttpChecks, site, verifyAlias, verifyError, verifyPage, verifySitemap } from '../../scripts/localized-routing-check.mjs';

const registries = {
  tools: { counter: { id: 'word-counter', locales: {
    en: { path: '/word-counter/', reviewed: true },
    de: { path: '/de/woerterzaehler/', reviewed: true },
    ja: { path: '/ja/word-counter/', reviewed: false },
  } } },
  pages: { home: { id: 'home', locales: {
    en: { path: '/', reviewed: true }, de: { path: '/de/', reviewed: true },
  } } },
};
const rule = { source: '/de/word-counter/', destination: '/de/woerterzaehler/', status: 301 };
const model = createVerificationModel(registries, ['/guides/example/'], [rule]);
const route = model.routes.get(rule.destination)!;
const html = `<html data-page-type="tool" data-tool="word-counter" data-locale="de" lang="de"><head>
  <link href="${site}${route.path}" rel="canonical">
  ${Object.entries(route.alternates).map(([lang, url]) => `<link href="${url}" hreflang="${lang}" rel="alternate">`).join('')}
  <script type="application/ld+json">${JSON.stringify({ '@type': 'WebApplication', url: site + route.path })}</script>
  <script type="application/ld+json">${JSON.stringify({ '@type': 'BreadcrumbList', itemListElement: [
    { item: site + '/de/' }, { item: site + route.path },
  ] })}</script></head><body></body></html>`;

describe('full localized routing verifier failure detection', () => {
  it('bounds simultaneous HTTP checks while checking every input exactly once', async () => {
    let active = 0;
    let peak = 0;
    const visited: number[] = [];
    const inputs = Array.from({ length: 25 }, (_, index) => index);
    const results = await runHttpChecks(inputs, async (input: number) => {
      active++;
      peak = Math.max(peak, active);
      visited.push(input);
      await new Promise(resolve => setTimeout(resolve, 0));
      active--;
      return input * 2;
    });
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(8);
    expect(active).toBe(0);
    expect(visited).toEqual(inputs);
    expect(results).toEqual(inputs.map(input => input * 2));
  });
  it('reports a failed HTTP check after draining in-flight work and stops later batches', async () => {
    const visited: number[] = [];
    let active = 0;
    const failure = new Error('missing production destination');
    await expect(runHttpChecks(Array.from({ length: 25 }, (_, index) => index), async (input: number) => {
      visited.push(input);
      if (input === 2) throw failure;
      active++;
      await new Promise(resolve => setTimeout(resolve, 0));
      active--;
    })).rejects.toBe(failure);
    expect(active).toBe(0);
    expect(visited).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
  it('accepts reordered attributes and exact published alternate sets', () => {
    expect(() => verifyPage(html, route, model)).not.toThrow();
    expect(route.alternates).not.toHaveProperty('ja');
  });
  it('rejects duplicate canonical tags and incorrect tool identity', () => {
    expect(() => verifyPage(html.replace('</head>', `<link rel="canonical" href="${site}${route.path}"></head>`), route, model)).toThrow(/self-canonical/);
    expect(() => verifyPage(html.replace('data-tool="word-counter"', 'data-tool="other"'), route, model)).toThrow(/stable tool identity/);
  });
  it('rejects missing/duplicate alternates and draft alternates', () => {
    expect(() => verifyPage(html.replace('hreflang="de"', 'hreflang="en"'), route, model)).toThrow(/reciprocal/);
    expect(() => verifyPage(html.replace('</head>', `<link rel="alternate" hreflang="ja" href="${site}/ja/word-counter/"></head>`), route, model)).toThrow(/alternates/);
    expect(() => verifyPage(html.replace('hreflang="x-default"', 'hreflang="ja"'), route, model)).toThrow(/reciprocal/);
  });
  it('rejects legacy structured data and wrong locale/noindex', () => {
    const staleData = html.replace(`"url":"${site}${route.path}"`, `"url":"${site}${rule.source}"`);
    expect(() => verifyPage(staleData, route, model)).toThrow(/WebApplication URL/);
    expect(() => verifyPage(html.replace('lang="de"', 'lang="en"'), route, model)).toThrow(/html lang/);
    expect(() => verifyPage(html.replace('</head>', '<meta content="noindex" name="robots"></head>'), route, model)).toThrow(/indexable/);
  });
  it('accepts English guides/fallbacks and ignores tool select values/source strings', () => {
    const links = `<a href="/word-counter/">English fallback</a><a href="/guides/example/">Guide</a>
      <select id="quality"><option value="light">Light</option></select>
      <script>const example = '<a href="/de/word-counter/">';</script>`;
    expect(() => auditLinks(links, route.path, model, new Set())).not.toThrow();
  });
  it('rejects slashless/query/fragment legacy links, drafts and missing assets', () => {
    const fullModel = createVerificationModel(registries, [], [rule, { ...rule, source: '/de/word-counter' }]);
    expect(() => auditLinks('<a href="/de/word-counter?x=1#input">Old</a>', route.path, fullModel, new Set())).toThrow(/stale/);
    expect(() => auditLinks('<select id="language-select"><option value="/ja/word-counter/">JA</option></select>', route.path, model, new Set())).toThrow(/unpublished/);
    expect(() => auditLinks('<script src="/_astro/missing.js"></script>', route.path, model, new Set())).toThrow(/missing script/);
  });
  it('requires noindex and correct locale on error pages', () => {
    const error = { path: '/de/404.html', locale: 'de' };
    const body = '<html lang="de" data-locale="de" data-page-type="not_found"><meta name="robots" content="noindex"></html>';
    expect(() => verifyError(body, error)).not.toThrow();
    expect(() => verifyError(body.replace('noindex', 'index'), error)).toThrow(/noindex/);
    expect(() => verifyError(body.replace('lang="de"', 'lang="en"'), error)).toThrow(/language/);
  });
  it('reads every sitemap chunk and requires exact canonical equality', async () => {
    const documents = new Map([
      ['/sitemap-index.xml', `<sitemapindex><loc>${site}/a.xml</loc><loc>${site}/b.xml</loc></sitemapindex>`],
      ['/a.xml', `<urlset><loc>${site}/</loc><loc>${site}/de/</loc><loc>${site}/word-counter/</loc></urlset>`],
      ['/b.xml', `<urlset><loc>${site}${route.path}</loc><loc>${site}/guides/example/</loc></urlset>`],
    ]);
    const sitemap = await readSitemap(async path => { if (!documents.has(path)) throw Error('missing chunk'); return documents.get(path)!; });
    expect(sitemap.chunks.size).toBe(3);
    expect(() => verifySitemap(sitemap, model)).not.toThrow();
    expect(() => verifySitemap({ ...sitemap, urls: sitemap.urls.slice(1) }, model)).toThrow(/Sitemap equals/);
    documents.delete('/b.xml');
    await expect(readSitemap(async path => { if (!documents.has(path)) throw Error('missing chunk'); return documents.get(path)!; })).rejects.toThrow(/missing chunk/);
  });
  it('rejects cyclic sitemap indexes and duplicate URLs across chunks', async () => {
    await expect(readSitemap(async () => `<sitemapindex><loc>${site}/sitemap-index.xml</loc></sitemapindex>`)).rejects.toThrow(/cycle/);
    await expect(readSitemap(async () => `<urlset><loc>${site}/</loc><loc>${site}/</loc></urlset>`)).rejects.toThrow(/Duplicate sitemap URL/);
  });
  it('checks every alias with manual handling and GET/HEAD, preserving repeated/encoded queries', async () => {
    const requests: { url: URL; method: string }[] = [];
    const fetcher = async (url: URL, options: RequestInit) => {
      expect(options.redirect).toBe('manual');
      requests.push({ url, method: options.method! });
      if (url.pathname === rule.source) return new Response(null, { status: 301, headers: { location: rule.destination + url.search } });
      return new Response(options.method === 'HEAD' ? null : html, { status: 200 });
    };
    expect(await verifyAlias(rule, model, 'http://localhost:8787', fetcher)).toBe(4);
    expect(requests).toHaveLength(8);
    expect(requests.some(({ url }) => url.searchParams.getAll('source').length === 2)).toBe(true);
  });
  it('rejects temporary redirects, lost/extra queries, chains and missing destinations', async () => {
    const fetcher = (status: number, location: string, finalStatus = 200) => async (url: URL, options: RequestInit) =>
      url.pathname === rule.source ? new Response(null, { status, headers: { location: location + url.search } })
        : new Response(options.method === 'HEAD' ? null : html, { status: finalStatus });
    await expect(verifyAlias(rule, model, 'http://localhost:8787', fetcher(302, rule.destination))).rejects.toThrow(/permanent/);
    await expect(verifyAlias(rule, model, 'http://localhost:8787', fetcher(301, rule.destination + '?tracking=added'))).rejects.toThrow(/query preservation/);
    await expect(verifyAlias(rule, model, 'http://localhost:8787', fetcher(301, rule.destination, 301))).rejects.toThrow(/status 200/);
    await expect(verifyAlias(rule, model, 'http://localhost:8787', fetcher(301, rule.destination, 404))).rejects.toThrow(/status 200/);
    const droppedQuery = async (url: URL, options: RequestInit) => url.pathname === rule.source
      ? new Response(null, { status: 301, headers: { location: rule.destination } })
      : new Response(options.method === 'HEAD' ? null : html);
    await expect(verifyAlias(rule, model, 'http://localhost:8787', droppedQuery)).rejects.toThrow(/query preservation/);
  });
});
