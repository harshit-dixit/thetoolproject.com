import type { AutoLoanDefaults } from '../data/auto-loan-defaults';
import { calculateLoan, calculateRefinance, MAX_APR, MAX_MONTHS, MAX_PAYOFF_MONTHS, MAX_TAX, yearlySchedule, type LoanResult, type ScheduleRow } from '../lib/auto-loan';
import { currencies, currencyAffix, currencyDigits, currencyForLanguage, parseAmount } from '../lib/tip-calculator';
import { i18nFrom } from '../i18n/client';
import { trackResult } from '../lib/analytics';

const root = document.querySelector<HTMLElement>('#auto-loan-tool')!;
const { t, counted, formatNumber, formatPercent } = i18nFrom(root);
const locale = root.dataset.locale || 'en';
const defaults = JSON.parse(root.dataset.defaults!) as AutoLoanDefaults;
const STORAGE_KEY = 'auto-loan-currency';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = (id: string) => $<HTMLInputElement>(id);
const buy = { price: input('loan-price'), down: input('loan-down'), tradeIn: input('loan-trade-in'), tradeOwed: input('loan-trade-owed'), months: input('loan-months'), apr: input('loan-apr'), tax: input('loan-tax'), fees: input('loan-fees') };
const refi = { balance: input('refi-balance'), payment: input('refi-payment'), apr: input('refi-apr'), newApr: input('refi-new-apr'), months: input('refi-months'), fees: input('refi-fees') };
const currencySelect = $<HTMLSelectElement>('loan-currency');
const ratePreset = root.querySelector<HTMLSelectElement>('[data-rate-preset]');
const breakdown = $('loan-breakdown');
const live = $('loan-live');
const chips = (name: string) => [...root.querySelectorAll<HTMLButtonElement>(`[data-${name}]`)];
const modeChips = chips('mode');
const downChips = chips('down');
const termChips = chips('term');
const refiTermChips = chips('refi-term');
const taxBaseChips = chips('tax-base');
const taxesInChips = chips('taxes-in');
const refiFeesChips = chips('refi-fees');
const viewChips = chips('schedule-view');

let currency = defaults.currency;
let digits = currencyDigits(currency);
let mode: 'buy' | 'refi' = 'buy';
let taxAfterTradeIn = true;
let taxesInLoan = true;
let refiFeesInLoan = false;
let byMonth = false;
let liveTimer: ReturnType<typeof setTimeout> | undefined;
let reportTimer: ReturnType<typeof setTimeout> | undefined;

const money = (value: number, fraction = digits) => formatNumber(value, { style: 'currency', currency, minimumFractionDigits: fraction, maximumFractionDigits: fraction });
const rate = (value: number) => formatPercent(value / 100, 2);
const press = (group: HTMLButtonElement[], active?: HTMLButtonElement) => group.forEach(chip => chip.setAttribute('aria-pressed', String(chip === active)));
const example = (value: number, fraction = 0) => formatNumber(value, { minimumFractionDigits: fraction, maximumFractionDigits: fraction });

function showError(field: HTMLInputElement, message?: string) {
  const error = $(`${field.id}-error`);
  error.hidden = !message;
  error.textContent = message ?? '';
  if (message) field.setAttribute('aria-invalid', 'true');
  else field.removeAttribute('aria-invalid');
}

/** An amount field: undefined when empty, and an error shown when it isn't a number. */
function readMoney(field: HTMLInputElement) {
  const value = parseAmount(field.value, locale);
  const bad = Number.isNaN(value);
  showError(field, bad ? t('autoLoan.errAmount', { example: example(25000) }) : undefined);
  return { value: bad ? undefined : value, bad };
}

function readRate(field: HTMLInputElement, max = MAX_APR, key = 'autoLoan.errRate') {
  const value = parseAmount(field.value, locale);
  const bad = Number.isNaN(value) || (value !== undefined && value > max);
  showError(field, bad ? t(key, { max: formatNumber(max) }) : undefined);
  return { value: bad ? undefined : value, bad };
}

