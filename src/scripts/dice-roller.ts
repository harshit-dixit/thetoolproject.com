import { diceBand, effectiveDrop, MAX_MODIFIER, parseWhole, rollDice, rollRange, secureRandomInt, type Drop, type Roll, type RollSpec } from '../lib/dice-roller';
import { i18nFrom } from '../i18n/client';
import { trackResult } from '../lib/analytics';

const root = document.querySelector<HTMLElement>('#dice-roller-tool')!;
const { t, formatNumber } = i18nFrom(root);
const limits = JSON.parse(root.dataset.limits!) as { MIN_DICE: number; MAX_DICE: number; MIN_SIDES: number; MAX_SIDES: number };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const countInput = $<HTMLInputElement>('dice-count');
const sidesInput = $<HTMLInputElement>('dice-sides');
const modifierInput = $<HTMLInputElement>('dice-modifier');
const rollButton = $<HTMLButtonElement>('dice-roll');
const fullscreenButton = $<HTMLButtonElement>('dice-fullscreen');
const faces = $('dice-faces');
const breakdown = $('dice-breakdown');
const range = $('dice-range');
const total = root.querySelector<HTMLElement>('[data-result="total"]')!;
const historyList = $<HTMLOListElement>('dice-history-list');
const historyEmpty = $('dice-history-empty');
const historyClear = $<HTMLButtonElement>('dice-history-clear');
const live = $('dice-live');
const sideChips = [...root.querySelectorAll<HTMLButtonElement>('[data-sides]')];
const dropChips = [...root.querySelectorAll<HTMLButtonElement>('[data-drop]')];
const presetChips = [...root.querySelectorAll<HTMLButtonElement>('[data-preset]')];
const HISTORY_SIZE = 10;
// The faces change a few times before they settle, like a die coming to rest. Nothing moves.
const TUMBLE_FRAMES = 6;
const TUMBLE_MS = 60;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
// Squares lit on a 3 × 3 grid for each face of a six-sided die.
const PIPS: Record<number, number[]> = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
const PRESETS: Record<string, Pick<RollSpec, 'count' | 'sides' | 'drop'>> = {
  advantage: { count: 2, sides: 20, drop: 'lowest' },
  disadvantage: { count: 2, sides: 20, drop: 'highest' },
  ability: { count: 4, sides: 6, drop: 'lowest' },
  pair: { count: 2, sides: 6, drop: 'none' },
};

let chosenSides: number | 'custom' = 6;
let drop: Drop = 'none';
let shownKey = '';
let tumbleTimer: ReturnType<typeof setInterval> | undefined;
let reportTimer: ReturnType<typeof setTimeout> | undefined;

const press = (chips: HTMLButtonElement[], active?: HTMLButtonElement) => chips.forEach(chip => chip.setAttribute('aria-pressed', String(chip === active)));
const signed = (value: number) => (value < 0 ? `−${formatNumber(-value)}` : `+${formatNumber(value)}`);
const notation = ({ count, sides, modifier }: RollSpec) => t('dice.notation', { count, sides }) + (modifier ? signed(modifier) : '');

function showError(input: HTMLInputElement, message?: string) {
  const error = $(`${input.id}-error`);
  error.hidden = !message;
  error.textContent = message ?? '';
  if (message) input.setAttribute('aria-invalid', 'true');
  else input.removeAttribute('aria-invalid');
}

/** Reads the fields. Each bad field gets its own message, and there's no spec until all are fixed. */
function readSpec(): RollSpec | undefined {
  const count = parseWhole(countInput.value, limits.MIN_DICE, limits.MAX_DICE);
  const sides = chosenSides === 'custom' ? parseWhole(sidesInput.value, limits.MIN_SIDES, limits.MAX_SIDES) : chosenSides;
  const modifierText = modifierInput.value.trim();
  const modifier = modifierText ? parseWhole(modifierText, -MAX_MODIFIER, MAX_MODIFIER) : 0;
  showError(countInput, count === undefined ? t('dice.errCount', { min: formatNumber(limits.MIN_DICE), max: formatNumber(limits.MAX_DICE) }) : undefined);
  showError(sidesInput, chosenSides === 'custom' && sides === undefined ? t('dice.errSides', { min: formatNumber(limits.MIN_SIDES), max: formatNumber(limits.MAX_SIDES) }) : undefined);
  showError(modifierInput, modifier === undefined ? t('dice.errModifier', { min: signed(-MAX_MODIFIER), max: signed(MAX_MODIFIER) }) : undefined);
  if (count === undefined || sides === undefined || modifier === undefined) return undefined;
  return { count, sides, modifier, drop };
}

