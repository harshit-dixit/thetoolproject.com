// Tip calculator: parsing typed amounts and working out the tip, total and each person's share.
// Money is handled in the currency's minor unit (cents), so 0.1 + 0.2 never shows up on a bill.

export type TipBase = 'bill' | 'preTax';

export type TipInput = {
  /** The amount on the bill, tax included. */
  bill: number;
  /** Tax on the bill. Only used when the tip is on the amount before tax. */
  tax: number;
  tipPercent: number;
  people: number;
  tipOn: TipBase;
  /** Round each share up to this many major units (1 = the next whole dollar). 0 keeps cents. */
  roundTo: number;
  /** Decimal places of the currency: 2 for USD, 0 for JPY. */
  digits: number;
};

export type TipResult = {
  /** The amount the tip is worked out on. */
  base: number;
  tip: number;
  /** Added by rounding each share up. */
  rounding: number;
  /** What the group pays in all: bill + tip + rounding. */
  total: number;
  perPerson: number;
  tipPerPerson: number;
  /** Tip plus rounding as a share of the base, e.g. 0.212. */
  effectiveRate: number;
};

export type TipError = 'taxTooHigh';

export const MAX_PEOPLE = 100;
export const MAX_PERCENT = 100;

/** How many decimals a currency uses (JPY 0, USD 2, KWD 3). */
export function currencyDigits(currency: string): number {
  return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
}

/** The currency sign the page language uses, and whether it goes after the number ("12,50 €"). */
export function currencyAffix(locale: string, currency: string): { symbol: string; suffix: boolean } {
  const parts = new Intl.NumberFormat(locale, { style: 'currency', currency }).formatToParts(1);
  const sign = parts.findIndex(part => part.type === 'currency');
  return { symbol: parts[sign]?.value ?? currency, suffix: sign > parts.findIndex(part => part.type === 'integer') };
}

function separators(locale: string) {
  const parts = new Intl.NumberFormat(locale).formatToParts(1234567.5);
  return { group: parts.find(part => part.type === 'group')?.value ?? ',', decimal: parts.find(part => part.type === 'decimal')?.value ?? '.' };
}

/**
 * Reads an amount the way people type it: "48.50", "48,50", "1,234.56", "1.234,56", "$ 20".
 * Returns undefined for an empty field and NaN for text that isn't a number.
 * A single "," or "." is a decimal point, unless exactly three digits follow it and it's the
 * page language's thousands separator, so "1,500" is 1500 in English and "1.500" is 1500 in German.
 */
