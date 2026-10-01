import { describe, expect, it } from 'vitest';
import {
  areaFields, calculateArea, calculateVolume, convertArea, convertVolume, displayOptions, ellipsePerimeter, horizontalTankFill,
  parseLength, volumeFields, AREA_UNITS, FLAT_SHAPES, SOLID_SHAPES, TANK_TYPES, VOLUME_SHAPES, type Values,
} from './geometry';

const volume = (...args: Parameters<typeof calculateVolume>) => {
  const outcome = calculateVolume(...args);
  if ('error' in outcome) throw new Error(outcome.error);
  return outcome.result;
};
const area = (...args: Parameters<typeof calculateArea>) => {
  const outcome = calculateArea(...args);
  if ('error' in outcome) throw new Error(outcome.error);
  return outcome.result;
};

describe('calculateVolume', () => {
  it('works out the textbook shapes', () => {
    expect(volume('cube', { a: 3 }).volume).toBe(27);
    expect(volume('box', { l: 4, w: 3, h: 2 }).volume).toBe(24);
    expect(volume('cylinder', { r: 3, h: 10 }).volume).toBeCloseTo(282.7433, 4);
    expect(volume('cone', { r: 3, h: 10 }).volume).toBeCloseTo(94.2478, 4);
    expect(volume('sphere', { r: 3 }).volume).toBeCloseTo(113.0973, 4);
    expect(volume('hemisphere', { r: 3 }).volume).toBeCloseTo(56.5487, 4);
    expect(volume('pyramid', { l: 6, w: 4, h: 9 }).volume).toBe(72);
    expect(volume('prism', { b: 4, t: 3, l: 10 }).volume).toBe(60);
  });

  it('gives a cone a third of the cylinder and a hemisphere half the sphere', () => {
    const values = { r: 2.5, h: 7 };
    expect(volume('cone', values).volume * 3).toBeCloseTo(volume('cylinder', values).volume, 10);
    expect(volume('hemisphere', values).volume * 2).toBeCloseTo(volume('sphere', values).volume, 10);
  });

  it('measures the space inside a pipe, and the wall when the outside diameter is given', () => {
    // A 2 in pipe 10 ft (120 in) long holds about 377 cubic inches, or 1.63 US gallons.
    const inside = volume('pipe', { d: 2, l: 120 });
    expect(inside.volume).toBeCloseTo(376.9911, 4);
    expect(inside.material).toBeUndefined();
    expect(convertVolume(inside.volume, 'in', 'usgal')).toBeCloseTo(1.632, 3);
    expect(volume('pipe', { d: 2, l: 120, D: 2.5 }).material).toBeCloseTo(Math.PI * (1.5625 - 1) * 120, 8);
    expect(calculateVolume('pipe', { d: 2, l: 120, D: 2 })).toEqual({ error: 'outerTooSmall' });
  });

  it('fills a vertical, rectangular or horizontal tank to a liquid height', () => {
    const vertical = volume('tank', { d: 4, h: 10, f: 5 }, 'vertical');
    expect(vertical.volume).toBeCloseTo(40 * Math.PI, 10);
    expect(vertical.filled).toBeCloseTo(20 * Math.PI, 10);
    expect(volume('tank', { l: 2, w: 3, h: 4, f: 1 }, 'rectangular')).toEqual({ volume: 24, filled: 6 });
    // Half full by depth is half the volume in a lying cylinder, but a quarter of the depth holds far less than a quarter.
    const half = volume('tank', { d: 4, l: 10, f: 2 }, 'horizontal');
    expect(half.filled! / half.volume).toBeCloseTo(0.5, 10);
    const quarter = volume('tank', { d: 4, l: 10, f: 1 }, 'horizontal');
    expect(quarter.filled! / quarter.volume).toBeCloseTo(0.1955, 4);
    expect(volume('tank', { d: 4, l: 10, f: 4 }, 'horizontal').filled).toBeCloseTo(half.volume, 10);
    expect(volume('tank', { d: 4, l: 10, f: 0 }, 'horizontal').filled).toBe(0);
  });

  it('refuses a liquid level above the top of the tank', () => {
    expect(calculateVolume('tank', { d: 4, h: 10, f: 11 }, 'vertical')).toEqual({ error: 'fillTooHigh' });
    expect(calculateVolume('tank', { d: 4, l: 10, f: 4.1 }, 'horizontal')).toEqual({ error: 'fillTooHigh' });
    expect(calculateVolume('tank', { l: 2, w: 3, h: 4, f: 5 }, 'rectangular')).toEqual({ error: 'fillTooHigh' });
  });

  it('has a field for every value each shape needs', () => {
    for (const shape of VOLUME_SHAPES) for (const tank of TANK_TYPES) {
      const values: Values = Object.fromEntries(volumeFields(shape, tank).filter(field => !field.optional).map(field => [field.key, 1]));
      expect(() => calculateVolume(shape, values, tank)).not.toThrow();
    }
  });
});

