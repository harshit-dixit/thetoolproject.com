// Reads a WebP file's RIFF header without decoding any pixels: size, transparency and animation.
// Container layout: https://developers.google.com/speed/webp/docs/riff_container

export type WebpInfo = {
  width: number;
  height: number;
  /** Lossy (VP8), lossless (VP8L), or the extended container (VP8X) that adds alpha, animation and metadata. */
  kind: 'lossy' | 'lossless' | 'extended';
  alpha: boolean;
  animated: boolean;
  /** ANMF chunks; 1 for a still image. */
  frames: number;
  /** From the ANIM chunk: 0 means loop forever. */
  loopCount: number;
};

const ascii = (bytes: Uint8Array, at: number, length: number) => String.fromCharCode(...bytes.subarray(at, at + length));
const u24 = (bytes: Uint8Array, at: number) => bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16);
const u32 = (bytes: Uint8Array, at: number) => (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0;

export function isWebp(bytes: Uint8Array) {
  return bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP';
}

/** Returns undefined when the bytes aren't a WebP file or the header is cut off. */
export function readWebpInfo(bytes: Uint8Array): WebpInfo | undefined {
  if (!isWebp(bytes)) return undefined;
  let info: WebpInfo | undefined;
  let frames = 0;
  let loopCount = 0;
  for (let at = 12; at + 8 <= bytes.length;) {
    const type = ascii(bytes, at, 4);
    const size = u32(bytes, at + 4);
    const body = at + 8;
    if (body + Math.min(size, 10) > bytes.length) break;
    if (!info && type === 'VP8X' && size >= 10) {
      const flags = bytes[body];
      info = { width: u24(bytes, body + 4) + 1, height: u24(bytes, body + 7) + 1, kind: 'extended', alpha: !!(flags & 0x10), animated: !!(flags & 0x02), frames: 1, loopCount: 0 };
    } else if (!info && type === 'VP8 ' && size >= 10 && bytes[body + 3] === 0x9d && bytes[body + 4] === 0x01 && bytes[body + 5] === 0x2a) {
      info = { width: (bytes[body + 6] | (bytes[body + 7] << 8)) & 0x3fff, height: (bytes[body + 8] | (bytes[body + 9] << 8)) & 0x3fff, kind: 'lossy', alpha: false, animated: false, frames: 1, loopCount: 0 };
    } else if (!info && type === 'VP8L' && size >= 5 && bytes[body] === 0x2f) {
      const bits = u32(bytes, body + 1);
      info = { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1, kind: 'lossless', alpha: !!((bits >>> 28) & 1), animated: false, frames: 1, loopCount: 0 };
    } else if (type === 'ANIM' && size >= 6) {
      loopCount = bytes[body + 4] | (bytes[body + 5] << 8);
    } else if (type === 'ANMF') {
      frames++;
    }
    // A simple file has one image chunk; only the extended format needs the rest of the scan.
    if (info && info.kind !== 'extended') break;
    at = body + size + (size & 1);
  }
  if (!info || !info.width || !info.height) return undefined;
  if (info.animated) { info.frames = Math.max(frames, 1); info.loopCount = loopCount; }
  return info;
}
