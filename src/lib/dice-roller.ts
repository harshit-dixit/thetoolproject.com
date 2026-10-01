// Dice rolls: a number of dice with the same number of sides, an optional modifier and an
// optional dropped die (the lowest for advantage and 4d6 ability scores, the highest for
// disadvantage). Rolls use the browser's cryptographic random numbers with rejection sampling,
// so every face is exactly as likely as every other.

export const DIE_SIDES = [4, 6, 8, 10, 12, 20, 100] as const;
export const MIN_DICE = 1;
export const MAX_DICE = 50;
export const MIN_SIDES = 2;
export const MAX_SIDES = 1000;
export const MAX_MODIFIER = 1000;

export type Drop = 'none' | 'lowest' | 'highest';
export type RollSpec = { count: number; sides: number; modifier: number; drop: Drop };
export type Roll = {
  values: number[];
  /** The index of the dropped die, or -1 when every die counts. */
  dropped: number;
  /** The sum of the dice that count, before the modifier. */
  kept: number;
  total: number;
};
/** Returns a whole number from 1 to `sides`. */
export type RandomDie = (sides: number) => number;

const RANGE = 2 ** 32;

/** A fair whole number from 1 to `sides`, from 32-bit random values. Values from the top of the
 * range that would favour the low faces are thrown away and drawn again. */
export function secureRandomInt(sides: number, fill: (array: Uint32Array<ArrayBuffer>) => Uint32Array = array => crypto.getRandomValues(array)): number {
  const limit = RANGE - (RANGE % sides);
  const buffer = new Uint32Array(1);
  for (;;) {
    const value = fill(buffer)[0];
    if (value < limit) return (value % sides) + 1;
  }
}

/** Dropping a die needs at least two dice; with one die, it always counts. */
export const effectiveDrop = ({ count, drop }: Pick<RollSpec, 'count' | 'drop'>): Drop => (count < 2 ? 'none' : drop);

export function rollDice(spec: RollSpec, random: RandomDie = secureRandomInt): Roll {
  const values = Array.from({ length: spec.count }, () => random(spec.sides));
  return scoreRoll(spec, values);
}

/** Works out which die is dropped and the total for dice already rolled. Ties drop the first one. */
export function scoreRoll(spec: RollSpec, values: number[]): Roll {
  const drop = effectiveDrop(spec);
  let dropped = -1;
  if (drop !== 'none') {
    dropped = 0;
    values.forEach((value, index) => {
      if (drop === 'lowest' ? value < values[dropped] : value > values[dropped]) dropped = index;
    });
  }
  const kept = values.reduce((sum, value, index) => (index === dropped ? sum : sum + value), 0);
  return { values, dropped, kept, total: kept + spec.modifier };
}

/** The lowest and highest possible totals and the exact average. */
export function rollRange(spec: RollSpec): { min: number; max: number; average: number } {
  const { count, sides, modifier } = spec;
  const drop = effectiveDrop(spec);
  const kept = drop === 'none' ? count : count - 1;
  let average = (count * (sides + 1)) / 2;
  // The expected lowest of n dice is the sum over k of P(every die ≥ k); the highest is the
  // sum over k of P(some die ≥ k). The dropped die's expected value comes off the average.
  if (drop !== 'none') {
    let expected = 0;
    for (let k = 1; k <= sides; k++) {
      expected += drop === 'lowest' ? ((sides - k + 1) / sides) ** count : 1 - ((k - 1) / sides) ** count;
    }
    average -= expected;
  }
  return { min: kept + modifier, max: kept * sides + modifier, average: average + modifier };
}

/** The number of ways to roll each total with `count` dice, indexed from the lowest total (`count`). */
export function sumDistribution(count: number, sides: number): number[] {
  let ways = [1];
  for (let die = 0; die < count; die++) {
    const next = new Array<number>(ways.length + sides - 1).fill(0);
    ways.forEach((value, index) => {
      for (let face = 0; face < sides; face++) next[index + face] += value;
    });
    ways = next;
  }
  return ways;
}

/** Reads a whole number typed in a field: full-width digits, a leading + and the minus sign (−) are
 * accepted. Returns undefined for anything else or a value outside min–max. */
export function parseWhole(text: string, min: number, max: number): number | undefined {
  const clean = text.normalize('NFKC').replace(/−/g, '-').replace(/\s+/g, '');
  if (!/^[+-]?\d+$/.test(clean)) return undefined;
  const value = Number(clean);
  return value >= min && value <= max ? value : undefined;
}

/** For analytics: how many dice, as `1`–`9` or `10+`. */
export const diceBand = (count: number) => (count >= 10 ? '10+' : String(count));
