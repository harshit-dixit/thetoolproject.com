// Auto loan calculator: the monthly payment, what the loan costs, and a payment-by-payment schedule.
// Money is handled in the currency's minor unit (cents), and each month's interest is rounded to the cent,
// the way a lender's amortization schedule is written.

export type LoanInput = {
  /** The price agreed with the seller, before tax. */
  price: number;
  downPayment: number;
  tradeIn: number;
  /** What is still owed on the trade-in. More than it's worth (negative equity) goes into the new loan. */
  tradeOwed: number;
  salesTaxPercent: number;
  /** Most US states tax the price minus the trade-in; some tax the full price. */
  taxAfterTradeIn: boolean;
  /** Title, registration, documentation and other fees. */
  fees: number;
  /** Add the tax and fees to the loan, or pay them when you sign. */
  taxesInLoan: boolean;
  /** The annual interest rate, %. An APR also counts the lender's fees, so using one overstates the payment a little. */
  apr: number;
  months: number;
  /** Decimal places of the currency: 2 for USD, 0 for JPY. */
  digits: number;
};

export type ScheduleRow = { month: number; payment: number; principal: number; interest: number; balance: number };

export type LoanResult = {
  loanAmount: number;
  monthlyPayment: number;
  /** The last payment, which clears the few cents that rounding the monthly payment leaves. */
  lastPayment: number;
  months: number;
  salesTax: number;
  fees: number;
  /** Down payment plus any tax and fees not in the loan. */
  upfront: number;
  totalInterest: number;
  totalPayments: number;
  /** Price, tax, fees and interest. */
  totalCost: number;
  /** Negative equity on the trade-in that went into the loan. */
  negativeEquity: number;
  schedule: ScheduleRow[];
};

export type RefinanceInput = {
  balance: number;
  /** The payment on the current loan. */
  currentPayment: number;
  currentApr: number;
  newApr: number;
  newMonths: number;
  fees: number;
  feesInLoan: boolean;
  digits: number;
};

export type RefinanceResult = {
  /** Months left on the current loan at its current payment. */
  currentMonths: number;
  currentInterest: number;
  currentTotal: number;
  newLoanAmount: number;
  newPayment: number;
  newLastPayment: number;
  newInterest: number;
  /** New payments plus fees paid upfront. */
  newTotal: number;
  /** Lower by this much each month. Negative when the new payment is higher. */
  monthlySavings: number;
  /** What the current loan still costs minus what the new one costs. Negative means refinancing costs more. */
  totalSavings: number;
  schedule: ScheduleRow[];
};

/** `paymentTooLow`: the payment doesn't cover a month's interest. `tooLong`: it would take more than MAX_PAYOFF_MONTHS. */
export type RefinanceError = 'paymentTooLow' | 'tooLong';

export const MAX_MONTHS = 120;
/** How long a current loan's remaining payments may run when refinancing: 50 years. */
export const MAX_PAYOFF_MONTHS = 600;
export const MAX_APR = 50;
export const MAX_TAX = 25;
/** The terms dealers and lenders usually offer, for the comparison table and the term chips. */
export const TERMS = [36, 48, 60, 72, 84] as const;

const toMinor = (value: number, digits: number) => Math.round(Math.max(0, value) * 10 ** digits);
const toMajor = (value: number, digits: number) => value / 10 ** digits;
// Rounds half up, ignoring floating-point noise such as 682.4999999.
const roundHalfUp = (value: number) => Math.round(Number(value.toFixed(6)));
const monthlyRate = (apr: number) => Math.min(MAX_APR, Math.max(0, apr)) / 100 / 12;

/** The level monthly payment that pays off `principal` (minor units) in `months`: P·r / (1 − (1 + r)^−n). */
export function paymentFor(principal: number, apr: number, months: number): number {
  const n = Math.max(1, Math.round(months));
  const r = monthlyRate(apr);
  if (principal <= 0) return 0;
  if (r === 0) return Math.ceil(principal / n);
  // 1 − (1 + r)^−n, written so it stays accurate when r is tiny instead of cancelling to noise.
  return roundHalfUp((principal * r) / -Math.expm1(-n * Math.log1p(r)));
}

/**
 * Month-by-month schedule in minor units. With `months`, the last of them clears whatever is left,
 * so a loan written for 60 months ends at 60 even though the payment was rounded to the cent.
 * Without it, payments continue until the balance is paid (at most MAX_PAYOFF_MONTHS).
 */
export function amortize(principal: number, apr: number, payment: number, months?: number): ScheduleRow[] | undefined {
  const r = monthlyRate(apr);
  const rows: ScheduleRow[] = [];
  let balance = principal;
  const limit = months ?? MAX_PAYOFF_MONTHS;
  for (let month = 1; balance > 0 && month <= limit; month++) {
    const interest = roundHalfUp(balance * r);
    const last = month === months || balance + interest <= payment;
    const paid = last ? balance + interest : payment;
    if (paid <= interest) return undefined;
    balance -= paid - interest;
    rows.push({ month, payment: paid, principal: paid - interest, interest, balance });
  }
  return balance > 0 ? undefined : rows;
}

