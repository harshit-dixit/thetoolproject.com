import { describe, expect, it } from 'vitest';
import { calculateTip, currencyDigits, currencyForLanguage, parseAmount, type TipInput } from './tip-calculator';

const input = (overrides: Partial<TipInput>): TipInput => ({ bill: 0, tax: 0, tipPercent: 20, people: 1, tipOn: 'bill', roundTo: 0, digits: 2, ...overrides });
const result = (overrides: Partial<TipInput>) => {
  const outcome = calculateTip(input(overrides));
  if (!('result' in outcome)) throw new Error(`Unexpected error: ${outcome.error}`);
  return outcome.result;
};

describe('parseAmount', () => {
  it('reads plain and decimal amounts', () => {
    expect(parseAmount('48')).toBe(48);
    expect(parseAmount('48.50')).toBe(48.5);
    expect(parseAmount('.5')).toBe(0.5);
    expect(parseAmount('12.')).toBe(12);
  });

  it('treats a comma with one or two digits after it as a decimal point in any language', () => {
    expect(parseAmount('48,50', 'en')).toBe(48.5);
    expect(parseAmount('48,5', 'de')).toBe(48.5);
  });

  it('reads thousands separators by the page language', () => {
    expect(parseAmount('1,500', 'en')).toBe(1500);
    expect(parseAmount('1.500', 'de')).toBe(1500);
    expect(parseAmount('1.500', 'en')).toBe(1.5);
    expect(parseAmount('1,234,567', 'en')).toBe(1234567);
  });

  it('uses the last separator as the decimal point when both appear', () => {
    expect(parseAmount('1,234.56', 'de')).toBe(1234.56);
    expect(parseAmount('1.234,56', 'en')).toBe(1234.56);
  });

  it('ignores currency signs and spaces, including French and Swiss grouping', () => {
    expect(parseAmount('$ 20')).toBe(20);
    expect(parseAmount('1 234,50 €', 'fr')).toBe(1234.5);
    expect(parseAmount("1'234.50", 'de')).toBe(1234.5);
    expect(parseAmount('１２００', 'ja')).toBe(1200);
    expect(parseAmount('R$ 1.500', 'pt')).toBe(1500);
    expect(parseAmount('USD 20')).toBe(20);
    expect(parseAmount('3000円', 'ja')).toBe(3000);
    expect(parseAmount('18%')).toBe(18);
  });

  it('returns undefined for an empty field and NaN for text that is not an amount', () => {
    expect(parseAmount('  ')).toBeUndefined();
    expect(parseAmount('abc')).toBeNaN();
    expect(parseAmount('-5')).toBeNaN();
    expect(parseAmount('1,23,4')).toBeNaN();
    expect(parseAmount('1..5')).toBeNaN();
    expect(parseAmount('abc30000')).toBeNaN();
    expect(parseAmount('30000abc')).toBeNaN();
    expect(parseAmount('30k')).toBeNaN();
    expect(parseAmount('3O000')).toBeNaN();
  });
});

describe('calculateTip', () => {
  it('works out the tip and total on the whole bill', () => {
    expect(result({ bill: 50 })).toMatchObject({ base: 50, tip: 10, total: 60, perPerson: 60, rounding: 0 });
  });

  it('rounds the tip half up to the cent', () => {
    // 45.50 × 15% = 6.825
    expect(result({ bill: 45.5, tipPercent: 15 }).tip).toBe(6.83);
    expect(result({ bill: 10.05, tipPercent: 10 }).tip).toBe(1.01);
  });

  it('tips on the amount before tax', () => {
    const r = result({ bill: 108.25, tax: 8.25, tipOn: 'preTax' });
    expect(r).toMatchObject({ base: 100, tip: 20, total: 128.25 });
  });

  it('ignores the tax field when tipping on the whole bill', () => {
    expect(result({ bill: 108.25, tax: 8.25 }).tip).toBe(21.65);
  });

  it('refuses tax larger than the bill', () => {
    expect(calculateTip(input({ bill: 10, tax: 12, tipOn: 'preTax' }))).toEqual({ error: 'taxTooHigh' });
  });

  it('rounds each share up to the cent so the shares cover the bill', () => {
    const r = result({ bill: 100, tipPercent: 0, people: 3 });
    expect(r.perPerson).toBe(33.34);
    expect(r.total).toBe(100.02);
    expect(r.rounding).toBeCloseTo(0.02);
  });

  it('rounds each share up to a whole step and counts the difference', () => {
    const r = result({ bill: 85, tipPercent: 18, people: 3, roundTo: 1 });
    // 85 + 15.30 = 100.30, 33.43 each, rounded up to 34.
    expect(r).toMatchObject({ tip: 15.3, perPerson: 34, total: 102 });
    expect(r.rounding).toBeCloseTo(1.7);
    expect(r.effectiveRate).toBeCloseTo(0.2);
  });

  it('splits yen without decimals and rounds to 100 yen', () => {
    const r = result({ bill: 10000, tipPercent: 0, people: 3, digits: 0, roundTo: 100 });
    expect(r).toMatchObject({ perPerson: 3400, total: 10200, rounding: 200 });
  });

  it('keeps people between 1 and 100, and the tip between 0% and 100%', () => {
    expect(result({ bill: 10, people: 0 }).perPerson).toBe(12);
    expect(result({ bill: 1000, people: 500, tipPercent: 0 }).perPerson).toBe(10);
    expect(result({ bill: 10, tipPercent: 250 }).tip).toBe(10);
    expect(result({ bill: 10, tipPercent: -5 }).tip).toBe(0);
  });

  it('gives a tip per person', () => {
    expect(result({ bill: 90, tipPercent: 20, people: 4 }).tipPerPerson).toBe(4.5);
  });
});

describe('currencies', () => {
  it('knows how many decimals each currency uses', () => {
    expect(currencyDigits('USD')).toBe(2);
    expect(currencyDigits('JPY')).toBe(0);
  });

  it('picks a currency only from a region the visitor set', () => {
    expect(currencyForLanguage('en-IN')).toBe('INR');
    expect(currencyForLanguage('es-MX')).toBe('MXN');
    expect(currencyForLanguage('pt-BR')).toBe('BRL');
    expect(currencyForLanguage('es')).toBeUndefined();
    expect(currencyForLanguage('en-001')).toBeUndefined();
    expect(currencyForLanguage('not a tag')).toBeUndefined();
  });
});
