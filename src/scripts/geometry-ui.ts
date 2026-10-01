// Shared page logic for the volume and area calculators: chips, the measurement fields, number and unit text.
import { displayOptions, LENGTH_UNITS, MAX_LENGTH, parseLength, type Field, type FieldKey, type LengthUnit, type Values } from '../lib/geometry';
import { i18nFrom } from '../i18n/client';

export function geometryUi(root: HTMLElement, prefix: 'vol' | 'area') {
  const i18n = i18nFrom(root);
  const { t, has, formatNumber, locale } = i18n;
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(`${prefix}-${id}`) as T;
  const live = $('live');
  const prompt = $('prompt');
  const formula = $('formula');
  const extra = $<HTMLUListElement>('extra');
  const conversions = $<HTMLUListElement>('conversions');
  const shapeError = $('shape-error');
  const valueOut = root.querySelector<HTMLElement>('[data-result="value"]')!;
  const unitOut = root.querySelector<HTMLElement>('[data-result="unit"]')!;
  const wrappers = new Map([...root.querySelectorAll<HTMLElement>('[data-field]')].map(el => [el.dataset.field as FieldKey, el]));
  const fieldList = root.querySelector<HTMLElement>('.geo-fields')!;
  let liveTimer: ReturnType<typeof setTimeout> | undefined;
  let reportTimer: ReturnType<typeof setTimeout> | undefined;

  const num = (value: number) => formatNumber(value, displayOptions(value));
  const symbol = (unit: LengthUnit) => t(`geo.sym.${unit}`);
  const length = (value: number, unit: LengthUnit) => `${num(value)} ${symbol(unit)}`;
  const cubic = (value: number, unit: LengthUnit) => `${num(value)} ${symbol(unit)}³`;
  const square = (value: number, unit: LengthUnit) => `${num(value)} ${symbol(unit)}²`;
  /** A named unit such as liters or acres, with the plural the shown number takes ("1 liter", "1.5 liters", "1,5 litre"). */
  const named = (base: string, value: number) => {
    const rule = new Intl.PluralRules(locale, displayOptions(value)).select(value);
    return t(has(`${base}.${rule}`) ? `${base}.${rule}` : `${base}.other`, { count: num(value) });
  };

  /** Wires a chip group: pressing one chip unpresses the others in `chips` and calls back with its data value. */
  function chips(chipList: HTMLButtonElement[], attribute: string, onPick: (value: string) => void) {
    for (const chip of chipList) chip.addEventListener('click', () => {
      press(chipList, chip);
      onPick(chip.dataset[attribute]!);
    });
  }
  const press = (chipList: HTMLButtonElement[], active?: HTMLButtonElement) => chipList.forEach(chip => chip.setAttribute('aria-pressed', String(chip === active)));
  const chipsFor = (attribute: string) => [...root.querySelectorAll<HTMLButtonElement>(`[data-${attribute}]`)].filter(el => el.tagName === 'BUTTON');

  function showError(key: FieldKey | 'shape', message?: string) {
    const error = key === 'shape' ? shapeError : $(`${key}-error`);
    error.hidden = !message;
    error.textContent = message ?? '';
    if (key === 'shape') return;
    const input = $<HTMLInputElement>(key);
    if (message) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }

  /**
   * Shows the shape's fields with their labels, hints and unit, and hides the rest. The fields are moved into the
   * shape's order in the page itself, not just on screen, so Tab and screen readers meet them in the order they're shown.
   */
  function showFields(fields: Field[], unit: LengthUnit, labelFor: (field: Field) => string) {
    const shown = fields.map(field => wrappers.get(field.key)!);
    const order = [...shown, ...[...wrappers.values()].filter(el => !shown.includes(el))];
    // Only move them when the order changes: moving a field while it's being typed in would take the focus away.
    if (order.some((el, i) => fieldList.children[i] !== el)) fieldList.append(...order);
    for (const [key, wrapper] of wrappers) {
      const field = fields.find(field => field.key === key);
      wrapper.hidden = !field;
      if (!field) { showError(key); continue; }
      wrapper.querySelector('label')!.textContent = labelFor(field);
      const hint = $(`${key}-hint`);
      const hintKey = `geo.hint.${field.label}`;
      hint.hidden = !has(hintKey);
      hint.textContent = has(hintKey) ? t(hintKey) : '';
      $(`${key}-unit`).textContent = symbol(unit);
    }
  }

  /** Reads the shown fields. Each bad field gets its own message; there are no values until every required one is filled in. */
  function readFields(fields: Field[], allowZero: FieldKey[] = []): Values | undefined {
    const values: Values = {};
    let complete = true;
    for (const field of fields) {
      const zero = allowZero.includes(field.key);
      const parsed = parseLength($<HTMLInputElement>(field.key).value, locale, zero);
      if (parsed && 'error' in parsed) {
        showError(field.key, parsed.error === 'tooLarge' ? t('geo.errTooLarge', { max: formatNumber(MAX_LENGTH) }) : t(zero ? 'geo.errInvalidZero' : 'geo.errInvalid'));
        complete = false;
        continue;
      }
      showError(field.key);
      if (parsed) values[field.key] = parsed.value;
      else if (!field.optional) complete = false;
    }
    return complete ? values : undefined;
  }

  type Shown = { label: string; value: number; unit: string; formula: string; work?: string; prompt?: string; extras?: string[]; conversions?: string[] };
  /** Draws the readout. Without a value it shows the formula and what to enter. */
  function render(shown: Shown) {
    clearTimeout(liveTimer);
    clearTimeout(reportTimer);
    $('result-label').textContent = shown.label;
    const ready = shown.work !== undefined;
    valueOut.textContent = ready ? num(shown.value) : '–';
    unitOut.textContent = ready ? shown.unit : '';
    const result = `${num(shown.value)} ${shown.unit}`;
    formula.textContent = ready ? t('geo.math', { formula: shown.formula, work: shown.work!, result }) : shown.formula;
    prompt.textContent = ready ? '' : shown.prompt ?? '';
    extra.replaceChildren(...(ready ? shown.extras ?? [] : []).map(text => Object.assign(document.createElement('li'), { textContent: text })));
    extra.hidden = !extra.children.length;
    conversions.replaceChildren(...(ready ? shown.conversions ?? [] : ['–']).map(text => Object.assign(document.createElement('li'), { textContent: text })));
    // Screen readers hear the answer once typing pauses, not on every keystroke.
    if (ready) liveTimer = setTimeout(() => { live.textContent = t('geo.liveSummary', { label: shown.label, value: result }); }, 1000);
    else live.textContent = '';
  }

  /** Reports once the fields settle. Only the shape and unit are sent, never a measurement or a result. */
  function report(send: () => void) {
    reportTimer = setTimeout(send, 1500);
  }

  // The unit: this page language's default, or the last one the visitor picked on either calculator.
  const unitChips = chipsFor('unit');
  const stored = (() => { try { return localStorage.getItem('geometry-unit'); } catch { return null; } })();
  let unit = (LENGTH_UNITS.find(u => u === stored) ?? root.dataset.defaultUnit) as LengthUnit;
  press(unitChips, unitChips.find(chip => chip.dataset.unit === unit));
  function onUnit(callback: () => void) {
    chips(unitChips, 'unit', value => {
      unit = value as LengthUnit;
      try { localStorage.setItem('geometry-unit', unit); } catch { /* private mode */ }
      callback();
    });
  }

  function onInput(callback: () => void) {
    for (const key of wrappers.keys()) $(key).addEventListener('input', callback);
  }

  return { t, has, num, percent: (ratio: number) => i18n.formatPercent(ratio, 1), symbol, length, cubic, square, named, chips, chipsFor, press, showError, showFields, readFields, render, report, onUnit, onInput, unit: () => unit };
}
