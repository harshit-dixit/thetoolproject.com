import { utils, write, type CellObject, type WorkSheet } from 'xlsx';
// SheetJS ships the DOS code pages used by older dBASE files.
// @ts-ignore The package does not publish a declaration for this optional module.
import { utils as codepage } from 'xlsx/dist/cpexcel.full.mjs';

export type DbfErrorCode = 'invalid' | 'unsupported' | 'memo' | 'tooManyRows' | 'tooManyColumns' | 'encoding';
export type DbfError = { code: DbfErrorCode; detail?: string };
export type DbfEncoding = 'auto' | 'windows-1252' | 'windows-1251' | 'ibm866' | 'ibm850' | 'ibm437' | 'utf-8';
export type DbfResult = { xlsx: Uint8Array<ArrayBuffer>; rows: number; columns: number; skipped: number; encoding: string; preview: string[][]; textNumbers: number };

const MAX_ROWS = 1_048_575; // A header row also occupies one Excel row.
const MAX_COLUMNS = 16_384;
const PREVIEW_ROWS = 12;
const PREVIEW_COLUMNS = 12;
const CODEPAGES: Record<number, string> = {
  0x01: 'ibm437', 0x02: 'ibm850', 0x03: 'windows-1252', 0x57: 'windows-1252',
  0x26: 'ibm866', 0x65: 'ibm866', 0x66: 'ibm866', 0x67: 'ibm861',
  0x6a: 'ibm737', 0x7a: 'windows-936', 0x7b: 'windows-932',
  0x7c: 'windows-874', 0x7d: 'windows-1255', 0x7e: 'windows-1256',
  0xc8: 'windows-1250', 0xc9: 'windows-1251', 0xca: 'windows-1254', 0xcb: 'windows-1253',
};
type Field = { name: string; type: string; length: number; offset: number; decimals: number };
const fail = (code: DbfErrorCode, detail?: string): never => { throw { code, detail } satisfies DbfError; };
const pad = (value: number) => String(value).padStart(2, '0');
const excelDate = (year: number, month: number, day: number) => {
  const ms = Date.UTC(year, month - 1, day);
  const date = new Date(ms);
  return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day && ms >= Date.UTC(1900, 2, 1)
    ? (ms - Date.UTC(1899, 11, 30)) / 86_400_000 : undefined;
};
const clean = (value: string) => value.replace(/\u0000+$/g, '').trimEnd();
const previewValue = (cell: CellObject | undefined): string => cell?.v == null ? '' : cell.t === 'b' ? cell.v ? 'TRUE' : 'FALSE' : String(cell.v);

