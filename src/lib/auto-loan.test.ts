import { describe, expect, it } from 'vitest';
import { amortize, calculateLoan, calculateRefinance, paymentFor, yearlySchedule, type LoanInput, type RefinanceInput } from './auto-loan';

const loan = (overrides: Partial<LoanInput>) => calculateLoan({
  price: 30000, downPayment: 0, tradeIn: 0, tradeOwed: 0, salesTaxPercent: 0, taxAfterTradeIn: true, fees: 0, taxesInLoan: true, apr: 6, months: 60, digits: 2, ...overrides,
});
const refinance = (overrides: Partial<RefinanceInput>) => {
  const outcome = calculateRefinance({ balance: 20000, currentPayment: 500, currentApr: 9, newApr: 6, newMonths: 48, fees: 0, feesInLoan: false, digits: 2, ...overrides });
  if (!('result' in outcome)) throw new Error(`Unexpected error: ${outcome.error}`);
  return outcome.result;
};

describe('paymentFor', () => {
  it('uses the standard amortization formula, rounded to the cent', () => {
    // $30,000 at 6% for 60 months is $579.98 a month.
    expect(paymentFor(3000000, 6, 60)).toBe(57998);
    // $25,000 at 7.5% for 72 months.
    expect(paymentFor(2500000, 7.5, 72)).toBe(43225);
  });

  it('divides evenly at 0%, rounding up so the payments cover the loan', () => {
    expect(paymentFor(3000000, 0, 60)).toBe(50000);
    expect(paymentFor(1000000, 0, 36)).toBe(27778);
  });

  it('stays accurate at a rate just above 0%', () => {
    expect(paymentFor(3000000, 1e-9, 60)).toBe(50000);
    expect(paymentFor(3000000, 0.0001, 60)).toBe(50000);
  });

  it('is zero for nothing borrowed', () => {
    expect(paymentFor(0, 6, 60)).toBe(0);
  });
});

describe('amortize', () => {
  it('ends on the last month with the balance at zero', () => {
    const rows = amortize(3000000, 6, 57998, 60)!;
    expect(rows).toHaveLength(60);
    expect(rows.at(-1)!.balance).toBe(0);
    // The first month's interest is $30,000 × 0.5% = $150.
    expect(rows[0]).toEqual({ month: 1, payment: 57998, principal: 42998, interest: 15000, balance: 2957002 });
    expect(rows.reduce((total, row) => total + row.principal, 0)).toBe(3000000);
  });

  it('runs until the balance is paid when no term is given', () => {
    const rows = amortize(1000000, 0, 100000)!;
    expect(rows).toHaveLength(10);
  });

  it('gives up when the payment never covers the interest', () => {
    expect(amortize(2000000, 12, 20000)).toBeUndefined();
  });
});

describe('calculateLoan', () => {
  it('works out the payment, interest and total cost', () => {
    const result = loan({});
    expect(result).toMatchObject({ loanAmount: 30000, monthlyPayment: 579.98, months: 60, salesTax: 0, upfront: 0 });
    expect(result.totalInterest).toBeCloseTo(4798.8, 0);
    expect(result.totalPayments).toBeCloseTo(30000 + result.totalInterest, 6);
    expect(result.totalCost).toBeCloseTo(30000 + result.totalInterest, 6);
  });

  it('takes the down payment and trade-in equity off the loan', () => {
    const result = loan({ downPayment: 5000, tradeIn: 8000, tradeOwed: 3000 });
    expect(result.loanAmount).toBe(20000);
    expect(result.upfront).toBe(5000);
    expect(result.negativeEquity).toBe(0);
  });

  it('adds negative equity on the trade-in to the loan', () => {
    const result = loan({ tradeIn: 5000, tradeOwed: 8000 });
    expect(result.loanAmount).toBe(33000);
    expect(result.negativeEquity).toBe(3000);
  });

  it('taxes the price minus the trade-in, or the full price', () => {
    expect(loan({ salesTaxPercent: 7, tradeIn: 5000 }).salesTax).toBe(1750);
    expect(loan({ salesTaxPercent: 7, tradeIn: 5000, taxAfterTradeIn: false }).salesTax).toBe(2100);
    // A down payment doesn't lower the tax.
    expect(loan({ salesTaxPercent: 7, downPayment: 10000 }).salesTax).toBe(2100);
  });

  it('adds tax and fees to the loan, or to what you pay upfront', () => {
    const inLoan = loan({ salesTaxPercent: 6.25, fees: 500, downPayment: 3000 });
    expect(inLoan.salesTax).toBe(1875);
    expect(inLoan.loanAmount).toBe(29375);
    expect(inLoan.upfront).toBe(3000);
    const upfront = loan({ salesTaxPercent: 6.25, fees: 500, downPayment: 3000, taxesInLoan: false });
    expect(upfront.loanAmount).toBe(27000);
    expect(upfront.upfront).toBe(5375);
    expect(upfront.totalCost).toBeCloseTo(30000 + 1875 + 500 + upfront.totalInterest, 6);
  });

  it('needs no loan when the down payment covers the price', () => {
    expect(loan({ downPayment: 35000 })).toMatchObject({ loanAmount: 0, monthlyPayment: 0, months: 0, totalInterest: 0, schedule: [] });
  });

  it('works in currencies without cents', () => {
    const result = loan({ price: 3000000, apr: 3, months: 60, digits: 0 });
    expect(result.monthlyPayment).toBe(53906);
    expect(Number.isInteger(result.totalInterest)).toBe(true);
  });

  it('keeps the months between 1 and 120', () => {
    expect(loan({ months: 500 }).months).toBe(120);
    expect(loan({ months: 0 }).months).toBe(1);
  });
});

