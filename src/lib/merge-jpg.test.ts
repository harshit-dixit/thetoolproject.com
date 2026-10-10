import { describe, expect, it } from 'vitest';
import { byName, isImageFile, mergedName, orientationMatrix, planImage, planPdfPage, readImageInfo } from './merge-jpg';

const u16be = (n: number) => [(n >> 8) & 255, n & 255];

/** A JPEG header: SOI, an optional EXIF block with an orientation, then a baseline frame header (or the other way round). */
function jpeg(width: number, height: number, { orientation, little = false, components = 3, frame = 0xc0, exifLast = false }: { orientation?: number; little?: boolean; components?: number; frame?: number; exifLast?: boolean } = {}) {
  const parts: number[] = [0xff, 0xd8];
  // A JFIF block first, as most cameras and editors write.
  parts.push(0xff, 0xe0, ...u16be(16), ...Array.from('JFIF\0', c => c.charCodeAt(0)), 1, 1, 0, 0, 1, 0, 1, 0, 0);
  const sof = [0xff, frame, ...u16be(8 + components * 3), 8, ...u16be(height), ...u16be(width), components, ...Array(components * 3).fill(0)];
  if (exifLast) parts.push(...sof);
  if (orientation) {
    const u16 = (n: number) => little ? [n & 255, (n >> 8) & 255] : u16be(n);
    const u32 = (n: number) => little ? [n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24] : [n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255];
    // TIFF header, then an IFD with a width tag before the orientation tag.
    const tiff = [...(little ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(8), ...u16(2),
      ...u16(0x0100), ...u16(3), ...u32(1), ...u16(width), 0, 0,
      ...u16(0x0112), ...u16(3), ...u32(1), ...u16(orientation), 0, 0,
      ...u32(0)];
    const body = [...Array.from('Exif', c => c.charCodeAt(0)), 0, 0, ...tiff];
    parts.push(0xff, 0xe1, ...u16be(body.length + 2), ...body);
  }
  if (!exifLast) parts.push(...sof);
  parts.push(0xff, 0xda, 0, 2);
  return new Uint8Array(parts);
}

describe('reading image sizes', () => {
  it('reads a JPEG frame header after the JFIF block', () => {
    expect(readImageInfo(jpeg(4032, 3024))).toEqual({ type: 'jpeg', width: 4032, height: 3024, orientation: 1, components: 3 });
    expect(readImageInfo(jpeg(800, 600, { frame: 0xc2 }))).toMatchObject({ width: 800, height: 600 });
  });

  it('swaps the size of a phone photo stored on its side', () => {
    expect(readImageInfo(jpeg(4032, 3024, { orientation: 6 }))).toMatchObject({ width: 3024, height: 4032, orientation: 6 });
    expect(readImageInfo(jpeg(4032, 3024, { orientation: 8, little: true }))).toMatchObject({ width: 3024, height: 4032, orientation: 8 });
    expect(readImageInfo(jpeg(4032, 3024, { orientation: 3, little: true }))).toMatchObject({ width: 4032, height: 3024, orientation: 3 });
    // Some editors write the EXIF block after the frame header.
    expect(readImageInfo(jpeg(200, 100, { orientation: 6, exifLast: true }))).toMatchObject({ width: 100, height: 200, orientation: 6 });
    // An out-of-range value is treated as upright.
    expect(readImageInfo(jpeg(10, 20, { orientation: 9 }))).toMatchObject({ width: 10, height: 20, orientation: 1 });
  });

  it('reports CMYK JPEGs', () => {
    expect(readImageInfo(jpeg(100, 50, { components: 4 }))?.components).toBe(4);
  });

  it('reads PNG and WebP headers', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 5, 0, 0, 0, 2, 208, 8, 6, 0, 0, 0]);
    expect(readImageInfo(png)).toEqual({ type: 'png', width: 1280, height: 720, orientation: 1 });
    const vp8l = [0x2f, ...[(99 & 0xff), ((99 >> 8) & 0x3f) | ((49 & 0x3) << 6), (49 >> 2) & 0xff, (49 >> 10) & 0x0f]];
    const webp = new Uint8Array([...Array.from('RIFF', c => c.charCodeAt(0)), 30, 0, 0, 0, ...Array.from('WEBPVP8L', c => c.charCodeAt(0)), vp8l.length, 0, 0, 0, ...vp8l, 0]);
    expect(readImageInfo(webp)).toEqual({ type: 'webp', width: 100, height: 50, orientation: 1 });
  });

  it('gives up on other files and cut-off headers', () => {
    expect(readImageInfo(new TextEncoder().encode('GIF89a......'))).toBeUndefined();
    expect(readImageInfo(jpeg(100, 100).subarray(0, 24))).toBeUndefined();
    // A frame header but no image data yet: an EXIF block could still follow, so read more.
    const whole = jpeg(100, 100);
    expect(readImageInfo(whole.subarray(0, whole.length - 4))).toBeUndefined();
    // Image data before any frame header.
    expect(readImageInfo(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]))).toBeUndefined();
  });
});

