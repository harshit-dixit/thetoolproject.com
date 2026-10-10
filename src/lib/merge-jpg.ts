// Merge JPG settings, limits and layout maths, shared by the page and the worker. Kept free of libraries so the
// page's first load stays small; pdf-lib is loaded by the worker only when a PDF is made.
import { readWebpInfo } from './webp';

export type MergeOutput = 'image' | 'pdf';
export type Layout = 'vertical' | 'horizontal' | 'grid';
export type Fit = 'match' | 'original';
export type Background = 'white' | 'black';
export type PageSize = 'fit' | 'a4' | 'letter';
export type Orientation = 'auto' | 'portrait' | 'landscape';
export type Margin = 'none' | 'small' | 'large';

export type ImageOptions = { layout: Layout; columns: number; fit: Fit; gap: number; background: Background; quality: number };
export type PdfOptions = { pageSize: PageSize; orientation: Orientation; margin: Margin };
export type Size = { width: number; height: number };
export type Rect = { x: number; y: number; width: number; height: number };

export const LAYOUTS: Layout[] = ['vertical', 'horizontal', 'grid'];
export const COLUMNS = [2, 3, 4];
/** Space between images, in pixels of the merged image. */
export const GAPS = [0, 10, 30];
export const QUALITIES = [0.95, 0.9, 0.75];
export const PAGE_SIZES: PageSize[] = ['fit', 'a4', 'letter'];
export const ORIENTATIONS: Orientation[] = ['auto', 'portrait', 'landscape'];
export const MARGINS: Margin[] = ['none', 'small', 'large'];

export const LIMITS = {
  files: 100,
  fileBytes: 50 * 1024 * 1024,
  // A PDF holds every image in memory until it's saved.
  totalBytes: 300 * 1024 * 1024,
  pixels: 50_000_000,
};

/**
 * Canvas sizes to try for the merged image, largest first. Browsers cap canvases (iOS Safari at about 16.7 megapixels),
 * and a canvas that's too big fails to draw or save, so a failed attempt is retried at the next size.
 */
export const CANVAS_LIMITS = [
  { side: 16_384, pixels: 50_000_000 },
  { side: 8_192, pixels: 16_000_000 },
];

// PDF points: 72 to the inch.
const PAPER: Record<Exclude<PageSize, 'fit'>, Size> = { a4: { width: 595.28, height: 841.89 }, letter: { width: 612, height: 792 } };
/** Half an inch (12.7 mm) and an inch (25.4 mm). */
const MARGIN_POINTS: Record<Margin, number> = { none: 0, small: 36, large: 72 };
/** "Same as image" pages are the image's size at 96 pixels per inch, the size a browser shows it at 100%. */
const POINTS_PER_PIXEL = 72 / 96;
/** PDF readers stop at 200 inches a side (PDF 1.7, Annex C). */
const MAX_PAGE_POINTS = 14_400;

export type ImageInfo = {
  type: 'jpeg' | 'png' | 'webp';
  /** The size the image is shown at, after its EXIF orientation. */
  width: number;
  height: number;
  /** EXIF orientation, 1–8. 1 means the pixels are stored the way they're shown. */
  orientation: number;
  /** JPEG colour components: 1 grey, 3 colour, 4 CMYK. */
  components?: number;
};

const u16be = (bytes: Uint8Array, at: number) => (bytes[at] << 8) | bytes[at + 1];
const u32be = (bytes: Uint8Array, at: number) => ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;

/** The orientation tag (0x0112) in the first IFD of an EXIF block that starts at `start` (the TIFF header). */
export function exifOrientation(bytes: Uint8Array, start: number, end = bytes.length) {
  if (start + 8 > end) return 1;
  const little = bytes[start] === 0x49 && bytes[start + 1] === 0x49;
  if (!little && !(bytes[start] === 0x4d && bytes[start + 1] === 0x4d)) return 1;
  const u16 = (at: number) => little ? bytes[at] | (bytes[at + 1] << 8) : u16be(bytes, at);
  const u32 = (at: number) => little ? (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0 : u32be(bytes, at);
  if (u16(start + 2) !== 42) return 1;
  const ifd = start + u32(start + 4);
  if (ifd + 2 > end) return 1;
  const count = u16(ifd);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > end) break;
    if (u16(entry) !== 0x0112) continue;
    const value = u16(entry + 8);
    return value >= 1 && value <= 8 ? value : 1;
  }
  return 1;
}

