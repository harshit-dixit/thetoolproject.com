// Merge JPG's reading and drawing, run by the worker, or by the page in browsers whose workers can't draw
// (no OffscreenCanvas, or one without a 2D context). pdf-lib is loaded only when a PDF is made.
import { CANVAS_LIMITS, LIMITS, orientationMatrix, planImage, planPdfPage, readImageInfo, type ImageInfo, type ImageOptions, type PdfOptions, type Size } from './merge-jpg';

export type MergeResult = {
  data: Uint8Array; width?: number; height?: number; pages?: number;
  /** Image: below 1 when the merged image was made smaller to fit the browser's canvas limit. */
  scale?: number;
  /** PDF: images that weren't JPEG (or were CMYK JPEGs) and were saved as JPEG first. */
  reencoded?: number;
};

export type Progress = (done: number) => void;

/** `unsupported`: nothing here can draw, so the page should try. `canvas`: drawing failed, often at this size. */
export class MergeError extends Error { constructor(public code: string) { super(code); } }

// Phone photos store their size and orientation in the first few KB; a large EXIF thumbnail can push it further.
const HEADER_BYTES = 1024 * 1024;

async function decode(file: Blob): Promise<ImageBitmap> {
  try {
    // Turn photos the way their EXIF orientation says. Older browsers don't know the option, and already do it.
    return await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => createImageBitmap(file));
  } catch { throw new MergeError('decode'); }
}

/**
 * The size an image is shown at. The header is read first so an image too big to merge isn't decoded; then the image
 * is decoded, so a damaged one is left out now rather than failing the merge, or going into a PDF that won't open.
 */
export async function measure(file: Blob): Promise<Size> {
  if (file.size > LIMITS.fileBytes) throw new MergeError('tooLarge');
  let info = readImageInfo(new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer()));
  if (!info && file.size > HEADER_BYTES) info = readImageInfo(new Uint8Array(await file.arrayBuffer()));
  if (info && info.width * info.height > LIMITS.pixels) throw new MergeError('tooManyPixels');
  const bitmap = await decode(file);
  // The decoded size is what gets drawn, so it's the one to plan with.
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  if (!size.width || !size.height) throw new MergeError('decode');
  if (size.width * size.height > LIMITS.pixels) throw new MergeError('tooManyPixels');
  return size;
}

type Context = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
type Surface = { context: Context; toJpeg: (quality: number) => Promise<Uint8Array>; release: () => void };

let offscreen: boolean | undefined;
/** Safari 16.0–16.3 has OffscreenCanvas without 2D drawing. */
function hasOffscreen2d() {
  if (offscreen === undefined) {
    try { offscreen = typeof OffscreenCanvas !== 'undefined' && !!new OffscreenCanvas(1, 1).getContext('2d'); } catch { offscreen = false; }
  }
  return offscreen;
}

/** Whether this context can draw: a worker needs OffscreenCanvas, the page can fall back to a canvas element. */
export const canDraw = () => hasOffscreen2d() || typeof document !== 'undefined';

function checked(blob: Blob | null) {
  // A canvas over the browser's limit can come back empty instead of failing.
  if (!blob || blob.type !== 'image/jpeg' || !blob.size) throw new MergeError('canvas');
  return blob.arrayBuffer().then(buffer => new Uint8Array(buffer));
}

function canvas(width: number, height: number): Surface {
  let context: Context | null;
  let toBlob: (quality: number) => Promise<Blob | null>;
  let release: () => void;
  if (hasOffscreen2d()) {
    const surface = new OffscreenCanvas(width, height);
    context = surface.getContext('2d');
    toBlob = quality => surface.convertToBlob({ type: 'image/jpeg', quality });
    release = () => { surface.width = surface.height = 1; };
  } else if (typeof document !== 'undefined') {
    const surface = document.createElement('canvas');
    surface.width = width;
    surface.height = height;
    context = surface.getContext('2d');
    toBlob = quality => new Promise(resolve => surface.toBlob(resolve, 'image/jpeg', quality));
    release = () => { surface.width = surface.height = 1; };
  } else throw new MergeError('unsupported');
  if (!context) throw new MergeError('canvas');
  context.imageSmoothingQuality = 'high';
  const drawn = context;
  return {
    context: drawn,
    toJpeg: async quality => {
      let blob: Blob | null;
      try { blob = await toBlob(quality); } catch { throw new MergeError('canvas'); }
      return checked(blob);
    },
    release,
  };
}

export async function mergeImage(files: Blob[], sizes: Size[], options: ImageOptions, progress: Progress): Promise<MergeResult> {
  if (!canDraw()) throw new MergeError('unsupported');
  let failure: unknown;
  for (const limit of CANVAS_LIMITS) {
    const plan = planImage(sizes, options, limit);
    try {
      const { context, toJpeg, release } = canvas(plan.width, plan.height);
      try {
        context.fillStyle = options.background === 'black' ? '#000000' : '#ffffff';
        context.fillRect(0, 0, plan.width, plan.height);
        for (let i = 0; i < files.length; i++) {
          const bitmap = await decode(files[i]);
          const rect = plan.rects[i];
          try { context.drawImage(bitmap, rect.x, rect.y, rect.width, rect.height); } finally { bitmap.close(); }
          progress(i + 1);
        }
        const data = await toJpeg(options.quality);
        return { data, width: plan.width, height: plan.height, scale: plan.scale };
      } finally { release(); }
    } catch (error) {
      // A damaged image fails the same way at any size; only a canvas failure is worth a smaller try.
      if (!(error instanceof MergeError && error.code === 'canvas')) throw error;
      failure = error;
    }
  }
  throw failure;
}

export async function mergePdf(files: Blob[], options: PdfOptions, progress: Progress): Promise<MergeResult> {
  const { PDFDocument, concatTransformationMatrix, drawObject, popGraphicsState, pushGraphicsState } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  let reencoded = 0;
  for (let i = 0; i < files.length; i++) {
    const bytes = new Uint8Array(await files[i].arrayBuffer());
    const info: ImageInfo | undefined = readImageInfo(bytes);
    let image;
    let orientation = 1;
    // JPEGs go into the PDF as they are, with no quality lost. CMYK JPEGs are often stored inverted, which PDF
    // readers show as a negative, so those and other formats are drawn by the browser and saved as JPEG first.
    if (info?.type === 'jpeg' && info.components !== 4) {
      try { image = await doc.embedJpg(bytes); orientation = info.orientation; } catch { image = undefined; }
    }
    if (!image) {
      // Checked here rather than up front, so a PDF of JPEGs works even where nothing can draw.
      if (!canDraw()) throw new MergeError('unsupported');
      const bitmap = await decode(files[i]);
      const { context, toJpeg, release } = canvas(bitmap.width, bitmap.height);
      try {
        // JPEG has no transparency, so transparent PNG and WebP areas print white.
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, bitmap.width, bitmap.height);
        try { context.drawImage(bitmap, 0, 0); } finally { bitmap.close(); }
        image = await doc.embedJpg(await toJpeg(0.92));
      } finally { release(); }
      reencoded++;
    }
    const shown = orientation >= 5 ? { width: image.height, height: image.width } : { width: image.width, height: image.height };
    const plan = planPdfPage(shown, options);
    const page = doc.addPage([plan.pageWidth, plan.pageHeight]);
    const name = page.node.newXObject('Image', image.ref);
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...orientationMatrix(orientation, plan)), drawObject(name), popGraphicsState());
    progress(i + 1);
  }
  const data = await doc.save();
  return { data, pages: files.length, reencoded };
}
