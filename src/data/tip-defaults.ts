import type { Locale } from '../i18n/dictionaries';

// Per-language starting values for the tip calculator. They're numbers, so they live here rather than in the
// translation files, where the checker requires every number in the English copy to appear in each translation.
// The visitor's own region can still change the currency (see currencyForLanguage in lib/tip-calculator.ts).
export type TipDefaults = { currency: string; presets: number[]; tip: number };

export const tipDefaults: Record<Locale, TipDefaults> = {
  // US norms: 15–20% at a sit-down restaurant, 20% the most common.
  en: { currency: 'USD', presets: [15, 18, 20, 25], tip: 20 },
  // Spain and Latin America: small tips, often rounding up.
  es: { currency: 'EUR', presets: [0, 5, 10, 15], tip: 10 },
  // Brazil: a 10% service charge is often on the bill already.
  pt: { currency: 'BRL', presets: [0, 5, 10, 15], tip: 10 },
  de: { currency: 'EUR', presets: [0, 5, 10, 15], tip: 10 },
  fr: { currency: 'EUR', presets: [0, 5, 10, 15], tip: 5 },
  // Japan: tipping isn't customary, so the Japanese page is a bill splitter with an optional tip.
  ja: { currency: 'JPY', presets: [0, 5, 10, 15, 20], tip: 0 },
};