/** Start-of-frame markers carry the size; C4 (Huffman tables), C8 (reserved) and CC (arithmetic tables) don't. */
const isFrameMarker = (marker: number) => marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

function readJpeg(bytes: Uint8Array): ImageInfo | undefined {
  let orientation: number | undefined;
  let frame: { width: number; height: number; components: number } | undefined;
  for (let at = 2; at + 4 <= bytes.length;) {
    if (bytes[at] !== 0xff) return undefined;
    const marker = bytes[at + 1];
    // Fill bytes, and markers that stand alone without a length.
    if (marker === 0xff) { at++; continue; }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) { at += 2; continue; }
    // The image data starts: the EXIF block, if any, came before it, though not always before the frame header.
    if (marker === 0xda || marker === 0xd9) {
      if (!frame) return undefined;
      const shown = orientation ?? 1;
      const turned = shown >= 5;
      return { type: 'jpeg', width: turned ? frame.height : frame.width, height: turned ? frame.width : frame.height, orientation: shown, components: frame.components };
    }
    const length = u16be(bytes, at + 2);
    if (length < 2) return undefined;
    const body = at + 4;
    // The first EXIF block counts; a later one is usually an embedded thumbnail's.
    if (orientation === undefined && marker === 0xe1 && body + 6 <= bytes.length && String.fromCharCode(...bytes.subarray(body, body + 4)) === 'Exif' && bytes[body + 4] === 0 && bytes[body + 5] === 0) {
      orientation = exifOrientation(bytes, body + 6, Math.min(bytes.length, at + 2 + length));
    }
    if (isFrameMarker(marker) && !frame) {
      if (body + 6 > bytes.length) return undefined;
      const height = u16be(bytes, body + 1);
      const width = u16be(bytes, body + 3);
      if (!width || !height) return undefined;
      frame = { width, height, components: bytes[body + 5] };
    }
    at += 2 + length;
  }
  // Cut off before the image data: an EXIF block may still follow.
  return undefined;
}

/**
 * Reads the size of a JPEG, PNG or WebP image from its header, without decoding any pixels.
 * Returns undefined for other files, or when the header is cut off (read more of the file, or let the browser decode it).
 * A header says nothing about whether the image data after it is whole; decode the image to find out.
 */
export function readImageInfo(bytes: Uint8Array): ImageInfo | undefined {
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return readJpeg(bytes);
  if (bytes.length >= 24 && u32be(bytes, 0) === 0x89504e47 && u32be(bytes, 4) === 0x0d0a1a0a && u32be(bytes, 12) === 0x49484452) {
    const width = u32be(bytes, 16);
    const height = u32be(bytes, 20);
    return width && height ? { type: 'png', width, height, orientation: 1 } : undefined;
  }
  const webp = readWebpInfo(bytes);
  return webp ? { type: 'webp', width: webp.width, height: webp.height, orientation: 1 } : undefined;
}

export type ImagePlan = Size & {
  rects: Rect[];
  /** Below 1 when the merged image was made smaller to fit the canvas limit. */
  scale: number;
};

/**
 * Where each image goes in the merged image.
 * - vertical: one above the other. "match" scales every image to the narrowest width, so nothing is enlarged.
 * - horizontal: side by side. "match" scales every image to the lowest height.
 * - grid: rows of `columns` images. Every column is as wide as the narrowest image ("match") or the widest ("original"),
 *   and each row is as tall as its tallest image.
 * With "original", images keep their size and are centred in their row or column.
 */
