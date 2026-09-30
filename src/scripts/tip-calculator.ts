import type { TipDefaults } from '../data/tip-defaults';
import { calculateTip, currencies, currencyAffix, currencyDigits, currencyForLanguage, MAX_PEOPLE, MAX_PERCENT, parseAmount, roundingSteps, type TipBase, type TipResult } from '../lib/tip-calculator';
import { i18nFrom } from '../i18n/client';
import { trackResult } from '../lib/analytics';

const root = document.querySelector<HTMLElement>('#tip-calculator-tool')!;
const { t, formatNumber, formatPercent } = i18nFrom(root);
const locale = root.dataset.locale || 'en';
const defaults = JSON.parse(root.dataset.defaults!) as TipDefaults;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const billInput = $<HTMLInputElement>('tip-bill');
const tipInput = $<HTMLInputElement>('tip-percent');
const peopleInput = $<HTMLInputElement>('tip-people');
const taxInput = $<HTMLInputElement>('tip-tax');
const currencySelect = $<HTMLSelectElement>('tip-currency');
const breakdown = $('tip-breakdown');
const live = $('tip-live');
const tipChips = [...root.querySelectorAll<HTMLButtonElement>('[data-tip]')];
const tipOnChips = [...root.querySelectorAll<HTMLButtonElement>('[data-tip-on]')];
const roundChips = [...root.querySelectorAll<HTMLButtonElement>('[data-round]')];
const STORAGE_KEY = 'tip-calculator-currency';

let currency = defaults.currency;
let digits = currencyDigits(currency);
let tipOn: TipBase = 'bill';
let roundIndex = 0;
let liveTimer: ReturnType<typeof setTimeout> | undefined;
let reportTimer: ReturnType<typeof setTimeout> | undefined;

const money = (value: number, fraction = digits) => formatNumber(value, { style: 'currency', currency, minimumFractionDigits: fraction, maximumFractionDigits: fraction });
const percent = (rate: number) => formatPercent(rate, 1);
const press = (chips: HTMLButtonElement[], active?: HTMLButtonElement) => chips.forEach(chip => chip.setAttribute('aria-pressed', String(chip === active)));

function showError(input: HTMLInputElement, message?: string) {
  const error = $(`${input.id}-error`);
  error.hidden = !message;
  error.textContent = message ?? '';
  if (message) input.setAttribute('aria-invalid', 'true');
  else input.removeAttribute('aria-invalid');
}

function readPeople() {
  const text = peopleInput.value.trim();
  const value = Number(text.normalize('NFKC'));
  if (!text) return { people: 1 };
  if (!Number.isInteger(value) || value < 1 || value > MAX_PEOPLE) return { people: 1, invalid: true };
  return { people: value };
}

function setResults(result: TipResult | undefined, people: number) {
  const show = (name: string, value: number | undefined) => { root.querySelector<HTMLElement>(`[data-result="${name}"]`)!.textContent = value === undefined ? '–' : money(value); };
  show('tip', result?.tip);
  show('total', result?.total);
  show('tipPerPerson', result?.tipPerPerson);
  show('perPerson', result?.perPerson);
  $('tip-split').hidden = people < 2;
}

function renderTable(bill: number | undefined, tax: number, people: number, roundTo: number, tipPercent: number | undefined) {
  root.querySelectorAll<HTMLElement>('[data-split-column]').forEach(cell => { cell.hidden = people < 2; });
  root.querySelector('.tip-table')!.classList.toggle('is-split', people > 1);
  root.querySelectorAll<HTMLTableRowElement>('tr[data-row]').forEach(row => {
    const rate = Number(row.dataset.row);
    const outcome = bill === undefined ? undefined : calculateTip({ bill, tax, tipPercent: rate, people, tipOn, roundTo, digits });
    const result = outcome && 'result' in outcome ? outcome.result : undefined;
    const cells = row.querySelectorAll('td');
    cells[0].textContent = result ? money(result.tip) : '–';
    cells[1].textContent = result ? money(result.total) : '–';
    cells[2].textContent = result ? money(result.perPerson) : '–';
    row.classList.toggle('is-current', rate === tipPercent);
  });
}

