import en from './en.json';
import { locales, type Locale } from '../data/tools';

export type TranslationKey = keyof typeof en;
const translations: Partial<Record<Locale, Record<TranslationKey, string>>> = { en };
export function t(key: TranslationKey, locale: Locale = 'en'): string { return (translations[locale] ?? en)[key]; }
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
