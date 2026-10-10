import { readAvifInfo, TINY_AVIF_BASE64 } from '../lib/avif';
import { readImageInfo } from '../lib/merge-jpg';
import { readWebpInfo } from '../lib/webp';
import { crc32, readZip, ZipError } from '../lib/zip';
import { gifDelay, gifRepeat, isSourceEntry, SOURCES, LIMITS, MIME, traceSize, type ConvertOptions, type SourceFormat } from '../lib/webp-convert';
import { createGifWriter, embedSvg, traceSvg } from '../lib/webp-encode';

export type WebpRequest =
  | { type: 'unzip'; id: number; file: Blob; source: SourceFormat }
  | { type: 'convert'; id: number; file: Blob; options: ConvertOptions };

export type ConvertResult = {
  data: Uint8Array; crc: number; width: number; height: number;
  /** Frames in a WebP source; 1 for other sources. Only GIF output keeps more than the first. */
  frames: number;
  /** The source was animated (a WebP or an AVIF sequence) and only its first frame was kept. */
  firstFrameOnly: boolean;
  /** Set when the image was scaled down before tracing. */
  tracedAt?: { width: number; height: number };
  /** GIF only: some pixels were partly transparent and became fully opaque or fully transparent. */
  partialAlpha: boolean;
  copied?: boolean;
  reencoded?: boolean;
};

export type WebpResponse =
  | { id: number; entries: { path: string; blob: Blob }[]; other: number; locked: number }
  | { id: number; result: ConvertResult }
  | { id: number; error: { code: string } };

class ConvertError extends Error { constructor(public code: string) { super(code); } }

function canvas(width: number, height: number) {
  if (typeof OffscreenCanvas === 'undefined') throw new ConvertError('canvas');
  const surface = new OffscreenCanvas(width, height);
  const context = surface.getContext('2d', { willReadFrequently: true });
  if (!context) throw new ConvertError('canvas');
  context.imageSmoothingQuality = 'high';
  return { surface, context };
}

async function encode(surface: OffscreenCanvas, type: string, quality?: number) {
  let blob: Blob;
  try { blob = await surface.convertToBlob({ type, quality }); } catch { throw new ConvertError('canvas'); }
  // A browser that can't write the format silently falls back to PNG.
  if (blob.type !== type) throw new ConvertError(type === 'image/webp' ? 'webpEncode' : 'canvas');
  return new Uint8Array(await blob.arrayBuffer());
}

const pixels = (context: OffscreenCanvasRenderingContext2D, width: number, height: number) => {
  try { return context.getImageData(0, 0, width, height); } catch { throw new ConvertError('canvas'); }
};

async function animatedGif(bytes: Uint8Array, width: number, height: number, frames: number, loopCount: number) {
  if (frames * width * height > LIMITS.animationPixels) throw new ConvertError('animationTooLong');
  const decoder = new ImageDecoder({ data: bytes, type: 'image/webp' });
  try {
    await decoder.completed;
    const count = decoder.tracks.selectedTrack?.frameCount ?? frames;
    if (count * width * height > LIMITS.animationPixels) throw new ConvertError('animationTooLong');
    const { context } = canvas(width, height);
    const writer = createGifWriter(gifRepeat(loopCount));
    for (let frameIndex = 0; frameIndex < count; frameIndex++) {
      const { image } = await decoder.decode({ frameIndex });
      // VideoFrame.duration is in microseconds.
      const delay = gifDelay((image.duration ?? 100_000) / 1000);
      context.clearRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      image.close();
      writer.addFrame(pixels(context, width, height), delay);
    }
    return { ...writer.finish(), frames: count };
  } finally { decoder.close(); }
}

const canDecodeAnimation = async () => typeof ImageDecoder !== 'undefined' && await ImageDecoder.isTypeSupported('image/webp').catch(() => false);

// Only a success is remembered: a probe that fails once (say, under memory pressure) is tried again on the next
// failed AVIF, so one bad moment can't make every damaged file look like an unsupported browser.
let avifSupported = false;
async function canDecodeAvif() {
  if (avifSupported) return true;
  try {
    const bytes = Uint8Array.from(atob(TINY_AVIF_BASE64), char => char.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/avif' }));
    bitmap.close();
    avifSupported = true;
  } catch { /* not supported, or not this time */ }
  return avifSupported;
}

/** The decoded size of a JPEG whose header couldn't be read, so its row never shows 0 × 0. */
async function measure(bytes: Uint8Array) {
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: 'image/jpeg' })); } catch { throw new ConvertError('decode'); }
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  if (!size.width || !size.height) throw new ConvertError('decode');
  return size;
}

