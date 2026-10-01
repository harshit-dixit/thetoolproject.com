import { calculateVolume, convertVolume, cubicUnit, ROUND_VOLUME_SHAPES, TANK_TYPES, VOLUME_SHAPES, VOLUME_UNITS, volumeFields, type TankType, type Values, type VolumeShape, type VolumeUnit } from '../lib/geometry';
import { geometryUi } from './geometry-ui';
import { trackResult } from '../lib/analytics';

const root = document.querySelector<HTMLElement>('#volume-calculator-tool')!;
const ui = geometryUi(root, 'vol');
const { t } = ui;
const tankField = document.getElementById('vol-tank-field')!;
const measureField = document.getElementById('vol-measure-field')!;
const shapeChips = ui.chipsFor('shape');
const tankChips = ui.chipsFor('tank');
const measureChips = ui.chipsFor('measure');

let shape: VolumeShape = 'cylinder';
let tank: TankType = 'vertical';
let diameter = false;

const formulaId = () => (shape === 'tank' ? `tank-${tank}` : shape);
const isRound = () => ROUND_VOLUME_SHAPES.includes(shape);
const NAMED: Partial<Record<VolumeUnit, string>> = { ml: 'geo.vol.ml', l: 'geo.vol.l', usgal: 'geo.vol.usgal', impgal: 'geo.vol.impgal' };

function inUnit(value: number, to: VolumeUnit) {
  const unit = ui.unit();
  const converted = convertVolume(value, unit, to);
  const base = NAMED[to];
  if (base) return ui.named(base, converted);
  const lengthUnit = to.slice(0, -1) as Parameters<typeof ui.cubic>[1];
  return ui.cubic(converted, lengthUnit);
}

function update() {
  const unit = ui.unit();
  const fields = volumeFields(shape, tank);
  tankField.hidden = shape !== 'tank';
  measureField.hidden = !isRound();
  ui.showFields(fields, unit, field => t(`geo.label.${field.label === 'radius' && diameter ? 'diameter' : field.label}`));
  ui.showError('shape');

  const typed = ui.readFields(fields, ['f']);
  // The formulas use the radius, so a diameter is halved first.
  const values: Values | undefined = typed && isRound() && diameter ? { ...typed, r: typed.r! / 2 } : typed;
  const outcome = values ? calculateVolume(shape, values, tank) : undefined;
  if (outcome && 'error' in outcome) ui.showError(outcome.error === 'fillTooHigh' ? 'f' : 'D', t(outcome.error === 'fillTooHigh' ? 'vol.errFillTooHigh' : 'vol.errOuterTooSmall'));
  const result = outcome && 'result' in outcome ? outcome.result : undefined;

  const label = t(shape === 'pipe' ? 'vol.resultPipe' : shape !== 'tank' ? 'vol.resultVolume' : result?.filled !== undefined ? 'vol.resultFilled' : 'vol.resultTank');
  const formula = t(`vol.formula.${formulaId()}`);
  if (!result || !values) {
    ui.render({ label, value: 0, unit: '', formula, prompt: t('vol.empty') });
    return;
  }

  const shown = result.filled ?? result.volume;
  const work = t(`vol.work.${formulaId()}`, Object.fromEntries(Object.entries(values).map(([key, value]) => [key, ui.num(value)])));
  const extras: string[] = [];
  if (isRound() && diameter) extras.push(t('geo.radiusFromDiameter', { d: ui.num(typed!.r!), r: ui.num(values.r!) }));
  if (result.filled !== undefined) {
    extras.push(t('vol.fullTank', { volume: ui.cubic(result.volume, unit), gallons: inUnit(result.volume, unit === 'in' || unit === 'ft' || unit === 'yd' ? 'usgal' : 'l') }));
    extras.push(t('vol.filledShare', { percent: ui.percent(result.filled / result.volume) }));
  }
  if (result.material !== undefined) extras.push(t('vol.material', { volume: ui.cubic(result.material, unit) }));
  ui.render({
    label, value: shown, unit: `${ui.symbol(unit)}³`, formula, work, extras,
    conversions: VOLUME_UNITS.filter(to => to !== cubicUnit(unit)).map(to => inUnit(shown, to)),
  });
  ui.report(() => trackResult('success', { shape: shape === 'tank' ? `tank-${tank}` : shape, unit, measure: isRound() ? (diameter ? 'diameter' : 'radius') : undefined, fill: shape === 'tank' ? result.filled !== undefined : undefined, wall: shape === 'pipe' ? result.material !== undefined : undefined }));
}

ui.chips(shapeChips, 'shape', value => { shape = value as VolumeShape; update(); });
ui.chips(tankChips, 'tank', value => { tank = value as TankType; update(); });
ui.chips(measureChips, 'measure', value => { diameter = value === 'diameter'; update(); });
ui.onUnit(update);
ui.onInput(update);

// A link such as /volume-calculator/?shape=cone opens on that shape, and ?shape=tank-horizontal on that tank.
const asked = new URLSearchParams(location.search).get('shape') ?? '';
const [askedShape, askedTank] = asked.split('-');
if (VOLUME_SHAPES.includes(askedShape as VolumeShape)) {
  shape = askedShape as VolumeShape;
  ui.press(shapeChips, shapeChips.find(chip => chip.dataset.shape === shape));
  if (shape === 'tank' && TANK_TYPES.includes(askedTank as TankType)) {
    tank = askedTank as TankType;
    ui.press(tankChips, tankChips.find(chip => chip.dataset.tank === tank));
  }
}
update();