export function parseAmount(text: string, locale = 'en'): number | undefined {
  // A currency sign or code before or after the number, spaces (including the narrow no-break space French uses) and Swiss apostrophes.
  const cleaned = text.normalize('NFKC').replace(/[\s  '’]/g, '').replace(CURRENCY_BEFORE, '').replace(CURRENCY_AFTER, '');
  if (!text.trim()) return undefined;
  // Anything else, like "abc30000", isn't an amount.
  if (/[^\d.,-]/.test(cleaned)) return Number.NaN;
  if (!/\d/.test(cleaned) || /-/.test(cleaned) || /[.,]{2}/.test(cleaned)) return Number.NaN;
  const marks = cleaned.match(/[.,]/g) ?? [];
  const mark = marks[0] ?? '';
  let normalized = cleaned;
  if (new Set(marks).size === 2) {
    // Both kinds: whichever comes last is the decimal point.
    const decimal = cleaned.lastIndexOf('.') > cleaned.lastIndexOf(',') ? '.' : ',';
    const [whole = '', fraction = '', ...rest] = cleaned.split(decimal);
    if (rest.length) return Number.NaN;
    normalized = `${whole.replace(/[.,]/g, '')}.${fraction}`;
  } else if (marks.length > 1) {
    // One kind, used more than once: thousands separators.
    const groups = cleaned.split(mark);
    if (groups.slice(1).some(group => group.length !== 3)) return Number.NaN;
    normalized = groups.join('');
  } else if (marks.length === 1) {
    const [whole = '', fraction = ''] = cleaned.split(mark);
    const isGroup = fraction.length === 3 && whole.length > 0 && mark === separators(locale).group;
    normalized = isGroup ? whole + fraction : `${whole || '0'}.${fraction}`;
  }
  const value = Number(normalized);
  return Number.isFinite(value) ? value : Number.NaN;
}

const toMinor = (value: number, digits: number) => Math.round(value * 10 ** digits);
const toMajor = (value: number, digits: number) => value / 10 ** digits;
// Rounds half up, ignoring floating-point noise such as 682.4999999.
const roundHalfUp = (value: number) => Math.round(Number(value.toFixed(6)));

export function calculateTip(input: TipInput): { result: TipResult } | { error: TipError } {
  const { digits } = input;
  const people = Math.min(MAX_PEOPLE, Math.max(1, Math.floor(input.people) || 1));
  const bill = toMinor(Math.max(0, input.bill), digits);
  const tax = input.tipOn === 'preTax' ? toMinor(Math.max(0, input.tax), digits) : 0;
  if (tax > bill) return { error: 'taxTooHigh' };
  const base = bill - tax;
  const tip = roundHalfUp((base * Math.min(MAX_PERCENT, Math.max(0, input.tipPercent))) / 100);
  const exact = bill + tip;
  // Shares are rounded up, never down, so together they always cover the bill.
  let share = Math.ceil(exact / people);
  const step = input.roundTo > 0 ? toMinor(input.roundTo, digits) : 0;
  if (step > 0) share = Math.ceil(share / step) * step;
  const total = share * people;
  const rounding = total - exact;
  return {
    result: {
      base: toMajor(base, digits),
      tip: toMajor(tip, digits),
      rounding: toMajor(rounding, digits),
      total: toMajor(total, digits),
      perPerson: toMajor(share, digits),
      tipPerPerson: toMajor(roundHalfUp(tip / people), digits),
      effectiveRate: base > 0 ? (tip + rounding) / base : 0,
    },
  };
}

/** Rounding choices for a currency: whole units for cents-based currencies, larger steps for yen and won. */
export function roundingSteps(digits: number): number[] {
  return digits > 0 ? [1, 5, 10] : [10, 100, 1000];
}

// The page language's currency, used when the visitor's region isn't in this list.
// Keys are the region part of navigator.language (en-GB -> GB).
export const regionCurrencies: Record<string, string> = {
  US: 'USD', CA: 'CAD', GB: 'GBP', IE: 'EUR', AU: 'AUD', NZ: 'NZD', IN: 'INR', SG: 'SGD', PH: 'PHP', ZA: 'ZAR', NG: 'NGN', AE: 'AED',
  MX: 'MXN', AR: 'ARS', CO: 'COP', CL: 'CLP', PE: 'PEN', ES: 'EUR', BR: 'BRL', PT: 'EUR', DE: 'EUR', AT: 'EUR', CH: 'CHF',
  FR: 'EUR', BE: 'EUR', LU: 'EUR', NL: 'EUR', IT: 'EUR', JP: 'JPY', KR: 'KRW', CN: 'CNY', HK: 'HKD', SE: 'SEK', NO: 'NOK', DK: 'DKK', PL: 'PLN',
};

/** Currencies offered in the picker, in this order. */
export const currencies = [
  'USD', 'EUR', 'GBP', 'CAD', 'AUD', 'NZD', 'INR', 'JPY', 'MXN', 'BRL', 'ARS', 'CLP', 'COP', 'PEN', 'CHF',
  'SGD', 'PHP', 'ZAR', 'NGN', 'AED', 'KRW', 'CNY', 'HKD', 'SEK', 'NOK', 'DKK', 'PLN',
] as const;

// What parseAmount skips before or after the number: a currency sign, maybe after a few letters (R$, US$, HK$),
// one of the codes above, the kr, zł and R written for some of them, 円 or 元, or a percent sign.
const CURRENCY_MARK = String.raw`(?:[A-Za-z]{0,3}\p{Sc}|${currencies.join('|')}|kr|zł|R|[円元%])`;
const CURRENCY_BEFORE = new RegExp(`^${CURRENCY_MARK}`, 'iu');
const CURRENCY_AFTER = new RegExp(`${CURRENCY_MARK}$`, 'iu');

/** The currency for a browser language tag such as "en-GB", if its region is known. */
export function currencyForLanguage(tag: string): string | undefined {
  try {
    const region = new Intl.Locale(tag).maximize().region;
    // maximize() guesses a region for a bare "es" or "pt"; only trust a region the visitor actually set.
    if (!region || !/[-_]/.test(tag)) return undefined;
    return regionCurrencies[region];
  } catch {
    return undefined;
  }
}