export function planImage(sizes: Size[], options: Pick<ImageOptions, 'layout' | 'columns' | 'fit' | 'gap'>, limit = CANVAS_LIMITS[0]): ImagePlan {
  if (!sizes.length) throw new Error('No images');
  const { layout, fit, gap } = options;
  const widths = sizes.map(size => size.width);
  const heights = sizes.map(size => size.height);
  const rects: Rect[] = [];
  let width = 0;
  let height = 0;
  if (layout === 'horizontal') {
    const rowHeight = fit === 'match' ? Math.min(...heights) : Math.max(...heights);
    let x = 0;
    for (const size of sizes) {
      const scaled = fit === 'match' ? { width: size.width * rowHeight / size.height, height: rowHeight } : size;
      rects.push({ x, y: (rowHeight - scaled.height) / 2, ...scaled });
      x += scaled.width + gap;
    }
    width = x - gap;
    height = rowHeight;
  } else {
    const columns = layout === 'vertical' ? 1 : Math.max(1, Math.min(options.columns, sizes.length));
    const cell = fit === 'match' ? Math.min(...widths) : Math.max(...widths);
    let y = 0;
    for (let row = 0; row * columns < sizes.length; row++) {
      const items = sizes.slice(row * columns, row * columns + columns).map(size => fit === 'match' ? { width: cell, height: size.height * cell / size.width } : size);
      const rowHeight = Math.max(...items.map(item => item.height));
      items.forEach((item, column) => rects.push({ x: column * (cell + gap) + (cell - item.width) / 2, y: y + (rowHeight - item.height) / 2, ...item }));
      y += rowHeight + gap;
    }
    width = columns * cell + (columns - 1) * gap;
    height = y - gap;
  }
  const scale = Math.min(1, limit.side / width, limit.side / height, Math.sqrt(limit.pixels / (width * height)));
  // Edges are rounded rather than sizes, so neighbouring images meet without a 1 px seam or overlap.
  const snap = (value: number) => Math.round(value * scale);
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
    scale,
    rects: rects.map(rect => {
      const x = snap(rect.x);
      const y = snap(rect.y);
      return { x, y, width: Math.max(1, snap(rect.x + rect.width) - x), height: Math.max(1, snap(rect.y + rect.height) - y) };
    }),
  };
}

export type PdfPagePlan = Rect & { pageWidth: number; pageHeight: number };

/** A PDF page for one image, in points: its size, and the box the image fills, centred inside the margins. */
export function planPdfPage(image: Size, options: PdfOptions): PdfPagePlan {
  if (options.pageSize === 'fit') {
    const scale = Math.min(POINTS_PER_PIXEL, MAX_PAGE_POINTS / image.width, MAX_PAGE_POINTS / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    return { pageWidth: width, pageHeight: height, x: 0, y: 0, width, height };
  }
  const paper = PAPER[options.pageSize];
  const landscape = options.orientation === 'landscape' || (options.orientation === 'auto' && image.width > image.height);
  const pageWidth = landscape ? paper.height : paper.width;
  const pageHeight = landscape ? paper.width : paper.height;
  const margin = MARGIN_POINTS[options.margin];
  const scale = Math.min((pageWidth - 2 * margin) / image.width, (pageHeight - 2 * margin) / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  return { pageWidth, pageHeight, x: (pageWidth - width) / 2, y: (pageHeight - height) / 2, width, height };
}

/**
 * The PDF transformation matrix [a b c d e f] that draws a JPEG's stored pixels into `box` the way its EXIF
 * orientation says to show them. PDF draws an image into the unit square, with (0, 0) at the stored image's
 * bottom-left corner, so each orientation is a rotation or flip of that square into the box.
 */
export function orientationMatrix(orientation: number, box: Rect): [number, number, number, number, number, number] {
  const { x, y, width: w, height: h } = box;
  switch (orientation) {
    case 2: return [-w, 0, 0, h, x + w, y];
    case 3: return [-w, 0, 0, -h, x + w, y + h];
    case 4: return [w, 0, 0, -h, x, y + h];
    case 5: return [0, -h, -w, 0, x + w, y + h];
    case 6: return [0, -h, w, 0, x, y + h];
    case 7: return [0, h, w, 0, x, y];
    case 8: return [0, h, -w, 0, x + w, y];
    default: return [w, 0, 0, h, x, y];
  }
}

/** Sorts file names the way people number them: IMG_2 before IMG_10. */
export function byName<T extends { name: string }>(items: T[]) {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  return [...items].sort((a, b) => collator.compare(a.name, b.name));
}

/** "holiday.jpg" → "holiday-merged.jpg" or "holiday-merged.pdf", named after the first image. */
export function mergedName(firstName: string, output: MergeOutput, single = false) {
  const base = firstName.replace(/\.[^.]*$/, '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim() || 'images';
  return `${base}${single ? '' : '-merged'}.${output === 'pdf' ? 'pdf' : 'jpg'}`;
}

/** Files the tool tries to read: images by type or extension. Anything else is left out and counted. */
export function isImageFile(file: { name: string; type: string }) {
  return /^image\//.test(file.type) || /\.(jpe?g|jfif|jfi|jif|jpe|pjpeg|pjp|png|webp)$/i.test(file.name);
}