function update() {
  const bill = parseAmount(billInput.value, locale);
  const tipPercent = parseAmount(tipInput.value, locale);
  const tax = tipOn === 'preTax' ? parseAmount(taxInput.value, locale) : 0;
  const { people, invalid: peopleInvalid } = readPeople();
  const example = (value: number, fraction = 0) => formatNumber(value, { minimumFractionDigits: fraction, maximumFractionDigits: fraction });

  const billBad = Number.isNaN(bill);
  const tipBad = tipPercent === undefined || Number.isNaN(tipPercent) || tipPercent > MAX_PERCENT;
  const taxBad = Number.isNaN(tax);
  showError(billInput, billBad ? t('tip.errBill', { example: example(48.5, digits) }) : undefined);
  showError(tipInput, tipBad && tipInput.value.trim() ? t('tip.errTip', { example: example(18) }) : undefined);
  showError(peopleInput, peopleInvalid ? t('tip.errPeople') : undefined);
  press(tipChips, tipChips.find(chip => Number(chip.dataset.tip) === tipPercent));

  const usableBill = billBad || bill === undefined ? undefined : bill;
  const rate = tipBad ? 0 : tipPercent!;
  const roundTo = roundIndex ? roundingSteps(digits)[roundIndex - 1] ?? 0 : 0;
  const outcome = usableBill === undefined || taxBad
    ? undefined
    : calculateTip({ bill: usableBill, tax: tax ?? 0, tipPercent: rate, people, tipOn, roundTo, digits });
  const taxTooHigh = outcome && 'error' in outcome;
  showError(taxInput, taxBad || taxTooHigh ? t('tip.errTax') : undefined);
  const result = outcome && 'result' in outcome ? outcome.result : undefined;

  setResults(billBad || taxBad || taxTooHigh ? undefined : result ?? (usableBill === undefined ? zeroResult() : undefined), people);
  renderTable(taxBad || taxTooHigh ? undefined : usableBill, tax ?? 0, people, roundTo, tipBad ? undefined : tipPercent);

  if (!result || !usableBill) { breakdown.textContent = t('tip.breakdownEmpty'); return; }
  const sentences = [t(tipOn === 'preTax' ? 'tip.breakdownPreTax' : 'tip.breakdownBill', { percent: percent(rate / 100), base: money(result.base) })];
  if (result.rounding > 0) {
    sentences.push(result.tip > 0
      ? t('tip.breakdownRoundingTip', { amount: money(result.rounding), percent: percent(result.effectiveRate) })
      : t('tip.breakdownRounding', { amount: money(result.rounding) }));
  }
  breakdown.textContent = sentences.join(' ');
  announce(result, people);
  report(rate, people);
}

const zeroResult = (): TipResult => ({ base: 0, tip: 0, rounding: 0, total: 0, perPerson: 0, tipPerPerson: 0, effectiveRate: 0 });

// Screen readers hear the answer once typing pauses, not on every keystroke.
function announce(result: TipResult, people: number) {
  clearTimeout(liveTimer);
  liveTimer = setTimeout(() => {
    live.textContent = people > 1
      ? t('tip.liveSummary', { tip: money(result.tip), total: money(result.total), each: money(result.perPerson) })
      : t('tip.liveSummaryOne', { tip: money(result.tip), total: money(result.total) });
  }, 1000);
}

// The answer changes on every keystroke, so only the one the inputs settle on is reported. The bill never is.
function report(rate: number, people: number) {
  clearTimeout(reportTimer);
  reportTimer = setTimeout(() => trackResult('success', {
    tip_percent: defaults.presets.includes(rate) ? String(rate) : 'custom',
    people: people >= 10 ? '10+' : String(people),
    tip_on: tipOn,
    round: roundIndex ? String(roundingSteps(digits)[roundIndex - 1]) : 'off',
    currency,
  }), 1500);
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
  billInput.placeholder = formatNumber(0, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  roundingSteps(digits).forEach((step, index) => { roundChips[index + 1].textContent = money(step, 0); });
}

tipChips.forEach(chip => chip.addEventListener('click', () => { tipInput.value = formatNumber(Number(chip.dataset.tip)); update(); }));
tipOnChips.forEach(chip => chip.addEventListener('click', () => {
  tipOn = chip.dataset.tipOn === 'preTax' ? 'preTax' : 'bill';
  press(tipOnChips, chip);
  $('tip-tax-field').hidden = tipOn !== 'preTax';
  update();
}));
roundChips.forEach(chip => chip.addEventListener('click', () => { roundIndex = Number(chip.dataset.round); press(roundChips, chip); update(); }));
for (const [id, change] of [['tip-people-down', -1], ['tip-people-up', 1]] as const) {
  $(id).addEventListener('click', () => {
    const next = Math.min(MAX_PEOPLE, Math.max(1, readPeople().people + change));
    peopleInput.value = formatNumber(next, { useGrouping: false });
    update();
  });
}
for (const input of [billInput, tipInput, peopleInput, taxInput]) input.addEventListener('input', update);
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