function readMonths(field: HTMLInputElement) {
  const text = field.value.trim().normalize('NFKC');
  const value = Number(text);
  const bad = !!text && (!Number.isInteger(value) || value < 1 || value > MAX_MONTHS);
  showError(field, bad ? t('autoLoan.errMonths', { max: formatNumber(MAX_MONTHS) }) : undefined);
  return { value: bad || !text ? undefined : value, bad };
}

function setResult(name: string, text: string) {
  root.querySelector<HTMLElement>(`[data-result="${name}"]`)!.textContent = text;
}

// A pending announcement or report belongs to an answer that's no longer on screen.
function cancelPending() {
  clearTimeout(liveTimer);
  clearTimeout(reportTimer);
}

function clearResults(message: string) {
  cancelPending();
  root.querySelectorAll<HTMLElement>('[data-result]').forEach(cell => { cell.textContent = '–'; });
  breakdown.textContent = message;
  renderSchedule([]);
  renderTerms(undefined);
}

function updateBuy() {
  const price = readMoney(buy.price);
  const down = readMoney(buy.down);
  const tradeIn = readMoney(buy.tradeIn);
  const tradeOwed = readMoney(buy.tradeOwed);
  const fees = readMoney(buy.fees);
  const tax = readRate(buy.tax, MAX_TAX, 'autoLoan.errTax');
  const apr = readRate(buy.apr);
  const months = readMonths(buy.months);
  press(termChips, termChips.find(chip => Number(chip.dataset.term) === months.value));
  press(downChips, downChips.find(chip => price.value && down.value !== undefined && Math.round((price.value * Number(chip.dataset.down)) / 100) === down.value));
  $('loan-down-share').textContent = price.value && down.value ? t('autoLoan.downShare', { percent: formatPercent(down.value / price.value, 1) }) : '';

  if ([price, down, tradeIn, tradeOwed, fees, tax, apr, months].some(field => field.bad)) return clearResults(t('autoLoan.breakdownFix'));
  if (!price.value || apr.value === undefined || months.value === undefined) return clearResults(t('autoLoan.breakdownEmpty'));

  const result = calculateLoan({
    price: price.value, downPayment: down.value ?? 0, tradeIn: tradeIn.value ?? 0, tradeOwed: tradeOwed.value ?? 0,
    salesTaxPercent: tax.value ?? 0, taxAfterTradeIn, fees: fees.value ?? 0, taxesInLoan, apr: apr.value, months: months.value, digits,
  });
  setResult('payment', money(result.monthlyPayment));
  setResult('loanAmount', money(result.loanAmount));
  setResult('interest', money(result.totalInterest));
  setResult('totalCost', money(result.totalCost));
  setResult('upfront', money(result.upfront));
  setResult('salesTax', money(result.salesTax));
  renderSchedule(result.schedule);
  renderTerms(result.loanAmount > 0 ? { loanAmount: result.loanAmount, apr: apr.value, months: result.months } : undefined);

  if (result.loanAmount === 0) {
    cancelPending();
    breakdown.textContent = t('autoLoan.breakdownNoLoan');
    return;
  }
  const sentences = [counted('autoLoan.breakdownPayments', result.months, { payment: money(result.monthlyPayment), rate: rate(apr.value), total: money(result.totalPayments) })];
  if (result.lastPayment !== result.monthlyPayment) sentences.push(t('autoLoan.breakdownLast', { last: money(result.lastPayment) }));
  if (result.negativeEquity > 0) sentences.push(t('autoLoan.breakdownNegative', { amount: money(result.negativeEquity) }));
  breakdown.textContent = sentences.join(' ');
  announce(t('autoLoan.liveBuy', { payment: money(result.monthlyPayment), interest: money(result.totalInterest) }));
  report({ mode: 'buy', term: String(result.months), trade_in: String(!!tradeIn.value), taxes: taxesInLoan ? 'loan' : 'upfront', tax_base: taxAfterTradeIn ? 'after_trade_in' : 'full_price' });
}

