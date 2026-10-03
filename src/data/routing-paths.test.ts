import { describe, expect, it } from 'vitest';
import { createPathResolver } from '../../scripts/routing-paths.mjs';
import { tools } from './tools';
import { sitePages as pages } from './pages';

describe('Node routing checks share publication and override behavior', () => {
  const resolver = createPathResolver({ tools, pages });
  it('accepts registry keys and stable IDs for the same translated entry', () => {
    expect(resolver.toolPath('wordCounter', 'es')).toBe(tools.wordCounter.locales.es!.path);
    expect(resolver.toolPath('word-counter', 'es')).toBe(tools.wordCounter.locales.es!.path);
    expect(resolver.pagePath('about', 'de')).toBe(pages.about.locales.de!.path);
    expect(resolver.pagePath('home', 'en')).toBe('/');
  });
  it('rejects unknown identities, missing locales and unpublished navigation', () => {
    expect(() => resolver.toolPath('missing', 'de')).toThrow(/Unknown/);
    expect(() => resolver.toolPath('word-counter', 'xx')).toThrow(/Unpublished/);
    expect(() => resolver.toolPath('eml-to-pdf', 'ja')).toThrow(/Unpublished/);
    expect(() => resolver.pagePath('missing', 'en')).toThrow(/Unknown/);
    expect(resolver.configuredToolPath('eml-to-pdf', 'ja')).toBe('/ja/eml-to-pdf/');
  });
  it('resolves actual registry overrides without reconstructing a default slug', () => {
    const fixture = createPathResolver({ tools: { fixture: { id: 'stable-id', locales: {
      de: { path: '/de/explicit-override/', reviewed: true },
    } } }, pages: {} });
    expect(fixture.toolPath('stable-id', 'de')).toBe('/de/explicit-override/');
  });
});
