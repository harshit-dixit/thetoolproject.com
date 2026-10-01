import { describe, expect, it } from 'vitest';
import { diceBand, effectiveDrop, parseWhole, rollDice, rollRange, scoreRoll, secureRandomInt, sumDistribution, type RollSpec } from './dice-roller';

const spec = (count: number, sides: number, modifier = 0, drop: RollSpec['drop'] = 'none'): RollSpec => ({ count, sides, modifier, drop });
/** A fill function that hands out the given 32-bit values in turn. */
const values = (...list: number[]) => (array: Uint32Array) => { array[0] = list.shift()!; return array; };

describe('secureRandomInt', () => {
  it('maps 32-bit values onto the faces', () => {
    expect(secureRandomInt(6, values(0))).toBe(1);
    expect(secureRandomInt(6, values(5))).toBe(6);
    expect(secureRandomInt(6, values(6))).toBe(1);
    expect(secureRandomInt(20, values(19))).toBe(20);
  });

  it('draws again instead of favouring low faces', () => {
    // 2^32 isn't a multiple of 6: the top 4 values (2^32 − 4 and up) would make faces 1–4 more likely.
    const top = 2 ** 32 - 1;
    expect(secureRandomInt(6, values(top, top - 3, 3))).toBe(4);
    // A power of two divides 2^32 evenly, so nothing is thrown away.
    expect(secureRandomInt(4, values(top))).toBe(4);
  });

  it('stays within 1 to sides with real random numbers', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const value = secureRandomInt(6);
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(6);
      seen.add(value);
    }
    expect(seen.size).toBe(6);
    const big = secureRandomInt(1000);
    expect(Number.isInteger(big) && big >= 1 && big <= 1000).toBe(true);
  });
});

describe('rollDice and scoreRoll', () => {
  it('rolls the requested number of dice and adds the modifier', () => {
    const faces = [4, 3];
    const roll = rollDice(spec(2, 6, 3), () => faces.shift()!);
    expect(roll).toEqual({ values: [4, 3], dropped: -1, kept: 7, total: 10 });
  });

  it('allows a negative total', () => {
    expect(scoreRoll(spec(1, 4, -5), [2]).total).toBe(-3);
  });

  it('drops the lowest die for advantage and ability scores', () => {
    expect(scoreRoll(spec(2, 20, 5, 'lowest'), [17, 4])).toEqual({ values: [17, 4], dropped: 1, kept: 17, total: 22 });
    expect(scoreRoll(spec(4, 6, 0, 'lowest'), [5, 1, 6, 3])).toMatchObject({ dropped: 1, kept: 14 });
  });

  it('drops the highest die for disadvantage', () => {
    expect(scoreRoll(spec(2, 20, 0, 'highest'), [17, 4])).toMatchObject({ dropped: 0, kept: 4, total: 4 });
  });

  it('drops only one of two equal dice', () => {
    expect(scoreRoll(spec(4, 6, 0, 'lowest'), [2, 5, 2, 6])).toMatchObject({ dropped: 0, kept: 13 });
    expect(scoreRoll(spec(2, 20, 0, 'highest'), [9, 9])).toMatchObject({ dropped: 0, kept: 9 });
  });

  it('never drops the only die', () => {
    expect(effectiveDrop({ count: 1, drop: 'lowest' })).toBe('none');
    expect(scoreRoll(spec(1, 20, 0, 'lowest'), [12])).toMatchObject({ dropped: -1, kept: 12 });
  });
});

describe('rollRange', () => {
  it('gives the range and average of plain rolls', () => {
    expect(rollRange(spec(1, 6))).toEqual({ min: 1, max: 6, average: 3.5 });
    expect(rollRange(spec(2, 6, 3))).toEqual({ min: 5, max: 15, average: 10 });
    expect(rollRange(spec(1, 4, -5))).toEqual({ min: -4, max: -1, average: -2.5 });
  });

  it('gives the exact average with a dropped die', () => {
    // 4d6 drop lowest: 15,869 ÷ 1,296 ≈ 12.24.
    const ability = rollRange(spec(4, 6, 0, 'lowest'));
    expect(ability.min).toBe(3);
    expect(ability.max).toBe(18);
    expect(ability.average).toBeCloseTo(15869 / 1296, 10);
    // Advantage averages 13.825 and disadvantage 7.175.
    expect(rollRange(spec(2, 20, 0, 'lowest')).average).toBeCloseTo(13.825, 10);
    expect(rollRange(spec(2, 20, 0, 'highest')).average).toBeCloseTo(7.175, 10);
  });

  it('ignores the drop with one die', () => {
    expect(rollRange(spec(1, 20, 2, 'lowest'))).toEqual({ min: 3, max: 22, average: 12.5 });
  });
});

describe('sumDistribution', () => {
  it('counts the ways to roll each total', () => {
    expect(sumDistribution(1, 6)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(sumDistribution(2, 6)).toEqual([1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1]);
    const three = sumDistribution(3, 6);
    expect(three.length).toBe(16);
    expect(three.reduce((a, b) => a + b, 0)).toBe(216);
    expect(three[10 - 3]).toBe(27);
  });
});

describe('parseWhole', () => {
  it('reads typed whole numbers', () => {
    expect(parseWhole('3', -10, 10)).toBe(3);
    expect(parseWhole(' +3 ', -10, 10)).toBe(3);
    expect(parseWhole('-2', -10, 10)).toBe(-2);
    expect(parseWhole('−2', -10, 10)).toBe(-2);
    expect(parseWhole('１２', 1, 50)).toBe(12);
  });

  it('rejects anything else', () => {
    expect(parseWhole('', 1, 50)).toBeUndefined();
    expect(parseWhole('2.5', 1, 50)).toBeUndefined();
    expect(parseWhole('d6', 1, 50)).toBeUndefined();
    expect(parseWhole('51', 1, 50)).toBeUndefined();
    expect(parseWhole('0', 1, 50)).toBeUndefined();
  });
});

it('diceBand groups counts for analytics', () => {
  expect(diceBand(1)).toBe('1');
  expect(diceBand(9)).toBe('9');
  expect(diceBand(10)).toBe('10+');
});
