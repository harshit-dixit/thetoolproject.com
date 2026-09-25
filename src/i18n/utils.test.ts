import { describe, it, expect } from 'vitest';
import {
  t,
  interpolate,
  formatNumber,
  formatBytes,
  counted,
  registerLocaleDictionary,
  getLocaleFromUrl,
  langTag
} from './utils';

describe('i18n utils', () => {
  it('interpolates template tokens correctly', () => {
    expect(interpolate('Hello {name}!', { name: 'World' })).toBe('Hello World!');
    expect(interpolate('{count} items found', { count: 42 })).toBe('42 items found');
    expect(interpolate('No params')).toBe('No params');
    expect(() => interpolate('Missing {param}', {})).toThrow(/Missing value for {param}/);
  });

  it('translates English keys correctly', () => {
    expect(t('brand', 'en')).toBe('thetoolproject');
    expect(t('guide.updated', 'en', { date: '2026-09-25' })).toBe('Last updated 2026-09-25');
  });

  it('throws for missing non-English dictionaries', () => {
    expect(() => t('brand', 'it' as any)).toThrow(/Translation dictionary not found for locale "it"/);
  });

  it('throws for missing keys in a registered non-English dictionary', () => {
    registerLocaleDictionary('it' as any, { 'brand': 'thetoolproject' });
    expect(t('brand', 'it' as any)).toBe('thetoolproject');
    expect(() => t('home.title', 'it' as any)).toThrow(/Missing translation for key "home.title" in locale "it"/);
  });

  it('formats numbers according to locale', () => {
    expect(formatNumber(1234.56, 'en', 2)).toBe('1,234.56');
    expect(formatNumber(1234.56, 'de', 2)).toBe('1.234,56');
  });

  it('formats bytes according to locale and units', () => {
    expect(formatBytes(500, 'en')).toBe('500 bytes');
    expect(formatBytes(2048, 'en')).toBe('2 KB');
    expect(formatBytes(5 * 1024 * 1024, 'en')).toBe('5 MB');
  });

  it('formats plural forms using counted()', () => {
    expect(counted('tool.rows', 1, 'en')).toBe('1 row');
    expect(counted('tool.rows', 5, 'en')).toBe('5 rows');
  });

  it('maps locales to BCP 47 tags for lang and hreflang', () => {
    expect(langTag('pt')).toBe('pt-BR');
    expect(langTag('ja')).toBe('ja');
    expect(formatNumber(1234.5, 'pt', 1)).toBe('1.234,5');
  });

  it('extracts locale from URL', () => {
    expect(getLocaleFromUrl(new URL('https://thetoolproject.com/'))).toBe('en');
    expect(getLocaleFromUrl(new URL('https://thetoolproject.com/compress-pdf/'))).toBe('en');
    expect(getLocaleFromUrl(new URL('https://thetoolproject.com/es/compress-pdf/'))).toBe('es');
    expect(getLocaleFromUrl(new URL('https://thetoolproject.com/ja/'))).toBe('ja');
  });
});