function face(value: number | undefined, sides: number, dropped = false) {
  const item = document.createElement('li');
  item.className = 'dice-face';
  if (value === undefined) item.classList.add('is-empty');
  else if (sides === 6) {
    item.classList.add('dice-pips');
    for (let cell = 0; cell < 9; cell++) {
      const pip = document.createElement('span');
      if (PIPS[value].includes(cell)) pip.className = 'on';
      item.append(pip);
    }
  } else {
    const text = formatNumber(value);
    item.textContent = text;
    if (text.length > 3) item.classList.add('is-long');
  }
  if (dropped) item.classList.add('is-dropped');
  return item;
}

function drawFaces(spec: RollSpec, roll?: Pick<Roll, 'values' | 'dropped'>) {
  const values = roll?.values ?? Array.from({ length: spec.count }, () => undefined);
  faces.replaceChildren(...values.map((value, index) => face(value, spec.sides, index === roll?.dropped)));
}

/** "2d6+3: 4 + 3 + 3 = 10." The dropped die isn't in the sum; a sentence after it says which one it was. */
function describe(spec: RollSpec, roll: Roll) {
  const kept = roll.values.filter((_, index) => index !== roll.dropped).map(value => formatNumber(value));
  const sum = kept.join(' + ');
  const withModifier = spec.modifier ? `${sum} ${spec.modifier < 0 ? '−' : '+'} ${formatNumber(Math.abs(spec.modifier))}` : sum;
  const math = kept.length > 1 || spec.modifier ? `${withModifier} = ${formatNumber(roll.total)}` : sum;
  const sentences = [t('dice.breakdown', { notation: notation(spec), math })];
  if (roll.dropped >= 0) sentences.push(t(drop === 'lowest' ? 'dice.droppedLowest' : 'dice.droppedHighest', { value: formatNumber(roll.values[roll.dropped]) }));
  // A natural 20 or 1 is the d20 that counts, before the modifier: one d20, or two with one dropped.
  if (spec.sides === 20 && kept.length === 1) {
    const natural = roll.values.find((_, index) => index !== roll.dropped);
    if (natural === 20) sentences.push(t('dice.natural20'));
    if (natural === 1) sentences.push(t('dice.natural1'));
  }
  return sentences.join(' ');
}

const specKey = (spec: RollSpec) => `${spec.count}d${spec.sides}${spec.modifier}${effectiveDrop(spec)}`;

/** Keeps the button, chips and range in step with the fields. A changed roll clears the last result. */
function sync() {
  const spec = readSpec();
  $('dice-sides-field').hidden = chosenSides !== 'custom';
  const count = spec?.count ?? parseWhole(countInput.value, limits.MIN_DICE, limits.MAX_DICE);
  $('dice-drop-field').hidden = !count || count < 2;
  const preset = presetChips.find(chip => {
    const target = PRESETS[chip.dataset.preset!];
    return spec && target.count === spec.count && target.sides === spec.sides && target.drop === effectiveDrop(spec);
  });
  press(presetChips, preset);
  if (!spec) {
    rollButton.textContent = t('dice.rollPlain');
    range.textContent = '';
    // A roll still tumbling is cancelled too, so it can't land after the fields went bad.
    shownKey = '';
    clearResult();
    return;
  }
  const dropNow = effectiveDrop(spec);
  rollButton.textContent = t(dropNow === 'lowest' ? 'dice.rollButtonLowest' : dropNow === 'highest' ? 'dice.rollButtonHighest' : 'dice.rollButton', { notation: notation(spec) });
  const { min, max, average } = rollRange(spec);
  range.textContent = t('dice.range', { min: formatNumber(min), max: formatNumber(max), average: formatNumber(average, { maximumFractionDigits: 2 }) });
  const key = specKey(spec);
  if (key !== shownKey) {
    shownKey = key;
    clearResult(spec);
  }
}

/** Empty dice for the roll in the fields, or none while a field is wrong. */
function clearResult(spec?: RollSpec) {
  stopTumble();
  if (spec) drawFaces(spec);
  else faces.replaceChildren();
  total.textContent = '–';
  breakdown.textContent = t('dice.empty');
  live.textContent = '';
}

