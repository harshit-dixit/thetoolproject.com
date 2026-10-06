import type { OvertimeDefaults } from '../data/overtime-defaults';
import { calculateOvertime, FLSA_PREMIUM, FLSA_WEEK_HOURS, MAX_HOURS, MAX_MULTIPLIER, PERIODS_PER_YEAR, type OvertimeResult, type PayBasis, type Period, type SalaryPeriod } from '../lib/overtime';
import { currencies, currencyAffix, currencyDigits, currencyForLanguage, parseAmount } from '../lib/tip-calculator';
import { i18nFrom } from '../i18n/client';
import { trackResult } from '../lib/analytics';

const root = document.querySelector<HTMLElement>('#overtime-tool')!;
const { t, counted, formatNumber, formatPercent } = i18nFrom(root);
const locale = root.dataset.locale || 'en';
const defaults = JSON.parse(root.dataset.defaults!) as OvertimeDefaults;
const STORAGE_KEY = 'overtime-currency';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = (id: string) => $<HTMLInputElement>(id);
const fields = { rate: input('ot-rate'), salary: input('ot-salary'), regular: input('ot-regular'), hours: input('ot-hours'), multiplier: input('ot-multiplier'), hours2: input('ot-hours2'), multiplier2: input('ot-multiplier2'), bonus: input('ot-bonus') };
const salaryPeriod = $<HTMLSelectElement>('ot-salary-period');
const currencySelect = $<HTMLSelectElement>('ot-currency');
const breakdown = $('ot-breakdown');
const live = $('ot-live');
const taxLink = document.querySelector<HTMLAnchorElement>('#ot-tax-link');
const taxQualified = document.getElementById('ot-tax-qualified')!;
const taxPath = taxLink?.getAttribute('href') ?? '';
const chips = (name: string) => [...root.querySelectorAll<HTMLButtonElement>(`[data-${name}]`)];
const basisChips = chips('basis');
const periodChips = chips('period');
const multiplierChips = chips('multiplier');

let currency = defaults.currency;
let digits = currencyDigits(currency);
let basis: PayBasis = defaults.basis;
let period: Period = defaults.period;
let liveTimer: ReturnType<typeof setTimeout> | undefined;
let reportTimer: ReturnType<typeof setTimeout> | undefined;

const money = (value: number, fraction = digits) => formatNumber(value, { style: 'currency', currency, minimumFractionDigits: fraction, maximumFractionDigits: fraction });
const usd = (value: number, fraction = 2) => formatNumber(value, { style: 'currency', currency: 'USD', minimumFractionDigits: fraction, maximumFractionDigits: fraction });
const press = (group: HTMLButtonElement[], active?: HTMLButtonElement) => group.forEach(chip => chip.setAttribute('aria-pressed', String(chip === active)));
const example = (value: number) => formatNumber(value, { maximumFractionDigits: 2 });

function showError(field: HTMLInputElement, message?: string) {
  const error = $(`${field.id}-error`);
  error.hidden = !message;
  error.textContent = message ?? '';
  if (message) field.setAttribute('aria-invalid', 'true');
  else field.removeAttribute('aria-invalid');
}

/** A number field: undefined when empty, and an error shown when it isn't a number in range. */
function read(field: HTMLInputElement, message: () => string, max = Infinity, min = 0) {
  const value = parseAmount(field.value, locale);
  const bad = Number.isNaN(value) || (value !== undefined && (value < min || value > max));
  showError(field, bad ? message() : undefined);
  return { value: bad ? undefined : value, bad };
}
const readMoney = (field: HTMLInputElement, sample: number) => read(field, () => t('overtime.errAmount', { example: example(sample) }));
const readHours = (field: HTMLInputElement) => read(field, () => t('overtime.errHours', { example: example(8) }), MAX_HOURS[period]);
const readMultiplier = (field: HTMLInputElement) => read(field, () => t('overtime.errMultiplier', { max: formatNumber(MAX_MULTIPLIER) }), MAX_MULTIPLIER, 1);

function setResult(name: string, text: string) {
  root.querySelector<HTMLElement>(`[data-result="${name}"]`)!.textContent = text;
}
const showRow = (name: string, shown: boolean) => root.querySelectorAll<HTMLElement>(`[data-row="${name}"]`).forEach(row => { row.hidden = !shown; });