export function convertDbfToExcel(bytes: Uint8Array, selectedEncoding: DbfEncoding = 'auto', sheetName = 'Data'): DbfResult {
  if (bytes.length < 33) fail('invalid');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = bytes[0];
  if (![0x03, 0x30, 0x31, 0x83, 0x8b, 0xf5].includes(version)) fail('unsupported', `DBF version 0x${version.toString(16)}`);
  const recordCount = view.getUint32(4, true);
  const headerLength = view.getUint16(8, true);
  const recordLength = view.getUint16(10, true);
  const descriptorEnd = version === 0x30 || version === 0x31 ? headerLength - 263 : headerLength;
  if (headerLength < 65 || headerLength > bytes.length || descriptorEnd < 65 || recordLength < 2 || (descriptorEnd - 33) % 32 !== 0) fail('invalid');
  if (recordCount > MAX_ROWS) fail('tooManyRows');
  if (headerLength + recordCount * recordLength > bytes.length) fail('invalid');
  const encoding = selectedEncoding === 'auto' ? CODEPAGES[bytes[29]] || 'windows-1252' : selectedEncoding;
  let decode: (bytes: Uint8Array) => string;
  const dosCodepage = ({ 'ibm437': 437, 'ibm850': 850, 'ibm861': 861, 'ibm737': 737 } as Record<string, number>)[encoding];
  if (dosCodepage) decode = bytes => codepage.decode(dosCodepage, bytes);
  else {
    try { const decoder = new TextDecoder(encoding); decode = bytes => decoder.decode(bytes); }
    catch { return fail('encoding', encoding); }
  }
  const fields: Field[] = [];
  let offset = 1;
  for (let position = 32; position < descriptorEnd - 1; position += 32) {
    const raw = bytes.subarray(position, position + 32);
    if (raw[0] === 0x0d) break;
    const end = raw.subarray(0, 11).indexOf(0);
    const name = clean(decode(raw.subarray(0, end < 0 ? 11 : end)));
    const type = String.fromCharCode(raw[11]);
    const length = raw[16];
    if (!name || !length) fail('invalid');
    if (['M', 'G', 'P'].includes(type)) fail('memo');
    if (!['C', 'N', 'F', 'D', 'L', 'I', 'Y', 'T', 'B'].includes(type) || type === 'B' && version !== 0x30 && version !== 0x31) fail('unsupported', `Field ${name} (${type})`);
    if (['I'].includes(type) && length !== 4 || ['Y', 'T', 'B'].includes(type) && length !== 8) fail('invalid');
    fields.push({ name, type, length, offset, decimals: raw[17] });
    offset += length;
  }
  if (!fields.length || fields.length > MAX_COLUMNS || bytes[descriptorEnd - 1] !== 0x0d || offset !== recordLength) fail(fields.length > MAX_COLUMNS ? 'tooManyColumns' : 'invalid');
  const rows: CellObject[][] = [fields.map(field => ({ t: 's', v: field.name }))];
  const preview: string[][] = [fields.slice(0, PREVIEW_COLUMNS).map(field => field.name)];
  let skipped = 0;
  let textNumbers = 0;
  for (let r = 0; r < recordCount; r++) {
    const base = headerLength + r * recordLength;
    if (bytes[base] === 0x2a) { skipped++; continue; }
    if (bytes[base] !== 0x20) fail('invalid');
    const cells: CellObject[] = [];
    const texts: string[] = [];
    for (const field of fields) {
      const start = base + field.offset;
      const raw = bytes.subarray(start, start + field.length);
      const value = clean(decode(raw));
      let cell: CellObject | undefined;
      switch (field.type) {
        case 'C': if (value) cell = { t: 's', v: value }; break;
        case 'N': case 'F': {
          const numberText = value.trim();
          if (numberText && numberText !== '.') {
            if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(numberText)) fail('invalid');
            const significant = numberText.replace(/^[+-]?0*/, '').replace(/[.eE+-]/g, '').replace(/^0+/, '');
            const number = Number(numberText);
            if (significant.length > 15 || !Number.isFinite(number)) { cell = { t: 's', v: numberText }; textNumbers++; }
            else cell = { t: 'n', v: number };
          }
          break;
        }
        case 'D': {
          const dateText = value.trim();
          if (dateText && dateText !== '00000000') {
            if (!/^\d{8}$/.test(dateText)) fail('invalid');
            const year = +dateText.slice(0, 4), month = +dateText.slice(4, 6), day = +dateText.slice(6, 8);
            const serial = excelDate(year, month, day);
            cell = serial === undefined ? { t: 's', v: `${year}-${pad(month)}-${pad(day)}` } : { t: 'n', v: serial, z: 'yyyy-mm-dd' };
          }
          break;
        }
        case 'L': {
          const flag = value.trim().toUpperCase();
          if (flag === 'Y' || flag === 'T') cell = { t: 'b', v: true };
          else if (flag === 'N' || flag === 'F') cell = { t: 'b', v: false };
          else if (flag && flag !== '?') fail('invalid');
          break;
        }
        case 'I': cell = { t: 'n', v: view.getInt32(start, true) }; break;
        case 'Y': {
          const currency = view.getBigInt64(start, true);
          const value = Number(currency) / 10_000;
          if (currency > 99_999_999_999_999n || currency < -99_999_999_999_999n) {
            const absolute = currency < 0n ? -currency : currency;
            cell = { t: 's', v: `${currency < 0n ? '-' : ''}${absolute / 10_000n}.${String(absolute % 10_000n).padStart(4, '0')}` };
            textNumbers++;
          }
          else cell = { t: 'n', v: value, z: '#,##0.0000' };
          break;
        }
        case 'T': {
          const julian = view.getUint32(start, true), milliseconds = view.getUint32(start + 4, true);
          if (julian || milliseconds) {
            const serial = julian - 2_415_019 + milliseconds / 86_400_000;
            cell = serial >= 61 && milliseconds < 86_400_000 ? { t: 'n', v: serial, z: 'yyyy-mm-dd hh:mm:ss' } : { t: 's', v: `${julian}:${milliseconds}` };
          }
          break;
        }
        case 'B': cell = { t: 'n', v: view.getFloat64(start, true) }; break;
      }
      cells.push(cell!);
      if (r - skipped < PREVIEW_ROWS && texts.length < PREVIEW_COLUMNS) texts.push(field.type === 'D' && cell?.t === 'n' ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` : previewValue(cell));
    }
    rows.push(cells);
    if (preview.length <= PREVIEW_ROWS) preview.push(texts);
  }
  const sheet = { '!data': rows, '!ref': utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length - 1, c: fields.length - 1 } }) } as WorkSheet;
  sheet['!cols'] = fields.map(field => ({ wch: Math.min(60, Math.max(10, field.name.length + 2, field.length + 1)) }));
  if (rows.length > 1) sheet['!autofilter'] = { ref: sheet['!ref']! };
  const book = utils.book_new();
  const safeName = sheetName.replace(/[:\\/?*[\]\u0000-\u001f]/g, '-').replace(/^'+|'+$/g, '').slice(0, 31) || 'Data';
  utils.book_append_sheet(book, sheet, safeName);
  const xlsx = new Uint8Array(write(book, { type: 'array', bookType: 'xlsx', compression: true }) as ArrayBuffer);
  return { xlsx, rows: rows.length - 1, columns: fields.length, skipped, encoding, preview, textNumbers };
}
