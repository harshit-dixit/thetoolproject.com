// Overtime calculator: overtime pay for a week or a month, and the US "no tax on overtime" deduction.
// Money comes in and goes out in major units (dollars) and every amount shown is rounded to the currency's
// minor unit. The parts are rounded first and the total is their sum, so the lines on the page always add up.

export type PayBasis = 'hourly' | 'salary';
/** How often the salary is paid. */
export type SalaryPeriod = 'week' | 'biweek' | 'semimonth' | 'month' | 'year';
/** The stretch of time the hours cover. US overtime is counted by the workweek. */
export type Period = 'week' | 'month';

export type OvertimeInput = {
  basis: PayBasis;
  /** Hourly pay, used when basis is 'hourly'. */
  hourlyRate: number;
  /** Salary, used when basis is 'salary'. */
  salary: number;
  salaryPeriod: SalaryPeriod;
  period: Period;
  /** Hours at the regular rate in the period. For a salary, the hours it pays for. */
  regularHours: number;
  overtimeHours: number;
  /** 1.5 is time and a half. */
  multiplier: number;
  /** Hours at a second, usually higher, rate such as double time. */
  secondHours: number;
  secondMultiplier: number;
  /** A bonus or commission earned in the period. Under the FLSA it raises the regular rate. */
  bonus: number;
  /** Decimal places of the currency: 2 for USD, 0 for JPY. */
  digits: number;
  /**
   * In a week, regular hours past this many are owed the FLSA premium on top of their straight-time pay: 40 under US law.
   * Left out, regular hours are only ever paid straight time.
   */
  weeklyLimit?: number;
};

export type OvertimeResult = {
  /** Pay per hour before any bonus: the hourly rate, or the salary divided by its hours. */
  baseRate: number;
  /** The base rate plus the bonus spread over every hour worked (the FLSA regular rate). */
  regularRate: number;
  overtimeRate: number;
  secondRate: number;
  regularPay: number;
  /** Pay for the overtime hours at the first rate, plus the overtime owed on the bonus for them. */
  overtimePay: number;
  /** Regular hours past the weekly limit: their straight time is in the regular pay, but they're overtime. */
  limitHours: number;
  /** The premium owed on those hours: half the regular rate for each. */
  limitPay: number;
  secondPay: number;
  bonus: number;
  totalPay: number;
  totalHours: number;
  /** Overtime owed on the bonus, included in overtimePay, limitPay and secondPay. */
  bonusOvertime: number;
  /** Hours that count as FLSA overtime: over 40 in the workweek. In a month, every overtime hour. */
  flsaHours: number;
  /** The US qualified overtime compensation for the period: the "half" of time and a half, at most. */
  qualified: number;
};

export type OvertimeError = 'tooManyHours' | 'noRegularHours';

export const MAX_HOURS: Record<Period, number> = { week: 168, month: 744 };
export const MAX_MULTIPLIER = 10;
export const FLSA_WEEK_HOURS = 40;
/** The FLSA premium: overtime is at least one and a half times the regular rate. */
export const FLSA_PREMIUM = 0.5;
export const PERIODS_PER_YEAR: Record<Period, number> = { week: 52, month: 12 };
const SALARY_PER_YEAR: Record<SalaryPeriod, number> = { week: 52, biweek: 26, semimonth: 24, month: 12, year: 1 };

const round = (value: number, digits: number) => {
  const scale = 10 ** digits;
  return Math.round((value + Number.EPSILON) * scale) / scale;
};

/**
 * A salary for the period: a monthly salary is × 12 ÷ 52 for a week, as 29 CFR 778.113 converts it.
 * Going through the year keeps every pair of periods consistent.
 */
export function salaryFor(salary: number, from: SalaryPeriod, to: Period): number {
  return (salary * SALARY_PER_YEAR[from]) / PERIODS_PER_YEAR[to];
}

