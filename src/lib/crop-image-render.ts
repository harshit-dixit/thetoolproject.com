// Crop image's drawing and saving, run by the worker, or by the page in browsers whose workers can't draw
// (no OffscreenCanvas, or one without a 2D context).
import { BORDER_WIDTH, CANVAS_LIMITS, circleSize, COLORS, LIMITS, MIME, outputSize, type CircleOptions, type CropFormat, type Rect, type Size } from './crop-image';

/** With `circle`, the square crop is cut to a circle; its corners are transparent or filled, as chosen. */
export type CropOptions = { format: CropFormat; quality: number; circle?: CircleOptions };
export type CropResult = {
  data: Uint8Array; width: number; height: number;
  /** Below 1 when the crop was saved smaller to fit the browser's canvas limit (not when a smaller circle size was chosen). */
  scale: number;
};

/**
 * `unsupported`: nothing here can draw, so the page should try. `canvas`: drawing failed, often at this size.
 * `encode`: the browser saved another format than the one asked for (Safari can't save WebP).
 */
export class CropError extends Error { constructor(public code: string) { super(code); } }

async function decode(file: Blob): Promise<ImageBitmap> {
  try {
    // Turn photos the way their EXIF orientation says, as the preview shows them. Older browsers don't know the
    // option, and already do it.
    return await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => createImageBitmap(file));
  } catch { throw new CropError('decode'); }
}

let offscreen: boolean | undefined;
/** Safari 16.0–16.3 has OffscreenCanvas without 2D drawing. */
function hasOffscreen2d() {
  if (offscreen === undefined) {
    try { offscreen = typeof OffscreenCanvas !== 'undefined' && !!new OffscreenCanvas(1, 1).getContext('2d'); } catch { offscreen = false; }
  }
  return offscreen;
}

type Context = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

function canvas(width: number, height: number) {
  let context: Context | null;
  let toBlob: (type: string, quality: number) => Promise<Blob | null>;
  let release: () => void;
  if (hasOffscreen2d()) {
    const surface = new OffscreenCanvas(width, height);
    context = surface.getContext('2d');
    toBlob = (type, quality) => surface.convertToBlob({ type, quality });
    release = () => { surface.width = surface.height = 1; };
  } else if (typeof document !== 'undefined') {
    const surface = document.createElement('canvas');
    surface.width = width;
    surface.height = height;
    context = surface.getContext('2d');
    toBlob = (type, quality) => new Promise(resolve => surface.toBlob(resolve, type, quality));
    release = () => { surface.width = surface.height = 1; };
  } else throw new CropError('unsupported');
  if (!context) throw new CropError('canvas');
  context.imageSmoothingQuality = 'high';
  return { context, toBlob, release };
}

/**
 * Cuts `rect` out of the image and saves it. `shown` is the image's size as the page showed it; if this browser decodes
 * it at another size, the box is scaled to match, so the crop covers the same part of the picture.
 */
export async function cropImage(file: Blob, shown: Size, rect: Rect, options: CropOptions): Promise<CropResult> {
  if (file.size > LIMITS.fileBytes) throw new CropError('tooLarge');
  if (!hasOffscreen2d() && typeof document === 'undefined') throw new CropError('unsupported');
  const bitmap = await decode(file);
  try {
    if (bitmap.width * bitmap.height > LIMITS.pixels) throw new CropError('tooManyPixels');
    const sx = bitmap.width / shown.width;
    const sy = bitmap.height / shown.height;
    const source = { x: rect.x * sx, y: rect.y * sy, width: rect.width * sx, height: rect.height * sy };
    const type = MIME[options.format];
    const { circle } = options;
    const target = circle ? { width: circleSize(rect, circle.size), height: circleSize(rect, circle.size) } : rect;
    let failure: unknown;
    for (const limit of CANVAS_LIMITS) {
      const size = outputSize(target, limit);
      try {
        const { context, toBlob, release } = canvas(size.width, size.height);
        try {
          // JPG has no transparency, so transparent areas (and a circle's corners) are saved white.
          const fill = circle && circle.background !== 'transparent' ? COLORS[circle.background] : options.format === 'jpg' ? COLORS.white : undefined;
          if (fill) {
            context.fillStyle = fill;
            context.fillRect(0, 0, size.width, size.height);
          }
          if (circle) {
            const radius = size.width / 2;
            context.save();
            context.beginPath();
            context.arc(radius, radius, radius, 0, Math.PI * 2);
            context.clip();
            context.drawImage(bitmap, source.x, source.y, source.width, source.height, 0, 0, size.width, size.height);
            context.restore();
            // The ring is drawn inside the circle's edge, so the circle keeps its size.
            const ring = BORDER_WIDTH[circle.border] * size.width;
            if (ring > 0) {
              context.beginPath();
              context.arc(radius, radius, radius - ring / 2, 0, Math.PI * 2);
              context.lineWidth = ring;
              context.strokeStyle = COLORS[circle.borderColor];
              context.stroke();
            }
          } else context.drawImage(bitmap, source.x, source.y, source.width, source.height, 0, 0, size.width, size.height);
          let blob: Blob | null;
          try { blob = await toBlob(type, options.quality); } catch { throw new CropError('canvas'); }
          // A canvas over the browser's limit can come back empty instead of failing.
          if (!blob || !blob.size) throw new CropError('canvas');
          // Never offer a .webp download that's really a PNG.
          if (blob.type !== type) throw new CropError('encode');
          return { data: new Uint8Array(await blob.arrayBuffer()), width: size.width, height: size.height, scale: size.scale };
        } finally { release(); }
      } catch (error) {
        // Only a canvas failure is worth a smaller try.
        if (!(error instanceof CropError && error.code === 'canvas')) throw error;
        failure = error;
      }
    }
    throw failure;
  } finally { bitmap.close(); }
}