describe('horizontalTankFill', () => {
  it('matches a circular segment', () => {
    // r = 1, filled to the middle: half the circle.
    expect(horizontalTankFill(1, 1, 1)).toBeCloseTo(Math.PI / 2, 12);
    expect(horizontalTankFill(1, 3, 2)).toBeCloseTo(3 * Math.PI, 12);
    expect(horizontalTankFill(1, 1, 0.5)).toBeCloseTo(Math.acos(0.5) - 0.5 * Math.sqrt(0.75), 12);
    expect(horizontalTankFill(1, 1, 1.5)).toBeCloseTo(Math.PI - (Math.acos(0.5) - 0.5 * Math.sqrt(0.75)), 12);
  });

  it('stays positive and accurate for a very shallow fill', () => {
    // A thin segment of depth f is (4 ÷ 3) × √(2r) × f^1.5 to first order; the next term is smaller by about f ÷ r.
    for (const [r, f] of [[100, 1e-7], [1e9, 1e-3], [1, 1e-12], [5e8, 1]]) {
      const filled = horizontalTankFill(r, 1, f);
      expect(filled).toBeGreaterThan(0);
      expect(filled / ((4 / 3) * Math.sqrt(2 * r) * f ** 1.5)).toBeCloseTo(1, 6);
    }
    expect(calculateVolume('tank', { d: 200, l: 100, f: 1e-7 }, 'horizontal')).toEqual({ result: { volume: expect.any(Number), filled: expect.closeTo(5.963e-8, 10) } });
  });

  it('is symmetric: the liquid below a depth and the air above it make the full tank', () => {
    for (const f of [1e-9, 0.01, 0.3, 0.999, 1, 1.7, 2 - 1e-9]) {
      expect(horizontalTankFill(1, 1, f) + horizontalTankFill(1, 1, 2 - f)).toBeCloseTo(Math.PI, 12);
    }
  });

  it('agrees with the textbook formula wherever that formula is accurate', () => {
    for (let f = 0.05; f < 2; f += 0.05) {
      const textbook = Math.acos(1 - f) - (1 - f) * Math.sqrt(2 * f - f * f);
      expect(horizontalTankFill(1, 1, f)).toBeCloseTo(textbook, 12);
    }
  });
});

describe('calculateArea', () => {
  it('works out flat shapes and their perimeters', () => {
    expect(area('square', { a: 5 })).toEqual({ area: 25, perimeter: 20 });
    expect(area('rectangle', { l: 8, w: 3 })).toEqual({ area: 24, perimeter: 22 });
    expect(area('triangle', { b: 10, h: 4 })).toEqual({ area: 20 });
    expect(area('trapezoid', { b1: 6, b2: 10, h: 4 }).area).toBe(32);
    expect(area('parallelogram', { b: 7, h: 3 }).area).toBe(21);
    const circle = area('circle', { r: 5 });
    expect(circle.area).toBeCloseTo(78.5398, 4);
    expect(circle.perimeter).toBeCloseTo(31.4159, 4);
    expect(area('ellipse', { e1: 5, e2: 3 }).area).toBeCloseTo(47.1239, 4);
  });

  it('uses Heron’s formula for three sides', () => {
    expect(area('triangle', { s1: 3, s2: 4, s3: 5 }, 'sides')).toEqual({ area: 6, perimeter: 12 });
    expect(area('triangle', { s1: 5, s2: 5, s3: 6 }, 'sides').area).toBeCloseTo(12, 12);
    // A long thin triangle stays accurate.
    expect(area('triangle', { s1: 100000, s2: 99999.99979, s3: 0.00029 }, 'sides').area).toBeCloseTo(10, 0);
  });

  it('refuses three sides that can’t meet', () => {
    expect(calculateArea('triangle', { s1: 1, s2: 2, s3: 3 }, 'sides')).toEqual({ error: 'notTriangle' });
    expect(calculateArea('triangle', { s1: 1, s2: 2, s3: 10 }, 'sides')).toEqual({ error: 'notTriangle' });
  });

  it('works out surface areas, with the side area and slant height', () => {
    expect(area('solid-cube', { a: 2 }).area).toBe(24);
    expect(area('solid-box', { l: 4, w: 3, h: 2 }).area).toBe(52);
    const cylinder = area('solid-cylinder', { r: 3, h: 10 });
    expect(cylinder.area).toBeCloseTo(78 * Math.PI, 10);
    expect(cylinder.lateral).toBeCloseTo(60 * Math.PI, 10);
    const cone = area('solid-cone', { r: 3, h: 4 });
    expect(cone.slant).toBe(5);
    expect(cone.area).toBeCloseTo(24 * Math.PI, 10);
    expect(area('solid-sphere', { r: 3 }).area).toBeCloseTo(36 * Math.PI, 10);
    // Base 6, height 4: slant 5, four triangles of 15 and a base of 36.
    expect(area('solid-pyramid', { a: 6, h: 4 })).toEqual({ area: 96, lateral: 60, slant: 5 });
  });

  it('has a field for every value each shape needs', () => {
    const shapes = [...FLAT_SHAPES, ...SOLID_SHAPES.map(shape => `solid-${shape}` as const)];
    for (const shape of shapes) for (const method of ['base', 'sides'] as const) {
      const values: Values = Object.fromEntries(areaFields(shape, method).map(field => [field.key, 2]));
      expect(() => calculateArea(shape, values, method)).not.toThrow();
    }
  });
});

