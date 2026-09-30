import { calculateGpa, honorFor, maxGpa, MAX_COURSES, MAX_CREDITS, MAX_SEMESTERS, MAX_TOTAL_CREDITS, planFinalGpa, type Course, type Earlier, type Grade, type GpaResult, type Scale } from '../lib/college-gpa';
import { letterForGpa, letterFromPercent, parseNumber, roundGpa } from '../lib/high-school-gpa';
import { i18nFrom } from '../i18n/client';
import { trackResult } from '../lib/analytics';

const root = document.querySelector<HTMLElement>('#gpa-tool')!;
const { t, counted, formatNumber } = i18nFrom(root);
const START_COURSES = Number(root.dataset.startCourses) || 5;
const STORAGE_KEY = 'gpa-calculator';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const termsBox = $('gpa-terms');
const breakdown = $('gpa-breakdown');
const honorLine = $('gpa-honor');
const honorText = honorLine.querySelector<HTMLElement>('[data-honor-text]')!;
const planLine = $('gpa-plan');
const live = $('gpa-live');
const coursesError = $('gpa-courses-error');
const earlierError = $('gpa-earlier-error');
const planError = $('gpa-plan-error');
const earlierInputs = { gpa: $<HTMLInputElement>('gpa-earlier-gpa'), credits: $<HTMLInputElement>('gpa-earlier-credits') };
const planInputs = { target: $<HTMLInputElement>('gpa-target'), remaining: $<HTMLInputElement>('gpa-remaining') };
const aPlusAbove = root.querySelector<HTMLButtonElement>('[data-a-plus="above"]')!;

// Blank copies of a semester and a course row. Cloning copies what the browser may have restored, so they're reset.
const termTemplate = termsBox.querySelector<HTMLFieldSetElement>('[data-term]')!.cloneNode(true) as HTMLFieldSetElement;
const rowTemplate = termTemplate.querySelector<HTMLFieldSetElement>('[data-row]')!.cloneNode(true) as HTMLFieldSetElement;
for (const template of [termTemplate, rowTemplate]) {
  template.querySelectorAll('input').forEach(input => { input.value = input.defaultValue; input.removeAttribute('aria-invalid'); });
  template.querySelectorAll('select').forEach(select => { select.selectedIndex = 0; });
  template.querySelectorAll('[data-derived]').forEach(derived => { derived.textContent = ''; });
}
termTemplate.querySelector('[data-rows]')!.replaceChildren();

const chipGroups = {
  gradeType: [...root.querySelectorAll<HTMLButtonElement>('[data-grade-type]')],
  scale: [...root.querySelectorAll<HTMLButtonElement>('[data-scale]')],
  aPlus: [...root.querySelectorAll<HTMLButtonElement>('[data-a-plus]')],
  earlier: [...root.querySelectorAll<HTMLButtonElement>('[data-earlier]')],
};

type Settings = { percent: boolean; thirds: boolean; aPlusAbove: boolean; earlier: boolean };
const settings: Settings = { percent: false, thirds: false, aPlusAbove: false, earlier: false };
type SavedRow = { name: string; grade: string; percent: string; credits: string };
type Saved = Settings & { terms: SavedRow[][]; earlierValues: { gpa: string; credits: string }; planValues: { target: string; remaining: string } };

let liveTimer: ReturnType<typeof setTimeout> | undefined;
let reportTimer: ReturnType<typeof setTimeout> | undefined;

