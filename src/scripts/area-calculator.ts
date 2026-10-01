import { AREA_UNITS, areaFields, calculateArea, convertArea, FLAT_SHAPES, ROUND_AREA_SHAPES, SOLID_SHAPES, squareUnit, type AreaShape, type AreaUnit, type LengthUnit, type TriangleMethod, type Values } from '../lib/geometry';
import { geometryUi } from './geometry-ui';
import { trackResult } from '../lib/analytics';

const root = document.querySelector<HTMLElement>('#area-calculator-tool')!;
const ui = geometryUi(root, 'area');
const { t } = ui;
const methodField = document.getElementById('area-method-field')!;
const measureField = document.getElementById('area-measure-field')!;
// The flat shapes and the solids are two chip groups with one choice between them.
const shapeChips = ui.chipsFor('shape');
const methodChips = ui.chipsFor('method');
const measureChips = ui.chipsFor('measure');
const SHAPES: AreaShape[] = [...FLAT_SHAPES, ...SOLID_SHAPES.map(shape => `solid-${shape}` as const)];

let shape: AreaShape = 'rectangle';
let method: TriangleMethod = 'base';
let diameter = false;

const formulaId = () => (shape === 'triangle' ? `triangle-${method}` : shape);
const isRound = () => ROUND_AREA_SHAPES.includes(shape);
const isSolid = () => shape.startsWith('solid-');
const NAMED: Partial<Record<AreaUnit, string>> = { acre: 'geo.area.acre', ha: 'geo.area.ha' };

function inUnit(value: number, to: AreaUnit) {
  const converted = convertArea(value, ui.unit(), to);
  const base = NAMED[to];
  return base ? ui.named(base, converted) : ui.square(converted, to.slice(0, -1) as LengthUnit);
}

/** The numbers for the worked formula: the typed values, plus Heron's s and its differences, or a slant height. */
function workParams(values: Values, slant?: number) {
  const params: Record<string, string> = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, ui.num(value)]));
  if (shape === 'triangle' && method === 'sides') {
    const s = (values.s1! + values.s2! + values.s3!) / 2;
    Object.assign(params, { s: ui.num(s), sa: ui.num(s - values.s1!), sb: ui.num(s - values.s2!), sc: ui.num(s - values.s3!) });
  }
  if (slant !== undefined) params.s = ui.num(slant);
  return params;
}

function update() {
  const unit = ui.unit();
  const fields = areaFields(shape, method);
  methodField.hidden = shape !== 'triangle';
  measureField.hidden = !isRound();
  ui.showFields(fields, unit, field => t(`geo.label.${field.label === 'radius' && diameter ? 'diameter' : field.label}`));
  ui.showError('shape');

  const typed = ui.readFields(fields);
  const values: Values | undefined = typed && isRound() && diameter ? { ...typed, r: typed.r! / 2 } : typed;
  const outcome = values ? calculateArea(shape, values, method) : undefined;
  if (outcome && 'error' in outcome) ui.showError('shape', t('area.errNotTriangle'));
  const result = outcome && 'result' in outcome ? outcome.result : undefined;

  const label = t(isSolid() ? 'area.resultSurface' : 'area.resultArea');
  const formula = t(`area.formula.${formulaId()}`);
  if (!result || !values) {
    ui.render({ label, value: 0, unit: '', formula, prompt: t('area.empty') });
    return;
  }

  const extras: string[] = [];
  if (isRound() && diameter) extras.push(t('geo.radiusFromDiameter', { d: ui.num(typed!.r!), r: ui.num(values.r!) }));
  if (shape === 'triangle' && method === 'sides') extras.push(t('area.heronS', { s: ui.num((values.s1! + values.s2! + values.s3!) / 2) }));
  if (result.perimeter !== undefined) {
    const key = shape === 'circle' ? 'area.circumference' : shape === 'ellipse' ? 'area.ellipsePerimeter' : 'area.perimeter';
    extras.push(t(key, { length: ui.length(result.perimeter, unit) }));
  }
  if (result.slant !== undefined) extras.push(t('area.slant', { length: ui.length(result.slant, unit) }));
  if (result.lateral !== undefined) extras.push(t('area.lateral', { area: ui.square(result.lateral, unit) }));
  ui.render({
    label, value: result.area, unit: `${ui.symbol(unit)}²`, formula, work: t(`area.work.${formulaId()}`, workParams(values, result.slant)), extras,
    conversions: AREA_UNITS.filter(to => to !== squareUnit(unit)).map(to => inUnit(result.area, to)),
  });
  ui.report(() => trackResult('success', { shape, unit, measure: isRound() ? (diameter ? 'diameter' : 'radius') : undefined, method: shape === 'triangle' ? method : undefined }));
}

ui.chips(shapeChips, 'shape', value => { shape = value as AreaShape; update(); });
ui.chips(methodChips, 'method', value => { method = value as TriangleMethod; update(); });
ui.chips(measureChips, 'measure', value => { diameter = value === 'diameter'; update(); });
ui.onUnit(update);
ui.onInput(update);

// A link such as /area-calculator/?shape=circle opens on that shape, and ?shape=triangle-sides on Heron's formula.
const asked = new URLSearchParams(location.search).get('shape') ?? '';
const askedShape = asked === 'triangle-sides' ? 'triangle' : asked;
if (SHAPES.includes(askedShape as AreaShape)) {
  shape = askedShape as AreaShape;
  ui.press(shapeChips, shapeChips.find(chip => chip.dataset.shape === shape));
  if (asked === 'triangle-sides') {
    method = 'sides';
    ui.press(methodChips, methodChips.find(chip => chip.dataset.method === 'sides'));
  }
}
update();