describe('ellipsePerimeter', () => {
  it('is exact for a circle and close for a long ellipse', () => {
    expect(ellipsePerimeter(2, 2)).toBeCloseTo(4 * Math.PI, 12);
    // The exact perimeter for semi-axes 10 and 1 is 40.6397...
    expect(ellipsePerimeter(10, 1)).toBeCloseTo(40.6397, 3);
  });
});

describe('unit conversions', () => {
  it('converts volumes', () => {
    expect(convertVolume(1, 'ft', 'usgal')).toBeCloseTo(7.48052, 5);
    expect(convertVolume(231, 'in', 'usgal')).toBeCloseTo(1, 12);
    expect(convertVolume(1000, 'cm', 'l')).toBeCloseTo(1, 12);
    expect(convertVolume(1, 'm', 'impgal')).toBeCloseTo(219.969, 3);
    expect(convertVolume(1, 'yd', 'ft3')).toBeCloseTo(27, 10);
    expect(convertVolume(1, 'cm', 'ml')).toBeCloseTo(1, 12);
  });

  it('converts areas', () => {
    expect(convertArea(43560, 'ft', 'acre')).toBeCloseTo(1, 12);
    expect(convertArea(10000, 'm', 'ha')).toBeCloseTo(1, 12);
    expect(convertArea(1, 'yd', 'ft2')).toBeCloseTo(9, 10);
    expect(convertArea(1, 'in', 'cm2')).toBeCloseTo(6.4516, 10);
    expect(AREA_UNITS).toHaveLength(8);
  });
});

describe('parseLength', () => {
  it('reads lengths typed in each language', () => {
    expect(parseLength('12.5', 'en')).toEqual({ value: 12.5 });
    expect(parseLength('12,5', 'de')).toEqual({ value: 12.5 });
    expect(parseLength('1,250', 'en')).toEqual({ value: 1250 });
    expect(parseLength(' ', 'en')).toBeUndefined();
  });

  it('refuses text, negatives, zero and huge values', () => {
    expect(parseLength('abc', 'en')).toEqual({ error: 'invalid' });
    expect(parseLength('-3', 'en')).toEqual({ error: 'invalid' });
    expect(parseLength('0', 'en')).toEqual({ error: 'invalid' });
    expect(parseLength('0', 'en', true)).toEqual({ value: 0 });
    expect(parseLength('2000000000', 'en')).toEqual({ error: 'tooLarge' });
  });
});

describe('displayOptions', () => {
  it('keeps small results readable', () => {
    const show = (value: number) => new Intl.NumberFormat('en', displayOptions(value)).format(value);
    expect(show(282.743338)).toBe('282.74');
    expect(show(3.14159)).toBe('3.142');
    expect(show(0.0748052)).toBe('0.07481');
    expect(show(0)).toBe('0');
    expect(show(1234567.891)).toBe('1,234,567.89');
  });
});
