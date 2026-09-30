// College GPA: credit-weighted averages for each semester and across all of them, combined with
// an earlier GPA, the average still needed to reach a target GPA, and common Latin honors cutoffs.
// The 4.0 scale, percent cutoffs and number parsing are shared with the high school calculator.

import { LETTERS, LETTER_POINTS, roundGpa, type Letter } from './high-school-gpa';

/** P is a pass in a pass/fail course and W a withdrawal: neither is part of the GPA. */
export type Grade = Letter | 'P' | 'W';

export const MAX_SEMESTERS = 12;
export const MAX_COURSES = 12;
/** Credits for one course. Most US courses are 1–5 credit hours; 20 leaves room for other systems. */
export const MAX_CREDITS = 20;
/** Credits behind an earlier GPA, or still to take. */
export const MAX_TOTAL_CREDITS = 500;
export const DEFAULT_CREDITS = 3;

export type Course = { grade: Grade | undefined; credits: number };

/**
 * How plus and minus grades count. Most colleges add or take off 0.3 (B+ 3.3, A- 3.7); some use
 * thirds (B+ 3.33, A- 3.67). An A+ is 4.0 at some colleges and 4.3 (4.33 in thirds) at others.
 */
export type Scale = { thirds: boolean; aPlusAbove: boolean };
export const DEFAULT_SCALE: Scale = { thirds: false, aPlusAbove: false };

export type TermResult = {
  /** Graded courses that count towards the GPA. */
  counted: number;
  /** Pass/fail and withdrawn courses, left out of the GPA. */
  excluded: number;
  credits: number;
  /** Quality points: each grade's points times its credits. */
  points: number;
  /** undefined until a graded course with credits counts. */
  gpa?: number;
};

export type Earlier = { gpa: number; credits: number };

export type GpaResult = TermResult & {
  terms: TermResult[];
  /** This GPA combined with the earlier one, when one was entered. */
  cumulative?: number;
  cumulativeCredits: number;
};

const THIRDS: Partial<Record<Letter, number>> = { 'A-': 3.67, 'B+': 3.33, 'B-': 2.67, 'C+': 2.33, 'C-': 1.67, 'D+': 1.33, 'D-': 0.67 };

export function pointsFor(letter: Letter, scale: Scale = DEFAULT_SCALE): number {
  if (letter === 'A+') return scale.aPlusAbove ? (scale.thirds ? 4.33 : 4.3) : 4;
  return (scale.thirds ? THIRDS[letter] : undefined) ?? LETTER_POINTS[letter];
}

/** The highest GPA the scale allows: an A in everything, or an A+ where it's worth more. */
export const maxGpa = (scale: Scale = DEFAULT_SCALE) => pointsFor('A+', scale);

/** Slack for floating-point sums, so 3 × 3.7 / 3 still reaches 3.7. Far below any GPA a registrar reports. */
const EPSILON = 1e-9;

/**
 * The letter a GPA corresponds to on the chosen scale: the highest letter whose points it reaches,
 * as shown at two decimals. A 3.67 is an A- in thirds but a B+ in 0.3 steps.
 */
export function letterFor(gpa: number, scale: Scale = DEFAULT_SCALE): Letter {
  const shown = roundGpa(gpa);
  const letters = LETTERS.filter(letter => letter !== 'A+' || scale.aPlusAbove);
  return letters.find(letter => shown + EPSILON >= pointsFor(letter, scale)) ?? 'F';
}

const round = (value: number) => Number(value.toFixed(6));

export function termGpa(courses: Course[], scale: Scale = DEFAULT_SCALE): TermResult {
  let counted = 0, excluded = 0, credits = 0, points = 0;
  for (const course of courses) {
    if (!course.grade) continue;
    if (course.grade === 'P' || course.grade === 'W') { excluded++; continue; }
    const weight = Math.min(MAX_CREDITS, Math.max(0, course.credits));
    // A course worth 0 credits doesn't move the GPA.
    if (!(weight > 0)) continue;
    counted++;
    credits += weight;
    points += pointsFor(course.grade, scale) * weight;
  }
  const result: TermResult = { counted, excluded, credits: round(credits), points: round(points) };
  if (credits > 0) result.gpa = points / credits;
  return result;
}

/** Every semester's GPA, the GPA across all of them, and that combined with an earlier GPA. */
export function calculateGpa(terms: Course[][], scale: Scale = DEFAULT_SCALE, earlier?: Earlier): GpaResult {
  const results = terms.map(term => termGpa(term, scale));
  const sum = (key: 'counted' | 'excluded' | 'credits' | 'points') => results.reduce((total, term) => total + term[key], 0);
  const credits = round(sum('credits'));
  const points = round(sum('points'));
  const result: GpaResult = { terms: results, counted: sum('counted'), excluded: sum('excluded'), credits, points, cumulativeCredits: credits };
  if (credits > 0) result.gpa = points / credits;
  // The earlier GPA counts in proportion to the credits behind it.
  if (earlier && earlier.credits > 0 && credits > 0) {
    result.cumulativeCredits = round(earlier.credits + credits);
    result.cumulative = (earlier.gpa * earlier.credits + points) / result.cumulativeCredits;
  }
  return result;
}

export type Plan =
  /** The average needed over the remaining credits. */
  | { status: 'possible'; required: number; final: number }
  /** Even the top grade in every remaining credit falls short; best is the highest final GPA. */
  | { status: 'impossible'; required: number; best: number }
  /** The target is met whatever the remaining grades are. */
  | { status: 'secured'; required: number; worst: number };

/** The average GPA needed over `remaining` credits to finish with `target`. */
export function planFinalGpa(current: Earlier, target: number, remaining: number, scale: Scale = DEFAULT_SCALE): Plan | undefined {
  const top = maxGpa(scale);
  if (!(remaining > 0) || !(current.credits >= 0) || !Number.isFinite(target)) return undefined;
  const total = current.credits + remaining;
  const have = current.gpa * current.credits;
  const required = (target * total - have) / remaining;
  // Compared unrounded: needing 4.002 on a 4.0 scale is out of reach, even though it shows as 4.00.
  if (required > top + EPSILON) return { status: 'impossible', required, best: (have + top * remaining) / total };
  if (required <= EPSILON) return { status: 'secured', required, worst: have / total };
  return { status: 'possible', required, final: target };
}

export type Honor = 'summa' | 'magna' | 'cum';
export const HONORS: readonly Honor[] = ['summa', 'magna', 'cum'];
/**
 * The University of Utah's cutoffs (registrar.utah.edu/handbook/honors.php), a common set.
 * Each college sets its own, and some rank graduates by percentile instead.
 */
export const COMMON_HONORS: Record<Honor, number> = { summa: 3.9, magna: 3.7, cum: 3.5 };

/**
 * The highest Latin honor cutoff a GPA meets, compared at full precision: colleges don't all round,
 * so a 3.4996 doesn't meet 3.5 here even though it shows as 3.50.
 */
export function honorFor(gpa: number, cutoffs: Record<Honor, number> = COMMON_HONORS): Honor | undefined {
  return HONORS.find(honor => gpa + EPSILON >= cutoffs[honor]);
}

/** The next cutoff above the GPA that it reaches only when rounded to two decimals, if any. */
export function roundsUpTo(gpa: number, cutoffs: Record<Honor, number> = COMMON_HONORS): Honor | undefined {
  const honor = [...HONORS].reverse().find(name => gpa + EPSILON < cutoffs[name]);
  return honor && roundGpa(gpa) >= cutoffs[honor] ? honor : undefined;
}
