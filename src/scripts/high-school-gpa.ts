import { calculateGpa, roundGpa, letterForGpa, letterFromPercent, MAX_CLASSES, MAX_CREDITS, parseNumber, percentRange, type APlus, type Course, type Grade, type GpaResult, type Level } from '../lib/high-school-gpa';
import { i18nFrom } from '../i18n/client';
import { trackResult } from '../lib/analytics';

const root = document.querySelector<HTMLElement>('#hs-gpa-tool')!;
const { t, counted, formatNumber, formatPercent } = i18nFrom(root);
const START_ROWS = Number(root.dataset.startRows) || 6;
const MAX_EARLIER_GPA = 6;
const MAX_EARLIER_UNITS = 500;
const STORAGE_KEY = 'high-school-gpa';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const rowsBox = $('hs-gpa-rows');
const classes = $('hs-gpa-classes');
const breakdown = $('hs-gpa-breakdown');
const live = $('hs-gpa-live');
const classesError = $('hs-gpa-classes-error');
const earlierError = $('hs-gpa-earlier-error');
const earlierInputs = { unweighted: $<HTMLInputElement>('hs-gpa-earlier-unweighted'), weighted: $<HTMLInputElement>('hs-gpa-earlier-weighted'), units: $<HTMLInputElement>('hs-gpa-earlier-units') };
const template = rowsBox.querySelector<HTMLFieldSetElement>('[data-row]')!.cloneNode(true) as HTMLFieldSetElement;
// Cloning copies what the browser may have restored into the first row, so the template starts blank.
template.querySelectorAll('input').forEach(input => { input.value = input.defaultValue; input.removeAttribute('aria-invalid'); });
template.querySelectorAll('select').forEach(select => { select.selectedIndex = 0; });
template.querySelector('[data-derived]')!.textContent = '';
const chipGroups = {
  gradeType: [...root.querySelectorAll<HTMLButtonElement>('[data-grade-type]')],
  credits: [...root.querySelectorAll<HTMLButtonElement>('[data-credits]')],
  aPlus: [...root.querySelectorAll<HTMLButtonElement>('[data-a-plus]')],
  earlier: [...root.querySelectorAll<HTMLButtonElement>('[data-earlier]')],
};

type Settings = { percent: boolean; useCredits: boolean; aPlus: APlus; earlier: boolean };
const settings: Settings = { percent: false, useCredits: false, aPlus: 4, earlier: false };
type SavedRow = { name: string; grade: string; percent: string; level: string; credits: string };
type Saved = Settings & { rows: SavedRow[]; earlierValues: { unweighted: string; weighted: string; units: string } };

let liveTimer: ReturnType<typeof setTimeout> | undefined;
let reportTimer: ReturnType<typeof setTimeout> | undefined;

