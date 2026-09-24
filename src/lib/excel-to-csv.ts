import { read, SSF, utils, type CellObject, type WorkBook, type WorkSheet } from 'xlsx';

export type Separator = 'comma' | 'semicolon' | 'tab';
export type NumberMode = 'formatted' | 'plain';
export type CsvOptions = { separator: Separator; numbers: NumberMode };
export type SheetInfo = { name: string; hidden: boolean; rows: number; columns: number };
export type CsvResult = { csv: string; rows: number; columns: number; preview: string[][]; previewText: string };
export type ExcelErrorCode = 'passwordProtected' | 'unreadable' | 'noSheets';
export type ExcelError = { code: ExcelErrorCode };

export const PREVIEW_ROWS = 100;
export const PREVIEW_COLUMNS = 30;
const SEPARATORS: Record<Separator, string> = { comma: ',', semicolon: ';', tab: '\t' };
const EOL = '\r\n';

export function openWorkbook(data: ArrayBuffer | Uint8Array): WorkBook {
  let workbook: WorkBook;
  try {
    workbook = read(data, { type: 'array', dense: true, cellNF: true, cellHTML: false, cellFormula: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Encrypted Excel files fail with "File is password-protected" and ODS with "Unsupported ODS Encryption".
    // Damaged ZIP headers can report "ZIP encryption", which is not a password anyone set.
    throw { code: /password|ODS Encryption/i.test(message) ? 'passwordProtected' : 'unreadable' } satisfies ExcelError;
  }
  if (!sheetIndexes(workbook).length) throw { code: 'noSheets' } satisfies ExcelError;
  return workbook;
}

// Chart and dialog sheets have no cells to export, so they are left out of the list.
function sheetIndexes(workbook: WorkBook) {
  return workbook.SheetNames.map((name, index) => ({ name, index })).filter(({ name }) => {
    const sheet = workbook.Sheets[name];
    // The SheetJS types only list sheet and chart, but dialog and macro sheets are reported too.
    const type = sheet?.['!type'] as string | undefined;
    return sheet && type !== 'chart' && type !== 'dialog';
  });
}

export function describeWorkbook(workbook: WorkBook): SheetInfo[] {
  return sheetIndexes(workbook).map(({ name, index }) => {
    const { rows, columns } = extent(workbook.Sheets[name]);
    return { name, hidden: !!workbook.Workbook?.Sheets?.[index]?.Hidden, rows, columns };
  });
}

export function sheetNames(workbook: WorkBook) {
  return sheetIndexes(workbook).map(({ name }) => name);
}

type Grid = { rows: number; columns: number; startRow: number; startColumn: number; data: CellObject[][] };

// The used range often includes formatted but empty rows and columns at the end, so trim to real content.
function extent(sheet: WorkSheet): Grid {
  const data: CellObject[][] = sheet['!data'] ?? [];
  const ref = sheet['!ref'];
  if (!ref) return { rows: 0, columns: 0, startRow: 0, startColumn: 0, data };
  const { s: { r: startRow, c: startColumn } } = utils.decode_range(ref);
  let lastRow = -1;
  let lastColumn = -1;
  for (let r = startRow; r < data.length; r++) {
    const row = data[r];
    if (!row) continue;
    for (let c = row.length - 1; c >= startColumn; c--) {
      if (hasContent(row[c])) { lastRow = r; if (c > lastColumn) lastColumn = c; break; }
    }
  }
  return { rows: lastRow < 0 ? 0 : lastRow - startRow + 1, columns: lastColumn < 0 ? 0 : lastColumn - startColumn + 1, startRow, startColumn, data };
}

function hasContent(cell: CellObject | undefined) {
  return !!cell && cell.t !== 'z' && !(cell.t === 's' && cell.v === '');
}

export function sheetToCsv(workbook: WorkBook, name: string, options: CsvOptions): CsvResult {
  const sheet = workbook.Sheets[name];
  const grid = extent(sheet);
  const separator = SEPARATORS[options.separator];
  const date1904 = !!workbook.Workbook?.WBProps?.date1904;
  const lines: string[] = [];
  const preview: string[][] = [];
  const fields: string[] = new Array(grid.columns);
  for (let r = 0; r < grid.rows; r++) {
    const row = grid.data[grid.startRow + r];
    for (let c = 0; c < grid.columns; c++) fields[c] = cellText(row?.[grid.startColumn + c], options.numbers, date1904);
    if (r < PREVIEW_ROWS) preview.push(fields.slice(0, PREVIEW_COLUMNS));
    lines.push(fields.map(field => quote(field, separator)).join(separator));
  }
  const csv = lines.length ? lines.join(EOL) + EOL : '';
  return { csv, rows: grid.rows, columns: grid.columns, preview, previewText: lines.slice(0, PREVIEW_ROWS).join(EOL) };
}

export function quote(field: string, separator: string) {
  return field.includes(separator) || /["\r\n]/.test(field) ? `"${field.replaceAll('"', '""')}"` : field;
}

export function cellText(cell: CellObject | undefined, numbers: NumberMode, date1904 = false): string {
  if (!cell) return '';
  switch (cell.t) {
    case 's': return String(cell.v ?? '');
    case 'b': return cell.v ? 'TRUE' : 'FALSE';
    case 'e': return cell.w ?? '';
    case 'd': return cell.v instanceof Date ? isoFromDate(cell.v) : cell.w ?? '';
    case 'n': return numberText(cell, numbers, date1904);
    default: return '';
  }
}

function numberText(cell: CellObject, numbers: NumberMode, date1904: boolean) {
  const value = cell.v as number;
  const format = typeof cell.z === 'string' ? cell.z : 'General';
  // Elapsed-time formats such as [h]:mm count past 24 hours, so keep Excel's own text for them.
  if (SSF.is_date(format) && !/\[[hms]+\]/i.test(format)) return isoFromSerial(value, format, date1904) ?? cell.w ?? plainNumber(value);
  // SheetJS rounds General numbers to fit a narrow column; Excel's CSV export keeps 15 significant digits.
  if (numbers === 'plain' || format === 'General') return plainNumber(value);
  return cell.w ?? plainNumber(value);
}

export function plainNumber(value: number) {
  return Number.isFinite(value) ? String(Number(value.toPrecision(15))) : '';
}

const pad = (value: number, length = 2) => String(value).padStart(length, '0');

function isoFromSerial(serial: number, format: string, date1904: boolean) {
  const parts = SSF.parse_date_code(serial, { date1904 });
  const pattern = format.replace(/"[^"]*"|\[[^\]]*\]|\\./g, '').replace(/AM\/PM|A\/P/gi, '');
  const hasTime = /[hs]/i.test(pattern);
  const hasDate = /[yd]/i.test(pattern) || (!hasTime && /m/i.test(pattern));
  // Excel shows day 0 as "1/0/1900", which has no ISO form.
  if (!parts || (parts.d === 0 && (hasDate || !hasTime))) return undefined;
  const date = `${pad(parts.y, 4)}-${pad(parts.m)}-${pad(parts.d)}`;
  const time = `${pad(parts.H)}:${pad(parts.M)}:${pad(parts.S)}`;
  if (hasTime && !hasDate) return time;
  if (hasTime) return `${date} ${time}`;
  return date;
}

function isoFromDate(value: Date) {
  const date = `${pad(value.getUTCFullYear(), 4)}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
  const time = `${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}:${pad(value.getUTCSeconds())}`;
  return time === '00:00:00' ? date : `${date} ${time}`;
}

// File names inside a ZIP must be valid on Windows, macOS and Linux, and unique ignoring case.
export function csvFileNames(names: string[], extension: string) {
  const used = new Set<string>();
  return names.map(name => {
    let base = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/^[\s.]+|[\s.]+$/g, '') || 'Sheet';
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(base)) base += '-Sheet';
    let candidate = `${base}.${extension}`;
    for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${base} (${n}).${extension}`;
    used.add(candidate.toLowerCase());
    return candidate;
  });
}
