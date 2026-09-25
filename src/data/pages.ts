import { type Locale } from './tools';

export type PageLocale = {
  path: string;
  title: string;
  description: string;
  reviewed: boolean;
};

export type SitePageId = 'home' | 'about' | 'contact' | 'privacy' | 'terms' | 'notFound';

export type SitePage = {
  id: SitePageId;
  locales: Partial<Record<Locale, PageLocale>>;
};

export const sitePages: Record<SitePageId, SitePage> = {
  home: {
    id: 'home',
    locales: {
      en: {
        path: '/',
        title: 'Free, open source file tools | thetoolproject',
        description: 'Convert CSV to JSON, JSON to HTML, Excel or CSV, XML to JSON or CSV, and spreadsheets to CSV in your browser. Free, open source tools that keep your files on your device.',
        reviewed: true,
      },
    },
  },
  about: {
    id: 'about',
    locales: {
      en: {
        path: '/about/',
        title: 'About us | thetoolproject',
        description: 'Learn why thetoolproject makes free, open source browser tools and how you can help improve them.',
        reviewed: true,
      },
    },
  },
  contact: {
    id: 'contact',
    locales: {
      en: {
        path: '/contact/',
        title: 'Contact us | thetoolproject',
        description: 'Contact thetoolproject about a tool, a bug, or a question. Email us or open a GitHub issue.',
        reviewed: true,
      },
    },
  },
  privacy: {
    id: 'privacy',
    locales: {
      en: {
        path: '/privacy/',
        title: 'Privacy policy | thetoolproject',
        description: 'How thetoolproject handles files, contact emails, and basic website request data.',
        reviewed: true,
      },
    },
  },
  terms: {
    id: 'terms',
    locales: {
      en: {
        path: '/terms/',
        title: 'Terms of use | thetoolproject',
        description: "Terms for using thetoolproject's free browser tools, guides, and open source code.",
        reviewed: true,
      },
    },
  },
  notFound: {
    id: 'notFound',
    locales: {
      en: {
        path: '/404/',
        title: "This page doesn't exist | thetoolproject",
        description: 'The page you requested could not be found. Browse the available tools.',
        reviewed: true,
      },
    },
  },
};

export function publishedPageLocales(page: SitePage): [Locale, PageLocale][] {
  return Object.entries(page.locales).filter((entry): entry is [Locale, PageLocale] => !!entry[1]?.reviewed);
}

export function getPublishedHomePath(locale: Locale): string | undefined {
  const entry = sitePages.home.locales[locale];
  return entry?.reviewed ? entry.path : undefined;
}

export function getPublishedPagePath(pageId: SitePageId, locale: Locale): string {
  const page = sitePages[pageId];
  const localized = page.locales[locale];
  if (localized?.reviewed) return localized.path;
  const english = page.locales.en;
  if (english?.reviewed) return english.path;
  return '/';
}