const gpa = (value: number | undefined) => value === undefined ? '–' : formatNumber(roundGpa(value), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rowsList = () => [...rowsBox.querySelectorAll<HTMLFieldSetElement>('[data-row]')];
const field = <T extends HTMLInputElement | HTMLSelectElement>(row: HTMLElement, name: string) => row.querySelector<T>(`[data-field="${name}"]`)!;
const press = (chips: HTMLButtonElement[], attribute: string, value: string) => chips.forEach(chip => chip.setAttribute('aria-pressed', String(chip.getAttribute(attribute) === value)));
const markInvalid = (input: HTMLElement, invalid: boolean) => invalid ? input.setAttribute('aria-invalid', 'true') : input.removeAttribute('aria-invalid');

// Legends and remove labels say "Class 3", so they're renumbered when a row goes.
function numberRows() {
  const rows = rowsList();
  rows.forEach((row, index) => {
    row.querySelector('legend')!.textContent = t('hsGpa.classLegend', { n: index + 1 });
    row.querySelector('[data-remove]')!.setAttribute('aria-label', t('hsGpa.removeLabel', { n: index + 1 }));
  });
  $<HTMLButtonElement>('hs-gpa-add').disabled = rows.length >= MAX_CLASSES;
}

function addRow(values?: Partial<SavedRow>) {
  const row = template.cloneNode(true) as HTMLFieldSetElement;
  if (values) {
    field(row, 'name').value = values.name ?? '';
    field(row, 'grade').value = values.grade ?? '';
    field(row, 'percent').value = values.percent ?? '';
    field(row, 'level').value = values.level ?? 'regular';
    field(row, 'credits').value = values.credits ?? field(row, 'credits').value;
  }
  rowsBox.append(row);
  applyModes(row);
  return row;
}

function applyModes(scope: ParentNode = root) {
  scope.querySelectorAll<HTMLElement>('[data-credits-cell]').forEach(cell => { cell.hidden = !settings.useCredits; });
  scope.querySelectorAll<HTMLSelectElement>('[data-field="grade"]').forEach(select => { select.hidden = settings.percent; });
  scope.querySelectorAll<HTMLElement>('.hs-gpa-percent').forEach(box => { box.hidden = !settings.percent; });
  classes.classList.toggle('has-credits', settings.useCredits);
}

function readRows() {
  let percentBad = false, creditsBad = false;
  const courses: Course[] = rowsList().map(row => {
    let grade: Grade | undefined;
    if (settings.percent) {
      const input = field<HTMLInputElement>(row, 'percent');
      const value = parseNumber(input.value);
      const letter = value === undefined ? undefined : letterFromPercent(value);
      const bad = value !== undefined && !letter;
      percentBad ||= bad;
      markInvalid(input, bad);
      row.querySelector('[data-derived]')!.textContent = letter ?? '';
      grade = letter;
    } else {
      grade = (field(row, 'grade').value || undefined) as Grade | undefined;
    }
    const creditsInput = field<HTMLInputElement>(row, 'credits');
    const credits = parseNumber(creditsInput.value);
    const creditsInvalid = settings.useCredits && (Number.isNaN(credits) || (credits ?? 0) > MAX_CREDITS);
    creditsBad ||= creditsInvalid;
    markInvalid(creditsInput, creditsInvalid);
    return { grade: creditsInvalid ? undefined : grade, level: field(row, 'level').value as Level, credits: credits ?? 1 };
  });
  return { courses, percentBad, creditsBad };
}

function readEarlier() {
  if (!settings.earlier) { earlierError.hidden = true; return undefined; }
  const unweighted = parseNumber(earlierInputs.unweighted.value);
  const weighted = parseNumber(earlierInputs.weighted.value);
  const units = parseNumber(earlierInputs.units.value);
  const gpaBad = (value: number | undefined) => value !== undefined && (Number.isNaN(value) || value > MAX_EARLIER_GPA);
  const unitsBad = units !== undefined && (Number.isNaN(units) || units > MAX_EARLIER_UNITS);
  markInvalid(earlierInputs.unweighted, gpaBad(unweighted));
  markInvalid(earlierInputs.weighted, gpaBad(weighted));
  markInvalid(earlierInputs.units, unitsBad);
  const messages = [];
  if (gpaBad(unweighted) || gpaBad(weighted)) messages.push(t('hsGpa.errEarlierGpa'));
  if (unitsBad) messages.push(t('hsGpa.errEarlierUnits'));
  earlierError.hidden = !messages.length;
  earlierError.textContent = messages.join(' ');
  return {
    unweighted: gpaBad(unweighted) ? undefined : unweighted,
    weighted: gpaBad(weighted) ? undefined : weighted,
    units: unitsBad ? 0 : units ?? 0,
  };
}

function show(name: string, value: number | undefined) {
  root.querySelector<HTMLElement>(`[data-result="${name}"]`)!.textContent = gpa(value);
}

function update() {
  const { courses, percentBad, creditsBad } = readRows();
  const messages = [];
  if (percentBad) messages.push(t('hsGpa.errPercent'));
  if (creditsBad) messages.push(t('hsGpa.errCredits'));
  if (rowsList().length >= MAX_CLASSES) messages.push(t('hsGpa.classesFull', { max: MAX_CLASSES }));
  classesError.hidden = !messages.length;
  classesError.textContent = messages.join(' ');

  const earlier = readEarlier();
  const result = calculateGpa(courses, { useCredits: settings.useCredits, aPlus: settings.aPlus }, earlier);
  show('unweighted', result.unweighted);
  show('weighted', result.weighted);
  show('cumulativeUnweighted', result.cumulativeUnweighted);
  show('cumulativeWeighted', result.cumulativeWeighted);
  $('hs-gpa-cumulative').hidden = result.cumulativeUnweighted === undefined && result.cumulativeWeighted === undefined;
  root.querySelector<HTMLElement>('[data-cumulative="unweighted"]')!.hidden = result.cumulativeUnweighted === undefined;
  root.querySelector<HTMLElement>('[data-cumulative="weighted"]')!.hidden = result.cumulativeWeighted === undefined;
  $('hs-gpa-earlier-units-label').textContent = t(settings.useCredits ? 'hsGpa.earlierCredits' : 'hsGpa.earlierClasses');

  describe(result);
  save();
  if (result.unweighted !== undefined) {
    announce(result);
    report(result, courses);
  }
}

function describe(result: GpaResult) {
  if (result.unweighted === undefined || result.weighted === undefined) {
    breakdown.textContent = result.passFail ? counted('hsGpa.breakdownPassFail', result.passFail) : t('hsGpa.breakdownEmpty');
    return;
  }
  const sentences = [settings.useCredits ? counted('hsGpa.breakdownCredits', result.units) : counted('hsGpa.breakdownClasses', result.counted)];
  const letter = letterForGpa(roundGpa(result.unweighted), settings.aPlus);
  const [min, max] = percentRange(letter);
  sentences.push(t('hsGpa.breakdownLetter', { gpa: gpa(result.unweighted), letter, range: `${formatNumber(min)}–${formatPercent(max / 100)}` }));
  const bonus = result.weighted - result.unweighted;
  if (bonus >= 0.005) sentences.push(t('hsGpa.breakdownBonus', { amount: gpa(bonus) }));
  if (result.passFail) sentences.push(counted('hsGpa.breakdownPassFail', result.passFail));
  breakdown.textContent = sentences.join(' ');
}

// Screen readers hear the answer once typing pauses, not on every change.
function announce(result: GpaResult) {
  clearTimeout(liveTimer);
  liveTimer = setTimeout(() => { live.textContent = t('hsGpa.liveSummary', { unweighted: gpa(result.unweighted), weighted: gpa(result.weighted) }); }, 1000);
}

// Only the settings the answer settles on are reported, never the grades or the GPA.
function report(result: GpaResult, courses: Course[]) {
  clearTimeout(reportTimer);
  reportTimer = setTimeout(() => trackResult('success', {
    classes: result.counted >= 10 ? '10+' : String(result.counted),
    grade_type: settings.percent ? 'percent' : 'letter',
    credits: settings.useCredits ? 'on' : 'off',
    weighted: String(courses.some(course => course.grade && course.level !== 'regular')),
    a_plus: String(settings.aPlus),
    earlier: String(result.cumulativeUnweighted !== undefined || result.cumulativeWeighted !== undefined),
  }), 1500);
}

// Classes stay in this browser so a student can come back next term. Storage can be blocked; then nothing is kept.
function save() {
  const saved: Saved = {
    ...settings,
    rows: rowsList().map(row => ({
      name: field(row, 'name').value, grade: field(row, 'grade').value, percent: field(row, 'percent').value,
      level: field(row, 'level').value, credits: field(row, 'credits').value,
    })),
    earlierValues: { unweighted: earlierInputs.unweighted.value, weighted: earlierInputs.weighted.value, units: earlierInputs.units.value },
  };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(saved)); } catch { /* not remembered */ }
}

