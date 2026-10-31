// Tells from the file's bytes whether an image is animated (GIF, APNG, WebP or an AVIF sequence), without decoding it.
// Crop image shows and saves only the first frame of these.
import { readAvifInfo } from './avif';

const ascii = (bytes: Uint8Array, at: number, length: number) => String.fromCharCode(...bytes.subarray(at, at + length));
const u32be = (bytes: Uint8Array, at: number) => ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;

export const isGif = (bytes: Uint8Array) => bytes.length >= 6 && /^GIF8[79]a$/.test(ascii(bytes, 0, 6));

/** Counts a GIF's frames, stopping at `upTo`. Each frame's pixels have to be skipped, so pass the whole file. */
export function gifFrames(bytes: Uint8Array, upTo = 2) {
  if (!isGif(bytes) || bytes.length < 13) return 0;
  // Header, screen descriptor, then the global colour table if the flags say there's one.
  let at = 13 + (bytes[10] & 0x80 ? 3 * (2 << (bytes[10] & 7)) : 0);
  const skipSubBlocks = () => { while (at < bytes.length && bytes[at]) at += bytes[at] + 1; at++; };
  let frames = 0;
  while (at < bytes.length) {
    const kind = bytes[at];
    if (kind === 0x2c) {
      if (++frames >= upTo) break;
      const flags = bytes[at + 9];
      at += 10 + (flags & 0x80 ? 3 * (2 << (flags & 7)) : 0) + 1; // descriptor, local colour table, LZW code size
      skipSubBlocks();
    } else if (kind === 0x21) {
      at += 2;
      skipSubBlocks();
    } else break; // 0x3b ends the file; anything else is damage.
  }
  return frames;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** An APNG says how many frames it has in an acTL chunk, which comes before the image data. */
function isAnimatedPng(bytes: Uint8Array) {
  if (bytes.length < 8 || PNG_SIGNATURE.some((byte, i) => bytes[i] !== byte)) return false;
  for (let at = 8; at + 12 <= bytes.length;) {
    const length = u32be(bytes, at);
    const type = ascii(bytes, at + 4, 4);
    if (type === 'acTL') return u32be(bytes, at + 8) > 1;
    if (type === 'IDAT' || type === 'IEND') return false;
    at += 12 + length;
  }
  return false;
}

/**
 * An animated WebP sets a flag in its VP8X chunk, which comes first. Checked here rather than with readWebpInfo, which
 * would move the whole WebP reader into Merge JPG's first load (it shares isWebp).
 */
const isAnimatedWebp = (bytes: Uint8Array) =>
  bytes.length >= 21 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 8) === 'WEBPVP8X' && !!(bytes[20] & 0x02);

/** For a GIF, pass the whole file; for other formats the first megabyte is plenty. */
export function isAnimated(bytes: Uint8Array) {
  if (isGif(bytes)) return gifFrames(bytes) > 1;
  return isAnimatedPng(bytes) || isAnimatedWebp(bytes) || !!readAvifInfo(bytes)?.animated;
}
