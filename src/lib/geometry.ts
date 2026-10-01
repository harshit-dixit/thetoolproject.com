// Volume, area and surface area of common shapes, and the unit conversions the calculators show.
// Every length is in one unit chosen by the visitor; results are in that unit cubed or squared.
import { parseAmount } from './tip-calculator';

export type LengthUnit = 'mm' | 'cm' | 'm' | 'in' | 'ft' | 'yd';
export const LENGTH_UNITS: LengthUnit[] = ['mm', 'cm', 'm', 'in', 'ft', 'yd'];
/** Meters in one unit. The inch is exactly 2.54 cm, the foot 12 inches and the yard 3 feet. */
export const METERS_PER: Record<LengthUnit, number> = { mm: 0.001, cm: 0.01, m: 1, in: 0.0254, ft: 0.3048, yd: 0.9144 };

/** The largest length a field accepts, so results stay well inside what a double holds exactly enough to show. */
export const MAX_LENGTH = 1e9;

export type VolumeUnit = 'mm3' | 'cm3' | 'm3' | 'in3' | 'ft3' | 'yd3' | 'ml' | 'l' | 'usgal' | 'impgal';
export const VOLUME_UNITS: VolumeUnit[] = ['mm3', 'cm3', 'm3', 'in3', 'ft3', 'yd3', 'ml', 'l', 'usgal', 'impgal'];
/** Cubic meters in one unit. The US gallon is 231 cubic inches and the imperial gallon 4.54609 liters. */
export const CUBIC_METERS_PER: Record<VolumeUnit, number> = {
  mm3: 1e-9, cm3: 1e-6, m3: 1, in3: 0.0254 ** 3, ft3: 0.3048 ** 3, yd3: 0.9144 ** 3,
  ml: 1e-6, l: 1e-3, usgal: 231 * 0.0254 ** 3, impgal: 0.00454609,
};

export type AreaUnit = 'mm2' | 'cm2' | 'm2' | 'in2' | 'ft2' | 'yd2' | 'acre' | 'ha';
export const AREA_UNITS: AreaUnit[] = ['mm2', 'cm2', 'm2', 'in2', 'ft2', 'yd2', 'acre', 'ha'];
/** Square meters in one unit. An acre is 43,560 square feet and a hectare 10,000 square meters. */
export const SQUARE_METERS_PER: Record<AreaUnit, number> = {
  mm2: 1e-6, cm2: 1e-4, m2: 1, in2: 0.0254 ** 2, ft2: 0.3048 ** 2, yd2: 0.9144 ** 2, acre: 43560 * 0.3048 ** 2, ha: 1e4,
};

export const cubicUnit = (unit: LengthUnit) => `${unit}3` as VolumeUnit;
export const squareUnit = (unit: LengthUnit) => `${unit}2` as AreaUnit;

/** A volume in the cube of `unit`, converted to `to`. */
export function convertVolume(value: number, unit: LengthUnit, to: VolumeUnit): number {
  return (value * METERS_PER[unit] ** 3) / CUBIC_METERS_PER[to];
}

/** An area in the square of `unit`, converted to `to`. */
export function convertArea(value: number, unit: LengthUnit, to: AreaUnit): number {
  return (value * METERS_PER[unit] ** 2) / SQUARE_METERS_PER[to];
}

export type LengthError = 'invalid' | 'tooLarge';

/**
 * Reads a typed length the way the tip calculator reads amounts, so "12.5", "12,5" and "1,250" work in each language.
 * Empty is undefined (not typed yet). Zero is accepted only where it makes sense, such as an empty tank.
 */
export function parseLength(text: string, locale: string, allowZero = false): { value: number } | { error: LengthError } | undefined {
  const value = parseAmount(text, locale);
  if (value === undefined) return undefined;
  if (Number.isNaN(value) || value < 0 || (value === 0 && !allowZero)) return { error: 'invalid' };
  if (value > MAX_LENGTH) return { error: 'tooLarge' };
  return { value };
}

/** Two decimals from 100 up, three from 1 up, and four significant digits below 1, so 0.0748 gallons isn't shown as 0.07. */
export function displayOptions(value: number): Intl.NumberFormatOptions {
  const size = Math.abs(value);
  if (size === 0) return { maximumFractionDigits: 0 };
  if (size >= 100) return { maximumFractionDigits: 2 };
  if (size >= 1) return { maximumFractionDigits: 3 };
  return { maximumSignificantDigits: 4 };
}

