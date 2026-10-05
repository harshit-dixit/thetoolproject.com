import type { Locale } from '../i18n/dictionaries';
import type { PayBasis, Period, SalaryPeriod } from '../lib/overtime';

// Per-language starting values for the overtime calculator. They're numbers, so they live here rather than in the
// translation files, where the checker requires every number in the English copy to appear in each translation.
// The visitor's own region can still change the currency (see currencyForLanguage in lib/tip-calculator.ts).
// - en: the FLSA's time and a half over 40 hours a week, and the US "no tax on overtime" panel.
// - pt: Brazilian practice, a monthly salary over 220 hours (44 a week) at the constitutional minimum of +50%.
// - fr: the 35-hour week at +25%, the Code du travail rate for the first 8 overtime hours.
// - ja: a monthly salary at the Labor Standards Act's +25%. 160 hours is a starting value to change, not a legal figure.
// - es, de: neither law sets one premium, so 1.5 and 1.25 are only starting values to change.
export type OvertimeDefaults = {
  currency: string;
  basis: PayBasis;
  salaryPeriod: SalaryPeriod;
  period: Period;
  regularHours: number;
  multiplier: number;
  /** The overtime rate chips, as multipliers. */
  multipliers: number[];
  secondMultiplier: number;
  usTax: boolean;
  /** Hourly rates for the "How much is overtime pay" table, in the page currency. */
  tableRates: number[];
};

export const overtimeDefaults: Record<Locale, OvertimeDefaults> = {
  en: { currency: 'USD', basis: 'hourly', salaryPeriod: 'year', period: 'week', regularHours: 40, multiplier: 1.5, multipliers: [1.5, 2], secondMultiplier: 2, usTax: true, tableRates: [15, 18, 20, 22, 25, 30, 40, 50] },
  es: { currency: 'EUR', basis: 'hourly', salaryPeriod: 'month', period: 'week', regularHours: 40, multiplier: 1.5, multipliers: [1.25, 1.5, 2], secondMultiplier: 2, usTax: false, tableRates: [10, 12, 15, 18, 20, 25, 30] },
  pt: { currency: 'BRL', basis: 'salary', salaryPeriod: 'month', period: 'month', regularHours: 220, multiplier: 1.5, multipliers: [1.5, 2], secondMultiplier: 2, usTax: false, tableRates: [10, 15, 20, 25, 30, 40, 50] },
  de: { currency: 'EUR', basis: 'hourly', salaryPeriod: 'month', period: 'week', regularHours: 40, multiplier: 1.25, multipliers: [1.25, 1.5, 2], secondMultiplier: 1.5, usTax: false, tableRates: [14, 15, 18, 20, 25, 30, 40] },
  fr: { currency: 'EUR', basis: 'hourly', salaryPeriod: 'month', period: 'week', regularHours: 35, multiplier: 1.25, multipliers: [1.25, 1.5, 2], secondMultiplier: 1.5, usTax: false, tableRates: [12, 15, 18, 20, 25, 30, 40] },
  ja: { currency: 'JPY', basis: 'salary', salaryPeriod: 'month', period: 'month', regularHours: 160, multiplier: 1.25, multipliers: [1.25, 1.35, 1.5], secondMultiplier: 1.5, usTax: false, tableRates: [1000, 1100, 1200, 1500, 2000, 2500, 3000] },
};

// The "Overtime rules by country" table, the same on every page. Each rule is a translation key
// (overtime.rules.{country}) with a link to the law or the government page it comes from, checked October 2026.
export const overtimeRuleCountries = ['US', 'MX', 'BR', 'FR', 'DE', 'ES', 'JP'] as const;
export const overtimeRuleSources: Record<(typeof overtimeRuleCountries)[number], string> = {
  US: 'https://www.dol.gov/agencies/whd/overtime',
  MX: 'https://www.diputados.gob.mx/LeyesBiblio/pdf/LFT.pdf',
  BR: 'https://www.planalto.gov.br/ccivil_03/constituicao/constituicao.htm',
  FR: 'https://www.service-public.gouv.fr/particuliers/vosdroits/F2391',
  DE: 'https://www.gesetze-im-internet.de/arbzg/__3.html',
  ES: 'https://www.boe.es/buscar/act.php?id=BOE-A-2015-11430',
  JP: 'https://laws.e-gov.go.jp/law/322AC0000000049',
};