describe('calculateRefinance', () => {
  it('compares the rest of the current loan with the new one', () => {
    const result = refinance({});
    // $20,000 at 9% paying $500 a month has 48 payments left.
    expect(result.currentMonths).toBe(48);
    expect(result.newPayment).toBe(469.7);
    expect(result.monthlySavings).toBeCloseTo(30.3, 6);
    expect(result.totalSavings).toBeCloseTo(result.currentTotal - result.newTotal, 6);
    expect(result.totalSavings).toBeGreaterThan(1000);
  });

  it('counts fees paid upfront in the new total, or adds them to the new loan', () => {
    const upfront = refinance({ fees: 300 });
    expect(upfront.newLoanAmount).toBe(20000);
    expect(upfront.newTotal).toBeCloseTo(upfront.newPayment * 47 + upfront.newLastPayment + 300, 6);
    const rolled = refinance({ fees: 300, feesInLoan: true });
    expect(rolled.newLoanAmount).toBe(20300);
  });

  it('shows that a longer term can lower the payment but cost more', () => {
    const result = refinance({ newApr: 9, newMonths: 72 });
    expect(result.monthlySavings).toBeGreaterThan(0);
    expect(result.totalSavings).toBeLessThan(0);
  });

  it('reports a payment that never pays the loan off', () => {
    expect(calculateRefinance({ balance: 20000, currentPayment: 100, currentApr: 9, newApr: 6, newMonths: 48, fees: 0, feesInLoan: false, digits: 2 })).toEqual({ error: 'paymentTooLow' });
  });

  it('tells a payment that takes too long apart from one that never covers the interest', () => {
    // At 0% there's no interest to cover, but $20,000 at $30 a month is 667 payments.
    expect(calculateRefinance({ balance: 20000, currentPayment: 30, currentApr: 0, newApr: 6, newMonths: 48, fees: 0, feesInLoan: false, digits: 2 })).toEqual({ error: 'tooLong' });
    // $20,000 at 9% is $150 of interest a month; $151 covers it but would take far longer than 50 years.
    expect(calculateRefinance({ balance: 20000, currentPayment: 151, currentApr: 9, newApr: 6, newMonths: 48, fees: 0, feesInLoan: false, digits: 2 })).toEqual({ error: 'tooLong' });
  });
});

describe('yearlySchedule', () => {
  it('adds up each year and keeps the balance at its end', () => {
    const years = yearlySchedule(loan({}).schedule);
    expect(years).toHaveLength(5);
    expect(years[0].payment).toBeCloseTo(579.98 * 12, 6);
    expect(years.at(-1)!.balance).toBe(0);
    expect(years.reduce((total, year) => total + year.principal, 0)).toBeCloseTo(30000, 6);
  });

  it('keeps a short last year', () => {
    expect(yearlySchedule(loan({ months: 30 }).schedule)).toHaveLength(3);
  });
});