// A pending announcement or report belongs to an answer that's no longer on screen.
function cancelPending() {
  clearTimeout(liveTimer);
  clearTimeout(reportTimer);
}

function clearResults(message: string) {
  cancelPending();
  root.querySelectorAll<HTMLElement>('[data-result]').forEach(cell => { cell.textContent = '–'; });
  breakdown.textContent = message;
  updateTaxLink();
}

function update() {
  const rate = readMoney(fields.rate, 20);
  const salary = readMoney(fields.salary, 52000);
  const regular = readHours(fields.regular);
  const overtimeHours = readHours(fields.hours);
  const multiplier = readMultiplier(fields.multiplier);
  const secondHours = readHours(fields.hours2);
  const secondMultiplier = readMultiplier(fields.multiplier2);
  const bonus = readMoney(fields.bonus, 100);
  press(multiplierChips, multiplierChips.find(chip => Number(chip.dataset.multiplier) === multiplier.value));
  // The hidden pay field doesn't count, so a leftover mistake there can't block the answer.
  const pay = basis === 'hourly' ? rate : salary;
  showError(basis === 'hourly' ? fields.salary : fields.rate);

  const all = [pay, regular, overtimeHours, multiplier, secondHours, secondMultiplier, bonus];
  if (all.some(field => field.bad)) return clearResults(t('overtime.breakdownFix'));
  const empty = t(basis === 'hourly' ? 'overtime.breakdownEmpty' : 'overtime.breakdownEmptySalary');
  if (!pay.value || multiplier.value === undefined || (basis === 'salary' && !regular.value)) {
    if (basis === 'salary' && pay.value && !regular.value && regular.value !== undefined) showError(fields.regular, t('overtime.errNoRegular'));
    return clearResults(empty);
  }

  const outcome = calculateOvertime({
    basis, hourlyRate: rate.value ?? 0, salary: salary.value ?? 0, salaryPeriod: salaryPeriod.value as SalaryPeriod, period,
    regularHours: regular.value ?? 0, overtimeHours: overtimeHours.value ?? 0, multiplier: multiplier.value,
    secondHours: secondHours.value ?? 0, secondMultiplier: secondMultiplier.value ?? multiplier.value, bonus: bonus.value ?? 0, digits,
    // On the US page, regular hours past 40 in a week are owed the FLSA premium, as a salary for 45 hours is.
    weeklyLimit: defaults.usTax ? FLSA_WEEK_HOURS : undefined,
  });
  if ('error' in outcome) {
    showError(outcome.error === 'noRegularHours' ? fields.regular : fields.hours, outcome.error === 'noRegularHours'
      ? t('overtime.errNoRegular')
      : t(`overtime.errTooManyHours.${period}`, { max: formatNumber(MAX_HOURS[period]) }));
    return clearResults(t('overtime.breakdownFix'));
  }
  const result = outcome.result;
  const second = (secondHours.value ?? 0) > 0;
  const extra = result.overtimePay + result.limitPay + result.secondPay;
  setResult('overtimePay', money(extra));
  setResult('overtimeRate', money(result.overtimeRate));
  setResult('secondRate', money(result.secondRate));
  setResult('secondPay', money(result.secondPay));
  setResult('regularRate', money(result.regularRate));
  setResult('regularPay', money(result.regularPay));
  setResult('bonus', money(result.bonus));
  setResult('totalPay', money(result.totalPay));
  showRow('second', second);
  showRow('bonus', result.bonus > 0);

  // The hours are shown at the rate before any bonus, and the bonus's share of the overtime on its own, so each sentence adds up.
  const hours = overtimeHours.value ?? 0;
  const sentences: string[] = [];
  if (hours > 0 || result.limitHours === 0) sentences.push(counted('overtime.breakdown', hours, { rate: money(result.baseRate * multiplier.value), pay: money(result.baseRate * multiplier.value * hours) }));
  if (result.limitHours > 0) sentences.push(counted('overtime.breakdownLimit', result.limitHours, { pay: money(FLSA_PREMIUM * result.baseRate * result.limitHours) }));
  if (result.bonusOvertime > 0) sentences.push(t('overtime.breakdownBonus', { amount: money(result.bonusOvertime) }));
  const base = result.regularPay + result.bonus;
  if (extra > 0 && base > 0) sentences.push(t('overtime.breakdownShare', { percent: formatPercent(extra / base) }));
  breakdown.textContent = sentences.join(' ');
  updateTaxLink(result);
  announce(t('overtime.live', { pay: money(extra), total: money(result.totalPay) }));
  report({ basis, period, multiplier: String(multiplier.value), second: String(second), bonus: String(result.bonus > 0) });
}

