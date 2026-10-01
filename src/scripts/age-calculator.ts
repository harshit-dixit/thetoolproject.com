import { ageBand, calculateAge, parseIsoDate, toIsoDate, type AgeResult, type CivilDate, type Span } from '../lib/age-calculator';
import { i18nFrom } from '../i18n/client';
import { trackResult } from '../lib/analytics';

const root = document.querySelector<HTMLElement>('#age-calculator-tool')!;
const { t, counted, formatNumber, locale } = i18nFrom(root);

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const birthInput = $<HTMLInputElement>('age-birth');
const onInput = $<HTMLInputElement>('age-on');
const todayButton = $<HTMLButtonElement>('age-on-today');
const birthError = $('age-birth-error');
const breakdown = $('age-breakdown');
const live = $('age-live');
const units = new Intl.ListFormat(locale, { type: 'unit', style: 'long' });
let liveTimer: ReturnType<typeof setTimeout> | undefined;
let reportTimer: ReturnType<typeof setTimeout> | undefined;

// Dates are formatted at midnight UTC so the browser's time zone can't move them to the day before.
const utc = ({ year, month, day }: CivilDate) => {
  const date = new Date(Date.UTC(2000, month - 1, day));
  date.setUTCFullYear(year);
  return date;
};
const longDate = new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' });
const fullDate = new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeZone: 'UTC' });
const weekdayName = new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' });

const amount = (unit: string, count: number) => counted(`age.unit.${unit}`, count);
/** "5 months, 14 days": the non-zero parts, or days alone when everything is zero. */
const spanText = ({ years, months, days }: Span) => {
  const parts = [years && amount('years', years), months && amount('months', months), days && amount('days', days)].filter(Boolean) as string[];
  return units.format(parts.length ? parts : [amount('days', 0)]);
};
const withRemainder = (unit: string, count: number, days: number) => units.format(days ? [amount(unit, count), amount('days', days)] : [amount(unit, count)]);

function today(): CivilDate {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

function show(name: string, text: string) {
  root.querySelector<HTMLElement>(`[data-result="${name}"]`)!.textContent = text;
}

function render(result: AgeResult | undefined, birth?: CivilDate) {
  show('years', result ? formatNumber(result.years) : '–');
  show('months', result ? formatNumber(result.months) : '–');
  show('days', result ? formatNumber(result.days) : '–');
  show('totalMonths', result ? withRemainder('months', result.totalMonths, result.days) : '–');
  show('weeks', result ? withRemainder('weeks', result.weeks, result.weekDays) : '–');
  show('totalDays', result ? amount('days', result.totalDays) : '–');
  show('hours', result ? amount('hours', result.totalDays * 24) : '–');
  show('minutes', result ? amount('minutes', result.totalDays * 1440) : '–');
  show('nextDate', result ? fullDate.format(utc(result.nextBirthday)) : '–');
  show('nextWhen', !result ? '' : result.daysUntilNext === 0
    ? counted('age.nextToday', result.nextAge)
    : counted('age.nextIn', result.nextAge, { countdown: spanText(result.untilNext) }));
  breakdown.textContent = result && birth
    ? t('age.breakdown', { days: amount('days', result.totalDays), date: longDate.format(utc(birth)), weekday: weekdayName.format(utc(birth)) })
    : t('age.breakdownEmpty');
}

function update() {
  const birth = parseIsoDate(birthInput.value);
  const on = parseIsoDate(onInput.value) ?? today();
  todayButton.hidden = onInput.value === toIsoDate(today());
  const outcome = birth ? calculateAge(birth, on) : undefined;
  const after = outcome && 'error' in outcome;
  birthError.hidden = !after;
  birthError.textContent = after ? t('age.errBirthAfter') : '';
  if (after) birthInput.setAttribute('aria-invalid', 'true');
  else birthInput.removeAttribute('aria-invalid');
  const result = outcome && 'result' in outcome ? outcome.result : undefined;
  render(result, birth);
  if (result) {
    announce(result);
    report(result, onInput.value === toIsoDate(today()));
  }
}

// Screen readers hear the age once typing pauses, not on every keystroke.
function announce(result: AgeResult) {
  clearTimeout(liveTimer);
  liveTimer = setTimeout(() => { live.textContent = t('age.liveSummary', { age: spanText(result) }); }, 1000);
}

// Only a coarse age band is reported, once the dates settle. The dates themselves never leave the page.
function report(result: AgeResult, onToday: boolean) {
  clearTimeout(reportTimer);
  reportTimer = setTimeout(() => trackResult('success', { age_band: ageBand(result.years), as_of: onToday ? 'today' : 'other' }), 1500);
}

birthInput.addEventListener('input', update);
onInput.addEventListener('input', update);
todayButton.addEventListener('click', () => {
  onInput.value = toIsoDate(today());
  update();
  onInput.focus();
});
// The browser may restore typed dates after a back navigation; otherwise "age on" starts at today.
if (!parseIsoDate(onInput.value)) onInput.value = toIsoDate(today());
update();
