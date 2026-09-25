import { locales, type Locale } from './tools';
import { dictionaries } from '../i18n/dictionaries';

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

export type PageRouteOverride = {
  path?: string;
  reviewed?: boolean;
};
export type PageRouteOverrides = Partial<Record<Locale, PageRouteOverride>>;

export function createPageLocales(
  pathGen: (locale: Locale) => string,
  prefix: string,
  overrides?: PageRouteOverrides
): Record<Locale, PageLocale> {
  const result: Partial<Record<Locale, PageLocale>> = {};
  for (const locale of locales) {
    const d = dictionaries[locale];
    const defaultPath = pathGen(locale);
    const defaultReviewed = locale === 'en';
    const override = overrides?.[locale];
    result[locale] = {
      path: override?.path ?? defaultPath,
      title: d[`${prefix}.title`],
      description: d[`${prefix}.description`],
      reviewed: override?.reviewed ?? defaultReviewed,
    };
  }
  return result as Record<Locale, PageLocale>;
}

export const sitePages: Record<SitePageId, SitePage> = {
  home: {
    id: 'home',
    locales: createPageLocales((locale) => (locale === 'en' ? '/' : `/${locale}/`), 'home'),
  },
  about: {
    id: 'about',
    locales: createPageLocales((locale) => (locale === 'en' ? '/about/' : `/${locale}/about/`), 'about'),
  },
  contact: {
    id: 'contact',
    locales: createPageLocales((locale) => (locale === 'en' ? '/contact/' : `/${locale}/contact/`), 'contact'),
  },
  privacy: {
    id: 'privacy',
    locales: createPageLocales((locale) => (locale === 'en' ? '/privacy/' : `/${locale}/privacy/`), 'privacy'),
  },
  terms: {
    id: 'terms',
    locales: createPageLocales((locale) => (locale === 'en' ? '/terms/' : `/${locale}/terms/`), 'terms'),
  },
  notFound: {
    id: 'notFound',
    locales: createPageLocales((locale) => (locale === 'en' ? '/404.html' : `/${locale}/404.html`), 'notFound'),
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
  throw new Error(`Page ${pageId} has no published route`);
}
