import type { Locale } from '../i18n/dictionaries';

// Average US auto loan rates (APR, %) by credit score (VantageScore 4.0), from Experian's State of the Automotive
// Finance Market, Q2 2026, checked September 2026:
// https://www.experian.com/blogs/ask-experian/average-car-loan-interest-rates-by-credit-score/
// The English page offers them in the rate list and starts at the average rate for a new car.
export const usRateTiers = ['superPrime', 'prime', 'nearPrime', 'subprime', 'deepSubprime'] as const;
export type RateTier = (typeof usRateTiers)[number];
export const usRates: Record<'new' | 'used', Record<RateTier | 'all', number>> = {
  new: { all: 6.35, superPrime: 4.41, prime: 6.15, nearPrime: 9.71, subprime: 13.52, deepSubprime: 16.11 },
  used: { all: 11.19, superPrime: 6.29, prime: 8.81, nearPrime: 13.93, subprime: 19.1, deepSubprime: 21.62 },
};

// Average US auto loans in Q2 2026 (Experian, same report), for the "Average car payment" table:
// https://www.experian.com/blogs/ask-experian/average-car-payment/
export const usAverages = {
  payment: { new: 765, used: 542 },
  financed: { new: 43610, used: 27852 },
  months: { new: 69.5, used: 67.9 },
} as const;

// Per-language starting values for the auto loan calculator. They're numbers, so they live here rather than in the
// translation files, where the checker requires every number in the English copy to appear in each translation.
// The visitor's own region can still change the currency (see currencyForLanguage in lib/tip-calculator.ts).
// `apr` is left out where there's no sourced average to start from: the visitor types their own rate.
export type AutoLoanDefaults = { currency: string; months: number; apr?: number; usRates: boolean };

export const autoLoanDefaults: Record<Locale, AutoLoanDefaults> = {
  en: { currency: 'USD', months: 60, apr: usRates.new.all, usRates: true },
  es: { currency: 'EUR', months: 60, usRates: false },
  pt: { currency: 'BRL', months: 48, usRates: false },
  de: { currency: 'EUR', months: 60, usRates: false },
  fr: { currency: 'EUR', months: 60, usRates: false },
  ja: { currency: 'JPY', months: 60, usRates: false },
};
