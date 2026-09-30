import { describe, expect, it } from 'vitest';
import { calculateGpa, roundGpa, gradePoints, letterForGpa, letterFromPercent, parseNumber, percentRange, type Course } from './high-school-gpa';

const course = (grade: Course['grade'], level: Course['level'] = 'regular', credits = 1): Course => ({ grade, level, credits });
const noCredits = { useCredits: false, aPlus: 4 } as const;
const withCredits = { useCredits: true, aPlus: 4 } as const;

describe('letterFromPercent', () => {
  it('uses the 10-point scale with plus and minus grades', () => {
    expect(letterFromPercent(100)).toBe('A+');
    expect(letterFromPercent(97)).toBe('A+');
    expect(letterFromPercent(96.9)).toBe('A');
    expect(letterFromPercent(93)).toBe('A');
    expect(letterFromPercent(92)).toBe('A-');
    expect(letterFromPercent(89)).toBe('B+');
    expect(letterFromPercent(80)).toBe('B-');
    expect(letterFromPercent(63)).toBe('D');
    expect(letterFromPercent(60)).toBe('D-');
    expect(letterFromPercent(59.9)).toBe('F');
    expect(letterFromPercent(0)).toBe('F');
  });

  it('allows extra credit up to 120 and refuses anything else', () => {
    expect(letterFromPercent(104)).toBe('A+');
    expect(letterFromPercent(121)).toBeUndefined();
    expect(letterFromPercent(-1)).toBeUndefined();
    expect(letterFromPercent(Number.NaN)).toBeUndefined();
  });
});

describe('gradePoints', () => {
  it('adds 0.5 for honors and 1 for AP or IB', () => {
    expect(gradePoints('B', 'regular')).toEqual({ unweighted: 3, weighted: 3 });
    expect(gradePoints('B', 'honors')).toEqual({ unweighted: 3, weighted: 3.5 });
    expect(gradePoints('A', 'ap')).toEqual({ unweighted: 4, weighted: 5 });
  });

  it('gives an F no points in any class', () => {
    expect(gradePoints('F', 'ap')).toEqual({ unweighted: 0, weighted: 0 });
  });

  it('counts A+ as 4.0 or 4.3', () => {
    expect(gradePoints('A+', 'regular').unweighted).toBe(4);
    expect(gradePoints('A+', 'regular', 4.3).unweighted).toBe(4.3);
    expect(gradePoints('A+', 'ap', 4.3).weighted).toBeCloseTo(5.3);
  });
});

describe('calculateGpa', () => {
  it('averages every class equally without credits', () => {
    const r = calculateGpa([course('A'), course('B+', 'honors'), course('B'), course('A-', 'ap')], noCredits);
    // (4 + 3.3 + 3 + 3.7) / 4 = 3.5; weighted (4 + 3.8 + 3 + 4.7) / 4 = 3.875
    expect(r.unweighted).toBeCloseTo(3.5);
    expect(r.weighted).toBeCloseTo(3.875);
    expect(r).toMatchObject({ counted: 4, units: 4 });
  });

  it('weights each class by its credits when credits are used', () => {
    const r = calculateGpa([course('A', 'regular', 1), course('C', 'regular', 0.5)], withCredits);
    // (4 × 1 + 2 × 0.5) / 1.5
    expect(r.unweighted).toBeCloseTo(10 / 3);
    expect(r.units).toBe(1.5);
  });

  it('ignores credits when they are turned off', () => {
    const r = calculateGpa([course('A', 'regular', 1), course('C', 'regular', 0.5)], noCredits);
    expect(r.unweighted).toBeCloseTo(3);
  });

  it('leaves out pass/fail classes, empty rows and 0-credit classes', () => {
    const r = calculateGpa([course('A'), course('P'), course(undefined), course('C', 'regular', 0)], withCredits);
    expect(r).toMatchObject({ counted: 1, passFail: 1, unweighted: 4 });
  });

  it('has no GPA until a graded class counts', () => {
    const r = calculateGpa([course('P'), course(undefined)], noCredits);
    expect(r.unweighted).toBeUndefined();
    expect(r.weighted).toBeUndefined();
  });

  it('combines this term with an earlier GPA', () => {
    const r = calculateGpa([course('A'), course('A'), course('B', 'ap'), course('B')], noCredits, { unweighted: 3, weighted: 3.2, units: 12 });
    // (3 × 12 + 14) / 16 = 3.125; (3.2 × 12 + 15) / 16 = 3.3375
    expect(r.cumulativeUnweighted).toBeCloseTo(3.125);
    expect(r.cumulativeWeighted).toBeCloseTo(3.3375);
  });

  it('only combines the earlier GPAs that were entered', () => {
    const r = calculateGpa([course('A')], noCredits, { unweighted: 3, units: 4 });
    expect(r.cumulativeUnweighted).toBeCloseTo(3.2);
    expect(r.cumulativeWeighted).toBeUndefined();
    expect(calculateGpa([course('A')], noCredits, { unweighted: 3, units: 0 }).cumulativeUnweighted).toBeUndefined();
  });
});

describe('letterForGpa', () => {
  it('names the letter an unweighted GPA reaches', () => {
    expect(letterForGpa(4)).toBe('A');
    expect(letterForGpa(3.7)).toBe('A-');
    expect(letterForGpa(3.5)).toBe('B+');
    expect(letterForGpa(3.0)).toBe('B');
    expect(letterForGpa(0.5)).toBe('F');
  });

  it('only names A+ when A+ is worth 4.3', () => {
    expect(letterForGpa(4.3, 4.3)).toBe('A+');
    expect(letterForGpa(4.1, 4.3)).toBe('A');
  });
});

describe('percentRange', () => {
  it('gives each letter its range', () => {
    expect(percentRange('A+')).toEqual([97, 100]);
    expect(percentRange('B+')).toEqual([87, 89]);
    expect(percentRange('D-')).toEqual([60, 62]);
    expect(percentRange('F')).toEqual([0, 59]);
  });
});

describe('parseNumber', () => {
  it('reads decimal points and commas', () => {
    expect(parseNumber('3.5')).toBe(3.5);
    expect(parseNumber('3,5')).toBe(3.5);
    expect(parseNumber('92.5 %')).toBe(92.5);
    expect(parseNumber('.5')).toBe(0.5);
    expect(parseNumber('９５')).toBe(95);
  });

  it('returns undefined when empty and NaN when not a number', () => {
    expect(parseNumber('  ')).toBeUndefined();
    expect(parseNumber('abc')).toBeNaN();
    expect(parseNumber('-1')).toBeNaN();
    expect(parseNumber('1.2.3')).toBeNaN();
    expect(parseNumber('.')).toBeNaN();
  });
});

describe('roundGpa', () => {
  it('rounds half up to two decimals despite floating-point noise', () => {
    expect(roundGpa(14.3 / 4)).toBe(3.58);
    expect(roundGpa(15.5 / 4)).toBe(3.88);
    expect(roundGpa(10 / 3)).toBe(3.33);
  });
});
