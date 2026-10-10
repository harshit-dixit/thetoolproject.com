import { describe, expect, it } from 'vitest';
import { sourceAccept, isSourceFile, isSourceEntry, gifDelay, gifRepeat, isWebpEntry, outputPath, traceSize, uniquePaths } from './webp-convert';
import { createGifWriter, embedSvg, traceSvg } from './webp-encode';

/** A test image: a red square on a transparent background, with a blue bar along the bottom. */
function sample(width = 40, height = 40) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    if (y >= height - 8) data.set([0, 0, 255, 255], i);
    else if (x >= 10 && x < 30 && y >= 5 && y < 25) data.set([255, 0, 0, 255], i);
  }
  return { width, height, data };
}

describe('output names', () => {
  it('swaps the extension and keeps folders from a ZIP', () => {
    expect(outputPath('holiday/beach.webp', 'png')).toBe('holiday/beach.png');
    expect(outputPath('logo.WEBP', 'svg')).toBe('logo.svg');
    expect(outputPath('no-extension', 'jpg')).toBe('no-extension.jpg');
    expect(outputPath('../../etc/x:y?.webp', 'gif')).toBe('etc/x_y_.gif');
    expect(outputPath('.webp', 'png')).toBe('image.png');
  });

  it('numbers names that would overwrite each other, ignoring case', () => {
    expect(uniquePaths(['a.png', 'A.png', 'a.png', 'b/a.png', 'a-2.png'])).toEqual(['a.png', 'A-2.png', 'a-3.png', 'b/a.png', 'a-2-2.png']);
  });

  it('picks WebP files out of a ZIP listing, not macOS metadata', () => {
    expect(isWebpEntry('photos/cat.webp')).toBe(true);
    expect(isWebpEntry('__MACOSX/photos/._cat.webp')).toBe(false);
    expect(isWebpEntry('photos/._cat.webp')).toBe(false);
    expect(isWebpEntry('notes.txt')).toBe(false);
  });
});

describe('sizes and timing', () => {
  it('traces large images at about a megapixel, keeping the shape', () => {
    expect(traceSize(800, 600)).toEqual({ width: 800, height: 600 });
    const scaled = traceSize(4000, 3000);
    expect(scaled.width / scaled.height).toBeCloseTo(4 / 3, 2);
    expect(scaled.width * scaled.height).toBeLessThanOrEqual(1_000_000);
  });

  it('maps WebP loop counts and frame durations to GIF', () => {
    expect([gifRepeat(0), gifRepeat(1), gifRepeat(3)]).toEqual([0, -1, 2]);
    expect([gifDelay(0), gifDelay(16), gifDelay(33), gifDelay(100)]).toEqual([20, 20, 30, 100]);
  });
});

describe('GIF', () => {
  it('writes a looping animation with transparency', () => {
    const writer = createGifWriter(0);
    writer.addFrame(sample(), 100);
    writer.addFrame(sample(), 250);
    const { bytes, partialAlpha } = writer.finish();
    const ascii = new TextDecoder('latin1').decode(bytes);
    expect(ascii.slice(0, 6)).toBe('GIF89a');
    expect(ascii).toContain('NETSCAPE2.0');
    expect(bytes[6] | (bytes[7] << 8)).toBe(40);
    // Two graphic control extensions (0x21 0xF9), each clearing the frame (disposal 2) with a transparent color.
    const controls = [...bytes.keys()].filter(i => bytes[i] === 0x21 && bytes[i + 1] === 0xf9 && bytes[i + 2] === 4);
    expect(controls).toHaveLength(2);
    for (const at of controls) expect(bytes[at + 3]).toBe((2 << 2) | 1);
    expect(bytes[controls[1] + 4]).toBe(25);
    expect(bytes.at(-1)).toBe(0x3b);
    expect(partialAlpha).toBe(false);
  });

  it('writes a still image without the loop block and notes soft edges', () => {
    const image = sample();
    image.data[3] = 128;
    const writer = createGifWriter(-1);
    writer.addFrame(image, 0);
    const { bytes, partialAlpha } = writer.finish();
    expect(new TextDecoder('latin1').decode(bytes)).not.toContain('NETSCAPE2.0');
    expect(partialAlpha).toBe(true);
  });
});

describe('SVG', () => {
  it('traces pixels into filled paths and leaves transparent areas out', () => {
    const svg = traceSvg(sample(), 8, 400, 400);
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="400" height="400" viewBox="0 0 40 40">/);
    expect(svg).toContain('fill="rgb(255,0,0)"');
    expect(svg).toContain('fill="rgb(0,0,255)"');
    expect(svg).not.toContain('opacity="0"');
    expect(svg.endsWith('</svg>')).toBe(true);
  });

  it('embeds a PNG as a data URI at the image size', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    expect(embedSvg(png, 12, 34)).toBe('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="12" height="34" viewBox="0 0 12 34"><image width="12" height="34" xlink:href="data:image/png;base64,iVBORw=="/></svg>');
  });
});


describe('source formats', () => {
  it('names WebP output and the chosen JPEG extension', () => {
    expect(outputPath('pic.avif', 'webp')).toBe('pic.webp');
    expect(outputPath('photo.jfif', 'jpg', 'jpeg')).toBe('photo.jpeg');
  });
  it('accepts each source by MIME or extension and excludes hidden ZIP entries', () => {
    for (const source of ['webp', 'avif', 'jfif'] as const) {
      expect(isSourceFile(source, { name: `x.${source.toUpperCase()}`, type: '' })).toBe(true);
      expect(isSourceEntry(source, `folder/x.${source}`)).toBe(true);
      expect(isSourceEntry(source, `__MACOSX/._x.${source}`)).toBe(false);
      expect(isSourceEntry(source, `folder/.x.${source}`)).toBe(false);
      expect(isSourceEntry(source, 'notes.txt')).toBe(false);
    }
    for (const extension of ['jif', 'jfi', 'jpe', 'jpeg', 'jpg']) expect(isSourceFile('jfif', { name: `x.${extension}`, type: '' })).toBe(true);
    expect(isSourceFile('avif', { name: 'x', type: 'image/avif' })).toBe(true);
    expect(isSourceFile('jfif', { name: 'x', type: 'image/pjpeg' })).toBe(true);
    expect(isSourceFile('webp', { name: 'x', type: 'image/webp' })).toBe(true);
    expect(isSourceFile('avif', { name: 'x.png', type: 'image/png' })).toBe(false);
    expect(sourceAccept('webp')).toBe('.webp,image/webp,.zip,application/zip');
    expect(sourceAccept('avif')).toBe('.avif,image/avif,.zip,application/zip');
    expect(sourceAccept('jfif')).toBe('.jfif,.jfi,.jif,.jpe,.jpg,.jpeg,image/jpeg,image/pjpeg,.zip,application/zip');
  });
});
