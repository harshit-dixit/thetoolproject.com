import { describe, it, expect } from 'vitest';
import { tools, publishedToolLocales, getPublishedToolPath, type Locale } from './tools';
import { sitePages, publishedPageLocales, getPublishedPagePath, getPublishedHomePath, type SitePage } from './pages';

describe('routing and review gate', () => {
  it('every tool has an English reviewed route', () => {
    for (const [key, tool] of Object.entries(tools)) {
      expect(tool.locales.en, `tool ${key} should have en locale`).toBeDefined();
      expect(tool.locales.en?.reviewed, `tool ${key} en locale should be reviewed`).toBe(true);
      expect(tool.locales.en?.path).toMatch(/^\/[a-z0-9-]+\/$/);
    }
  });

  it('no non-English tool locale is reviewed in Phase 1', () => {
    const nonEnLocales: Locale[] = ['es', 'pt', 'de', 'fr', 'ja'];
    for (const [key, tool] of Object.entries(tools)) {
      for (const loc of nonEnLocales) {
        const entry = tool.locales[loc];
        if (entry) {
          expect(entry.reviewed, `tool ${key} ${loc} must not be reviewed in Phase 1`).toBe(false);
        }
      }
      const published = publishedToolLocales(tool);
      expect(published.map(([l]) => l)).toEqual(['en']);
    }
  });

  it('every site page has an English reviewed route', () => {
    for (const [id, page] of Object.entries(sitePages)) {
      expect(page.locales.en, `page ${id} should have en locale`).toBeDefined();
      expect(page.locales.en?.reviewed, `page ${id} en locale should be reviewed`).toBe(true);
    }
  });

  it('no non-English site page is reviewed in Phase 1', () => {
    for (const [id, page] of Object.entries(sitePages)) {
      const published = publishedPageLocales(page);
      expect(published.map(([l]) => l), `page ${id} published locales`).toEqual(['en']);
    }
  });

  it('getPublishedToolPath resolves paths for English and falls back safely for unreviewed locales', () => {
    expect(getPublishedToolPath('compressPdf', 'en')).toBe('/compress-pdf/');
    expect(getPublishedToolPath('compress-pdf', 'en')).toBe('/compress-pdf/');
    // When non-English is unreviewed, it safely links to English so links never 404
    expect(getPublishedToolPath('compressPdf', 'es')).toBe('/compress-pdf/');
    expect(() => getPublishedToolPath('nonexistent', 'en')).toThrow(/Unknown tool/);
  });

  it('getPublishedPagePath resolves paths for site pages', () => {
    expect(getPublishedPagePath('home', 'en')).toBe('/');
    expect(getPublishedPagePath('about', 'en')).toBe('/about/');
    expect(getPublishedPagePath('contact', 'en')).toBe('/contact/');
    expect(getPublishedPagePath('privacy', 'en')).toBe('/privacy/');
    expect(getPublishedPagePath('terms', 'en')).toBe('/terms/');
    expect(getPublishedPagePath('notFound', 'en')).toBe('/404/');
  });

  it('getPublishedHomePath resolves home path only for reviewed locales', () => {
    expect(getPublishedHomePath('en')).toBe('/');
    expect(getPublishedHomePath('es')).toBeUndefined();
  });

  it('publishedPageLocales filters out unreviewed locales and includes reviewed ones', () => {
    const mockPage: SitePage = {
      id: 'about',
      locales: {
        en: { path: '/about/', title: 'About', description: 'Desc', reviewed: true },
        es: { path: '/es/about/', title: 'Acerca de', description: 'Desc', reviewed: true },
        de: { path: '/de/about/', title: 'Über uns', description: 'Desc', reviewed: false },
      },
    };
    const published = publishedPageLocales(mockPage);
    expect(published.map(([loc]) => loc)).toEqual(['en', 'es']);
    expect(published.map(([, entry]) => entry.path)).toEqual(['/about/', '/es/about/']);
  });

  it('getPublishedPagePath falls back to English when locale is unreviewed or missing', () => {
    expect(getPublishedPagePath('about', 'es')).toBe('/about/');
    expect(getPublishedPagePath('privacy', 'de')).toBe('/privacy/');
  });
});