// Fields. Each shape lists the measurements it needs, in the order they're shown.
// r is a radius, or a diameter when the visitor measures across; the scripts halve it before calling these functions.
export type FieldKey = 'a' | 'l' | 'w' | 'h' | 'r' | 'b' | 't' | 'd' | 'D' | 'f' | 's1' | 's2' | 's3' | 'b1' | 'b2' | 'e1' | 'e2';
export type Field = { key: FieldKey; label: string; optional?: boolean };
export type Values = Partial<Record<FieldKey, number>>;

export type VolumeShape = 'cube' | 'box' | 'cylinder' | 'cone' | 'sphere' | 'hemisphere' | 'pyramid' | 'prism' | 'pipe' | 'tank';
export const VOLUME_SHAPES: VolumeShape[] = ['cylinder', 'box', 'cube','cone', 'sphere', 'hemisphere', 'pyramid', 'prism', 'pipe', 'tank'];
export type TankType = 'vertical' | 'horizontal' | 'rectangular';
export const TANK_TYPES: TankType[] = ['vertical', 'horizontal', 'rectangular'];
/** Shapes measured by a radius or a diameter, which the visitor picks. */
export const ROUND_VOLUME_SHAPES: VolumeShape[] = ['cylinder', 'cone', 'sphere', 'hemisphere'];

export function volumeFields(shape: VolumeShape, tank: TankType = 'vertical'): Field[] {
  switch (shape) {
    case 'cube': return [{ key: 'a', label: 'side' }];
    case 'box': return [{ key: 'l', label: 'length' }, { key: 'w', label: 'width' }, { key: 'h', label: 'height' }];
    case 'cylinder':
    case 'cone': return [{ key: 'r', label: 'radius' }, { key: 'h', label: 'height' }];
    case 'sphere':
    case 'hemisphere': return [{ key: 'r', label: 'radius' }];
    case 'pyramid': return [{ key: 'l', label: 'baseLength' }, { key: 'w', label: 'baseWidth' }, { key: 'h', label: 'height' }];
    case 'prism': return [{ key: 'b', label: 'triangleBase' }, { key: 't', label: 'triangleHeight' }, { key: 'l', label: 'prismLength' }];
    case 'pipe': return [{ key: 'd', label: 'innerDiameter' }, { key: 'l', label: 'pipeLength' }, { key: 'D', label: 'outerDiameter', optional: true }];
    case 'tank':
      if (tank === 'horizontal') return [{ key: 'd', label: 'diameter' }, { key: 'l', label: 'length' }, { key: 'f', label: 'fill', optional: true }];
      if (tank === 'rectangular') return [{ key: 'l', label: 'length' }, { key: 'w', label: 'width' }, { key: 'h', label: 'height' }, { key: 'f', label: 'fill', optional: true }];
      return [{ key: 'd', label: 'diameter' }, { key: 'h', label: 'height' }, { key: 'f', label: 'fill', optional: true }];
  }
}

export type VolumeResult = {
  /** The shape's volume; for a tank, the full tank. For a pipe, the space inside it. */
  volume: number;
  /** The liquid in a tank filled to height f. */
  filled?: number;
  /** The pipe wall's own volume, when the outside diameter is given. */
  material?: number;
};
export type VolumeError = 'fillTooHigh' | 'outerTooSmall';

const need = (values: Values, ...keys: FieldKey[]) => keys.map(key => {
  const value = values[key];
  if (value === undefined) throw new Error(`Missing value for ${key}`);
  return value;
});

/** The liquid in a horizontal cylinder of radius r and length l filled to depth f: a circular segment times the length. */
export function horizontalTankFill(r: number, l: number, f: number): number {
  if (f <= 0) return 0;
  if (f >= 2 * r) return Math.PI * r * r * l;
  const segment = r * r * Math.acos((r - f) / r) - (r - f) * Math.sqrt(2 * r * f - f * f);
  return segment * l;
}