describe('planning the merged image', () => {
  const sizes = [{ width: 1000, height: 500 }, { width: 500, height: 500 }, { width: 800, height: 1200 }];

  it('stacks images at the narrowest width, with gaps between them', () => {
    const plan = planImage(sizes, { layout: 'vertical', columns: 2, fit: 'match', gap: 10 });
    expect(plan).toMatchObject({ width: 500, height: 250 + 500 + 750 + 20, scale: 1 });
    expect(plan.rects).toEqual([{ x: 0, y: 0, width: 500, height: 250 }, { x: 0, y: 260, width: 500, height: 500 }, { x: 0, y: 770, width: 500, height: 750 }]);
  });

  it('keeps original sizes centred in the widest column', () => {
    const plan = planImage(sizes, { layout: 'vertical', columns: 2, fit: 'original', gap: 0 });
    expect(plan).toMatchObject({ width: 1000, height: 2200 });
    expect(plan.rects[1]).toEqual({ x: 250, y: 500, width: 500, height: 500 });
  });

  it('puts images side by side at the lowest height', () => {
    const plan = planImage(sizes, { layout: 'horizontal', columns: 2, fit: 'match', gap: 0 });
    expect(plan).toMatchObject({ width: 1000 + 500 + 333, height: 500 });
    expect(plan.rects.map(rect => rect.x)).toEqual([0, 1000, 1500]);
    // Rounded edges: the widths add up to the full width with no seam.
    expect(plan.rects.reduce((sum, rect) => sum + rect.width, 0)).toBe(plan.width);
    const original = planImage(sizes, { layout: 'horizontal', columns: 2, fit: 'original', gap: 0 });
    expect(original.height).toBe(1200);
    expect(original.rects[0]).toEqual({ x: 0, y: 350, width: 1000, height: 500 });
  });

  it('lays out a grid row by row, each row as tall as its tallest image', () => {
    const plan = planImage(sizes, { layout: 'grid', columns: 2, fit: 'match', gap: 10 });
    expect(plan).toMatchObject({ width: 1010, height: 500 + 10 + 750 });
    expect(plan.rects).toEqual([
      { x: 0, y: 125, width: 500, height: 250 },
      { x: 510, y: 0, width: 500, height: 500 },
      { x: 0, y: 510, width: 500, height: 750 },
    ]);
    // More columns than images: the grid is as wide as the images it has.
    expect(planImage(sizes.slice(0, 2), { layout: 'grid', columns: 4, fit: 'match', gap: 0 }).width).toBe(1000);
  });

  it('scales the whole image down to the canvas limit', () => {
    const tall = Array(20).fill({ width: 3024, height: 4032 });
    const plan = planImage(tall, { layout: 'vertical', columns: 2, fit: 'match', gap: 0 }, { side: 16_384, pixels: 50_000_000 });
    expect(plan.height).toBe(16_384);
    expect(plan.width).toBe(Math.floor(3024 * 16_384 / 80_640));
    expect(plan.scale).toBeCloseTo(16_384 / 80_640);
    const big = planImage([{ width: 8000, height: 8000 }], { layout: 'vertical', columns: 2, fit: 'match', gap: 0 }, { side: 16_384, pixels: 16_000_000 });
    expect(big.width * big.height).toBeLessThanOrEqual(16_000_000);
  });
});

