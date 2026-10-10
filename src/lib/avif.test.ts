import { describe, expect, it } from 'vitest';
import { isAvif, readAvifInfo, TINY_AVIF_BASE64 } from './avif';
const u32 = (n: number) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const box = (type: string, body: number[]) => [...u32(body.length + 8), ...Buffer.from(type), ...body];
const ftyp = (major = 'avif', compatible = 'mif1') => box('ftyp', [...Buffer.from(major), 0, 0, 0, 0, ...Buffer.from(compatible)]);
const ispe = (w: number, h: number) => box('ispe', [0, 0, 0, 0, ...u32(w), ...u32(h)]);
describe('AVIF headers', () => {
  it('recognizes major and compatible brands, rejecting other or short files', () => {
    for (const brand of ['avif', 'avis']) {
      expect(isAvif(Uint8Array.from(ftyp(brand)))).toBe(true);
      expect(isAvif(Uint8Array.from(ftyp('mif1', brand)))).toBe(true);
    }
    expect(isAvif(Uint8Array.from(ftyp('heic')))).toBe(false);
    expect(isAvif(new Uint8Array(10))).toBe(false);
    expect(isAvif(Uint8Array.from(ftyp()).slice(0, 17))).toBe(false);
  });
  it('takes the largest property and tolerates missing dimensions', () => {
    const bytes = Uint8Array.from([...ftyp(), ...box('iprp', [...ispe(8, 8), ...ispe(64, 48), ...ispe(1, 1)])]);
    expect(readAvifInfo(bytes)).toEqual({ width: 64, height: 48, animated: false });
    expect(readAvifInfo(Uint8Array.from(ftyp()))).toEqual({ width: undefined, height: undefined, animated: false });
    expect(readAvifInfo(new Uint8Array(8))).toBeUndefined();
  });
  it('marks sequences by major brand, or compatible avis plus moov', () => {
    expect(readAvifInfo(Uint8Array.from(ftyp('avis')))?.animated).toBe(true);
    expect(readAvifInfo(Uint8Array.from(ftyp('avif', 'avis')))?.animated).toBe(false);
    expect(readAvifInfo(Uint8Array.from([...ftyp('avif', 'avis'), ...box('moov', [])]))?.animated).toBe(true);
  });
  it('reads the actual 1 × 1 probe header', () => {
    const bytes = new Uint8Array(Buffer.from(TINY_AVIF_BASE64, 'base64'));
    expect(isAvif(bytes)).toBe(true);
    expect(readAvifInfo(bytes)).toEqual({ width: 1, height: 1, animated: false });
  });
});