export function calculateVolume(shape: VolumeShape, values: Values, tank: TankType = 'vertical'): { result: VolumeResult } | { error: VolumeError } {
  switch (shape) {
    case 'cube': { const [a] = need(values, 'a'); return { result: { volume: a ** 3 } }; }
    case 'box': { const [l, w, h] = need(values, 'l', 'w', 'h'); return { result: { volume: l * w * h } }; }
    case 'cylinder': { const [r, h] = need(values, 'r', 'h'); return { result: { volume: Math.PI * r * r * h } }; }
    case 'cone': { const [r, h] = need(values, 'r', 'h'); return { result: { volume: (Math.PI * r * r * h) / 3 } }; }
    case 'sphere': { const [r] = need(values, 'r'); return { result: { volume: (4 / 3) * Math.PI * r ** 3 } }; }
    case 'hemisphere': { const [r] = need(values, 'r'); return { result: { volume: (2 / 3) * Math.PI * r ** 3 } }; }
    case 'pyramid': { const [l, w, h] = need(values, 'l', 'w', 'h'); return { result: { volume: (l * w * h) / 3 } }; }
    case 'prism': { const [b, t, l] = need(values, 'b', 't', 'l'); return { result: { volume: (b * t * l) / 2 } }; }
    case 'pipe': {
      const [d, l] = need(values, 'd', 'l');
      const volume = Math.PI * (d / 2) ** 2 * l;
      if (values.D === undefined) return { result: { volume } };
      if (values.D <= d) return { error: 'outerTooSmall' };
      return { result: { volume, material: Math.PI * ((values.D / 2) ** 2 - (d / 2) ** 2) * l } };
    }
    case 'tank': {
      const f = values.f;
      if (tank === 'horizontal') {
        const [d, l] = need(values, 'd', 'l');
        const volume = Math.PI * (d / 2) ** 2 * l;
        if (f === undefined) return { result: { volume } };
        if (f > d) return { error: 'fillTooHigh' };
        return { result: { volume, filled: horizontalTankFill(d / 2, l, f) } };
      }
      if (tank === 'rectangular') {
        const [l, w, h] = need(values, 'l', 'w', 'h');
        if (f === undefined) return { result: { volume: l * w * h } };
        if (f > h) return { error: 'fillTooHigh' };
        return { result: { volume: l * w * h, filled: l * w * f } };
      }
      const [d, h] = need(values, 'd', 'h');
      const base = Math.PI * (d / 2) ** 2;
      if (f === undefined) return { result: { volume: base * h } };
      if (f > h) return { error: 'fillTooHigh' };
      return { result: { volume: base * h, filled: base * f } };
    }
  }
}

export type FlatShape = 'square' | 'rectangle' | 'triangle' | 'circle' | 'trapezoid' | 'parallelogram' | 'ellipse';
export type SolidShape = 'cube' | 'box' | 'cylinder' | 'cone' | 'sphere' | 'pyramid';
export type AreaShape = FlatShape | `solid-${SolidShape}`;
export const FLAT_SHAPES: FlatShape[] = ['rectangle', 'square', 'triangle', 'circle', 'trapezoid', 'parallelogram', 'ellipse'];
export const SOLID_SHAPES: SolidShape[] = ['cube', 'box', 'cylinder', 'cone', 'sphere', 'pyramid'];
export const ROUND_AREA_SHAPES: AreaShape[] = ['circle', 'solid-cylinder', 'solid-cone', 'solid-sphere'];
export type TriangleMethod = 'base' | 'sides';

export function areaFields(shape: AreaShape, triangle: TriangleMethod = 'base'): Field[] {
  switch (shape) {
    case 'square': return [{ key: 'a', label: 'side' }];
    case 'rectangle': return [{ key: 'l', label: 'length' }, { key: 'w', label: 'width' }];
    case 'triangle': return triangle === 'sides'
      ? [{ key: 's1', label: 'side1' }, { key: 's2', label: 'side2' }, { key: 's3', label: 'side3' }]
      : [{ key: 'b', label: 'base' }, { key: 'h', label: 'height' }];
    case 'circle': return [{ key: 'r', label: 'radius' }];
    case 'trapezoid': return [{ key: 'b1', label: 'base1' }, { key: 'b2', label: 'base2' }, { key: 'h', label: 'height' }];
    case 'parallelogram': return [{ key: 'b', label: 'base' }, { key: 'h', label: 'height' }];
    case 'ellipse': return [{ key: 'e1', label: 'semiMajor' }, { key: 'e2', label: 'semiMinor' }];
    case 'solid-cube': return [{ key: 'a', label: 'side' }];
    case 'solid-box': return [{ key: 'l', label: 'length' }, { key: 'w', label: 'width' }, { key: 'h', label: 'height' }];
    case 'solid-cylinder':
    case 'solid-cone': return [{ key: 'r', label: 'radius' }, { key: 'h', label: 'height' }];
    case 'solid-sphere': return [{ key: 'r', label: 'radius' }];
    case 'solid-pyramid': return [{ key: 'a', label: 'baseSide' }, { key: 'h', label: 'height' }];
  }
}

