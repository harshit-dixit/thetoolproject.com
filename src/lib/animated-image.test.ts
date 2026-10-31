import { describe, expect, it } from 'vitest';
import { GIFEncoder } from 'gifenc';
import { gifFrames, isAnimated } from './animated-image';

const palette = [[255, 0, 0], [0, 0, 255]];
function gif(frames: number) {
  const encoder = GIFEncoder();
  for (let i = 0; i < frames; i++) encoder.writeFrame(new Uint8Array(16).fill(i % 2), 4, 4, { palette, delay: 100 });
  encoder.finish();
  return encoder.bytes();
}

const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const pngChunk = (type: string, body: number[]) => [...be32(body.length), ...[...type].map(c => c.charCodeAt(0)), ...body, 0, 0, 0, 0];
const png = (...chunks: number[][]) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunks.flat()]);
const ihdr = pngChunk('IHDR', [...be32(4), ...be32(4), 8, 6, 0, 0, 0]);

describe('isAnimated', () => {
  it('counts GIF frames', () => {
    expect(gifFrames(gif(1))).toBe(1);
    expect(gifFrames(gif(3))).toBe(2);
    expect(isAnimated(gif(1))).toBe(false);
    expect(isAnimated(gif(2))).toBe(true);
  });

  it('finds an APNG by its acTL chunk', () => {
    expect(isAnimated(png(ihdr, pngChunk('IDAT', [0])))).toBe(false);
    expect(isAnimated(png(ihdr, pngChunk('acTL', [...be32(2), ...be32(0)]), pngChunk('IDAT', [0])))).toBe(true);
    // An APNG of one frame is a still image.
    expect(isAnimated(png(ihdr, pngChunk('acTL', [...be32(1), ...be32(0)]), pngChunk('IDAT', [0])))).toBe(false);
    // acTL after the image data isn't APNG.
    expect(isAnimated(png(ihdr, pngChunk('IDAT', [0]), pngChunk('acTL', [...be32(2), ...be32(0)])))).toBe(false);
  });

  it('reads the animation flag of an extended WebP', () => {
    const webp = (flags: number) => new Uint8Array([...'RIFF'].map(c => c.charCodeAt(0)).concat([30, 0, 0, 0], [...'WEBPVP8X'].map(c => c.charCodeAt(0)), [10, 0, 0, 0, flags, 0, 0, 0, 3, 0, 0, 3, 0, 0]));
    expect(isAnimated(webp(0x02))).toBe(true);
    expect(isAnimated(webp(0x10))).toBe(false);
  });

  it('ignores other files', () => {
    expect(isAnimated(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(false);
    expect(isAnimated(new Uint8Array())).toBe(false);
  });
});
