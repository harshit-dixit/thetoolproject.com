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
    expect(getPublishedPagePath('notFound', 'en')).toBe('/404.html');
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
    expect(getPublishedPagePath('notFound', 'es')).toBe('/404.html');
  });

  it('client translation helper throws on missing keys instead of returning the key name', () => {
    // Simulate client string lookup helper in csv-to-sql, xml-to-json, dbf-to-excel
    const createClientT = (strings: Record<string, string>) => (key: string, vars?: Record<string, string | number>) => {
      const str = strings[key];
      if (typeof str !== 'string') {
        throw new Error(`Missing translation key: ${key}`);
      }
      if (!vars) return str;
      let text = str;
      for (const [k, v] of Object.entries(vars)) {
        text = text.replaceAll(`{${k}}`, String(v));
      }
      return text;
    };

    const validStrings: Record<string, string> = {
      'csvSql.errEmpty': 'Paste CSV data or choose a file first.',
      'dbf.errInvalid': 'This file is not a valid DBF table.',
      'xmlJson.errEmpty': 'Paste XML or choose a file first.',
    };

    const t = createClientT(validStrings);
    expect(t('csvSql.errEmpty')).toBe('Paste CSV data or choose a file first.');

    // Remove a required key: it must throw and CANNOT silently return the raw key name
    const corruptedStrings = { ...validStrings };
    delete corruptedStrings['csvSql.errEmpty'];
    const corruptedT = createClientT(corruptedStrings);

    expect(() => corruptedT('csvSql.errEmpty')).toThrow('Missing translation key: csvSql.errEmpty');
    // Ensure it never returns the key string
    let result: string | undefined;
    try {
      result = corruptedT('csvSql.errEmpty');
    } catch {
      // expected throw
    }
    expect(result).not.toBe('csvSql.errEmpty');
  });

  it('arranges localized 404 generation so a reviewed locale outputs /{locale}/404.html while drafts emit no public file', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const os = await import('node:os');
    const { pathToFileURL } = await import('node:url');
    const { localized404Integration } = await import('../../astro.config.mjs');

    // 1. Verify that in current Phase 1, drafts have no reviewed entry
    expect(sitePages.notFound.locales.es).toBeUndefined();
    const publishedCurrent = publishedPageLocales(sitePages.notFound);
    expect(publishedCurrent.map(([l]) => l)).toEqual(['en']);

    // 2. Isolated fixture: simulate a reviewed non-English notFound without mutating actual sitePages
    const fixtureNotFound: SitePage = {
      id: 'notFound',
      locales: {
        en: { path: '/404.html', title: "This page doesn't exist", description: 'Desc', reviewed: true },
        es: { path: '/es/404.html', title: 'Esta página no existe', description: 'Desc', reviewed: true },
        de: { path: '/de/404.html', title: 'Seite nicht gefunden', description: 'Desc', reviewed: false },
      },
    };

    const publishedFixture = publishedPageLocales(fixtureNotFound);
    expect(publishedFixture.map(([l]) => l)).toEqual(['en', 'es']);
    expect(publishedFixture.find(([l]) => l === 'de')).toBeUndefined(); // Draft de has no public route

    // Verify static path param logic for reviewed notFound: emits ${locale}/404 for build
    const nonEnglishReviewed = publishedFixture.filter(([locale]) => locale !== 'en');
    const generatedPaths = nonEnglishReviewed.map(([locale]) => ({
      path: `${locale}/404`,
      expectedFile: `/${locale}/404.html`,
    }));
    expect(generatedPaths).toEqual([{ path: 'es/404', expectedFile: '/es/404.html' }]);

    // 3. Test the build integration hook using an isolated temporary directory fixture
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'astro-404-test-'));
    try {
      // Simulate build output directory structure created by Astro with format: 'directory':
      // Root 404.html (English)
      fs.writeFileSync(path.join(tmpDir, '404.html'), '<!DOCTYPE html><html><body>English 404</body></html>', 'utf8');
      // Subdirectory es/404/index.html (Spanish 404 generated from catch-all before post-process)
      const es404Dir = path.join(tmpDir, 'es', '404');
      fs.mkdirSync(es404Dir, { recursive: true });
      fs.writeFileSync(path.join(es404Dir, 'index.html'), '<!DOCTYPE html><html lang="es"><body>Español 404</body></html>', 'utf8');

      // Execute the integration hook
      const integration = localized404Integration();
      await (integration.hooks as any)['astro:build:done']({ dir: pathToFileURL(tmpDir) });

      // Verify that /es/404.html now exists with the exact content
      const es404HtmlPath = path.join(tmpDir, 'es', '404.html');
      expect(fs.existsSync(es404HtmlPath)).toBe(true);
      expect(fs.readFileSync(es404HtmlPath, 'utf8')).toContain('Español 404');

      // Verify that the /es/404/ directory has been cleaned up and removed
      expect(fs.existsSync(es404Dir)).toBe(false);

      // Verify English /404.html is preserved
      expect(fs.existsSync(path.join(tmpDir, '404.html'))).toBe(true);
      expect(fs.readFileSync(path.join(tmpDir, '404.html'), 'utf8')).toContain('English 404');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});


