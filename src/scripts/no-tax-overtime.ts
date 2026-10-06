import { calculateDeduction, calculateOvertime, DEDUCTION_CAP, FLSA_WEEK_HOURS, MAX_HOURS, MAX_MULTIPLIER, PERIODS_PER_YEAR, PHASE_OUT_START, type FilingStatus } from '../lib/overtime';
import { parseAmount } from '../lib/tip-calculator';
import { i18nFrom } from '../i18n/client';
import { trackResult } from '../lib/analytics';

type Source = 'hours' | 'w2';

const root = document.querySelector<HTMLElement>('#no-tax-tool')!;
const { t, formatNumber } = i18nFrom(root);
const locale = root.dataset.locale || 'en';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = (id: string) => $<HTMLInputElement>(id);
const fields = { rate: input('nt-rate'), hours: input('nt-hours'), weeks: input('nt-weeks'), multiplier: input('nt-multiplier'), own: input('nt-own'), spouse: input('nt-spouse'), income: input('nt-income') };
const bracketSelect = root.querySelector<HTMLSelectElement>('[data-tax-bracket]')!;
const breakdown = $('nt-breakdown');
const live = $('nt-live');
const chips = (name: string) => [...root.querySelectorAll<HTMLButtonElement>(`[data-${name}]`)];
const sourceChips = chips('source');
const multiplierChips = chips('multiplier');
const filingChips = chips('filing');

let source: Source = 'hours';
let filing: FilingStatus = 'single';
let liveTimer: ReturnType<typeof setTimeout> | undefined;
let reportTimer: ReturnType<typeof setTimeout> | undefined;

// The deduction and its limits are in US dollars.
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
function read(field: HTMLInputElement, message: () => string, max = Infinity, min = 0, whole = false) {
  const value = parseAmount(field.value, locale);
  const bad = Number.isNaN(value) || (value !== undefined && (value < min || value > max || (whole && !Number.isInteger(value))));
  showError(field, bad ? message() : undefined);
  return { value: bad ? undefined : value, bad };
}
const readMoney = (field: HTMLInputElement, sample: number) => read(field, () => t('overtime.errAmount', { example: example(sample) }));
const unused = { value: undefined, bad: false };

function setResult(name: string, text: string) {
  root.querySelector<HTMLElement>(`[data-result="${name}"]`)!.textContent = text;
}

function clearResults(message: string) {
  clearTimeout(liveTimer);
  clearTimeout(reportTimer);
  root.querySelectorAll<HTMLElement>('[data-result]').forEach(cell => { cell.textContent = '–'; });
  breakdown.textContent = message;
}

