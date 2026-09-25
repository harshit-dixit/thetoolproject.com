import { describe, it, expect } from 'vitest';
import { tools, publishedToolLocales, getPublishedToolPath, createToolLocales, type Tool, type Locale } from './tools';
import { sitePages, publishedPageLocales, getPublishedPagePath, getPublishedHomePath, createPageLocales, type SitePage } from './pages';
import { buildStaticPaths } from './routes';

describe('routing and review gate', () => {
  it('every tool has an English reviewed route', () => {
    for (const [key, tool] of Object.entries(tools)) {
      expect(tool.locales.en, `tool ${key} should have en locale`).toBeDefined();
      expect(tool.locales.en?.reviewed, `tool ${key} en locale should be reviewed`).toBe(true);
      expect(tool.locales.en?.path).toMatch(/^\/[a-z0-9-]+\/$/);
    }
  });

  it('all non-English tool locales have draft entries with reviewed: false and non-empty metadata', () => {
    const nonEnLocales: Locale[] = ['es', 'pt', 'de', 'fr', 'ja'];
    for (const [key, tool] of Object.entries(tools)) {
      for (const loc of nonEnLocales) {
        const entry = tool.locales[loc];
        expect(entry, `tool ${key} should have draft entry for ${loc}`).toBeDefined();
        expect(entry?.reviewed, `tool ${key} ${loc} must have reviewed: false`).toBe(false);
        expect(entry?.path).toBe(`/${loc}/${tool.id}/`);
        expect(entry?.title).toBeTruthy();
        expect(entry?.description).toBeTruthy();
        expect(entry?.h1).toBeTruthy();
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

  it('all non-English site pages have draft entries with reviewed: false and non-empty metadata', () => {
    const nonEnLocales: Locale[] = ['es', 'pt', 'de', 'fr', 'ja'];
    for (const [id, page] of Object.entries(sitePages)) {
      for (const loc of nonEnLocales) {
        const entry = page.locales[loc];
        expect(entry, `page ${id} should have draft entry for ${loc}`).toBeDefined();
        expect(entry?.reviewed, `page ${id} ${loc} must have reviewed: false`).toBe(false);
        expect(entry?.title).toBeTruthy();
        expect(entry?.description).toBeTruthy();
      }
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

  it('supports per-item and per-locale approval and translated slugs: approved fixture builds and links while draft fixture emits no public route', () => {
    // 1. Approved fixture: simulates a tool approved in Spanish with a translated slug differing from English
    const approvedToolFixture: Tool = {
      id: 'compress-pdf',
      category: 'UtilitiesApplication',
      locales: createToolLocales('compress-pdf', 'compressPdf', {
        es: {
          path: '/es/comprimir-pdf/',
          reviewed: true,
        },
      }),
    };

    // 2. Draft fixture: standard unreviewed draft tool
    const draftToolFixture: Tool = {
      id: 'compress-pdf-to-100kb',
      category: 'UtilitiesApplication',
      locales: createToolLocales('compress-pdf-to-100kb', 'compressPdf100kb'),
    };

    // Verify approved fixture route decisions and review status
    expect(approvedToolFixture.locales.en?.reviewed).toBe(true);
    expect(approvedToolFixture.locales.en?.path).toBe('/compress-pdf/');
    expect(approvedToolFixture.locales.es?.reviewed).toBe(true);
    // Translated slug differs from the English slug
    expect(approvedToolFixture.locales.es?.path).toBe('/es/comprimir-pdf/');
    expect(approvedToolFixture.locales.es?.path).not.toBe(`/${'es'}/${approvedToolFixture.id}/`);
    // Other non-English locales remain draft with reviewed: false
    expect(approvedToolFixture.locales.de?.reviewed).toBe(false);
    expect(approvedToolFixture.locales.pt?.reviewed).toBe(false);
    expect(approvedToolFixture.locales.fr?.reviewed).toBe(false);
    expect(approvedToolFixture.locales.ja?.reviewed).toBe(false);

    // Published tool locales only includes reviewed entries (en and es)
    const approvedPublished = publishedToolLocales(approvedToolFixture);
    expect(approvedPublished.map(([loc]) => loc)).toEqual(['en', 'es']);
    expect(approvedPublished.map(([, entry]) => entry.path)).toEqual([
      '/compress-pdf/',
      '/es/comprimir-pdf/',
    ]);

    // Verify draft fixture: only English is published
    expect(draftToolFixture.locales.en?.reviewed).toBe(true);
    expect(draftToolFixture.locales.es?.reviewed).toBe(false);
    expect(draftToolFixture.locales.es?.path).toBe('/es/compress-pdf-to-100kb/');
    const draftPublished = publishedToolLocales(draftToolFixture);
    expect(draftPublished.map(([loc]) => loc)).toEqual(['en']);

    // The real route builder used by src/pages/[...path].astro, fed only the two fixtures.
    const generatedPaths = buildStaticPaths({
      allowDrafts: false,
      tools: { approved: approvedToolFixture, draft: draftToolFixture },
      pages: {},
    });

    // Only 3 routes: both English pages plus the approved Spanish page at its translated slug.
    // Nothing for the draft's non-English entries or the approved tool's de/pt/fr/ja entries.
    expect(generatedPaths.map(route => [route.params.path, route.props.locale])).toEqual([
      ['compress-pdf', 'en'],
      ['es/comprimir-pdf', 'es'],
      ['compress-pdf-to-100kb', 'en'],
    ]);
    expect(generatedPaths[1].props.entry).toBe(approvedToolFixture.locales.es);

    // Verify link switcher / alternate generation:
    // Only published routes are exposed in switcher / alternates
    const alternatesForApproved: Partial<Record<Locale, string>> = {};
    for (const [loc, entry] of publishedToolLocales(approvedToolFixture)) {
      alternatesForApproved[loc] = entry.path;
    }
    expect(alternatesForApproved).toEqual({
      en: '/compress-pdf/',
      es: '/es/comprimir-pdf/',
    });
    expect(alternatesForApproved.de).toBeUndefined();
    expect(alternatesForApproved.ja).toBeUndefined();

    // Verify sitePage fixture with custom translated slug
    const approvedPageFixture: SitePage = {
      id: 'about',
      locales: createPageLocales((loc) => loc === 'en' ? '/about/' : `/${loc}/about/`, 'about', {
        es: {
          path: '/es/acerca-de/',
          reviewed: true,
        },
      }),
    };
    const publishedPages = publishedPageLocales(approvedPageFixture);
    expect(publishedPages.map(([loc]) => loc)).toEqual(['en', 'es']);
    expect(publishedPages.map(([, entry]) => entry.path)).toEqual(['/about/', '/es/acerca-de/']);
  });

  it('arranges localized 404 generation so a reviewed locale outputs /{locale}/404.html while drafts emit no public file', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const os = await import('node:os');
    const { pathToFileURL } = await import('node:url');
    const { localized404Integration } = await import('../../astro.config.mjs');

    // 1. Verify that in current Phase 2, drafts have reviewed: false and are excluded from published
    expect(sitePages.notFound.locales.es?.reviewed).toBe(false);
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

  it('production routes contain only reviewed English pages; the draft preview adds every locale', () => {
    const production = buildStaticPaths({ allowDrafts: false });
    expect(production.every(route => route.props.locale === 'en')).toBe(true);
    // 19 tools + home, about, contact, privacy, terms (English 404 is src/pages/404.astro).
    expect(production).toHaveLength(Object.keys(tools).length + 5);
    expect(production.find(route => route.params.path === undefined)?.props.kind).toBe('page');

    const preview = buildStaticPaths({ allowDrafts: true });
    expect(preview.filter(route => route.props.locale === 'ja')).toHaveLength(Object.keys(tools).length + 6);
    expect(preview.some(route => route.params.path === 'ja/404')).toBe(true);
    expect(preview.some(route => route.params.path === 'ja')).toBe(true);
  });

  it('rejects two entries that resolve to the same URL', () => {
    const clash: Tool = {
      id: 'compress-pdf',
      category: 'UtilitiesApplication',
      locales: createToolLocales('compress-pdf', 'compressPdf', { es: { path: '/compress-pdf/', reviewed: true } }),
    };
    expect(() => buildStaticPaths({ allowDrafts: false, tools: { clash }, pages: {} })).toThrow(/Duplicate route: \/compress-pdf/);
  });
});

