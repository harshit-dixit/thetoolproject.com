import type en from './en.json';
import { dictionaries, type Dictionary, type Locale } from './dictionaries';
import { htmlLang, locales } from './locales.mjs';

export type TranslationKey = keyof typeof en;

const loadedDictionaries: Partial<Record<Locale, Dictionary>> = { ...dictionaries };

/**
 * Replaces {token} placeholders. Every placeholder in the template must have a value, so a
 * forgotten parameter fails the build instead of rendering an empty gap.
 */
export function interpolate(template: string, values?: Record<string, string | number>): string {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (_, token: string) => {
    if (!(token in values)) throw new Error(`Missing value for {${token}} in "${template}"`);
    return String(values[token]);
  });
}

export function t(key: TranslationKey, locale: Locale = 'en', params?: Record<string, string | number>): string {
  const dict = loadedDictionaries[locale];
  if (!dict) throw new Error(`Translation dictionary not found for locale "${locale}"`);
  const val = dict[key];
  if (val === undefined || val === '') {
    throw new Error(`Missing translation for key "${key}" in locale "${locale}"`);
  }
  return interpolate(val, params);
}

/** The BCP 47 tag for <html lang> and hreflang (e.g. pt-BR for the /pt/ pages). */
export function langTag(locale: Locale): string {
  return htmlLang[locale];
}

export function getLocaleFromUrl(url: URL): Locale {
  const part = url.pathname.split('/')[1];
  return locales.find((locale) => locale !== 'en' && locale === part) ?? 'en';
}

export function formatNumber(value: number, locale: Locale = 'en', maximumFractionDigits = 0): string {
  return new Intl.NumberFormat(langTag(locale), { maximumFractionDigits }).format(value);
}

export function formatBytes(bytes: number, locale: Locale = 'en'): string {
  const unit = bytes >= 1048576 ? 'unit.mb' : bytes >= 1024 ? 'unit.kb' : 'unit.bytes';
  const amount = bytes >= 1048576 ? bytes / 1048576 : bytes >= 1024 ? bytes / 1024 : bytes;
  return `${formatNumber(amount, locale, unit === 'unit.bytes' ? 0 : 1)} ${t(unit, locale)}`;
}

export function counted(
  baseKey: string,
  count: number,
  locale: Locale = 'en',
  params?: Record<string, string | number>
): string {
  const rule = new Intl.PluralRules(langTag(locale)).select(count);
  const dict = loadedDictionaries[locale];
  if (!dict) throw new Error(`Translation dictionary not found for locale "${locale}"`);
  const template = dict[`${baseKey}.${rule}`] ?? dict[`${baseKey}.other`];
  if (!template) throw new Error(`Missing plural translation for key "${baseKey}" (${rule}) in locale "${locale}"`);
  return interpolate(template, { count: formatNumber(count, locale), ...params });
}

/** Test hook: registers or replaces a dictionary for a locale. */
export function registerLocaleDictionary(locale: Locale, dictionary: Dictionary): void {
  loadedDictionaries[locale] = dictionary;
}
