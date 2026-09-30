import { describe, expect, it } from 'vitest';
import { calculateGpa, honorFor, maxGpa, planFinalGpa, pointsFor, termGpa, type Course } from './college-gpa';

const course = (grade: Course['grade'], credits = 3): Course => ({ grade, credits });
const thirds = { thirds: true, aPlusAbove: false };

describe('pointsFor', () => {
  it('uses the plus/minus 4.0 scale by default', () => {
    expect(pointsFor('A')).toBe(4);
    expect(pointsFor('A-')).toBe(3.7);
    expect(pointsFor('B+')).toBe(3.3);
    expect(pointsFor('D-')).toBe(0.7);
    expect(pointsFor('F')).toBe(0);
  });

  it('can count plus and minus grades in thirds', () => {
    expect(pointsFor('A-', thirds)).toBe(3.67);
    expect(pointsFor('B+', thirds)).toBe(3.33);
    expect(pointsFor('C-', thirds)).toBe(1.67);
    expect(pointsFor('B', thirds)).toBe(3);
  });

  it('counts an A+ as 4.0, 4.3 or 4.33', () => {
    expect(pointsFor('A+')).toBe(4);
    expect(pointsFor('A+', { thirds: false, aPlusAbove: true })).toBe(4.3);
    expect(pointsFor('A+', { thirds: true, aPlusAbove: true })).toBe(4.33);
    expect(maxGpa()).toBe(4);
    expect(maxGpa({ thirds: false, aPlusAbove: true })).toBe(4.3);
  });
});

describe('termGpa', () => {
  it('weights each grade by its credits', () => {
    // The example on the page: A (3), B+ (4), B (3), A- (2) = 12 + 13.2 + 9 + 7.4 = 41.6 over 12 credits
    const r = termGpa([course('A', 3), course('B+', 4), course('B', 3), course('A-', 2)]);
    expect(r.points).toBe(41.6);
    expect(r.credits).toBe(12);
    expect(r.gpa).toBeCloseTo(3.4667);
    expect(r.counted).toBe(4);
  });

  it('keeps an F in the credits but leaves out P, W, empty rows and 0-credit courses', () => {
    const r = termGpa([course('A'), course('F'), course('P'), course('W'), course(undefined), course('B', 0)]);
    expect(r).toMatchObject({ counted: 2, excluded: 2, credits: 6, points: 12, gpa: 2 });
  });

  it('has no GPA until a graded course with credits counts', () => {
    expect(termGpa([course('P'), course(undefined)]).gpa).toBeUndefined();
    expect(termGpa([course('A', 0)]).gpa).toBeUndefined();
  });

  it('caps credits for one course at 20', () => {
    expect(termGpa([course('A', 50)]).credits).toBe(20);
  });
});

describe('calculateGpa', () => {
  it('averages every semester by credits, not semester by semester', () => {
    const r = calculateGpa([[course('A', 3), course('B', 3)], [course('C', 3)]]);
    expect(r.terms.map(term => term.gpa)).toEqual([3.5, 2]);
    // (4 × 3 + 3 × 3 + 2 × 3) / 9 = 3, not (3.5 + 2) / 2 = 2.75
    expect(r.gpa).toBeCloseTo(3);
    expect(r.credits).toBe(9);
    expect(r.cumulative).toBeUndefined();
    expect(r.cumulativeCredits).toBe(9);
  });

  it('combines the semesters with an earlier GPA', () => {
    // The page's example: 3.2 over 60 credits and 3.8 over 15 new credits = (192 + 57) / 75 = 3.32
    const r = calculateGpa([[course('A', 3), course('A', 3), course('A', 3), course('A-', 3), course('B+', 3)]], undefined, { gpa: 3.2, credits: 60 });
    expect(r.gpa).toBeCloseTo(3.8);
    expect(r.cumulative).toBeCloseTo(3.32);
    expect(r.cumulativeCredits).toBe(75);
  });

  it('ignores an earlier GPA with no credits or when nothing new counts', () => {
    expect(calculateGpa([[course('A')]], undefined, { gpa: 3, credits: 0 }).cumulative).toBeUndefined();
    expect(calculateGpa([[course(undefined)]], undefined, { gpa: 3, credits: 30 }).cumulative).toBeUndefined();
  });
});

describe('planFinalGpa', () => {
  it('works out the average needed over the remaining credits', () => {
    // 3.2 over 60 credits, 3.5 wanted after 60 more: (3.5 × 120 - 192) / 60 = 3.8
    const plan = planFinalGpa({ gpa: 3.2, credits: 60 }, 3.5, 60);
    expect(plan?.status).toBe('possible');
    expect(plan?.required).toBeCloseTo(3.8);
  });

  it('says when even straight A’s fall short, with the best final GPA', () => {
    const plan = planFinalGpa({ gpa: 2.5, credits: 90 }, 3.5, 30);
    expect(plan?.status).toBe('impossible');
    // (225 + 120) / 120 = 2.875
    if (plan?.status === 'impossible') expect(plan.best).toBeCloseTo(2.875);
    // With A+ worth 4.3 the ceiling rises.
    const higher = planFinalGpa({ gpa: 3.8, credits: 90 }, 3.9, 30, { thirds: false, aPlusAbove: true });
    expect(higher?.status).toBe('possible');
    expect(higher?.required).toBeCloseTo(4.2);
  });

  it('says when the target is met whatever happens', () => {
    const plan = planFinalGpa({ gpa: 3.9, credits: 110 }, 3.5, 10);
    expect(plan?.status).toBe('secured');
    // Even all F's: 429 / 120 = 3.575
    if (plan?.status === 'secured') expect(plan.worst).toBeCloseTo(3.575);
  });

  it('treats a required 4.0 as possible despite floating-point noise', () => {
    expect(planFinalGpa({ gpa: 3, credits: 30 }, 3.5, 30)?.status).toBe('possible');
  });

  it('needs remaining credits', () => {
    expect(planFinalGpa({ gpa: 3, credits: 30 }, 3.5, 0)).toBeUndefined();
  });
});

describe('honorFor', () => {
  it('uses the 3.5, 3.7 and 3.9 cutoffs by default', () => {
    expect(honorFor(3.95)).toBe('summa');
    expect(honorFor(3.9)).toBe('summa');
    expect(honorFor(3.72)).toBe('magna');
    expect(honorFor(3.5)).toBe('cum');
    expect(honorFor(3.49)).toBeUndefined();
  });

  it('compares the GPA as shown, at two decimals', () => {
    expect(honorFor(3.4996)).toBe('cum');
    expect(honorFor(3.494)).toBeUndefined();
  });

  it('takes other cutoffs', () => {
    expect(honorFor(3.3, { summa: 3.8, magna: 3.5, cum: 3.2 })).toBe('cum');
  });
});
