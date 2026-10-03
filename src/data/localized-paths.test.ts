import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { tools, createToolLocales, type Tool } from './tools';
import { sitePages, createPageLocales } from './pages';
import { localizedPaths, type LocalizedPathMap } from './localized-paths.mjs';
import { validateLocalizedPaths } from './localized-path-validation.mjs';
import { buildStaticPaths } from './routes';
import { parseRedirectSource, renderRedirects } from '../../scripts/localized-redirects.mjs';

const baseline = JSON.parse(readFileSync(new URL('../../docs/localized-url-baseline.json', import.meta.url), 'utf8')).publishedRoutes;
const empty = (): LocalizedPathMap => ({ tool: {}, page: {} });
const pilot = (): LocalizedPathMap => ({
  tool: { 'word-counter': { de: { path: '/de/woerterzaehler/', previousPaths: ['/de/word-counter/'] } } },
  page: {},
});
function registries(mapping: LocalizedPathMap) {
  const fixtureTools = Object.fromEntries(Object.entries(tools).map(([key, tool]) => [key, {
    ...tool,
    locales: Object.fromEntries(Object.entries(tool.locales).map(([locale, entry]) => [locale, {
      ...entry, path: mapping.tool[tool.id]?.[locale]?.path
        ?? baseline.find((row: any) => row.kind === 'tool' && row.stableId === tool.id && row.locale === locale)?.oldCanonicalPath
        ?? entry!.path,
    }])),
  }]));
  const pages = Object.fromEntries(Object.entries(sitePages).map(([key, page]) => [key, {
    ...page,
    locales: Object.fromEntries(Object.entries(page.locales).map(([locale, entry]) => [locale, {
      ...entry, path: mapping.page[page.id]?.[locale]?.path
        ?? baseline.find((row: any) => row.kind === 'page' && row.stableId === page.id && row.locale === locale)?.oldCanonicalPath
        ?? entry!.path,
    }])),
  }]));
  return { tools: fixtureTools, pages };
}
const validate = (mapping: LocalizedPathMap) => validateLocalizedPaths(mapping, registries(mapping), baseline);

