import { describe, expect, it } from 'vitest';
import { calculateDeduction, calculateOvertime, salaryFor, type DeductionInput, type OvertimeInput } from './overtime';

const overtime = (overrides: Partial<OvertimeInput>) => {
  const outcome = calculateOvertime({
    basis: 'hourly', hourlyRate: 20, salary: 0, salaryPeriod: 'year', period: 'week', regularHours: 40, overtimeHours: 10,
    multiplier: 1.5, secondHours: 0, secondMultiplier: 2, bonus: 0, digits: 2, ...overrides,
  });
  if (!('result' in outcome)) throw new Error(`Unexpected error: ${outcome.error}`);
  return outcome.result;
};
const deduction = (overrides: Partial<DeductionInput>) => calculateDeduction({ qualified: 10000, status: 'single', digits: 2, ...overrides });

describe('calculateOvertime', () => {
  it('pays time and a half for the overtime hours', () => {
    const result = overtime({});
    expect(result.overtimeRate).toBe(30);
    expect(result.overtimePay).toBe(300);
    expect(result.regularPay).toBe(800);
    expect(result.totalPay).toBe(1100);
  });

  it('counts only the "half" as qualified overtime, as in the IRS example', () => {
    // IRS FS-2026-13, Q16: 50 hours at $20 with double time pays $400 of overtime; $100 qualifies.
    const result = overtime({ multiplier: 2 });
    expect(result.overtimePay).toBe(400);
    expect(result.flsaHours).toBe(10);
    expect(result.qualified).toBe(100);
  });

  it('rounds each amount to the cent and keeps the total the sum of the lines', () => {
    const result = overtime({ hourlyRate: 17.33, overtimeHours: 7.25 });
    expect(result.overtimePay).toBe(188.46);
    expect(result.regularPay).toBe(693.2);
    expect(result.totalPay).toBe(881.66);
  });

  it('has no minor unit for yen', () => {
    const result = overtime({ hourlyRate: 1234, overtimeHours: 3, multiplier: 1.25, digits: 0 });
    expect(result.overtimePay).toBe(4628);
  });

  it('adds a second rate such as double time', () => {
    // California: 12 hours at 1.5× and 2 hours at 2× in a week.
    const result = overtime({ overtimeHours: 12, secondHours: 2 });
    expect(result.secondRate).toBe(40);
    expect(result.secondPay).toBe(80);
    expect(result.totalPay).toBe(800 + 360 + 80);
    // Only the half counts for the double-time hours too.
    expect(result.qualified).toBe(140);
  });

  it('counts only hours over 40 in the week as FLSA overtime', () => {
    // A 35-hour contract with 8 overtime hours: 3 of them are over 40.
    const result = overtime({ regularHours: 35, overtimeHours: 8 });
    expect(result.overtimePay).toBe(240);
    expect(result.flsaHours).toBe(3);
    expect(result.qualified).toBe(30);
    expect(overtime({ regularHours: 35, overtimeHours: 5 }).qualified).toBe(0);
  });

  it('treats every overtime hour in a month as qualifying, since a month has no single workweek', () => {
    expect(overtime({ period: 'month', regularHours: 160, overtimeHours: 10 }).flsaHours).toBe(10);
  });

  it('never counts more premium than was paid', () => {
    expect(overtime({ multiplier: 1.25 }).qualified).toBe(50);
    expect(overtime({ multiplier: 1 }).qualified).toBe(0);
  });

  it('spreads a bonus over every hour and pays the premium on it for the overtime hours', () => {
    // The bonus spread over 50 hours: $20 an hour, 50 hours, a $100 bonus: regular rate $22, overtime owed $10 + $1 an hour.
    const result = overtime({ bonus: 100 });
    expect(result.regularRate).toBe(22);
    expect(result.overtimeRate).toBe(33);
    expect(result.bonusOvertime).toBe(10);
    expect(result.overtimePay).toBe(310);
    expect(result.totalPay).toBe(800 + 310 + 100);
    expect(result.qualified).toBe(110);
  });

  it('matches the Department of Labor bonus example to the cent', () => {
    // DOL Fact Sheet 56C, Example A: $10 an hour, 43 hours and a $50 bonus is $496.74 for the week.
    const result = overtime({ hourlyRate: 10, overtimeHours: 3, bonus: 50 });
    expect(result.overtimePay).toBe(46.74);
    expect(result.totalPay).toBe(496.74);
  });

  it('divides a salary by the hours it pays for', () => {
    // DOL Fact Sheet 23: $405 for 45 hours is $9 an hour. Here the salary covers 40 hours and 5 more are overtime.
    const result = overtime({ basis: 'salary', salary: 400, salaryPeriod: 'week', overtimeHours: 5 });
    expect(result.baseRate).toBe(10);
    expect(result.overtimePay).toBe(75);
    expect(result.regularPay).toBe(400);
  });

  it('owes half the regular rate on top for the hours a salary covers past 40', () => {
    // DOL Fact Sheet 23: $405 for 45 hours is $9 an hour, and the 5 hours past 40 are owed $4.50 more each.
    const result = overtime({ basis: 'salary', salary: 405, salaryPeriod: 'week', regularHours: 45, overtimeHours: 0, weeklyLimit: 40 });
    expect(result.baseRate).toBe(9);
    expect(result.limitHours).toBe(5);
    expect(result.limitPay).toBe(22.5);
    expect(result.totalPay).toBe(427.5);
    expect(result.flsaHours).toBe(5);
    expect(result.qualified).toBe(22.5);
    // Overtime hours on top are all past 40, and count after the salary's own.
    const more = overtime({ basis: 'salary', salary: 405, salaryPeriod: 'week', regularHours: 45, overtimeHours: 2, weeklyLimit: 40 });
    expect(more.overtimePay).toBe(27);
    expect(more.flsaHours).toBe(7);
    expect(more.qualified).toBe(31.5);
    // Hourly regular hours past 40 are owed the same premium.
    expect(overtime({ regularHours: 45, overtimeHours: 0, weeklyLimit: 40 }).limitPay).toBe(50);
  });

  it('pays regular hours straight time without a weekly limit, or in a month', () => {
    expect(overtime({ basis: 'salary', salary: 405, salaryPeriod: 'week', regularHours: 45, overtimeHours: 0 }).totalPay).toBe(405);
    expect(overtime({ period: 'month', regularHours: 173, overtimeHours: 0, weeklyLimit: 40 }).limitPay).toBe(0);
  });

  it('converts a salary to the period through the year', () => {
    expect(salaryFor(52000, 'year', 'week')).toBe(1000);
    // 29 CFR 778.113: a monthly salary × 12 ÷ 52 for a week.
    expect(salaryFor(5200, 'month', 'week')).toBe(1200);
    expect(salaryFor(2000, 'biweek', 'week')).toBe(1000);
    expect(salaryFor(2600, 'semimonth', 'week')).toBe(1200);
    expect(salaryFor(1200, 'week', 'month')).toBe(5200);
    // Brazil: a monthly salary of R$ 2.200 over 220 hours is R$ 10 an hour.
    expect(overtime({ basis: 'salary', salary: 2200, salaryPeriod: 'month', period: 'month', regularHours: 220, overtimeHours: 10 }).overtimePay).toBe(150);
  });

  it('works with no overtime hours', () => {
    const result = overtime({ overtimeHours: 0 });
    expect(result.overtimePay).toBe(0);
    expect(result.totalPay).toBe(800);
    expect(result.qualified).toBe(0);
  });

  it('rejects more hours than the period has, and a salary with no hours', () => {
    expect(calculateOvertime({ basis: 'hourly', hourlyRate: 20, salary: 0, salaryPeriod: 'year', period: 'week', regularHours: 160, overtimeHours: 10, multiplier: 1.5, secondHours: 0, secondMultiplier: 2, bonus: 0, digits: 2 })).toEqual({ error: 'tooManyHours' });
    expect(calculateOvertime({ basis: 'salary', hourlyRate: 0, salary: 1000, salaryPeriod: 'week', period: 'week', regularHours: 0, overtimeHours: 10, multiplier: 1.5, secondHours: 0, secondMultiplier: 2, bonus: 0, digits: 2 })).toEqual({ error: 'noRegularHours' });
  });
});