const scale = (): Scale => ({ thirds: settings.thirds, aPlusAbove: settings.aPlusAbove });
const gpa = (value: number | undefined) => value === undefined ? '–' : formatNumber(roundGpa(value), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const number = (value: number) => formatNumber(value, { maximumFractionDigits: 2 });
const termsList = () => [...termsBox.querySelectorAll<HTMLFieldSetElement>('[data-term]')];
const rowsOf = (term: HTMLElement) => [...term.querySelectorAll<HTMLFieldSetElement>('[data-row]')];
const field = <T extends HTMLInputElement | HTMLSelectElement>(row: HTMLElement, name: string) => row.querySelector<T>(`[data-field="${name}"]`)!;
const press = (chips: HTMLButtonElement[], attribute: string, value: string) => chips.forEach(chip => chip.setAttribute('aria-pressed', String(chip.getAttribute(attribute) === value)));
const markInvalid = (input: HTMLElement, invalid: boolean) => invalid ? input.setAttribute('aria-invalid', 'true') : input.removeAttribute('aria-invalid');

// Titles, legends and remove labels say "Semester 2" and "Course 3", so they're renumbered when one goes.
function numberAll() {
  const terms = termsList();
  terms.forEach((term, index) => {
    const title = t('gpa.termTitle', { n: index + 1 });
    term.querySelector('[data-term-legend]')!.textContent = title;
    term.querySelector('[data-term-title]')!.textContent = title;
    const removeTerm = term.querySelector<HTMLButtonElement>('[data-remove-term]')!;
    removeTerm.hidden = terms.length < 2;
    removeTerm.setAttribute('aria-label', t('gpa.removeTermLabel', { n: index + 1 }));
    const rows = rowsOf(term);
    rows.forEach((row, rowIndex) => {
      row.querySelector('legend')!.textContent = t('gpa.courseLegend', { n: rowIndex + 1 });
      row.querySelector('[data-remove]')!.setAttribute('aria-label', t('gpa.removeLabel', { n: rowIndex + 1 }));
    });
    term.querySelector<HTMLButtonElement>('[data-add-course]')!.disabled = rows.length >= MAX_COURSES;
  });
  $<HTMLButtonElement>('gpa-add-term').disabled = terms.length >= MAX_SEMESTERS;
}

function addRow(term: HTMLElement, values?: Partial<SavedRow>) {
  const row = rowTemplate.cloneNode(true) as HTMLFieldSetElement;
  if (values) {
    field(row, 'name').value = values.name ?? '';
    field(row, 'grade').value = values.grade ?? '';
    field(row, 'percent').value = values.percent ?? '';
    field(row, 'credits').value = values.credits ?? field(row, 'credits').value;
  }
  term.querySelector('[data-rows]')!.append(row);
  applyModes(row);
  return row;
}

function addTerm(rows?: Partial<SavedRow>[]) {
  const term = termTemplate.cloneNode(true) as HTMLFieldSetElement;
  termsBox.append(term);
  if (rows?.length) for (const values of rows.slice(0, MAX_COURSES)) addRow(term, values);
  else for (let i = 0; i < START_COURSES; i++) addRow(term);
  return term;
}

function applyModes(scope: ParentNode = root) {
  scope.querySelectorAll<HTMLSelectElement>('[data-field="grade"]').forEach(select => { select.hidden = settings.percent; });
  scope.querySelectorAll<HTMLElement>('.gpa-percent').forEach(box => { box.hidden = !settings.percent; });
}

function readTerms() {
  let percentBad = false, creditsBad = false;
  const terms: Course[][] = termsList().map(term => rowsOf(term).map(row => {
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
    const creditsInvalid = Number.isNaN(credits) || (credits ?? 0) > MAX_CREDITS;
    creditsBad ||= creditsInvalid;
    markInvalid(creditsInput, creditsInvalid);
    // A graded course with its credits left empty counts for nothing rather than guessing.
    return { grade: creditsInvalid ? undefined : grade, credits: credits ?? 0 };
  }));
  return { terms, percentBad, creditsBad };
}

/** A GPA or credit field: undefined when empty, NaN when it can't be used. */
function readField(input: HTMLInputElement, max: number) {
  const value = parseNumber(input.value);
  const bad = value !== undefined && (Number.isNaN(value) || value > max);
  markInvalid(input, bad);
  return bad ? Number.NaN : value;
}

function readEarlier(): Earlier | undefined {
  if (!settings.earlier) { earlierError.hidden = true; return undefined; }
  const value = readField(earlierInputs.gpa, maxGpa(scale()));
  const credits = readField(earlierInputs.credits, MAX_TOTAL_CREDITS);
  const messages = [];
  if (Number.isNaN(value)) messages.push(t('gpa.errEarlierGpa', { max: number(maxGpa(scale())) }));
  if (Number.isNaN(credits)) messages.push(t('gpa.errEarlierCredits'));
  earlierError.hidden = !messages.length;
  earlierError.textContent = messages.join(' ');
  if (value === undefined || credits === undefined || Number.isNaN(value) || Number.isNaN(credits)) return undefined;
  return { gpa: value, credits };
}

function show(name: string, text: string) {
  root.querySelector<HTMLElement>(`[data-result="${name}"]`)!.textContent = text;
}

function update() {
  const { terms, percentBad, creditsBad } = readTerms();
  const messages = [];
  if (percentBad) messages.push(t('gpa.errPercent'));
  if (creditsBad) messages.push(t('gpa.errCredits', { max: MAX_CREDITS }));
  if (termsList().some(term => rowsOf(term).length >= MAX_COURSES)) messages.push(t('gpa.coursesFull', { max: MAX_COURSES }));
  if (termsList().length >= MAX_SEMESTERS) messages.push(t('gpa.termsFull', { max: MAX_SEMESTERS }));
  coursesError.hidden = !messages.length;
  coursesError.textContent = messages.join(' ');

  const earlier = readEarlier();
  const result = calculateGpa(terms, scale(), earlier);
  termsList().forEach((term, index) => {
    const own = result.terms[index];
    term.querySelector('[data-term-gpa]')!.textContent = own.gpa === undefined ? t('gpa.termEmpty') : t('gpa.termGpa', { gpa: gpa(own.gpa), credits: number(own.credits) });
  });
  const overall = result.cumulative ?? result.gpa;
  const cumulative = result.cumulative !== undefined || result.terms.filter(term => term.gpa !== undefined).length > 1;
  $('gpa-result-label').textContent = t(cumulative ? 'gpa.resultCumulative' : 'gpa.resultGpa');
  show('gpa', gpa(overall));
  show('credits', overall === undefined ? '–' : number(result.cumulativeCredits));

  describe(result);
  plan(result, earlier);
  save();
  if (overall !== undefined) {
    announce(overall, result.cumulativeCredits);
    report(result, terms);
  }
}

function describe(result: GpaResult) {
  const overall = result.cumulative ?? result.gpa;
  if (overall === undefined || result.gpa === undefined) {
    breakdown.textContent = result.excluded ? counted('gpa.breakdownExcluded', result.excluded) : t('gpa.breakdownEmpty');
    honorLine.hidden = true;
    return;
  }
  const sentences = [t('gpa.breakdownPoints', { points: number(result.points), credits: number(result.credits), gpa: gpa(result.gpa) })];
  if (result.cumulative !== undefined) sentences.push(t('gpa.breakdownCumulative', { gpa: gpa(result.cumulative), credits: number(result.cumulativeCredits) }));
  sentences.push(t('gpa.breakdownLetter', { gpa: gpa(overall), letter: letterForGpa(roundGpa(overall), settings.aPlusAbove ? 4.3 : 4) }));
  if (result.excluded) sentences.push(counted('gpa.breakdownExcluded', result.excluded));
  breakdown.textContent = sentences.join(' ');

  const honor = honorFor(overall);
  const key = honor === 'summa' ? 'gpa.honorSumma' : honor === 'magna' ? 'gpa.honorMagna' : honor === 'cum' ? 'gpa.honorCum' : 'gpa.honorNone';
  honorText.textContent = t(key, { gpa: gpa(overall) });
  honorLine.hidden = false;
}

function plan(result: GpaResult, earlier: Earlier | undefined) {
  const top = maxGpa(scale());
  const target = readField(planInputs.target, top);
  const remaining = readField(planInputs.remaining, MAX_TOTAL_CREDITS);
  const messages = [];
  if (Number.isNaN(target)) messages.push(t('gpa.errTarget', { max: number(top) }));
  if (Number.isNaN(remaining)) messages.push(t('gpa.errRemaining'));
  planError.hidden = !messages.length;
  planError.textContent = messages.join(' ');

  // Plan from everything entered: the courses above with any GPA so far, or the GPA so far on its own.
  const current: Earlier | undefined = result.gpa !== undefined ? { gpa: result.cumulative ?? result.gpa, credits: result.cumulativeCredits }
    : earlier && earlier.credits > 0 ? earlier : undefined;
  if (target === undefined || remaining === undefined || Number.isNaN(target) || Number.isNaN(remaining) || !(remaining > 0)) {
    planLine.textContent = t('gpa.planEmpty');
    return;
  }
  if (current === undefined) { planLine.textContent = t('gpa.planNeedGpa'); return; }
  const outcome = planFinalGpa(current, target, remaining, scale());
  if (!outcome) { planLine.textContent = t('gpa.planEmpty'); return; }
  const params = { target: gpa(target), credits: number(remaining) };
  if (outcome.status === 'possible') planLine.textContent = t('gpa.planPossible', { ...params, required: gpa(outcome.required) });
  else if (outcome.status === 'impossible') planLine.textContent = t('gpa.planImpossible', { ...params, best: gpa(outcome.best) });
  else planLine.textContent = t('gpa.planSecured', { ...params, worst: gpa(outcome.worst) });
}

// Screen readers hear the answer once typing pauses, not on every change.
function announce(overall: number, credits: number) {
  clearTimeout(liveTimer);
  liveTimer = setTimeout(() => { live.textContent = t('gpa.liveSummary', { gpa: gpa(overall), credits: number(credits) }); }, 1000);
}

// Only the settings the answer settles on are reported, never the grades, the GPA or the target.
function report(result: GpaResult, terms: Course[][]) {
  clearTimeout(reportTimer);
  const semesters = terms.filter(term => term.some(course => course.grade)).length;
  reportTimer = setTimeout(() => trackResult('success', {
    courses: result.counted >= 10 ? '10+' : String(result.counted),
    semesters: semesters >= 4 ? '4+' : String(semesters),
    grade_type: settings.percent ? 'percent' : 'letter',
    scale: settings.thirds ? 'thirds' : 'tenths',
    a_plus: settings.aPlusAbove ? 'above' : '4',
    earlier: String(result.cumulative !== undefined),
    plan: String(Boolean(planInputs.target.value.trim() && planInputs.remaining.value.trim())),
  }), 1500);
}

// Courses stay in this browser so a student can come back next term. Storage can be blocked; then nothing is kept.
function save() {
  const saved: Saved = {
    ...settings,
    terms: termsList().map(term => rowsOf(term).map(row => ({
      name: field(row, 'name').value, grade: field(row, 'grade').value, percent: field(row, 'percent').value, credits: field(row, 'credits').value,
    }))),
    earlierValues: { gpa: earlierInputs.gpa.value, credits: earlierInputs.credits.value },
    planValues: { target: planInputs.target.value, remaining: planInputs.remaining.value },
  };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(saved)); } catch { /* not remembered */ }
}

