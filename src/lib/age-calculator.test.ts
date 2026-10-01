import { describe, expect, it } from 'vitest';
import { addMonths, ageBand, calculateAge, calendarSpan, dayNumber, parseIsoDate, toIsoDate, weekday, type CivilDate } from './age-calculator';

const d = (iso: string): CivilDate => {
  const date = parseIsoDate(iso);
  if (!date) throw new Error(`Bad test date ${iso}`);
  return date;
};
const age = (birth: string, on: string) => {
  const outcome = calculateAge(d(birth), d(on));
  if (!('result' in outcome)) throw new Error(`Unexpected error: ${outcome.error}`);
  return outcome.result;
};

describe('parseIsoDate', () => {
  it('reads date input values', () => {
    expect(parseIsoDate('1990-03-15')).toEqual({ year: 1990, month: 3, day: 15 });
    expect(parseIsoDate('2024-02-29')).toEqual({ year: 2024, month: 2, day: 29 });
  });

  it('rejects empty, impossible and unfinished dates', () => {
    expect(parseIsoDate('')).toBeUndefined();
    expect(parseIsoDate('2023-02-29')).toBeUndefined();
    expect(parseIsoDate('1900-02-29')).toBeUndefined();
    expect(parseIsoDate('2023-04-31')).toBeUndefined();
    expect(parseIsoDate('2023-13-01')).toBeUndefined();
    // Chrome reports 0199-03-15 while the year 1990 is half typed.
    expect(parseIsoDate('0199-03-15')).toBeUndefined();
    expect(parseIsoDate('15/03/1990')).toBeUndefined();
  });

  it('round-trips with toIsoDate', () => {
    expect(toIsoDate(d('1066-10-14'))).toBe('1066-10-14');
  });
});

describe('date arithmetic', () => {
  it('numbers days like the Unix epoch', () => {
    expect(dayNumber(d('1970-01-01'))).toBe(0);
    expect(dayNumber(d('2000-03-01'))).toBe(Date.UTC(2000, 2, 1) / 86400000);
    expect(dayNumber(d('1600-02-29')) - dayNumber(d('1600-02-28'))).toBe(1);
  });

  it('finds the day of the week', () => {
    expect(weekday(d('1970-01-01'))).toBe(4);
    expect(weekday(d('2026-10-01'))).toBe(4);
    expect(weekday(d('1990-03-15'))).toBe(4);
    expect(weekday(d('2000-01-01'))).toBe(6);
    expect(weekday(d('1066-10-14'))).toBe(new Date(dayNumber(d('1066-10-14')) * 86400000).getUTCDay());
  });

  it('adds months and keeps to the end of shorter months', () => {
    expect(addMonths(d('2025-01-31'), 1)).toEqual(d('2025-02-28'));
    expect(addMonths(d('2024-01-31'), 1)).toEqual(d('2024-02-29'));
    expect(addMonths(d('2024-02-29'), 12)).toEqual(d('2025-02-28'));
    expect(addMonths(d('2025-11-15'), 3)).toEqual(d('2026-02-15'));
  });

  it('counts whole months, then the days left', () => {
    expect(calendarSpan(d('2025-01-31'), d('2025-03-01'))).toMatchObject({ months: 1, days: 1 });
    expect(calendarSpan(d('2025-01-15'), d('2025-03-14'))).toMatchObject({ months: 1, days: 27 });
    expect(calendarSpan(d('2025-03-14'), d('2025-03-14'))).toMatchObject({ years: 0, months: 0, days: 0, totalMonths: 0 });
  });
});

