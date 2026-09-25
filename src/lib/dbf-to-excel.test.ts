import { describe, expect, it } from 'vitest';
import { read, utils } from 'xlsx';
import { convertDbfToExcel } from './dbf-to-excel';

type Field = { name: string; type: string; length: number; decimals?: number };
function dbf(fields: Field[], records: { deleted?: boolean; values: (string | Uint8Array)[] }[], language = 0x03, version = 0x03) {
  const header = 32 + fields.length * 32 + 1 + (version === 0x30 ? 263 : 0);
  const recordLength = 1 + fields.reduce((sum, field) => sum + field.length, 0);
  const bytes = new Uint8Array(header + records.length * recordLength + 1);
  const view = new DataView(bytes.buffer);
  bytes[0] = version; bytes[1] = 126; bytes[2] = 9; bytes[3] = 25;
  view.setUint32(4, records.length, true); view.setUint16(8, header, true); view.setUint16(10, recordLength, true); bytes[29] = language;
  const encoder = new TextEncoder();
  fields.forEach((field, i) => {
    const p = 32 + i * 32;
    bytes.set(encoder.encode(field.name), p); bytes[p + 11] = field.type.charCodeAt(0);
    bytes[p + 16] = field.length; bytes[p + 17] = field.decimals || 0;
  });
  bytes[32 + fields.length * 32] = 0x0d;
  records.forEach((record, i) => {
    let p = header + i * recordLength;
    bytes[p++] = record.deleted ? 0x2a : 0x20;
    record.values.forEach((value, column) => { const data = typeof value === 'string' ? encoder.encode(value) : value; bytes.fill(0x20, p, p + fields[column].length); bytes.set(data, p); p += fields[column].length; });
  });
  bytes[bytes.length - 1] = 0x1a;
  return bytes;
}
function table(bytes: Uint8Array) {
  const result = convertDbfToExcel(bytes);
  const book = read(result.xlsx, { type: 'array', cellDates: false });
  return { result, rows: utils.sheet_to_json<(string | number | boolean)[]>(book.Sheets[book.SheetNames[0]], { header: 1, raw: true }) };
}
describe('DBF to Excel', () => {
  it('converts fields to native Excel values and skips deleted records', () => {
    const { result, rows } = table(dbf([
      { name: 'NAME', type: 'C', length: 12 }, { name: 'AMOUNT', type: 'N', length: 10, decimals: 2 },
      { name: 'PAID', type: 'L', length: 1 }, { name: 'WHEN', type: 'D', length: 8 },
    ], [
      { values: ['Maya', '      12.50', 'Y', '20240115'] },
      { deleted: true, values: ['Old', '       1.0', 'N', '20200101'] },
      { values: ['Luis', '      0.00', 'N', '20240229'] },
    ]));
    expect(result.rows).toBe(2);
    expect(result.skipped).toBe(1);
    expect(rows).toEqual([['NAME', 'AMOUNT', 'PAID', 'WHEN'], ['Maya', 12.5, true, 45306], ['Luis', 0, false, 45351]]);
  });
  it('keeps long identifiers as text and never makes formulas', () => {
    const { result, rows } = table(dbf([{ name: 'ID', type: 'N', length: 18 }, { name: 'TEXT', type: 'C', length: 10 }], [{ values: ['123456789012345678', '=1+1'] }]));
    expect(result.textNumbers).toBe(1);
    expect(rows[1]).toEqual(['123456789012345678', '=1+1']);
  });
  it('decodes DOS text and Visual FoxPro headers', () => {
    const { result, rows } = table(dbf([{ name: 'CITY', type: 'C', length: 5 }], [{ values: [Uint8Array.of(0x43, 0x61, 0x66, 0x82, 0x20)] }], 0x02, 0x30));
    expect(result.encoding).toBe('ibm850');
    expect(rows[1][0]).toBe('Café');
  });
  it('rejects memo fields and truncated data rather than making incomplete workbooks', () => {
    expect(() => table(dbf([{ name: 'NOTES', type: 'M', length: 10 }], []))).toThrow();
    const bytes = dbf([{ name: 'NAME', type: 'C', length: 5 }], [{ values: ['Maya'] }]);
    expect(() => table(bytes.subarray(0, bytes.length - 3))).toThrow();
  });
});