function restore() {
  let saved: Partial<Saved> | undefined;
  try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') ?? undefined; } catch { /* blocked or damaged */ }
  if (!saved || !Array.isArray(saved.rows)) return;
  settings.percent = saved.percent === true;
  settings.useCredits = saved.useCredits === true;
  settings.aPlus = saved.aPlus === 4.3 ? 4.3 : 4;
  settings.earlier = saved.earlier === true;
  rowsBox.replaceChildren();
  for (const row of saved.rows.slice(0, MAX_CLASSES)) addRow(row);
  while (rowsList().length < 1) addRow();
  const values = saved.earlierValues;
  if (values) for (const key of ['unweighted', 'weighted', 'units'] as const) earlierInputs[key].value = typeof values[key] === 'string' ? values[key] : '';
}

function applySettings() {
  press(chipGroups.gradeType, 'data-grade-type', settings.percent ? 'percent' : 'letter');
  press(chipGroups.credits, 'data-credits', settings.useCredits ? 'on' : 'off');
  press(chipGroups.aPlus, 'data-a-plus', String(settings.aPlus));
  press(chipGroups.earlier, 'data-earlier', settings.earlier ? 'on' : 'off');
  $('hs-gpa-earlier-fields').hidden = !settings.earlier;
  applyModes();
}

chipGroups.gradeType.forEach(chip => chip.addEventListener('click', () => { settings.percent = chip.dataset.gradeType === 'percent'; applySettings(); update(); }));
chipGroups.credits.forEach(chip => chip.addEventListener('click', () => { settings.useCredits = chip.dataset.credits === 'on'; applySettings(); update(); }));
chipGroups.aPlus.forEach(chip => chip.addEventListener('click', () => { settings.aPlus = chip.dataset.aPlus === '4.3' ? 4.3 : 4; applySettings(); update(); }));
chipGroups.earlier.forEach(chip => chip.addEventListener('click', () => { settings.earlier = chip.dataset.earlier === 'on'; applySettings(); update(); }));

rowsBox.addEventListener('input', update);
rowsBox.addEventListener('change', update);
rowsBox.addEventListener('click', event => {
  const remove = (event.target as Element).closest('[data-remove]');
  if (!remove) return;
  const row = remove.closest<HTMLElement>('[data-row]')!;
  const rows = rowsList();
  const next = rows[rows.indexOf(row as HTMLFieldSetElement) + 1] ?? rows[rows.indexOf(row as HTMLFieldSetElement) - 1];
  row.remove();
  if (!rowsList().length) addRow();
  numberRows();
  // Keep focus in the list rather than dropping it to the page.
  (next?.querySelector<HTMLElement>('[data-remove]') ?? $('hs-gpa-add')).focus();
  update();
});
$('hs-gpa-add').addEventListener('click', () => {
  if (rowsList().length >= MAX_CLASSES) return;
  const row = addRow();
  numberRows();
  field(row, 'name').focus();
  update();
});
$('hs-gpa-clear').addEventListener('click', () => {
  rowsBox.replaceChildren();
  for (let i = 0; i < START_ROWS; i++) addRow();
  for (const input of Object.values(earlierInputs)) input.value = '';
  numberRows();
  update();
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* blocked storage */ }
});
for (const input of Object.values(earlierInputs)) input.addEventListener('input', update);

restore();
applySettings();
numberRows();
// The browser may also restore typed values after a back navigation.
update();
