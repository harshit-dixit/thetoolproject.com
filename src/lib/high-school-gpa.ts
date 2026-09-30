// High school GPA: turning letter or percent grades into grade points and averaging them,
// unweighted (4.0 scale) and weighted (honors and AP/IB classes earn extra points).

export const LETTERS = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-', 'F'] as const;
export type Letter = (typeof LETTERS)[number];
/** P is a pass in a pass/fail class: it earns credit but isn't part of the GPA. */
export type Grade = Letter | 'P';

export type Level = 'regular' | 'honors' | 'ap';
export const LEVELS: readonly Level[] = ['regular', 'honors', 'ap'];
/** Extra points a weighted GPA adds for a passing grade: the most common high school scheme. */
export const LEVEL_BONUS: Record<Level, number> = { regular: 0, honors: 0.5, ap: 1 };

/** Points on the unweighted 4.0 scale. A+ is 4.0 at most schools; some give 4.3. */
export const LETTER_POINTS: Record<Letter, number> = {
  'A+': 4, A: 4, 'A-': 3.7, 'B+': 3.3, B: 3, 'B-': 2.7, 'C+': 2.3, C: 2, 'C-': 1.7, 'D+': 1.3, D: 1, 'D-': 0.7, F: 0,
};

/** The lowest percentage for each letter on the common 10-point scale. Below 60 is an F. */
export const PERCENT_CUTOFFS: [Letter, number][] = [
  ['A+', 97], ['A', 93], ['A-', 90], ['B+', 87], ['B', 83], ['B-', 80], ['C+', 77], ['C', 73], ['C-', 70], ['D+', 67], ['D', 63], ['D-', 60], ['F', 0],
];

/** Percentages above 100 (extra credit) are allowed up to this. */
export const MAX_PERCENT = 120;
export const MAX_CREDITS = 10;
export const MAX_CLASSES = 30;

export type APlus = 4 | 4.3;

export type Course = {
  grade: Grade | undefined;
  level: Level;
  /** Ignored unless credits are used. */
  credits: number;
};

export type Earlier = {
  /** The GPA on the transcript so far. */
  unweighted?: number;
  weighted?: number;
  /** Classes (or credits, when credits are used) behind that GPA. */
  units: number;
};

export type GpaOptions = { useCredits: boolean; aPlus: APlus };

export type GpaResult = {
  /** Classes with a letter grade that count towards the GPA. */
  counted: number;
  /** Pass/fail classes, left out of the GPA. */
  passFail: number;
  /** Classes, or credits when credits are used, that the GPA is averaged over. */
  units: number;
  unweightedPoints: number;
  weightedPoints: number;
  /** undefined until at least one graded class counts. */
  unweighted?: number;
  weighted?: number;
  cumulativeUnweighted?: number;
  cumulativeWeighted?: number;
};

/** The letter for a percentage grade, or undefined if it's not 0–120. */
export function letterFromPercent(percent: number): Letter | undefined {
  if (!Number.isFinite(percent) || percent < 0 || percent > MAX_PERCENT) return undefined;
  return PERCENT_CUTOFFS.find(([, min]) => percent >= min)![0];
}

export function gradePoints(letter: Letter, level: Level, aPlus: APlus = 4): { unweighted: number; weighted: number } {
  const unweighted = letter === 'A+' ? aPlus : LETTER_POINTS[letter];
  // A failing grade earns no points, whatever the class.
  return { unweighted, weighted: letter === 'F' ? 0 : unweighted + LEVEL_BONUS[level] };
}

const round = (value: number, places = 6) => Number(value.toFixed(places));

/** Rounds a GPA half up to two decimals, so 14.3 ÷ 4 = 3.575 shows as 3.58, not 3.57 from floating-point noise. */
export function roundGpa(value: number): number {
  return Math.round(value * 100 + 1e-9) / 100;
}

export function calculateGpa(courses: Course[], options: GpaOptions, earlier?: Earlier): GpaResult {
  let counted = 0, passFail = 0, units = 0, unweightedPoints = 0, weightedPoints = 0;
  for (const course of courses) {
    if (!course.grade) continue;
    if (course.grade === 'P') { passFail++; continue; }
    const weight = options.useCredits ? Math.min(MAX_CREDITS, Math.max(0, course.credits)) : 1;
    // A class worth 0 credits doesn't move the GPA.
    if (!(weight > 0)) continue;
    const points = gradePoints(course.grade, course.level, options.aPlus);
    counted++;
    units += weight;
    unweightedPoints += points.unweighted * weight;
    weightedPoints += points.weighted * weight;
  }
  const result: GpaResult = { counted, passFail, units: round(units), unweightedPoints: round(unweightedPoints), weightedPoints: round(weightedPoints) };
  if (units > 0) {
    result.unweighted = unweightedPoints / units;
    result.weighted = weightedPoints / units;
  }
  // The earlier GPA counts in proportion to the classes or credits behind it.
  const before = earlier && earlier.units > 0 ? earlier.units : 0;
  if (before > 0 && units > 0) {
    if (earlier!.unweighted !== undefined) result.cumulativeUnweighted = (earlier!.unweighted * before + unweightedPoints) / (before + units);
    if (earlier!.weighted !== undefined) result.cumulativeWeighted = (earlier!.weighted * before + weightedPoints) / (before + units);
  }
  return result;
}

/**
 * The letter an unweighted GPA corresponds to: the highest letter whose points it reaches,
 * so 3.5 is a B+ average and 3.7 an A-.
 */
export function letterForGpa(gpa: number, aPlus: APlus = 4): Letter {
  const value = round(gpa, 4);
  // A+ only when A+ is worth more than an A; otherwise a 4.0 is an A.
  const letters = LETTERS.filter(letter => letter !== 'A+' || aPlus > 4);
  return letters.find(letter => value >= gradePoints(letter, 'regular', aPlus).unweighted) ?? 'F';
}

/** The percent range of a letter, e.g. [87, 89] for B+. F is [0, 59]; A+ is [97, 100]. */
export function percentRange(letter: Letter): [number, number] {
  const index = PERCENT_CUTOFFS.findIndex(([name]) => name === letter);
  const min = PERCENT_CUTOFFS[index][1];
  const max = index === 0 ? 100 : PERCENT_CUTOFFS[index - 1][1] - 1;
  return [min, max];
}

/**
 * Reads a number typed in any of the site's languages: "3.5", "3,5", "92.5 %".
 * Returns undefined for an empty field and NaN for anything that isn't a plain non-negative number.
 */
export function parseNumber(text: string): number | undefined {
  const cleaned = text.normalize('NFKC').replace(/[\s%]/g, '');
  if (!cleaned) return undefined;
  if (!/^\d*(?:[.,]\d*)?$/.test(cleaned) || !/\d/.test(cleaned)) return Number.NaN;
  return Number(cleaned.replace(',', '.'));
}
