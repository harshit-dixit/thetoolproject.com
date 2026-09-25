import en from './en.json';
import { locales, type Locale } from '../data/tools';

export type TranslationKey = keyof typeof en;

// Eagerly load all present locale dictionaries in src/i18n/*.json
const loadedDictionaries: Partial<Record<Locale, Record<string, string>>> = { en };

try {
  const modules = import.meta.glob<{ default: Record<string, string> }>('./*.json', { eager: true });
  for (const [path, mod] of Object.entries(modules)) {
    const match = path.match(/([a-z]{2})\.json$/);
    if (match) {
      const code = match[1] as Locale;
      if (locales.includes(code)) {
        loadedDictionaries[code] = mod.default;
      }
    }
  }
} catch {
  // Fallback if import.meta.glob is unavailable
}

export function interpolate(template: string, values?: Record<string, string | number>): string {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (_, token: string) => String(values[token] ?? ''));
}

export function t(key: TranslationKey, locale: Locale = 'en', params?: Record<string, string | number>): string {
  const dict = loadedDictionaries[locale];
  if (!dict) {
    if (locale === 'en') return interpolate(en[key], params);
    throw new Error(`Translation dictionary not found for locale "${locale}"`);
  }
  const val = dict[key];
  if (val === undefined || val === '') {
    throw new Error(`Missing translation for key "${key}" in locale "${locale}"`);
  }
  return interpolate(val, params);
}

export function getLocaleFromUrl(url: URL): Locale {
  const part = url.pathname.split('/')[1];
  return locales.find((locale) => locale !== 'en' && locale === part) ?? 'en';
}

export function formatNumber(value: number, locale: Locale = 'en', maximumFractionDigits = 0): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits }).format(value);
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
  const rule = new Intl.PluralRules(locale).select(count);
  const specificKey = `${baseKey}.${rule}` as TranslationKey;
  const otherKey = `${baseKey}.other` as TranslationKey;
  const dict = loadedDictionaries[locale] ?? (locale === 'en' ? en : undefined);
  if (!dict) throw new Error(`Translation dictionary not found for locale "${locale}"`);
  const template = dict[specificKey] ?? dict[otherKey];
  if (!template) throw new Error(`Missing plural translation for key "${baseKey}" (${rule}) in locale "${locale}"`);
  return interpolate(template, { count: formatNumber(count, locale), ...params });
}

export function registerLocaleDictionary(locale: Locale, dictionary: Record<string, string>): void {
  loadedDictionaries[locale] = dictionary;
}
