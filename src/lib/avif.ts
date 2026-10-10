// Reads an AVIF file's ISO-BMFF header without decoding any pixels: brands, size and whether it's a sequence.
// Container layout: https://aomediacodec.github.io/av1-avif/

const ascii = (bytes: Uint8Array, at: number) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

function brands(bytes: Uint8Array) {
  if (bytes.length < 16 || ascii(bytes, 4) !== 'ftyp') return [];
  const size = view(bytes).getUint32(0);
  if (size < 16 || size > bytes.length || size % 4) return [];
  const list = [ascii(bytes, 8)];
  for (let at = 16; at < size; at += 4) list.push(ascii(bytes, at));
  return list;
}

export function isAvif(bytes: Uint8Array) { return brands(bytes).some(brand => brand === 'avif' || brand === 'avis'); }

// Boxes that hold the image properties: meta > iprp > ipco > ispe. meta is a full box, with 4 bytes of version and flags first.
const CONTAINERS: Record<string, number> = { meta: 4, iprp: 0, ipco: 0 };
const SCAN_BYTES = 256 * 1024;

export function readAvifInfo(bytes: Uint8Array): { width?: number; height?: number; animated: boolean } | undefined {
  const list = brands(bytes);
  if (!list.some(brand => brand === 'avif' || brand === 'avis')) return undefined;
  const data = view(bytes);
  const end = Math.min(bytes.length, SCAN_BYTES);
  let width: number | undefined;
  let height: number | undefined;
  let moov = false;
  const walk = (from: number, to: number, top: boolean) => {
    for (let at = from; at + 8 <= to;) {
      let size = data.getUint32(at);
      const type = ascii(bytes, at + 4);
      let header = 8;
      if (size === 1) {
        if (at + 16 > to) return;
        size = Number(data.getBigUint64(at + 8));
        header = 16;
      } else if (size === 0) size = to - at;
      if (size < header) return;
      if (top && type === 'moov') moov = true;
      const boxEnd = Math.min(at + size, to);
      if (type in CONTAINERS) walk(at + header + CONTAINERS[type], boxEnd, false);
      else if (type === 'ispe' && at + header + 12 <= boxEnd) {
        // Version and flags, then width and height. A grid image lists its tiles too, so the largest is the full image.
        const w = data.getUint32(at + header + 4);
        const h = data.getUint32(at + header + 8);
        if (w && h && w * h > (width ?? 0) * (height ?? 0)) { width = w; height = h; }
      }
      at += size;
    }
  };
  walk(0, end, true);
  // libavif (used by Chrome and Firefox) follows the major brand: 'avif' shows the still image even when a sequence is
  // also stored, 'avis' plays the sequence. Other major brands play a sequence when there is one.
  const major = list[0];
  const animated = major === 'avis' || (major !== 'avif' && list.includes('avis') && moov);
  return { width, height, animated };
}

export const TINY_AVIF_BASE64 = 'AAAAHGZ0eXBhdmlmAAAAAG1pZjFhdmlmbWlhZgAAAOptZXRhAAAAAAAAACFoZGxyAAAAAAAAAABwaWN0AAAAAAAAAAAAAAAAAAAAACJpbG9jAAAAAERAAAEAAQAAAAABDgABAAAAAAAAACAAAAAjaWluZgAAAAAAAQAAABVpbmZlAgAAAAABAABhdjAxAAAAAA5waXRtAAAAAAABAAAAamlwcnAAAABLaXBjbwAAAAxhdjFDgSACAAAAABNjb2xybmNseAABAA0AAIAAAAAUaXNwZQAAAAAAAAABAAAAAQAAABBwaXhpAAAAAAMICAgAAAAXaXBtYQAAAAAAAAABAAEEgQIDBAAAAChtZGF0EgAKBzgABhAQ0AIyExAAAAAP+j9adAx6kYPdyns2ULA=';