describe('calculateDeduction', () => {
  it('deducts the qualified overtime up to $12,500, or $25,000 on a joint return', () => {
    expect(deduction({}).deduction).toBe(10000);
    expect(deduction({ qualified: 30000 })).toMatchObject({ capped: 12500, overCap: true, deduction: 12500 });
    expect(deduction({ qualified: 30000, status: 'joint' }).deduction).toBe(25000);
  });

  it('phases out by $100 for each whole $1,000 of income over $150,000, as Schedule 1-A line 19 rounds', () => {
    expect(deduction({ income: 150000 }).reduction).toBe(0);
    expect(deduction({ income: 150999 }).reduction).toBe(0);
    expect(deduction({ income: 151000 }).reduction).toBe(100);
    expect(deduction({ income: 175500 }).deduction).toBe(10000 - 2500);
    expect(deduction({ income: 400000 }).deduction).toBe(0);
    expect(deduction({ income: 310000, status: 'joint' }).deduction).toBe(9000);
  });

  it('is not available when married filing separately', () => {
    expect(deduction({ status: 'separate', bracket: 22 })).toMatchObject({ eligible: false, deduction: 0, taxSaved: 0 });
  });

  it('estimates the tax saved at the bracket', () => {
    expect(deduction({ qualified: 2600, bracket: 22 }).taxSaved).toBe(572);
    expect(deduction({}).taxSaved).toBeUndefined();
  });
});