export type AreaResult = {
  area: number;
  /** The distance around a flat shape, when the measurements give it. An ellipse's is Ramanujan's close approximation. */
  perimeter?: number;
  /** For a cylinder, cone or pyramid: the side's area without the base or ends. */
  lateral?: number;
  /** The slant height of a cone or pyramid, worked out from its height. */
  slant?: number;
};
export type AreaError = 'notTriangle';

/** Ramanujan's second approximation of an ellipse's perimeter, within a few parts per million for most shapes. */
export function ellipsePerimeter(a: number, b: number): number {
  const h = ((a - b) / (a + b)) ** 2;
  return Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
}

export function calculateArea(shape: AreaShape, values: Values, triangle: TriangleMethod = 'base'): { result: AreaResult } | { error: AreaError } {
  switch (shape) {
    case 'square': { const [a] = need(values, 'a'); return { result: { area: a * a, perimeter: 4 * a } }; }
    case 'rectangle': { const [l, w] = need(values, 'l', 'w'); return { result: { area: l * w, perimeter: 2 * (l + w) } }; }
    case 'triangle': {
      if (triangle === 'base') { const [b, h] = need(values, 'b', 'h'); return { result: { area: (b * h) / 2 } }; }
      const [a, b, c] = need(values, 's1', 's2', 's3');
      const [x, y, z] = [a, b, c].sort((p, q) => q - p);
      // The longest side must be shorter than the other two together; equal is a flat line with no area.
      if (x >= y + z) return { error: 'notTriangle' };
      // Heron's formula in the form that stays accurate for thin triangles (Kahan), with sides sorted x ≥ y ≥ z.
      const area = Math.sqrt((x + (y + z)) * (z - (x - y)) * (z + (x - y)) * (x + (y - z))) / 4;
      return { result: { area, perimeter: a + b + c } };
    }
    case 'circle': { const [r] = need(values, 'r'); return { result: { area: Math.PI * r * r, perimeter: 2 * Math.PI * r } }; }
    case 'trapezoid': { const [b1, b2, h] = need(values, 'b1', 'b2', 'h'); return { result: { area: ((b1 + b2) / 2) * h } }; }
    case 'parallelogram': { const [b, h] = need(values, 'b', 'h'); return { result: { area: b * h } }; }
    case 'ellipse': { const [a, b] = need(values, 'e1', 'e2'); return { result: { area: Math.PI * a * b, perimeter: ellipsePerimeter(a, b) } }; }
    case 'solid-cube': { const [a] = need(values, 'a'); return { result: { area: 6 * a * a } }; }
    case 'solid-box': { const [l, w, h] = need(values, 'l', 'w', 'h'); return { result: { area: 2 * (l * w + l * h + w * h) } }; }
    case 'solid-cylinder': {
      const [r, h] = need(values, 'r', 'h');
      const lateral = 2 * Math.PI * r * h;
      return { result: { area: lateral + 2 * Math.PI * r * r, lateral } };
    }
    case 'solid-cone': {
      const [r, h] = need(values, 'r', 'h');
      const slant = Math.hypot(r, h);
      const lateral = Math.PI * r * slant;
      return { result: { area: lateral + Math.PI * r * r, lateral, slant } };
    }
    case 'solid-sphere': { const [r] = need(values, 'r'); return { result: { area: 4 * Math.PI * r * r } }; }
    case 'solid-pyramid': {
      const [a, h] = need(values, 'a', 'h');
      // The slant height runs from the middle of a base edge to the apex.
      const slant = Math.hypot(a / 2, h);
      const lateral = 2 * a * slant;
      return { result: { area: lateral + a * a, lateral, slant } };
    }
  }
}