function restore() {
  let saved: Partial<Saved> | undefined;
  try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') ?? undefined; } catch { /* blocked or damaged */ }
  if (!saved || !Array.isArray(saved.terms) || !saved.terms.length) return;
  settings.percent = saved.percent === true;
  settings.thirds = saved.thirds === true;
  settings.aPlusAbove = saved.aPlusAbove === true;
  settings.earlier = saved.earlier === true;
  termsBox.replaceChildren();
  for (const rows of saved.terms.slice(0, MAX_SEMESTERS)) {
    const term = addTerm(Array.isArray(rows) ? rows : undefined);
    if (!rowsOf(term).length) addRow(term);
  }
  const text = (value: unknown) => typeof value === 'string' ? value : '';
  earlierInputs.gpa.value = text(saved.earlierValues?.gpa);
  earlierInputs.credits.value = text(saved.earlierValues?.credits);
  planInputs.target.value = text(saved.planValues?.target);
  planInputs.remaining.value = text(saved.planValues?.remaining);
}

function applySettings() {
  press(chipGroups.gradeType, 'data-grade-type', settings.percent ? 'percent' : 'letter');
  press(chipGroups.scale, 'data-scale', settings.thirds ? 'thirds' : 'tenths');
  press(chipGroups.aPlus, 'data-a-plus', settings.aPlusAbove ? 'above' : '4');
  press(chipGroups.earlier, 'data-earlier', settings.earlier ? 'on' : 'off');
  // An A+ above 4.0 is 4.3 on the tenths scale and 4.33 in thirds.
  aPlusAbove.textContent = (settings.thirds ? aPlusAbove.dataset.thirdsText : aPlusAbove.dataset.tenthsText) ?? '';
  $('gpa-earlier-fields').hidden = !settings.earlier;
  applyModes();
}