const sum = (rows: ScheduleRow[], field: 'payment' | 'interest') => rows.reduce((total, row) => total + row[field], 0);
const inMajor = (rows: ScheduleRow[], digits: number): ScheduleRow[] => rows.map(row => ({
  month: row.month, payment: toMajor(row.payment, digits), principal: toMajor(row.principal, digits), interest: toMajor(row.interest, digits), balance: toMajor(row.balance, digits),
}));

export function calculateLoan(input: LoanInput): LoanResult {
  const { digits } = input;
  const months = Math.min(MAX_MONTHS, Math.max(1, Math.round(input.months) || 1));
  const price = toMinor(input.price, digits);
  const down = toMinor(input.downPayment, digits);
  const tradeIn = toMinor(input.tradeIn, digits);
  const tradeOwed = toMinor(input.tradeOwed, digits);
  const fees = toMinor(input.fees, digits);
  const taxable = input.taxAfterTradeIn ? Math.max(0, price - tradeIn) : price;
  const salesTax = roundHalfUp((taxable * Math.min(MAX_TAX, Math.max(0, input.salesTaxPercent))) / 100);
  const extras = salesTax + fees;
  // Equity in the trade-in lowers the loan like a down payment; negative equity is added to it.
  const financed = price - down - (tradeIn - tradeOwed) + (input.taxesInLoan ? extras : 0);
  const loanAmount = Math.max(0, financed);
  const payment = paymentFor(loanAmount, input.apr, months);
  const rows = loanAmount > 0 ? amortize(loanAmount, input.apr, payment, months) ?? [] : [];
  const totalInterest = sum(rows, 'interest');
  return {
    loanAmount: toMajor(loanAmount, digits),
    monthlyPayment: toMajor(payment, digits),
    lastPayment: toMajor(rows.at(-1)?.payment ?? 0, digits),
    months: rows.length,
    salesTax: toMajor(salesTax, digits),
    fees: toMajor(fees, digits),
    upfront: toMajor(down + (input.taxesInLoan ? 0 : extras), digits),
    totalInterest: toMajor(totalInterest, digits),
    totalPayments: toMajor(sum(rows, 'payment'), digits),
    totalCost: toMajor(price + extras + totalInterest, digits),
    negativeEquity: toMajor(Math.max(0, tradeOwed - tradeIn), digits),
    schedule: inMajor(rows, digits),
  };
}

export function calculateRefinance(input: RefinanceInput): { result: RefinanceResult } | { error: RefinanceError } {
  const { digits } = input;
  const balance = toMinor(input.balance, digits);
  const currentPayment = toMinor(input.currentPayment, digits);
  if (currentPayment <= roundHalfUp(balance * monthlyRate(input.currentApr))) return { error: 'paymentTooLow' };
  const current = amortize(balance, input.currentApr, currentPayment);
  if (!current) return { error: 'tooLong' };
  const fees = toMinor(input.fees, digits);
  const newMonths = Math.min(MAX_MONTHS, Math.max(1, Math.round(input.newMonths) || 1));
  const newLoan = balance + (input.feesInLoan ? fees : 0);
  const newPayment = paymentFor(newLoan, input.newApr, newMonths);
  const rows = amortize(newLoan, input.newApr, newPayment, newMonths) ?? [];
  const currentTotal = sum(current, 'payment');
  const newTotal = sum(rows, 'payment') + (input.feesInLoan ? 0 : fees);
  return {
    result: {
      currentMonths: current.length,
      currentInterest: toMajor(sum(current, 'interest'), digits),
      currentTotal: toMajor(currentTotal, digits),
      newLoanAmount: toMajor(newLoan, digits),
      newPayment: toMajor(newPayment, digits),
      newLastPayment: toMajor(rows.at(-1)?.payment ?? 0, digits),
      newInterest: toMajor(sum(rows, 'interest'), digits),
      newTotal: toMajor(newTotal, digits),
      monthlySavings: toMajor(currentPayment - newPayment, digits),
      totalSavings: toMajor(currentTotal - newTotal, digits),
      schedule: inMajor(rows, digits),
    },
  };
}

/** The schedule added up by year: payments, principal and interest in each 12 months, and the balance at the end. */
export function yearlySchedule(rows: ScheduleRow[]): ScheduleRow[] {
  const years: ScheduleRow[] = [];
  for (const row of rows) {
    const year = Math.ceil(row.month / 12);
    const current = years[year - 1] ??= { month: year, payment: 0, principal: 0, interest: 0, balance: 0 };
    current.payment += row.payment;
    current.principal += row.principal;
    current.interest += row.interest;
    current.balance = row.balance;
  }
  // Adding up major units picks up floating-point noise; the rows are whole cents.
  return years.map(year => ({ ...year, payment: tidy(year.payment), principal: tidy(year.principal), interest: tidy(year.interest) }));
}

const tidy = (value: number) => Math.round(value * 1e6) / 1e6;
