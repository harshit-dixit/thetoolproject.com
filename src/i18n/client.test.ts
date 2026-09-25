import { describe, expect, it } from 'vitest';
import { createI18n, interpolate } from './client';

const units = { 'unit.bytes': 'bytes', 'unit.kb': 'KB', 'unit.mb': 'MB' };
const rows = { 'tool.rows.one': '{count} row', 'tool.rows.other': '{count} rows' };

describe('client i18n', () => {
  it('translates and interpolates', () => {
    const { t } = createI18n({ greet: 'Hello {name}, {name}!' });
    expect(t('greet', { name: 'Ada' })).toBe('Hello Ada, Ada!');
  });

  it('throws on a missing key instead of returning the key name', () => {
    const { t } = createI18n({});
    expect(() => t('csvSql.errEmpty')).toThrow('Missing translation key "csvSql.errEmpty"');
  });

  it('throws on a missing parameter instead of leaving a gap', () => {
    const { t } = createI18n({ note: 'Showing {shown} of {total}' });
    expect(() => t('note', { shown: 1 })).toThrow('Missing parameter "total" for translation key "note"');
    expect(() => t('note')).toThrow(/Missing parameter "shown"/);
    expect(() => interpolate('{a}', {}, 'k')).toThrow(/"a"/);
  });

  it('allows empty-string parameters', () => {
    const { t } = createI18n({ note: 'A{extra}B' });
    expect(t('note', { extra: '' })).toBe('AB');
  });

  it('selects plural forms with Intl.PluralRules', () => {
    const en = createI18n(rows, 'en');
    expect(en.counted('tool.rows', 1)).toBe('1 row');
    expect(en.counted('tool.rows', 0)).toBe('0 rows');
    expect(en.counted('tool.rows', 1234)).toBe('1,234 rows');
  });

  it('uses the French "one" form for 0 and falls back to "other" for "many"', () => {
    const fr = createI18n({ 'tool.rows.one': '{count} ligne', 'tool.rows.other': '{count} lignes' }, 'fr');
    expect(fr.counted('tool.rows', 0)).toBe('0 ligne');
    expect(fr.counted('tool.rows', 1)).toBe('1 ligne');
    // 1,000,000 is CLDR "many" in French; there is no .many key, so .other is used.
    expect(new Intl.PluralRules('fr').select(1000000)).toBe('many');
    expect(fr.counted('tool.rows', 1000000)).toBe(`${new Intl.NumberFormat('fr').format(1000000)} lignes`);
  });

  it('uses the "other" form for Japanese', () => {
    const ja = createI18n({ 'tool.rows.one': '{count}行(one)', 'tool.rows.other': '{count}行' }, 'ja');
    expect(ja.counted('tool.rows', 1)).toBe('1行');
  });

  it('passes extra parameters to plural strings', () => {
    const { counted } = createI18n({ 'x.one': '{count} of {limit}', 'x.other': '{count} of {limit}s' });
    expect(counted('x', 2, { limit: 5 })).toBe('2 of 5s');
    expect(() => counted('missing', 2)).toThrow(/missing\.other/);
  });

  it('formats bytes with one consistent policy', () => {
    const en = createI18n(units, 'en');
    expect(en.formatBytes(0)).toBe('0 bytes');
    expect(en.formatBytes(1023)).toBe('1,023 bytes');
    expect(en.formatBytes(1024)).toBe('1 KB');
    expect(en.formatBytes(1536)).toBe('1.5 KB');
    expect(en.formatBytes(102400)).toBe('100 KB');
    expect(en.formatBytes(5 * 1048576 + 300000)).toBe('5.3 MB');
    const de = createI18n({ ...units, 'unit.bytes': 'Byte' }, 'de');
    expect(de.formatBytes(1536)).toBe('1,5 KB');
  });

  it('formats locale numbers and percentages', () => {
    expect(createI18n({}, 'de').formatNumber(1234.5)).toBe('1.234,5');
    expect(createI18n({}, 'en').formatPercent(0.45)).toBe('45%');
    expect(createI18n({}, 'fr').formatPercent(0.45)).toMatch(/^45\s%$/);
  });
});