function update() {
  const hoursMode = source === 'hours';
  // Only the fields on show count, so a leftover mistake in a hidden one can't block the answer.
  const rate = hoursMode ? readMoney(fields.rate, 20) : unused;
  // Overtime here is every hour past 40, so the week has 128 more at most.
  const hours = hoursMode ? read(fields.hours, () => t('overtime.errHours', { example: example(10) }), MAX_HOURS.week - FLSA_WEEK_HOURS) : unused;
  const weeks = hoursMode ? read(fields.weeks, () => t('noTax.errWeeks', { max: formatNumber(PERIODS_PER_YEAR.week) }), PERIODS_PER_YEAR.week, 0, true) : unused;
  const multiplier = hoursMode ? read(fields.multiplier, () => t('overtime.errMultiplier', { max: formatNumber(MAX_MULTIPLIER) }), MAX_MULTIPLIER, 1) : unused;
  const own = hoursMode ? unused : readMoney(fields.own, 3250);
  const spouse = filing === 'joint' ? readMoney(fields.spouse, 5000) : unused;
  const income = readMoney(fields.income, 90000);
  for (const [field, used] of [[fields.rate, hoursMode], [fields.hours, hoursMode], [fields.weeks, hoursMode], [fields.multiplier, hoursMode], [fields.own, !hoursMode], [fields.spouse, filing === 'joint']] as const) {
    if (!used) showError(field);
  }
  press(multiplierChips, multiplierChips.find(chip => Number(chip.dataset.multiplier) === multiplier.value));

  if ([rate, hours, weeks, multiplier, own, spouse, income].some(field => field.bad)) return clearResults(t('overtime.breakdownFix'));
  const empty = hoursMode ? t('noTax.breakdownEmpty', { cap: usd(DEDUCTION_CAP.single, 0) }) : t('noTax.breakdownEmptyW2');
  if (hoursMode ? !rate.value || hours.value === undefined || multiplier.value === undefined : own.value === undefined) return clearResults(empty);

  // The overtime calculator's rules: the FLSA's extra half for each hour past 40, never more than was paid.
  let weekly: { qualified: number; pay: number } | undefined;
  if (hoursMode) {
    const outcome = calculateOvertime({
      basis: 'hourly', hourlyRate: rate.value!, salary: 0, salaryPeriod: 'year', period: 'week', regularHours: FLSA_WEEK_HOURS,
      overtimeHours: hours.value!, multiplier: multiplier.value!, secondHours: 0, secondMultiplier: multiplier.value!, bonus: 0, digits: 2,
    });
    if ('error' in outcome) return clearResults(t('overtime.breakdownFix'));
    weekly = { qualified: outcome.result.qualified, pay: outcome.result.overtimePay };
  }
  const yearly = weekly ? weekly.qualified * (weeks.value ?? 0) : own.value!;
  const bracket = bracketSelect.value ? Number(bracketSelect.value) : undefined;
  const outcome = calculateDeduction({ qualified: yearly + (spouse.value ?? 0), status: filing, income: income.value, bracket, digits: 2 });

  setResult('deduction', usd(outcome.deduction));
  setResult('qualifiedWeek', weekly ? usd(weekly.qualified) : '–');
  setResult('qualifiedYear', usd(yearly));
  setResult('taxSaved', outcome.taxSaved === undefined ? '–' : usd(outcome.taxSaved));

  const sentences: string[] = [];
  if (weekly && weekly.qualified > 0) sentences.push(t('noTax.breakdownHalf', { qualified: usd(weekly.qualified), pay: usd(weekly.pay) }));
  if (!outcome.eligible) sentences.push(t('noTax.breakdownSeparate'));
  else {
    const status = filing === 'joint' ? 'joint' : 'single';
    if (outcome.overCap) sentences.push(t('noTax.breakdownCap', { cap: usd(DEDUCTION_CAP[status], 0) }));
    if (outcome.reduction > 0) sentences.push(t('noTax.breakdownPhase', { start: usd(PHASE_OUT_START[status], 0), reduction: usd(outcome.reduction, 0) }));
  }
  breakdown.textContent = sentences.length ? sentences.join(' ') : empty;
  announce(t('noTax.live', { deduction: usd(outcome.deduction) }));
  // Only the choices are reported. Pay, hours, income, the W-2 amount, the bracket and the deduction never are.
  report({ source, filing, ...(hoursMode ? { multiplier: String(multiplier.value) } : {}) });
}

// Screen readers hear the answer once typing pauses, not on every keystroke.
function announce(text: string) {
  clearTimeout(liveTimer);
  liveTimer = setTimeout(() => { live.textContent = text; }, 1000);
}

function report(params: Record<string, string>) {
  clearTimeout(reportTimer);
  reportTimer = setTimeout(() => trackResult('success', params), 1500);
}

function setSource(next: Source) {
  source = next;
  press(sourceChips, sourceChips.find(chip => chip.dataset.source === next));
  root.querySelectorAll<HTMLElement>('[data-source-panel]').forEach(panel => { panel.hidden = panel.dataset.sourcePanel !== next; });
  root.querySelector<HTMLElement>('[data-row="week"]')!.hidden = next !== 'hours';
  update();
}

sourceChips.forEach(chip => chip.addEventListener('click', () => setSource(chip.dataset.source === 'w2' ? 'w2' : 'hours')));
multiplierChips.forEach(chip => chip.addEventListener('click', () => { fields.multiplier.value = formatNumber(Number(chip.dataset.multiplier)); update(); }));
filingChips.forEach(chip => chip.addEventListener('click', () => {
  filing = (chip.dataset.filing as FilingStatus) || 'single';
  press(filingChips, chip);
  $('nt-spouse-field').hidden = filing !== 'joint';
  update();
}));
for (const field of Object.values(fields)) field.addEventListener('input', update);
bracketSelect.addEventListener('change', update);

// The overtime calculator links here with its answer in the fragment, which never reaches a server or analytics.
// The fields are filled from it once, then it's taken out of the address bar so the pay isn't left in a shared link.
const handoff = new URLSearchParams(location.hash.slice(1));
const handed = (name: string) => {
  const value = Number(handoff.get(name));
  return handoff.has(name) && Number.isFinite(value) && value >= 0 ? formatNumber(value, { useGrouping: false, maximumFractionDigits: 2 }) : undefined;
};
const prefill: [HTMLInputElement, string | undefined][] = [[fields.rate, handed('rate')], [fields.hours, handed('hours')], [fields.multiplier, handed('mult')]];
if (prefill.some(([, value]) => value !== undefined)) {
  for (const [field, value] of prefill) if (value !== undefined) field.value = value;
  history.replaceState(history.state, '', location.pathname + location.search);
}
// The browser may restore typed values after a back navigation.
update();
