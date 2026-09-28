import { describe, expect, it } from 'vitest';
import { crc32, createZip, createZipBlob, readZip, ZipError } from './zip';

const text = (value: string) => new TextEncoder().encode(value);
const read = async (blob: Blob) => new TextDecoder().decode(await blob.arrayBuffer());

async function deflateRaw(data: Uint8Array) {
  return new Uint8Array(await new Response(new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
}

/** A one-entry archive written by hand, for methods and flags createZip doesn't produce. */
function handmadeZip(name: string, stored: Uint8Array, { method = 8, size = stored.length, flags = 0x0800, crc = 0 } = {}) {
  const nameBytes = text(name);
  const local = new Uint8Array(30 + nameBytes.length);
  const lv = new DataView(local.buffer);
  lv.setUint32(0, 0x04034b50, true); lv.setUint16(6, flags, true); lv.setUint16(8, method, true);
  lv.setUint32(14, crc, true); lv.setUint32(18, stored.length, true); lv.setUint32(22, size, true); lv.setUint16(26, nameBytes.length, true);
  local.set(nameBytes, 30);
  const central = new Uint8Array(46 + nameBytes.length + 22);
  const cv = new DataView(central.buffer);
  cv.setUint32(0, 0x02014b50, true); cv.setUint16(8, flags, true); cv.setUint16(10, method, true);
  cv.setUint32(16, crc, true); cv.setUint32(20, stored.length, true); cv.setUint32(24, size, true); cv.setUint16(28, nameBytes.length, true);
  central.set(nameBytes, 46);
  const end = 46 + nameBytes.length;
  cv.setUint32(end, 0x06054b50, true); cv.setUint16(end + 8, 1, true); cv.setUint16(end + 10, 1, true);
  cv.setUint32(end + 12, 46 + nameBytes.length, true); cv.setUint32(end + 16, local.length + stored.length, true);
  return new Blob([local as BlobPart, stored as BlobPart, central as BlobPart]);
}

describe('zip', () => {
  it('reads back what createZip writes, skipping folders', async () => {
    const zip = createZip([{ name: 'a.csv', data: text('one') }, { name: 'folder/ü.csv', data: text('two') }]);
    const entries = await readZip(new Blob([zip as BlobPart]));
    expect(entries.map(entry => [entry.path, entry.size, entry.readable])).toEqual([['a.csv', 3, true], ['folder/ü.csv', 3, true]]);
    expect(await read(await entries[1].blob())).toBe('two');
  });

  it('writes the same archive from Blobs as from bytes', async () => {
    const date = new Date(2024, 0, 15, 10, 30);
    const data = [text('first'), text('second file')];
    const bytes = createZip([{ name: 'x/1.png', data: data[0] }, { name: '2.png', data: data[1] }], date);
    const blob = createZipBlob([{ name: 'x/1.png', blob: new Blob([data[0] as BlobPart]), crc: crc32(data[0]) }, { name: '2.png', blob: new Blob([data[1] as BlobPart]), crc: crc32(data[1]) }], date);
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
  });

  it('inflates deflated entries and reads Windows backslash paths', async () => {
    const original = text('webp '.repeat(500));
    const entries = await readZip(handmadeZip('photos\\cat.webp', await deflateRaw(original), { size: original.length }));
    expect(entries[0].path).toBe('photos/cat.webp');
    expect(new Uint8Array(await (await entries[0].blob()).arrayBuffer())).toEqual(original);
  });

  it('decodes names without the UTF-8 flag as Windows-1252', async () => {
    const zip = handmadeZip('x', text('data'), { method: 0, flags: 0 });
    const bytes = new Uint8Array(await zip.arrayBuffer());
    // Swap the one-letter name for "é" (0xE9) in both headers.
    bytes[30] = 0xe9;
    bytes[30 + 1 + 4 + 46] = 0xe9;
    expect((await readZip(new Blob([bytes as BlobPart])))[0].path).toBe('é');
  });

  it('lists encrypted and unsupported entries as unreadable', async () => {
    const [encrypted] = await readZip(handmadeZip('secret.webp', text('xxxx'), { flags: 0x0801 }));
    expect(encrypted).toMatchObject({ encrypted: true, readable: false });
    await expect(encrypted.blob()).rejects.toEqual(new ZipError('encrypted'));
    const [bzip2] = await readZip(handmadeZip('old.webp', text('xxxx'), { method: 12 }));
    expect(bzip2.readable).toBe(false);
  });

  it('rejects files that are not ZIP archives', async () => {
    await expect(readZip(new Blob([text('not a zip at all, just some text that goes on for a while')]))).rejects.toEqual(new ZipError('notZip'));
  });
});
