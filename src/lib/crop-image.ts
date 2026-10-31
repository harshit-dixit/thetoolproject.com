// Crop image settings, limits and crop-box maths, shared by the page and the worker. All rectangles are in pixels of
// the image as it's shown, after its EXIF orientation, which is also how the browser decodes it for the export.

export type Size = { width: number; height: number };
export type Rect = { x: number; y: number; width: number; height: number };
export type CropFormat = 'jpg' | 'png' | 'webp';
export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
/** Width to height, e.g. 4 / 5. Undefined is a free crop. */
export type Ratio = number | undefined;

/** Ratio chips: free, the image's own ratio, then width:height pairs. */
export const RATIOS = ['free', 'original', '1:1', '4:5', '3:2', '4:3', '16:9', '9:16'] as const;
export type RatioChoice = (typeof RATIOS)[number];
export const FORMATS: CropFormat[] = ['jpg', 'png', 'webp'];
export const QUALITIES = [0.95, 0.9, 0.75];

export type CropShape = 'rect' | 'circle';
/** Circle: what fills the square's corners outside the circle. JPG can't be transparent, so it gets white. */
export type Background = 'transparent' | 'white' | 'black';
export type Border = 'none' | 'thin' | 'thick';
export type BorderColor = 'white' | 'black';
/** PNG first: a circle needs transparent corners, which only PNG and WebP keep. */
export const CIRCLE_FORMATS: CropFormat[] = ['png', 'webp', 'jpg'];
/** Output widths in pixels, for profile pictures; "original" keeps the crop's own size. Never enlarged. */
export const CIRCLE_SIZES = ['original', 1080, 512, 400] as const;
export type CircleSize = (typeof CIRCLE_SIZES)[number];
export const BACKGROUNDS: Background[] = ['transparent', 'white', 'black'];
export const BORDERS: Border[] = ['none', 'thin', 'thick'];
export const BORDER_COLORS: BorderColor[] = ['white', 'black'];
/** Ring width as a share of the circle's diameter, so it looks the same at every output size. */
export const BORDER_WIDTH: Record<Border, number> = { none: 0, thin: 0.02, thick: 0.05 };
export const COLORS: Record<Exclude<Background, 'transparent'>, string> = { white: '#ffffff', black: '#000000' };

export type CircleOptions = { size: CircleSize; background: Background; border: Border; borderColor: BorderColor };

/** The circle's saved size: the chosen width, but never larger than the crop, so nothing is enlarged. */
export function circleSize(rect: Rect, size: CircleSize) {
  return size === 'original' ? rect.width : Math.min(size, rect.width);
}
export const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
export const MIME: Record<CropFormat, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

export const LIMITS = {
  fileBytes: 50 * 1024 * 1024,
  pixels: 50_000_000,
};

/**
 * Canvas sizes to try for the cropped image, largest first. Browsers cap canvases (iOS Safari at about 16.7 megapixels),
 * and a canvas that's too big fails to draw or save, so a failed attempt is retried smaller, as in Merge JPG.
 */
export const CANVAS_LIMITS = [
  { side: 16_384, pixels: 50_000_000 },
  { side: 8_192, pixels: 16_000_000 },
];

/** "4:5" → 0.8; "original" → the image's own ratio; "free" → undefined. `swapped` turns 4:5 into 5:4. */
export function ratioValue(choice: RatioChoice, image: Size, swapped = false): Ratio {
  if (choice === 'free') return undefined;
  if (choice === 'original') return image.width / image.height;
  const [w, h] = choice.split(':').map(Number);
  return swapped ? h / w : w / h;
}

/** The ratio a chip shows once swapped: "4:5" becomes "5:4". Free, original and 1:1 don't turn. */
export function ratioLabel(choice: RatioChoice, swapped: boolean) {
  if (!swapped || !choice.includes(':')) return choice;
  return choice.split(':').reverse().join(':');
}

