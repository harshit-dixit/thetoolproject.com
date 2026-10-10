// ISO-BMFF header inspection, bounded to the first 256 KB; no pixel decoding.
const ascii = (bytes: Uint8Array, at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
const u32 = (bytes: Uint8Array, at: number) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(at);
function brands(bytes: Uint8Array) {
  if (bytes.length < 16 || ascii(bytes, 4) !== 'ftyp') return [];
  const size = u32(bytes, 0);
  if (size < 16 || size > bytes.length || size % 4) return [];
  return [ascii(bytes, 8), ...Array.from({ length: (size - 16) / 4 }, (_, i) => ascii(bytes, 16 + i * 4))];
}
export function isAvif(bytes: Uint8Array) { return brands(bytes).some(brand => brand === 'avif' || brand === 'avis'); }
export function readAvifInfo(bytes: Uint8Array): { width?: number; height?: number; animated: boolean } | undefined {
  if (!isAvif(bytes)) return undefined;
  const end = Math.min(bytes.length, 256 * 1024);
  let width: number | undefined, height: number | undefined;
  let moov = false;
  // Properties sit inside nested boxes. Scan for complete, correctly sized ispe full boxes.
  for (let at = 4; at + 4 <= end; at++) {
    const type = ascii(bytes, at);
    const size = u32(bytes, at - 4);
    if (size < 8 || at - 4 + size > bytes.length) continue;
    if (type === 'moov') moov = true;
    if (type !== 'ispe' || size < 20 || at + 16 > end) continue;
    const w = u32(bytes, at + 8), h = u32(bytes, at + 12);
    if (w && h && w * h > (width ?? 0) * (height ?? 0)) { width = w; height = h; }
  }
  const b = brands(bytes);
  return { width, height, animated: b[0] === 'avis' || (b.includes('avis') && moov) };
}
export const TINY_AVIF_BASE64 = 'AAAAHGZ0eXBhdmlmAAAAAG1pZjFhdmlmbWlhZgAAAOptZXRhAAAAAAAAACFoZGxyAAAAAAAAAABwaWN0AAAAAAAAAAAAAAAAAAAAACJpbG9jAAAAAERAAAEAAQAAAAABDgABAAAAAAAAACAAAAAjaWluZgAAAAAAAQAAABVpbmZlAgAAAAABAABhdjAxAAAAAA5waXRtAAAAAAABAAAAamlwcnAAAABLaXBjbwAAAAxhdjFDgSACAAAAABNjb2xybmNseAABAA0AAIAAAAAUaXNwZQAAAAAAAAABAAAAAQAAABBwaXhpAAAAAAMICAgAAAAXaXBtYQAAAAAAAAABAAEEgQIDBAAAAChtZGF0EgAKBzgABhAQ0AIyExAAAAAP+j9adAx6kYPdyns2ULA=';
