import { describe, expect, it } from 'vitest';
import { isWebp, readWebpInfo } from './webp';

const u24 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255];
const u32 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
const chunk = (type: string, body: number[]) => [...type].map(c => c.charCodeAt(0)).concat(u32(body.length), body, body.length & 1 ? [0] : []);
const riff = (...chunks: number[][]) => {
  const body = [...'WEBP'].map(c => c.charCodeAt(0)).concat(...chunks);
  return new Uint8Array([...'RIFF'].map(c => c.charCodeAt(0)).concat(u32(body.length), body));
};
// Just enough of each bitstream header for the parser; the pixels themselves aren't read.
const vp8 = (width: number, height: number) => chunk('VP8 ', [0x50, 0x02, 0x00, 0x9d, 0x01, 0x2a, width & 255, width >> 8, height & 255, height >> 8, 0, 0]);
const vp8l = (width: number, height: number, alpha: boolean) => {
  const bits = ((width - 1) | ((height - 1) << 14) | ((alpha ? 1 : 0) << 28)) >>> 0;
  return chunk('VP8L', [0x2f, ...u32(bits), 0, 0, 0]);
};
const vp8x = (flags: number, width: number, height: number) => chunk('VP8X', [flags, 0, 0, 0, ...u24(width - 1), ...u24(height - 1)]);

describe('readWebpInfo', () => {
  it('reads a lossy image', () => {
    expect(readWebpInfo(riff(vp8(640, 480)))).toEqual({ width: 640, height: 480, kind: 'lossy', alpha: false, animated: false, frames: 1, loopCount: 0 });
  });

  it('reads a lossless image and its alpha flag', () => {
    expect(readWebpInfo(riff(vp8l(1, 16384, true)))).toMatchObject({ width: 1, height: 16384, kind: 'lossless', alpha: true });
    expect(readWebpInfo(riff(vp8l(300, 200, false)))?.alpha).toBe(false);
  });

  it('reads the extended header: canvas size, alpha, animation, frames and loop count', () => {
    const file = riff(vp8x(0x12, 400, 300), chunk('ANIM', [255, 255, 255, 255, 3, 0]), chunk('ANMF', new Array(16).fill(0)), chunk('ANMF', new Array(17).fill(0)));
    expect(readWebpInfo(file)).toEqual({ width: 400, height: 300, kind: 'extended', alpha: true, animated: true, frames: 2, loopCount: 3 });
  });

  it('treats an extended still image as one frame', () => {
    expect(readWebpInfo(riff(vp8x(0x10, 16383, 2), vp8l(16383, 2, true)))).toMatchObject({ width: 16383, height: 2, animated: false, frames: 1, alpha: true });
  });

  it('rejects files that are not WebP or are cut off', () => {
    expect(readWebpInfo(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]))).toBeUndefined();
    expect(isWebp(riff(vp8(1, 1)))).toBe(true);
    expect(readWebpInfo(riff(vp8(1, 1)).subarray(0, 24))).toBeUndefined();
    expect(readWebpInfo(riff(vp8(0, 5)))).toBeUndefined();
  });
});