/** Only ratios whose turned form has no chip of its own turn: 4:5 does, but 16:9 doesn't, as 9:16 is a chip. */
export const canSwap = (choice: RatioChoice) => choice.includes(':') && !(RATIOS as readonly string[]).includes(ratioLabel(choice, true));

/** Fits `width` × `height` to the ratio inside a box, rounding to whole pixels and never below 1 × 1. */
function sizeForRatio(maxWidth: number, maxHeight: number, ratio: number): Size {
  let width = maxWidth;
  let height = width / ratio;
  if (height > maxHeight) { height = maxHeight; width = height * ratio; }
  width = Math.max(1, Math.min(maxWidth, Math.round(width)));
  height = Math.max(1, Math.min(maxHeight, Math.round(height)));
  return { width, height };
}

/**
 * Where the crop box starts: free crops cover the middle 80% of the image, so the box and its handles are easy to
 * see and grab; a ratio gets the largest box of that shape, centred.
 */
export function initialCrop(image: Size, ratio: Ratio): Rect {
  const size = ratio === undefined
    ? { width: Math.max(1, Math.round(image.width * 0.8)), height: Math.max(1, Math.round(image.height * 0.8)) }
    : sizeForRatio(image.width, image.height, ratio);
  return { x: Math.round((image.width - size.width) / 2), y: Math.round((image.height - size.height) / 2), ...size };
}

/** Whole pixels, at least 1 × 1, inside the image. */
export function clampRect(rect: Rect, image: Size): Rect {
  const width = Math.max(1, Math.min(image.width, Math.round(rect.width)));
  const height = Math.max(1, Math.min(image.height, Math.round(rect.height)));
  const x = Math.max(0, Math.min(image.width - width, Math.round(rect.x)));
  const y = Math.max(0, Math.min(image.height - height, Math.round(rect.y)));
  return { x, y, width, height };
}

/** Moves the box without changing its size; it stops at the image's edges. */
export function moveRect(rect: Rect, dx: number, dy: number, image: Size): Rect {
  return clampRect({ ...rect, x: rect.x + dx, y: rect.y + dy }, image);
}

/**
 * Resizes the box by dragging one handle `dx`, `dy` image pixels from where the drag started. The opposite corner
 * (or edge) stays put, and the box stops at the image's edges and at 1 pixel; it doesn't flip over.
 * With a ratio, a corner follows whichever direction moved further, and an edge handle grows the other side
 * equally around the box's centre.
 */
export function resizeRect(rect: Rect, handle: Handle, dx: number, dy: number, image: Size, ratio: Ratio): Rect {
  const west = handle.includes('w');
  const east = handle.includes('e');
  const north = handle.includes('n');
  const south = handle.includes('s');
  let left = rect.x;
  let right = rect.x + rect.width;
  let top = rect.y;
  let bottom = rect.y + rect.height;
  if (west) left = Math.max(0, Math.min(right - 1, left + dx));
  if (east) right = Math.min(image.width, Math.max(left + 1, right + dx));
  if (north) top = Math.max(0, Math.min(bottom - 1, top + dy));
  if (south) bottom = Math.min(image.height, Math.max(top + 1, bottom + dy));
  if (ratio === undefined) return clampRect({ x: left, y: top, width: right - left, height: bottom - top }, image);

  // The room the box can grow into from its fixed side.
  const centreX = rect.x + rect.width / 2;
  const centreY = rect.y + rect.height / 2;
  const roomX = west ? rect.x + rect.width : east ? image.width - rect.x : 2 * Math.min(centreX, image.width - centreX);
  const roomY = north ? rect.y + rect.height : south ? image.height - rect.y : 2 * Math.min(centreY, image.height - centreY);
  let width = right - left;
  let height = bottom - top;
  const widthLeads = (west || east) && (!(north || south) || Math.abs(dx) >= Math.abs(dy) * ratio);
  if (widthLeads) height = width / ratio;
  else width = height * ratio;
  const size = sizeForRatio(Math.min(width, roomX), Math.min(height, roomY), ratio);
  const x = west ? rect.x + rect.width - size.width : east ? rect.x : centreX - size.width / 2;
  const y = north ? rect.y + rect.height - size.height : south ? rect.y : centreY - size.height / 2;
  return clampRect({ x, y, ...size }, image);
}

