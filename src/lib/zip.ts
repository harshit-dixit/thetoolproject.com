// A minimal ZIP writer and reader. Written entries are stored uncompressed, with UTF-8 names: enough for CSV files
// and images, which are already compressed. The reader handles stored and deflated entries, the two methods that
// Windows, macOS and common zip tools use.
export type ZipEntry = { name: string; data: Uint8Array };

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date: Date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((Math.max(date.getFullYear(), 1980) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

type EntryHeader = { name: Uint8Array; size: number; crc: number };

/** Each entry's local header (the data follows it) and the central directory that closes the archive. */
function zipHeaders(entries: EntryHeader[], modified: Date) {
  const { time, day } = dosDateTime(modified);
  const locals: Uint8Array[] = [];
  const offsets: number[] = [];
  let at = 0;
  for (const entry of entries) {
    const local = new Uint8Array(30 + entry.name.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x0800, true); // bit 11: names are UTF-8
    view.setUint16(8, 0, true); // stored
    view.setUint16(10, time, true);
    view.setUint16(12, day, true);
    view.setUint32(14, entry.crc, true);
    view.setUint32(18, entry.size, true);
    view.setUint32(22, entry.size, true);
    view.setUint16(26, entry.name.length, true);
    local.set(entry.name, 30);
    locals.push(local);
    offsets.push(at);
    at += local.length + entry.size;
  }
  const centralSize = entries.reduce((sum, entry) => sum + 46 + entry.name.length, 0);
  const central = new Uint8Array(centralSize + 22);
  const view = new DataView(central.buffer);
  let c = 0;
  entries.forEach((entry, i) => {
    view.setUint32(c, 0x02014b50, true);
    view.setUint16(c + 4, 20, true);
    view.setUint16(c + 6, 20, true);
    view.setUint16(c + 8, 0x0800, true);
    view.setUint16(c + 10, 0, true);
    view.setUint16(c + 12, time, true);
    view.setUint16(c + 14, day, true);
    view.setUint32(c + 16, entry.crc, true);
    view.setUint32(c + 20, entry.size, true);
    view.setUint32(c + 24, entry.size, true);
    view.setUint16(c + 28, entry.name.length, true);
    view.setUint32(c + 42, offsets[i], true);
    central.set(entry.name, c + 46);
    c += 46 + entry.name.length;
  });
  view.setUint32(c, 0x06054b50, true);
  view.setUint16(c + 8, entries.length, true);
  view.setUint16(c + 10, entries.length, true);
  view.setUint32(c + 12, centralSize, true);
  view.setUint32(c + 16, at, true);
  return { locals, central };
}

export function createZip(entries: ZipEntry[], modified = new Date()): Uint8Array {
  const encoder = new TextEncoder();
  const { locals, central } = zipHeaders(entries.map(entry => ({ name: encoder.encode(entry.name), size: entry.data.length, crc: crc32(entry.data) })), modified);
  const out = new Uint8Array(locals.reduce((sum, local, i) => sum + local.length + entries[i].data.length, central.length));
  let at = 0;
  entries.forEach((entry, i) => {
    out.set(locals[i], at);
    out.set(entry.data, at + locals[i].length);
    at += locals[i].length + entry.data.length;
  });
  out.set(central, at);
  return out;
}

/** Builds the archive from Blobs without copying them into one buffer, so a large batch doesn't have to fit in memory twice. */
export function createZipBlob(entries: { name: string; blob: Blob; crc: number }[], modified = new Date()): Blob {
  const encoder = new TextEncoder();
  const { locals, central } = zipHeaders(entries.map(entry => ({ name: encoder.encode(entry.name), size: entry.blob.size, crc: entry.crc })), modified);
  return new Blob([...entries.flatMap((entry, i) => [locals[i] as BlobPart, entry.blob]), central as BlobPart], { type: 'application/zip' });
}

export class ZipError extends Error {
  constructor(public code: 'notZip' | 'unsupported' | 'encrypted') { super(code); }
}

export type ZipFileEntry = {
  /** The path inside the archive, with forward slashes. */
  path: string;
  size: number;
  encrypted: boolean;
  /** Unsupported methods (bzip2, LZMA …) can be listed but not read. */
  readable: boolean;
  /** Stored entries are a slice of the archive; deflated ones are inflated with the browser's DecompressionStream. */
  blob(): Promise<Blob>;
};

const readBytes = async (blob: Blob, start: number, end: number) => new Uint8Array(await blob.slice(start, end).arrayBuffer());
// Names without the UTF-8 flag are usually in a DOS code page; Windows-1252 gets ASCII and most accents right.
const latin = new TextDecoder('windows-1252');
const utf8 = new TextDecoder();

/** Lists a ZIP archive's files from its central directory. Only the parts that are read are loaded into memory. */
export async function readZip(archive: Blob): Promise<ZipFileEntry[]> {
  const tailStart = Math.max(0, archive.size - 65_557);
  const tail = await readBytes(archive, tailStart, archive.size);
  let end = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x05 && tail[i + 3] === 0x06) { end = i; break; }
  if (end < 0) throw new ZipError('notZip');
  const endView = new DataView(tail.buffer, tail.byteOffset + end);
  const count = endView.getUint16(10, true);
  const centralSize = endView.getUint32(12, true);
  const centralStart = endView.getUint32(16, true);
  // ZIP64 archives (over 4 GB or 65,535 files) mark these fields as 0xFFFF / 0xFFFFFFFF.
  if (count === 0xffff || centralSize === 0xffffffff || centralStart === 0xffffffff) throw new ZipError('unsupported');
  if (centralStart + centralSize > archive.size) throw new ZipError('notZip');
  const central = await readBytes(archive, centralStart, centralStart + centralSize);
  const view = new DataView(central.buffer, central.byteOffset, central.byteLength);
  const entries: ZipFileEntry[] = [];
  for (let at = 0, i = 0; i < count; i++) {
    if (at + 46 > central.length || view.getUint32(at, true) !== 0x02014b50) throw new ZipError('notZip');
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const compressed = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const offset = view.getUint32(at + 42, true);
    const nameBytes = central.subarray(at + 46, at + 46 + nameLength);
    const path = (flags & 0x0800 ? utf8 : latin).decode(nameBytes).replace(/\\/g, '/');
    at += 46 + nameLength + extraLength + commentLength;
    if (path.endsWith('/')) continue;
    const encrypted = !!(flags & 1);
    entries.push({
      path, size, encrypted,
      readable: !encrypted && (method === 0 || method === 8),
      async blob() {
        if (encrypted) throw new ZipError('encrypted');
        if (method !== 0 && method !== 8) throw new ZipError('unsupported');
        const local = await readBytes(archive, offset, offset + 30);
        const localView = new DataView(local.buffer);
        if (local.length < 30 || localView.getUint32(0, true) !== 0x04034b50) throw new ZipError('notZip');
        const start = offset + 30 + localView.getUint16(26, true) + localView.getUint16(28, true);
        const data = archive.slice(start, start + compressed);
        if (method === 0) return data;
        return new Response(data.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
      },
    });
  }
  return entries;
}