export function calculateOvertime(input: OvertimeInput): { result: OvertimeResult } | { error: OvertimeError } {
  const { digits, period, regularHours, overtimeHours, secondHours, multiplier, secondMultiplier } = input;
  const totalHours = regularHours + overtimeHours + secondHours;
  if (totalHours > MAX_HOURS[period]) return { error: 'tooManyHours' };
  if (input.basis === 'salary' && regularHours <= 0) return { error: 'noRegularHours' };

  const periodSalary = input.basis === 'salary' ? salaryFor(input.salary, input.salaryPeriod, period) : 0;
  const baseRate = input.basis === 'salary' ? periodSalary / regularHours : input.hourlyRate;
  // A bonus covers every hour worked, so its straight-time part is already paid; the overtime hours are owed only the premium on it.
  const bonusRate = totalHours > 0 ? input.bonus / totalHours : 0;
  const regularRate = baseRate + bonusRate;
  const firstBonus = Math.max(0, multiplier - 1) * bonusRate * overtimeHours;
  const secondBonus = Math.max(0, secondMultiplier - 1) * bonusRate * secondHours;
  // A salary for 45 hours, or 45 hours entered as regular, pays them straight time; the FLSA still owes half the
  // regular rate on top for the 5 past 40 (Fact Sheet 23: $405 for 45 hours is owed $22.50 more).
  const limitHours = period === 'week' && input.weeklyLimit !== undefined ? Math.max(0, regularHours - input.weeklyLimit) : 0;
  const limitBonus = FLSA_PREMIUM * bonusRate * limitHours;

  const regularPay = round(input.basis === 'salary' ? periodSalary : baseRate * regularHours, digits);
  const overtimePay = round(baseRate * multiplier * overtimeHours + firstBonus, digits);
  const limitPay = round(FLSA_PREMIUM * regularRate * limitHours, digits);
  const secondPay = round(baseRate * secondMultiplier * secondHours + secondBonus, digits);
  const bonus = round(input.bonus, digits);

  // Only hours over 40 in the workweek are FLSA overtime, whatever an employer or a state calls overtime.
  const extraHours = overtimeHours + secondHours;
  const extraFlsa = period === 'week' ? Math.min(extraHours, Math.max(0, totalHours - FLSA_WEEK_HOURS - limitHours)) : extraHours;
  // The deduction counts the premium the FLSA requires, never more, and never more than was paid.
  // The FLSA hours are taken from the lower-paid tier first, since those are the first hours past 40.
  const firstFlsa = Math.min(overtimeHours, extraFlsa);
  const secondFlsa = extraFlsa - firstFlsa;
  const premium = (factor: number) => Math.min(FLSA_PREMIUM, Math.max(0, factor - 1));
  const qualified = round(regularRate * (FLSA_PREMIUM * limitHours + premium(multiplier) * firstFlsa + premium(secondMultiplier) * secondFlsa), digits);

  return {
    result: {
      baseRate,
      regularRate,
      overtimeRate: regularRate * multiplier,
      secondRate: regularRate * secondMultiplier,
      regularPay,
      overtimePay,
      limitHours,
      limitPay,
      secondPay,
      bonus,
      totalPay: round(regularPay + overtimePay + limitPay + secondPay + bonus, digits),
      totalHours,
      bonusOvertime: round(firstBonus + secondBonus + limitBonus, digits),
      flsaHours: limitHours + extraFlsa,
      qualified,
    },
  };
}

// The deduction for qualified overtime compensation (No Tax on Overtime), tax years 2025 to 2028.
// Schedule 1-A (Form 1040), Part III, lines 14 to 21; IRS FS-2026-13 (August 2026).
export type FilingStatus = 'single' | 'joint' | 'separate';
export const DEDUCTION_CAP: Record<'single' | 'joint', number> = { single: 12500, joint: 25000 };
export const PHASE_OUT_START: Record<'single' | 'joint', number> = { single: 150000, joint: 300000 };
export const PHASE_OUT_STEP = 1000;
export const PHASE_OUT_PER_STEP = 100;
export const DEDUCTION_YEARS = [2025, 2026, 2027, 2028] as const;
export const TAX_BRACKETS = [10, 12, 22, 24, 32, 35, 37] as const;

export type DeductionInput = {
  /** Qualified overtime for the year: the taxpayer's, plus the spouse's on a joint return. */
  qualified: number;
  status: FilingStatus;
  /** Modified adjusted gross income. Left out, no phase-out is applied. */
  income?: number;
  /** Federal income tax bracket, %, for the estimate of tax saved. */
  bracket?: number;
  digits: number;
};

export type DeductionResult = {
  /** Married filing separately can't claim the deduction. */
  eligible: boolean;
  /** Line 15: the qualified overtime, up to the cap. */
  capped: number;
  /** True when the cap lowered the amount. */
  overCap: boolean;
  /** Line 20: the phase-out. */
  reduction: number;
  /** Line 21. */
  deduction: number;
  /** The deduction times the bracket. Undefined without a bracket. */
  taxSaved?: number;
};

export function calculateDeduction(input: DeductionInput): DeductionResult {
  const { digits } = input;
  if (input.status === 'separate') return { eligible: false, capped: 0, overCap: false, reduction: 0, deduction: 0, taxSaved: input.bracket === undefined ? undefined : 0 };
  const cap = DEDUCTION_CAP[input.status];
  const capped = Math.min(input.qualified, cap);
  const over = (input.income ?? 0) - PHASE_OUT_START[input.status];
  // Line 19: a part of $1,000 doesn't count, so $150,999 reduces nothing and $151,000 reduces $100.
  const reduction = over > 0 ? Math.floor(over / PHASE_OUT_STEP) * PHASE_OUT_PER_STEP : 0;
  const deduction = Math.max(0, capped - reduction);
  return {
    eligible: true,
    capped,
    overCap: input.qualified > cap,
    reduction,
    deduction,
    taxSaved: input.bracket === undefined ? undefined : round((deduction * input.bracket) / 100, digits),
  };
}