describe('calculateAge', () => {
  it('gives years, months and days', () => {
    expect(age('1990-03-15', '2026-10-01')).toMatchObject({ years: 36, months: 6, days: 16, totalMonths: 438 });
  });

  it('gives totals in days, weeks and months', () => {
    const result = age('1990-03-15', '2026-10-01');
    expect(result.totalDays).toBe((Date.UTC(2026, 9, 1) - Date.UTC(1990, 2, 15)) / 86400000);
    expect(result.totalDays).toBe(13349);
    expect(result.weeks).toBe(1907);
    expect(result.weekDays).toBe(0);
  });

  it('turns a year older on the birthday, not the day after', () => {
    expect(age('2000-10-01', '2026-09-30')).toMatchObject({ years: 25, months: 11, days: 29 });
    expect(age('2000-10-01', '2026-10-01')).toMatchObject({ years: 26, months: 0, days: 0 });
  });

  it('counts a baby in months and days', () => {
    expect(age('2026-06-20', '2026-10-01')).toMatchObject({ years: 0, months: 3, days: 11, totalDays: 103, weeks: 14, weekDays: 5 });
  });

  it('gives zero on the day of birth', () => {
    const result = age('2026-10-01', '2026-10-01');
    expect(result).toMatchObject({ years: 0, months: 0, days: 0, totalDays: 0, nextAge: 1 });
    expect(result.nextBirthday).toEqual(d('2027-10-01'));
  });

  it('counts down to the next birthday', () => {
    const result = age('1990-03-15', '2026-10-01');
    expect(result.nextAge).toBe(37);
    expect(result.nextBirthday).toEqual(d('2027-03-15'));
    expect(result.untilNext).toEqual({ years: 0, months: 5, days: 14 });
    expect(result.daysUntilNext).toBe(165);
  });

  it('shows a birthday today as the next birthday', () => {
    const result = age('1990-10-01', '2026-10-01');
    expect(result).toMatchObject({ years: 36, nextAge: 36, daysUntilNext: 0 });
    expect(result.nextBirthday).toEqual(d('2026-10-01'));
  });

  it('gives a February 29 birthday on February 28 in other years', () => {
    expect(age('2000-02-29', '2025-02-27')).toMatchObject({ years: 24, months: 11, days: 29 });
    expect(age('2000-02-29', '2025-02-28')).toMatchObject({ years: 25, months: 0, days: 0 });
    expect(age('2000-02-29', '2025-03-01')).toMatchObject({ years: 25, months: 0, days: 1 });
    expect(age('2000-02-29', '2028-02-29')).toMatchObject({ years: 28, months: 0, days: 0 });
    expect(age('2000-02-29', '2026-10-01').nextBirthday).toEqual(d('2027-02-28'));
    expect(age('2000-02-29', '2027-10-01').nextBirthday).toEqual(d('2028-02-29'));
  });

  it('refuses a date of birth after the age-on date', () => {
    expect(calculateAge(d('2026-10-02'), d('2026-10-01'))).toEqual({ error: 'birthAfter' });
  });

  it('never goes negative or skips a day across a whole year', () => {
    const birth = d('1999-01-31');
    let previous = -1;
    for (let n = dayNumber(d('2023-12-25')); n < dayNumber(d('2025-01-10')); n++) {
      const current = calculateAge(birth, fromDay(n));
      if (!('result' in current)) throw new Error('unexpected');
      const { years, months, days, totalDays } = current.result;
      expect(days).toBeGreaterThanOrEqual(0);
      expect(months).toBeLessThan(12);
      expect(totalDays).toBe(previous === -1 ? totalDays : previous + 1);
      // Adding the span back to the birth date lands on the age-on date.
      expect(dayNumber(addMonths(birth, years * 12 + months)) + days).toBe(n);
      previous = totalDays;
    }
  });
});

describe('ageBand', () => {
  it('buckets ages coarsely', () => {
    expect([0, 1, 4, 5, 12, 13, 17, 18, 64, 65, 101].map(ageBand)).toEqual(['under-1', '1-4', '1-4', '5-12', '5-12', '13-17', '13-17', '18-64', '18-64', '65+', '65+']);
  });
});

function fromDay(n: number): CivilDate {
  const date = new Date(n * 86400000);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}