describe('PDF pages', () => {
  it('fits the image inside the margins of the paper, turning the page for wide images', () => {
    const page = planPdfPage({ width: 4000, height: 3000 }, { pageSize: 'a4', orientation: 'auto', margin: 'small' });
    expect(page.pageWidth).toBeCloseTo(841.89);
    expect(page.pageHeight).toBeCloseTo(595.28);
    expect(page.height).toBeCloseTo(595.28 - 72);
    expect(page.x).toBeCloseTo((841.89 - page.width) / 2);
    const portrait = planPdfPage({ width: 4000, height: 3000 }, { pageSize: 'letter', orientation: 'portrait', margin: 'none' });
    expect(portrait).toMatchObject({ pageWidth: 612, pageHeight: 792, width: 612, x: 0 });
    expect(portrait.height).toBeCloseTo(459);
    expect(portrait.y).toBeCloseTo((792 - 459) / 2);
    // Small images are enlarged to fill the page too.
    expect(planPdfPage({ width: 100, height: 100 }, { pageSize: 'letter', orientation: 'auto', margin: 'large' }).width).toBeCloseTo(612 - 144);
  });

  it('makes "same as image" pages at 96 pixels per inch, up to the PDF limit', () => {
    expect(planPdfPage({ width: 1200, height: 800 }, { pageSize: 'fit', orientation: 'auto', margin: 'large' })).toEqual({ pageWidth: 900, pageHeight: 600, x: 0, y: 0, width: 900, height: 600 });
    const long = planPdfPage({ width: 1000, height: 40_000 }, { pageSize: 'fit', orientation: 'auto', margin: 'none' });
    expect(long.pageHeight).toBe(14_400);
    expect(long.pageWidth).toBeCloseTo(360);
  });

  it('turns stored pixels the way the EXIF orientation says', () => {
    const box = { x: 10, y: 20, width: 300, height: 400 };
    // Maps a corner of the stored image (u, v in the unit square) to the page.
    const at = (orientation: number, u: number, v: number) => {
      const [a, b, c, d, e, f] = orientationMatrix(orientation, box);
      return [a * u + c * v + e, b * u + d * v + f];
    };
    // The stored top-left corner (u 0, v 1) lands where each orientation puts it.
    expect(at(1, 0, 1)).toEqual([10, 420]);
    expect(at(3, 0, 1)).toEqual([310, 20]);
    expect(at(6, 0, 1)).toEqual([310, 420]);
    expect(at(8, 0, 1)).toEqual([10, 20]);
    expect(at(2, 0, 1)).toEqual([310, 420]);
    expect(at(5, 0, 1)).toEqual([10, 420]);
    // Every orientation fills the box exactly.
    for (let orientation = 1; orientation <= 8; orientation++) {
      const corners = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([u, v]) => at(orientation, u, v));
      expect(new Set(corners.map(([x, y]) => `${x},${y}`))).toEqual(new Set(['10,20', '310,20', '10,420', '310,420']));
    }
  });
});

describe('names', () => {
  it('sorts numbered photos in order', () => {
    expect(byName([{ name: 'IMG_10.jpg' }, { name: 'img_2.jpg' }, { name: 'IMG_1.jpg' }]).map(file => file.name)).toEqual(['IMG_1.jpg', 'img_2.jpg', 'IMG_10.jpg']);
  });

  it('names the result after the first image', () => {
    expect(mergedName('holiday.JPG', 'image')).toBe('holiday-merged.jpg');
    expect(mergedName('scan 1.jpeg', 'pdf')).toBe('scan 1-merged.pdf');
    expect(mergedName('.jpg', 'pdf')).toBe('images-merged.pdf');
    expect(mergedName('a:b?.jpg', 'image')).toBe('a_b_-merged.jpg');
  });

  it('accepts images by type or extension', () => {
    expect(isImageFile({ name: 'photo.JPEG', type: '' })).toBe(true);
    expect(isImageFile({ name: 'scan', type: 'image/jpeg' })).toBe(true);
    expect(isImageFile({ name: 'notes.txt', type: 'text/plain' })).toBe(false);
  });
});


it('accepts JPEG interchange extensions and optionally names a single PDF', () => {
  for (const extension of ['jfi', 'jif', 'jpe', 'JFIF']) expect(isImageFile({ name: `scan.${extension}`, type: '' })).toBe(true);
  expect(mergedName('scan.jfif', 'pdf', true)).toBe('scan.pdf');
  expect(mergedName('scan.jfif', 'pdf')).toBe('scan-merged.pdf');
});