async function convert(file: Blob, options: ConvertOptions): Promise<ConvertResult> {
  if (file.size > LIMITS.fileBytes) throw new ConvertError('tooLarge');
  const bytes = new Uint8Array(await file.arrayBuffer());
  // Undefined for a mislabelled file (often a JPEG or PNG named .webp); the browser still decodes those.
  const source = options.source;
  if (source === 'jfif' && options.format === 'jpg' && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    // readImageInfo already applies the EXIF orientation to the display dimensions. A header it can't read is measured
    // by decoding; a file the browser can't decode either is reported as damaged rather than renamed.
    const info = readImageInfo(bytes);
    const { width, height } = info?.width && info.height ? info : await measure(bytes);
    return { data: bytes, crc: crc32(bytes), width, height, frames: 1, firstFrameOnly: false, partialAlpha: false, copied: true };
  }
  const avif = source === 'avif' ? readAvifInfo(bytes) : undefined;
  if (avif?.width && avif.height && avif.width * avif.height > LIMITS.pixels) throw new ConvertError('tooManyPixels');
  const info = source === 'webp' ? readWebpInfo(bytes) : undefined;
  if (info && info.width * info.height > LIMITS.pixels) throw new ConvertError('tooManyPixels');
  const frames = info?.animated ? info.frames : 1;

  if (options.format === 'gif' && info?.animated && frames > 1 && await canDecodeAnimation()) {
    const gif = await animatedGif(bytes, info.width, info.height, frames, info.loopCount);
    return { data: gif.bytes, crc: crc32(gif.bytes), width: info.width, height: info.height, frames: gif.frames, firstFrameOnly: false, partialAlpha: gif.partialAlpha };
  }

  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: SOURCES[source].blobType })); } catch {
    if (source === 'avif' && !await canDecodeAvif()) throw new ConvertError('avifUnsupported');
    throw new ConvertError('decode');
  }
  const { width, height } = bitmap;
  try {
    if (!width || !height) throw new ConvertError('decode');
    if (width * height > LIMITS.pixels) throw new ConvertError('tooManyPixels');
    // createImageBitmap gives the first frame of an AVIF sequence.
    const firstFrameOnly = frames > 1 || !!avif?.animated;
    let data: Uint8Array;
    let tracedAt: ConvertResult['tracedAt'];
    let partialAlpha = false;
    if (options.format === 'svg' && options.svgMode === 'trace') {
      const size = traceSize(width, height);
      const { context } = canvas(size.width, size.height);
      context.drawImage(bitmap, 0, 0, size.width, size.height);
      data = new TextEncoder().encode(traceSvg(pixels(context, size.width, size.height), options.colors, width, height));
      if (size.width !== width) tracedAt = size;
    } else {
      const { surface, context } = canvas(width, height);
      if (options.format === 'jpg') {
        // JPEG has no transparency, so transparent areas get the chosen background instead of turning black.
        context.fillStyle = source !== 'jfif' && options.background === 'black' ? '#000000' : '#ffffff';
        context.fillRect(0, 0, width, height);
      }
      context.drawImage(bitmap, 0, 0);
      if (options.format === 'gif') {
        const writer = createGifWriter(-1);
        writer.addFrame(pixels(context, width, height), 0);
        ({ bytes: data, partialAlpha } = writer.finish());
      } else if (options.format === 'svg') {
        data = new TextEncoder().encode(embedSvg(await encode(surface, MIME.png), width, height));
      } else {
        data = await encode(surface, MIME[options.format], options.format === 'jpg' && source === 'jfif' ? 0.92 : options.format === 'jpg' || options.format === 'webp' ? options.quality : undefined);
      }
    }
    return { data, crc: crc32(data), width, height, frames, firstFrameOnly, tracedAt, partialAlpha, reencoded: source === 'jfif' && options.format === 'jpg' || undefined };
  } finally { bitmap.close(); }
}

async function unzip(file: Blob, source: SourceFormat) {
  if (file.size > LIMITS.zipBytes) throw new ConvertError('zipTooLarge');
  let listing;
  try { listing = await readZip(file); } catch (error) { throw new ConvertError(error instanceof ZipError && error.code === 'unsupported' ? 'zipUnsupported' : 'notZip'); }
  const matching = listing.filter(entry => isSourceEntry(source, entry.path));
  const entries: { path: string; blob: Blob }[] = [];
  let locked = 0;
  for (const entry of matching) {
    if (!entry.readable) { locked++; continue; }
    // One more than the limit is enough for the page to report the batch as too big.
    if (entries.length > LIMITS.files) break;
    try { entries.push({ path: entry.path, blob: await entry.blob() }); } catch { locked++; }
  }
  const other = listing.filter(entry => !isSourceEntry(source, entry.path) && !entry.path.split('/').some(part => part === '__MACOSX' || part.startsWith('.'))).length;
  return { entries, other, locked };
}

self.addEventListener('message', async (event: MessageEvent<WebpRequest>) => {
  const request = event.data;
  try {
    if (request.type === 'unzip') {
      self.postMessage({ id: request.id, ...await unzip(request.file, request.source) } satisfies WebpResponse);
    } else {
      const result = await convert(request.file, request.options);
      self.postMessage({ id: request.id, result } satisfies WebpResponse, { transfer: [result.data.buffer] });
    }
  } catch (error) {
    self.postMessage({ id: request.id, error: { code: error instanceof ConvertError ? error.code : 'general' } } satisfies WebpResponse);
  }
});
