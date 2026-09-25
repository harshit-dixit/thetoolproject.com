import { tools as allTools, publishedToolLocales, type Locale, type Tool, type ToolLocale } from './tools';
import { sitePages as allPages, publishedPageLocales, type PageLocale, type SitePage, type SitePageId } from './pages';

export type RouteProps =
  | { kind: 'tool'; locale: Locale; entry: ToolLocale; tool: Tool }
  | { kind: 'page'; locale: Locale; entry: PageLocale; page: SitePage };

export type StaticRoute = { params: { path: string | undefined }; props: RouteProps };

type Options = {
  /** Include unreviewed drafts. Only ever true for an opt-in dev preview. */
  allowDrafts: boolean;
  tools?: Record<string, Tool>;
  pages?: Partial<Record<SitePageId, SitePage>>;
};

const toParam = (path: string) => path.replace(/^\/|\/$/g, '') || undefined;

/** Static routes for the catch-all page: reviewed tool and site pages, plus drafts when allowed. */
export function buildStaticPaths({ allowDrafts, tools = allTools, pages = allPages }: Options): StaticRoute[] {
  const toolRoutes = Object.values(tools).flatMap((tool) => {
    const list = allowDrafts ? (Object.entries(tool.locales) as [Locale, ToolLocale][]) : publishedToolLocales(tool);
    return list.map(([locale, entry]): StaticRoute => ({
      params: { path: toParam(entry.path) },
      props: { kind: 'tool', locale, entry, tool },
    }));
  });

  const pageRoutes = Object.values(pages).filter((page): page is SitePage => !!page).flatMap((page) => {
    const list = allowDrafts ? (Object.entries(page.locales) as [Locale, PageLocale][]) : publishedPageLocales(page);
    return list
      // English 404 is src/pages/404.astro. Localized ones are emitted as /{locale}/404/ and
      // moved to /{locale}/404.html by the localized-404 integration in astro.config.mjs.
      .filter(([locale]) => !(page.id === 'notFound' && locale === 'en'))
      .map(([locale, entry]): StaticRoute => ({
        params: { path: page.id === 'notFound' ? `${locale}/404` : toParam(entry.path) },
        props: { kind: 'page', locale, entry, page },
      }));
  });

  const routes = [...toolRoutes, ...pageRoutes];
  const seen = new Set<string | undefined>();
  for (const route of routes) {
    if (seen.has(route.params.path)) throw new Error(`Duplicate route: /${route.params.path ?? ''}`);
    seen.add(route.params.path);
  }
  return routes;
}