function stopTumble() {
  clearInterval(tumbleTimer);
  tumbleTimer = undefined;
}

function roll() {
  const spec = readSpec();
  if (!spec) {
    root.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus();
    return;
  }
  // The result is decided now; the tumble only shows other faces on the way to it.
  const result = rollDice(spec);
  const sides = chosenSides === 'custom' ? 'custom' : String(spec.sides);
  stopTumble();
  live.textContent = '';
  const finish = () => {
    stopTumble();
    drawFaces(spec, result);
    total.textContent = formatNumber(result.total);
    const text = describe(spec, result);
    breakdown.textContent = text;
    live.textContent = text;
    addHistory(text);
    report(spec, sides);
  };
  if (reducedMotion.matches) { finish(); }
  else {
    let frames = 0;
    total.textContent = '–';
    tumbleTimer = setInterval(() => {
      if (++frames >= TUMBLE_FRAMES) { finish(); return; }
      drawFaces(spec, { values: result.values.map(() => secureRandomInt(spec.sides)), dropped: -1 });
    }, TUMBLE_MS);
  }
}

function addHistory(text: string) {
  const item = document.createElement('li');
  item.textContent = text;
  historyList.prepend(item);
  while (historyList.children.length > HISTORY_SIZE) historyList.lastElementChild!.remove();
  historyList.hidden = false;
  historyEmpty.hidden = true;
  historyClear.hidden = false;
}

// Only the kind of roll is reported, once a roll has landed and rolling stops. The results never leave the page.
function report(spec: RollSpec, sides: string) {
  clearTimeout(reportTimer);
  reportTimer = setTimeout(() => trackResult('success', {
    sides,
    dice: diceBand(spec.count),
    modifier: spec.modifier !== 0,
    drop: effectiveDrop(spec),
  }), 1500);
}

function setCount(value: number) {
  countInput.value = String(Math.min(limits.MAX_DICE, Math.max(limits.MIN_DICE, value)));
  sync();
}

function chooseSides(sides: number | 'custom') {
  chosenSides = sides;
  press(sideChips, sideChips.find(chip => chip.dataset.sides === String(sides)));
}

sideChips.forEach(chip => chip.addEventListener('click', () => {
  const value = chip.dataset.sides!;
  chooseSides(value === 'custom' ? 'custom' : Number(value));
  sync();
  if (value === 'custom') sidesInput.focus();
}));
dropChips.forEach(chip => chip.addEventListener('click', () => {
  drop = chip.dataset.drop as Drop;
  press(dropChips, chip);
  sync();
}));
presetChips.forEach(chip => chip.addEventListener('click', () => {
  const preset = PRESETS[chip.dataset.preset!];
  chooseSides(preset.sides);
  drop = preset.drop;
  press(dropChips, dropChips.find(item => item.dataset.drop === drop));
  // An attack bonus doesn't belong on ability scores, which run from 3 to 18.
  if (chip.dataset.preset === 'ability') { modifierInput.value = ''; showError(modifierInput); }
  setCount(preset.count);
}));
// A number out of range steps from the nearest limit, so 51 then − gives 50.
const step = (by: number) => () => setCount((parseWhole(countInput.value, -Infinity, Infinity) ?? limits.MIN_DICE) + by);
$('dice-count-down').addEventListener('click', step(-1));
$('dice-count-up').addEventListener('click', step(1));
[countInput, sidesInput, modifierInput].forEach(input => input.addEventListener('input', sync));
rollButton.addEventListener('click', roll);
historyClear.addEventListener('click', () => {
  historyList.replaceChildren();
  historyList.hidden = true;
  historyEmpty.hidden = false;
  historyClear.hidden = true;
  rollButton.focus();
});

// Full screen needs the Fullscreen API on an element, which iPhones don't offer.
if (document.fullscreenEnabled && root.requestFullscreen) {
  fullscreenButton.hidden = false;
  fullscreenButton.addEventListener('click', () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void root.requestFullscreen().then(() => rollButton.focus(), () => undefined);
  });
  document.addEventListener('fullscreenchange', () => {
    fullscreenButton.textContent = t(document.fullscreenElement === root ? 'dice.exitFullscreen' : 'dice.fullscreen');
  });
}

sync();