/** The link to the no tax on overtime calculator, on the English page: this week's qualified overtime, and the hours to carry over. */
function updateTaxLink(result?: OvertimeResult) {
  if (!taxLink) return;
  // The deduction counts hours over 40 in a workweek and is in dollars, so only a week in US dollars has an amount to show.
  const shown = result && period === 'week' && currency === 'USD' && result.qualified > 0 ? result : undefined;
  taxQualified.textContent = shown ? t('overtime.taxQualified', { qualified: usd(shown.qualified) }) : t('overtime.taxTeaser');
  if (!shown) { taxLink.href = taxPath; return; }
  // One rate, the hours past 40 and the premium they average, so the other calculator arrives at the same qualified amount.
  const mult = 1 + shown.qualified / (shown.regularRate * shown.flsaHours);
  const handoff = new URLSearchParams({ rate: String(Math.round(shown.regularRate * 100) / 100), hours: String(shown.flsaHours), mult: String(Math.round(mult * 100) / 100) });
  taxLink.href = `${taxPath}#${handoff}`;
}

// Screen readers hear the answer once typing pauses, not on every keystroke.
function announce(text: string) {
  clearTimeout(liveTimer);
  liveTimer = setTimeout(() => { live.textContent = text; }, 1000);
}

// Only the settings the inputs settle on are reported. Pay and hours never are.
function report(params: Record<string, string>) {
  clearTimeout(reportTimer);
  reportTimer = setTimeout(() => trackResult('success', { ...params, currency }), 1500);
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

// The labels name the period, and the salary's hours label differs from an hourly worker's.
function relabel() {
  $('ot-regular-label').textContent = t(`overtime.${basis === 'salary' ? 'regularSalaryLabel' : 'regularLabel'}.${period}`);
  $('ot-hours-label').textContent = t(`overtime.hoursLabel.${period}`);
  $('ot-hours2-label').textContent = t(`overtime.secondLabel.${period}`);
  $('ot-bonus-label').textContent = t(`overtime.bonusLabel.${period}`);
  $('ot-total-label').textContent = t(`overtime.resultTotal.${period}`);
}

function setBasis(next: PayBasis) {
  basis = next;
  press(basisChips, basisChips.find(chip => chip.dataset.basis === next));
  root.querySelectorAll<HTMLElement>('[data-basis-panel]').forEach(panel => { panel.hidden = panel.dataset.basisPanel !== next; });
  relabel();
  update();
}

function setPeriod(next: Period) {
  if (next === period) return;
  // Regular hours move with the period when they're still the starting value: 40 a week is about 173 a month.
  const regular = parseAmount(fields.regular.value, locale);
  const ratio = PERIODS_PER_YEAR.week / PERIODS_PER_YEAR.month;
  if (regular !== undefined && !Number.isNaN(regular)) {
    const converted = next === 'month' ? regular * ratio : regular / ratio;
    fields.regular.value = formatNumber(Math.round(converted * 100) / 100, { useGrouping: false, maximumFractionDigits: 2 });
  }
  period = next;
  press(periodChips, periodChips.find(chip => chip.dataset.period === next));
  relabel();
  update();
}

basisChips.forEach(chip => chip.addEventListener('click', () => setBasis(chip.dataset.basis === 'salary' ? 'salary' : 'hourly')));
periodChips.forEach(chip => chip.addEventListener('click', () => setPeriod(chip.dataset.period === 'month' ? 'month' : 'week')));
multiplierChips.forEach(chip => chip.addEventListener('click', () => { fields.multiplier.value = formatNumber(Number(chip.dataset.multiplier)); update(); }));
for (const field of Object.values(fields)) field.addEventListener('input', update);
salaryPeriod.addEventListener('change', update);
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