chipGroups.gradeType.forEach(chip => chip.addEventListener('click', () => { settings.percent = chip.dataset.gradeType === 'percent'; applySettings(); update(); }));
chipGroups.scale.forEach(chip => chip.addEventListener('click', () => { settings.thirds = chip.dataset.scale === 'thirds'; applySettings(); update(); }));
chipGroups.aPlus.forEach(chip => chip.addEventListener('click', () => { settings.aPlusAbove = chip.dataset.aPlus === 'above'; applySettings(); update(); }));
chipGroups.earlier.forEach(chip => chip.addEventListener('click', () => { settings.earlier = chip.dataset.earlier === 'on'; applySettings(); update(); }));

termsBox.addEventListener('input', update);
termsBox.addEventListener('change', update);
termsBox.addEventListener('click', event => {
  const target = event.target as Element;
  const term = target.closest<HTMLFieldSetElement>('[data-term]');
  if (!term) return;
  if (target.closest('[data-add-course]')) {
    if (rowsOf(term).length >= MAX_COURSES) return;
    const row = addRow(term);
    numberAll();
    field(row, 'name').focus();
    update();
  } else if (target.closest('[data-remove]')) {
    const row = target.closest<HTMLFieldSetElement>('[data-row]')!;
    const rows = rowsOf(term);
    const next = rows[rows.indexOf(row) + 1] ?? rows[rows.indexOf(row) - 1];
    row.remove();
    if (!rowsOf(term).length) addRow(term);
    numberAll();
    // Keep focus in the list rather than dropping it to the page.
    (next?.querySelector<HTMLElement>('[data-remove]') ?? term.querySelector<HTMLElement>('[data-add-course]')!).focus();
    update();
  } else if (target.closest('[data-remove-term]')) {
    const terms = termsList();
    const next = terms[terms.indexOf(term) + 1] ?? terms[terms.indexOf(term) - 1];
    term.remove();
    numberAll();
    (next?.querySelector<HTMLElement>('[data-field="name"]') ?? $('gpa-add-term')).focus();
    update();
  }
});
$('gpa-add-term').addEventListener('click', () => {
  if (termsList().length >= MAX_SEMESTERS) return;
  const term = addTerm();
  numberAll();
  field(rowsOf(term)[0], 'name').focus();
  update();
});
$('gpa-clear').addEventListener('click', () => {
  termsBox.replaceChildren();
  addTerm();
  for (const input of [...Object.values(earlierInputs), ...Object.values(planInputs)]) input.value = '';
  numberAll();
  update();
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* blocked storage */ }
});
for (const input of [...Object.values(earlierInputs), ...Object.values(planInputs)]) input.addEventListener('input', update);

restore();
applySettings();
numberAll();
// The browser may also restore typed values after a back navigation.
update();
