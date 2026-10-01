// Age between two calendar dates. Everything works on whole dates (year, month, day), never on
// times, so time zones and daylight saving can't shift an answer by a day.

export type CivilDate = { year: number; month: number; day: number };

export type Span = { years: number; months: number; days: number };

export type AgeResult = Span & {
  totalMonths: number;
  totalDays: number;
  weeks: number;
  weekDays: number;
  /** The next birthday on or after the "age on" date, and the age it brings. */
  nextBirthday: CivilDate;
  nextAge: number;
  untilNext: Span;
  daysUntilNext: number;
};

export const MIN_YEAR = 1000;
export const MAX_YEAR = 9999;

const isLeap = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

export function daysInMonth(year: number, month: number) {
  return month === 2 ? (isLeap(year) ? 29 : 28) : [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

/** Reads a date input's value (yyyy-mm-dd). Years before 1000 count as unfinished typing. */
export function parseIsoDate(value: string): CivilDate | undefined {
  const match = /^(\d{4,})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return undefined;
  const [year, month, day] = match.slice(1).map(Number);
  if (year < MIN_YEAR || year > MAX_YEAR || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return undefined;
  return { year, month, day };
}

export const toIsoDate = ({ year, month, day }: CivilDate) => `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

/** Days since 1970-01-01 in the proleptic Gregorian calendar (H. Hinnant's days_from_civil). */
export function dayNumber({ year, month, day }: CivilDate) {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yearOfEra = y - era * 400;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

/** 0 is Sunday, as in Date.getDay(). */
export const weekday = (date: CivilDate) => (((dayNumber(date) + 4) % 7) + 7) % 7;

export const compareDates = (a: CivilDate, b: CivilDate) => dayNumber(a) - dayNumber(b);

/** Adds whole months. A day the target month doesn't have becomes its last day (January 31 + 1 month is February 28 or 29). */
export function addMonths(date: CivilDate, months: number): CivilDate {
  const index = date.year * 12 + (date.month - 1) + months;
  const year = Math.floor(index / 12);
  const month = index - year * 12 + 1;
  return { year, month, day: Math.min(date.day, daysInMonth(year, month)) };
}

/**
 * Whole years, months and days from one date to a later one. Months are counted from the start
 * date each time, never chained, so the answer doesn't drift; the days are what's left over.
 */
export function calendarSpan(from: CivilDate, to: CivilDate): Span & { totalMonths: number } {
  let totalMonths = (to.year - from.year) * 12 + (to.month - from.month);
  if (totalMonths > 0 && compareDates(addMonths(from, totalMonths), to) > 0) totalMonths--;
  const days = dayNumber(to) - dayNumber(addMonths(from, totalMonths));
  return { years: Math.floor(totalMonths / 12), months: totalMonths % 12, days, totalMonths };
}

export function calculateAge(birth: CivilDate, on: CivilDate): { result: AgeResult } | { error: 'birthAfter' } {
  if (compareDates(birth, on) > 0) return { error: 'birthAfter' };
  const span = calendarSpan(birth, on);
  const totalDays = dayNumber(on) - dayNumber(birth);
  // A birthday today counts as the next one, except on the day of birth itself.
  const birthdayToday = span.years > 0 && span.months === 0 && span.days === 0;
  const nextAge = birthdayToday ? span.years : span.years + 1;
  // Someone born on February 29 has the birthday on February 28 in other years.
  const nextBirthday = addMonths(birth, nextAge * 12);
  const until = calendarSpan(on, nextBirthday);
  return {
    result: {
      years: span.years,
      months: span.months,
      days: span.days,
      totalMonths: span.totalMonths,
      totalDays,
      weeks: Math.floor(totalDays / 7),
      weekDays: totalDays % 7,
      nextBirthday,
      nextAge,
      untilNext: { years: until.years, months: until.months, days: until.days },
      daysUntilNext: dayNumber(nextBirthday) - dayNumber(on),
    },
  };
}

/** A coarse age band for analytics, so no exact age or date is ever sent. */
export function ageBand(years: number) {
  if (years < 1) return 'under-1';
  if (years < 5) return '1-4';
  if (years < 13) return '5-12';
  if (years < 18) return '13-17';
  if (years < 65) return '18-64';
  return '65+';
}