/** Which corner to drag when a new box is drawn from `from` towards a point `dx`, `dy` away. */
export function drawHandle(dx: number, dy: number): Handle {
  return `${dy < 0 ? 'n' : 's'}${dx < 0 ? 'w' : 'e'}` as Handle;
}

/**
 * A typed width, height, X or Y. With a ratio, typing the width sets the height to match (and the other way round);
 * a box that would go past the image is moved back inside, or made smaller when it can't fit.
 */
export function setField(rect: Rect, field: keyof Rect, value: number, image: Size, ratio: Ratio): Rect {
  const next = { ...rect, [field]: value };
  if (field === 'width' || field === 'height') {
    if (ratio !== undefined) {
      const size = field === 'width'
        ? sizeForRatio(Math.min(value, image.width), image.height, ratio)
        : sizeForRatio(image.width, Math.min(value, image.height), ratio);
      Object.assign(next, size);
    }
    // Growing past the right or bottom edge moves the box left or up rather than cutting the size.
    next.width = Math.min(Math.max(1, Math.round(next.width)), image.width);
    next.height = Math.min(Math.max(1, Math.round(next.height)), image.height);
    next.x = Math.min(next.x, image.width - next.width);
    next.y = Math.min(next.y, image.height - next.height);
  }
  return clampRect(next, image);
}

/** Changes the ratio of an existing box: the largest box of the new shape that fits the image, centred where the box was. */
export function applyRatio(rect: Rect, image: Size, ratio: Ratio): Rect {
  if (ratio === undefined) return rect;
  const size = sizeForRatio(image.width, image.height, ratio);
  return clampRect({ x: rect.x + rect.width / 2 - size.width / 2, y: rect.y + rect.height / 2 - size.height / 2, ...size }, image);
}

/**
 * The size the crop is saved at: `target` (the box's own size unless a circle size was chosen), made smaller only if
 * the browser's canvas limit needs it. `scale` is below 1 only in that case.
 */
export function outputSize(target: Size, limit = CANVAS_LIMITS[0]): Size & { scale: number } {
  const scale = Math.min(1, limit.side / target.width, limit.side / target.height, Math.sqrt(limit.pixels / (target.width * target.height)));
  return { width: Math.max(1, Math.floor(target.width * scale)), height: Math.max(1, Math.floor(target.height * scale)), scale };
}

/** The format to save in when the visitor hasn't chosen one: the same as the image, or PNG for GIF and BMP. */
export function defaultFormat(file: { name: string; type: string }): CropFormat {
  if (/^image\/(jpeg|avif)$/.test(file.type) || /\.(jpe?g|jfif|jfi|jif|jpe|avif)$/i.test(file.name)) return 'jpg';
  if (file.type === 'image/webp' || /\.webp$/i.test(file.name)) return 'webp';
  return 'png';
}

/** "photo.jpeg" → "photo-cropped.jpg", or "photo-circle.png" for a circle. */
export function croppedName(name: string, format: CropFormat, shape: CropShape = 'rect') {
  const base = name.replace(/\.[^.]*$/, '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim() || 'image';
  return `${base}-${shape === 'circle' ? 'circle' : 'cropped'}.${format}`;
}

/** Files the tool tries to open: images by type or extension. */
export function isImageFile(file: { name: string; type: string }) {
  return /^image\//.test(file.type) || /\.(jpe?g|jfif|jfi|jif|jpe|png|webp|avif|gif|bmp)$/i.test(file.name);
}