function updateRefi() {
  const balance = readMoney(refi.balance);
  const payment = readMoney(refi.payment);
  const fees = readMoney(refi.fees);
  const apr = readRate(refi.apr);
  const newApr = readRate(refi.newApr);
  const months = readMonths(refi.months);
  press(refiTermChips, refiTermChips.find(chip => Number(chip.dataset.refiTerm) === months.value));
  showError(refi.payment, payment.bad ? t('autoLoan.errAmount', { example: example(450) }) : undefined);

  if ([balance, payment, fees, apr, newApr, months].some(field => field.bad)) return clearResults(t('autoLoan.breakdownFix'));
  if (!balance.value || !payment.value || apr.value === undefined || newApr.value === undefined || months.value === undefined) return clearResults(t('autoLoan.refiEmpty'));

  const outcome = calculateRefinance({ balance: balance.value, currentPayment: payment.value, currentApr: apr.value, newApr: newApr.value, newMonths: months.value, fees: fees.value ?? 0, feesInLoan: refiFeesInLoan, digits });
  if ('error' in outcome) {
    showError(refi.payment, outcome.error === 'tooLong'
      ? t('autoLoan.errPaymentTooLong', { years: formatNumber(MAX_PAYOFF_MONTHS / 12) })
      : t('autoLoan.errPaymentTooLow', { interest: money(Math.round(balance.value * apr.value / 12) / 100) }));
    return clearResults(t('autoLoan.breakdownFix'));
  }
  const result = outcome.result;
  const lower = result.monthlySavings >= 0;
  const saves = result.totalSavings >= 0;
  setResult('refiPayment', money(result.newPayment));
  setResult('refiMonthly', money(Math.abs(result.monthlySavings)));
  setResult('refiTotal', money(Math.abs(result.totalSavings)));
  setResult('refiInterest', money(result.newInterest));
  root.querySelector('[data-label="refiMonthly"]')!.textContent = t(lower ? 'autoLoan.refiLowerBy' : 'autoLoan.refiHigherBy');
  root.querySelector('[data-label="refiTotal"]')!.textContent = t(saves ? 'autoLoan.refiSaves' : 'autoLoan.refiCostsMore');
  renderSchedule(result.schedule);
  renderTerms({ loanAmount: result.newLoanAmount, apr: newApr.value, months: result.schedule.length });
  const sentences = [
    counted('autoLoan.refiCurrent', result.currentMonths, { interest: money(result.currentInterest), total: money(result.currentTotal) }),
    t('autoLoan.refiNew', { total: money(result.newTotal), interest: money(result.newInterest) }),
  ];
  // The schedule's payment column is hidden on phones, so the adjusted last payment is spelled out here.
  if (result.newLastPayment !== result.newPayment) sentences.push(t('autoLoan.breakdownLast', { last: money(result.newLastPayment) }));
  breakdown.textContent = sentences.join(' ');
  announce(t(saves ? 'autoLoan.liveRefiSaves' : 'autoLoan.liveRefiCosts', { payment: money(result.newPayment), amount: money(Math.abs(result.totalSavings)) }));
  report({ mode: 'refi', term: String(result.schedule.length), fees: refiFeesInLoan ? 'loan' : 'upfront', saves: String(saves) });
}

// The same loan at the usual terms, so the trade-off between payment and interest is plain.
function renderTerms(loan: { loanAmount: number; apr: number; months: number } | undefined) {
  root.querySelectorAll<HTMLTableRowElement>('tr[data-term-row]').forEach(row => {
    const months = Number(row.dataset.termRow);
    const result: LoanResult | undefined = loan && calculateLoan({ price: loan.loanAmount, downPayment: 0, tradeIn: 0, tradeOwed: 0, salesTaxPercent: 0, taxAfterTradeIn: true, fees: 0, taxesInLoan: true, apr: loan.apr, months, digits });
    const cells = row.querySelectorAll('td');
    cells[0].textContent = result ? money(result.monthlyPayment) : '–';
    cells[1].textContent = result ? money(result.totalInterest) : '–';
    row.classList.toggle('is-current', months === loan?.months);
  });
}

function renderSchedule(rows: ScheduleRow[]) {
  const body = $('loan-schedule-body');
  const shown = byMonth ? rows : yearlySchedule(rows);
  $('loan-schedule-first').textContent = t(byMonth ? 'autoLoan.colMonth' : 'autoLoan.colYear');
  $('loan-schedule').hidden = rows.length === 0;
  body.replaceChildren(...shown.map(row => {
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.scope = 'row';
    th.textContent = formatNumber(row.month);
    tr.append(th, ...[row.payment, row.principal, row.interest, row.balance].map(value => {
      const td = document.createElement('td');
      td.textContent = money(value);
      return td;
    }));
    return tr;
  }));
}