describe('localized path mapping and permanent redirects', () => {
  it('covers the completed rollout while preserving baseline identities, retained routes and draft exclusions', () => {
    expect(validateLocalizedPaths(localizedPaths, { tools, pages: sitePages }, baseline)).toHaveLength(486);
    let changed = 0;
    let retained = 0;
    for (const row of baseline.filter((row: { kind: string }) => ['tool', 'page'].includes(row.kind))) {
      const item = row.kind === 'tool' ? Object.values(tools).find(tool => tool.id === row.stableId) : sitePages[row.stableId as keyof typeof sitePages];
      const change = localizedPaths[row.kind as 'tool' | 'page'][row.stableId]?.[row.locale];
      const expected = change?.path ?? row.oldCanonicalPath;
      if (row.migrationScope) {
        if (change) changed++; else retained++;
        if (row.locale !== 'ja' && !['tool:qr-code-scanner:de', 'page:contact:fr'].includes(`${row.kind}:${row.stableId}:${row.locale}`)) {
          expect(change, `${row.kind}:${row.stableId}:${row.locale} must migrate`).toBeDefined();
        } else expect(change).toBeUndefined();
      } else expect(change).toBeUndefined();
      if (change) {
        expect(change.previousPaths).toContain(row.oldCanonicalPath);
        const preset = row.stableId.match(/-(\d+kb)$/)?.[1];
        if (preset) expect(change.path.endsWith(`-${preset}/`)).toBe(true);
      }
      expect(item!.locales[row.locale as keyof typeof item.locales]!.path).toBe(expected);
    }
    expect(changed).toBe(162);
    expect(retained).toBe(41);
    const routes = buildStaticPaths({ allowDrafts: false });
    expect(routes.some(route => route.params.path === 'ja/eml-to-pdf')).toBe(false);
    expect(routes.some(route => route.params.path === 'ja/mht-to-pdf')).toBe(false);
  });

  it('can validate an empty mapping against isolated pre-migration registries', () => {
    expect(validate(empty())).toEqual([]);
    expect(createToolLocales('word-counter', 'wordCounter', undefined, empty()).de.path).toBe('/de/word-counter/');
  });

  it('uses mapped tool and page defaults in actual factories and builds the stable tool at its translated path', () => {
    const mapping = pilot();
    mapping.page.about = { es: { path: '/es/acerca-de/', previousPaths: ['/es/about/'] } };
    const tool: Tool = { ...tools.wordCounter, locales: createToolLocales('word-counter', 'wordCounter', undefined, mapping) };
    const page = { ...sitePages.about, locales: createPageLocales(locale => locale === 'en' ? '/about/' : `/${locale}/about/`, 'about', undefined, mapping) };
    expect(tool.locales.de!.path).toBe('/de/woerterzaehler/');
    expect(tool.locales.en!.path).toBe('/word-counter/');
    expect(tool.locales.ja!.path).toBe('/ja/word-counter/');
    expect(page.locales.es.path).toBe('/es/acerca-de/');
    expect(page.locales.en.path).toBe('/about/');
    const routes = buildStaticPaths({ allowDrafts: false, tools: { wordCounter: tool }, pages: { about: page } });
    const translated = routes.find(route => route.params.path === 'de/woerterzaehler')!;
    expect(translated.props.kind).toBe('tool');
    if (translated.props.kind === 'tool') expect(translated.props.tool.id).toBe('word-counter');
    expect(routes.some(route => route.params.path === 'de/word-counter')).toBe(false);
    expect(routes.some(route => route.params.path === 'es/acerca-de')).toBe(true);
    expect(validate(mapping)).toHaveLength(6);
  });

  it('preserves explicit fixture paths and publication overrides over mapped defaults', () => {
    const mapping = pilot();
    mapping.page.about = { es: { path: '/es/acerca-de/', previousPaths: ['/es/about/'] } };
    const tool = createToolLocales('word-counter', 'wordCounter', { de: { path: '/de/fixture/', reviewed: false } }, mapping);
    const page = createPageLocales(locale => locale === 'en' ? '/about/' : `/${locale}/about/`, 'about',
      { es: { path: '/es/fixture/', reviewed: false } }, mapping);
    expect(tool.de.path).toBe('/de/fixture/');
    expect(tool.de.reviewed).toBe(false);
    expect(page.es.path).toBe('/es/fixture/');
    expect(page.es.reviewed).toBe(false);
    const fixture = registries(mapping);
    fixture.tools.wordCounter.locales.de!.path = '/de/fixture/';
    expect(() => validateLocalizedPaths(mapping, fixture, baseline)).toThrow(/disagrees/);
    fixture.tools.wordCounter.locales.de!.path = '/de/woerterzaehler/';
    fixture.tools.wordCounter.locales.de!.reviewed = false;
    expect(() => validateLocalizedPaths(mapping, fixture, baseline)).toThrow(/not published/);
  });

  it('emits independently specified slash, slashless and index.html 301 fixtures deterministically', () => {
    const rules = validate(pilot());
    expect(rules).toEqual([
      { source: '/de/word-counter', destination: '/de/woerterzaehler/', status: 301 },
      { source: '/de/word-counter/', destination: '/de/woerterzaehler/', status: 301 },
      { source: '/de/word-counter/index.html', destination: '/de/woerterzaehler/', status: 301 },
    ]);
    expect(renderRedirects(rules)).toContain('/de/word-counter/index.html /de/woerterzaehler/ 301\n');
    const mapping = pilot();
    mapping.tool['word-counter'].de.previousPaths.push('/de/wortzaehler/');
    const first = renderRedirects(validate(mapping));
    mapping.tool['word-counter'].de.previousPaths.reverse();
    expect(renderRedirects(validate(mapping))).toBe(first);
    expect(validate(mapping)).toHaveLength(6);
    expect(validate(mapping).every(rule => rule.destination === '/de/woerterzaehler/')).toBe(true);
    mapping.tool['word-counter'].de.path = '/de/zaehler/';
    mapping.tool['word-counter'].de.previousPaths.push('/de/woerterzaehler/');
    expect(validate(mapping)).toHaveLength(9);
    expect(validate(mapping).every(rule => rule.destination === '/de/zaehler/')).toBe(true);
  });

  it.each([
    '/de/Uppercase/', '/de/wörter/', '/de/%77ord/', 'de/word/', '/de/word',
    '/de//word/', '/de/../word/', '/de/a_b/', '/de/-word/', '/de/word--counter/',
    '/de/word/?x=1', '/de/word/#x', '/de/word/index.html', '/es/word/', '/de/',
    '/de/api/contact/', '/de/guides/word/', '/de/404/', '/de/500/',
  ])('rejects malformed, wrong-prefix or reserved canonical path %s', path => {
    const mapping = pilot();
    mapping.tool['word-counter'].de.path = path;
    expect(() => validate(mapping)).toThrow(/normalized|prefix|reserved/);
  });

  it.each([
    { tool: { invented: { de: { path: '/de/example/', previousPaths: ['/de/old/'] } } }, page: {} },
    { tool: { wordCounter: { de: { path: '/de/example/', previousPaths: ['/de/old/'] } } }, page: {} },
    { tool: { 'word-counter': { xx: { path: '/xx/example/', previousPaths: ['/xx/old/'] } } }, page: {} },
    { tool: { 'word-counter': { en: { path: '/example/', previousPaths: ['/word-counter/'] } } }, page: {} },
    { tool: {}, page: { home: { de: { path: '/de/example/', previousPaths: ['/de/'] } } } },
    { tool: {}, page: { notFound: { de: { path: '/de/example/', previousPaths: ['/de/404.html'] } } } },
  ])('rejects unknown identities/locales and protected English or special pages', mapping => {
    expect(() => validate(mapping)).toThrow(/unknown|English|special/);
  });

  it('rejects Japanese changes and both Japanese draft destinations without emitting aliases', () => {
    for (const id of ['word-counter', 'eml-to-pdf', 'mht-to-pdf']) {
      const mapping = empty();
      mapping.tool[id] = { ja: { path: '/ja/example/', previousPaths: [`/ja/${id}/`] } };
      expect(() => validate(mapping)).toThrow(id === 'word-counter' ? /Japanese/ : /not published/);
    }
  });

  it('rejects malformed maps and change records rather than silently skipping them', () => {
    for (const mapping of [null, [], { synonym: {} }, { tool: null }, { tool: [] }]) {
      expect(() => validateLocalizedPaths(mapping, { tools, pages: sitePages }, baseline)).toThrow(/invalid|unknown/);
    }
    const mapping = pilot();
    for (const change of [null, [], { path: '/de/new/' }, { path: '/de/new/', previousPaths: 'old' },
      { path: '/de/new/', previousPaths: ['/de/word-counter/'], reviewed: true }]) {
      const malformed = { tool: { 'word-counter': { de: change } }, page: {} };
      expect(() => validateLocalizedPaths(malformed, { tools, pages: sitePages }, baseline)).toThrow(/invalid|missing historical/);
    }
    mapping.tool['word-counter'] = {};
    expect(() => validate(mapping)).toThrow(/empty locale map/);
  });

  it('requires explicit unique baseline aliases and rejects self-redirects', () => {
    const mapping = pilot();
    mapping.tool['word-counter'].de.previousPaths = [];
    expect(() => validate(mapping)).toThrow(/missing historical/);
    mapping.tool['word-counter'].de.previousPaths = ['/de/invented-synonym/'];
    expect(() => validate(mapping)).toThrow(/baseline alias/);
    mapping.tool['word-counter'].de.previousPaths = ['/de/word-counter/', '/de/word-counter/'];
    expect(() => validate(mapping)).toThrow(/duplicate historical/);
    mapping.tool['word-counter'].de.previousPaths = ['/de/woerterzaehler/'];
    expect(() => validate(mapping)).toThrow(/self-redirect/);
    mapping.tool['word-counter'].de.previousPaths = ['/de/word-counter/', '/de/unsafe?query/'];
    expect(() => validate(mapping)).toThrow(/normalized/);
  });

  it('rejects duplicate destinations, historical sources owned by others, draft collisions, chains and loops', () => {
    const mapping = pilot();
    mapping.tool['word-counter'].de.path = '/de/about/';
    expect(() => validate(mapping)).toThrow(/duplicate destination/);
    mapping.tool['word-counter'].de.path = '/de/woerterzaehler/';
    mapping.tool['word-counter'].de.previousPaths.push('/de/about/');
    expect(() => validate(mapping)).toThrow(/another entry/);
    mapping.tool['word-counter'].de.previousPaths.pop();
    mapping.tool['word-counter'].de.previousPaths.push('/de/current-draft/');
    const fixture = registries(mapping);
    fixture.tools.emlToPdf.locales.de!.path = '/de/current-draft/';
    fixture.tools.emlToPdf.locales.de!.reviewed = false;
    expect(() => validateLocalizedPaths(mapping, fixture, baseline)).toThrow(/active path/);
    const chain: LocalizedPathMap = { tool: {
      'word-counter': { de: { path: '/de/new/', previousPaths: ['/de/word-counter/'] } },
      'tip-calculator': { de: { path: '/de/latest/', previousPaths: ['/de/tip-calculator/', '/de/new/'] } },
    }, page: {} };
    expect(() => validate(chain)).toThrow(/chain or loop/);
    chain.tool['tip-calculator'].de.path = '/de/word-counter/';
    chain.tool['tip-calculator'].de.previousPaths = ['/de/tip-calculator/'];
    expect(() => validate(chain)).toThrow(/chain or loop/);
    chain.tool['tip-calculator'].de.path = '/de/latest/';
    chain.tool['word-counter'].de.previousPaths.push('/de/shared-history/');
    chain.tool['tip-calculator'].de.previousPaths.push('/de/shared-history/');
    expect(() => validate(chain)).toThrow(/duplicate redirect source/);
  });

  it('keeps unrelated rules in their separate source, orders static before dynamic, and rejects interference', () => {
    const rendered = renderRedirects(validate(pilot()), '/articles/* /blog/:splat 301\n/old-doc /about/ 308\n');
    expect(rendered).toContain('/old-doc /about/ 308');
    expect(rendered.indexOf('/old-doc')).toBeLessThan(rendered.indexOf('/articles/*'));
    expect(parseRedirectSource('/legacy /about/')[0].status).toBe(302);
    expect(() => renderRedirects(validate(pilot()), '/de/* /elsewhere/ 301')).toThrow(/overlaps/);
    expect(() => renderRedirects(validate(pilot()), '/old /de/word-counter/ 301')).toThrow(/chain/);
    expect(() => renderRedirects([], '/one /two 301\n/two /one 301')).toThrow(/loop/);
    expect(() => renderRedirects([], '/one /one 301')).toThrow(/self-redirect/);
    expect(() => renderRedirects([], '/one /two 301\n/one /three 301')).toThrow(/Duplicate/);
    expect(() => parseRedirectSource('/one /two 404')).toThrow(/status/);
    expect(() => parseRedirectSource('/one?query /two 301')).toThrow(/source/);
  });

  it('enforces Cloudflare static, dynamic and declaration length limits including independent rules', () => {
    const staticRules = Array.from({ length: 2000 }, (_, index) => `/old-${index} /destination/ 301`).join('\n');
    expect(() => renderRedirects([], staticRules)).not.toThrow();
    expect(() => renderRedirects(validate(pilot()), staticRules)).toThrow(/2,000/);
    const dynamicRules = Array.from({ length: 101 }, (_, index) => `/old-${index}/* /destination/:splat 301`).join('\n');
    expect(() => renderRedirects([], dynamicRules)).toThrow(/100 dynamic/);
    expect(() => renderRedirects([], `/${'a'.repeat(1000)} /destination/ 301`)).toThrow(/1,000/);
  });
});