// Screen readers hear the answer once typing pauses, not on every keystroke.
function announce(text: string) {
  clearTimeout(liveTimer);
  liveTimer = setTimeout(() => { live.textContent = text; }, 1000);
}

// Only the settings the inputs settle on are reported. Prices, rates and payments never are.
function report(params: Record<string, string>) {
  clearTimeout(reportTimer);
  reportTimer = setTimeout(() => trackResult('success', { ...params, currency }), 1500);
}

function update() {
  if (mode === 'buy') updateBuy();
  else updateRefi();
}

function setCurrency(code: string) {
  currency = code;
  digits = currencyDigits(code);
  currencySelect.value = code;
  const { symbol, suffix } = currencyAffix(locale, code);
  root.querySelectorAll<HTMLElement>('[data-currency-symbol]').forEach(sign => {
    sign.textContent = symbol;
    sign.parentElement!.classList.toggle('is-suffix', suffix);
  });
}

function setMode(next: 'buy' | 'refi') {
  mode = next;
  press(modeChips, modeChips.find(chip => chip.dataset.mode === next));
  root.querySelectorAll<HTMLElement>('[data-panel]').forEach(panel => { panel.hidden = panel.dataset.panel !== next; });
  update();
}

const bindChoice = (group: HTMLButtonElement[], apply: (chip: HTMLButtonElement) => void) => group.forEach(chip => chip.addEventListener('click', () => { apply(chip); press(group, chip); update(); }));
modeChips.forEach(chip => chip.addEventListener('click', () => setMode(chip.dataset.mode === 'refi' ? 'refi' : 'buy')));
bindChoice(taxBaseChips, chip => { taxAfterTradeIn = chip.dataset.taxBase !== 'full'; });
bindChoice(taxesInChips, chip => { taxesInLoan = chip.dataset.taxesIn !== 'upfront'; });
bindChoice(refiFeesChips, chip => { refiFeesInLoan = chip.dataset.refiFees === 'loan'; });
bindChoice(viewChips, chip => { byMonth = chip.dataset.scheduleView === 'month'; });
termChips.forEach(chip => chip.addEventListener('click', () => { buy.months.value = chip.dataset.term!; update(); }));
refiTermChips.forEach(chip => chip.addEventListener('click', () => { refi.months.value = chip.dataset.refiTerm!; update(); }));
downChips.forEach(chip => chip.addEventListener('click', () => {
  const price = parseAmount(buy.price.value, locale);
  if (!price || Number.isNaN(price)) { buy.price.focus(); return; }
  buy.down.value = formatNumber(Math.round((price * Number(chip.dataset.down)) / 100), { useGrouping: false });
  update();
}));
ratePreset?.addEventListener('change', () => {
  if (!ratePreset.value) return;
  buy.apr.value = formatNumber(Number(ratePreset.value));
  update();
});
buy.apr.addEventListener('input', () => { if (ratePreset) ratePreset.value = ''; });
for (const field of [...Object.values(buy), ...Object.values(refi)]) field.addEventListener('input', update);
currencySelect.addEventListener('change', () => {
  setCurrency(currencySelect.value);
  try { localStorage.setItem(STORAGE_KEY, currency); } catch { /* storage can be blocked; the choice just isn't remembered */ }
  update();
});

// Currency: the visitor's last choice, else their region's currency, else the page language's.
let saved: string | null = null;
try { saved = localStorage.getItem(STORAGE_KEY); } catch { /* blocked storage */ }
const known = (code: string | null | undefined): code is string => !!code && (currencies as readonly string[]).includes(code);
const regional = navigator.languages.find(tag => tag.split('-')[0].toLowerCase() === locale.split('-')[0]);
const detected = known(saved) ? saved : regional ? currencyForLanguage(regional) : undefined;
if (known(detected) && detected !== currency) setCurrency(detected);
// The browser may restore typed values after a back navigation.
update();
