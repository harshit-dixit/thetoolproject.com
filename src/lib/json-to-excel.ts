import { utils, write, type CellObject, type WorkSheet } from 'xlsx';
import { LargeInteger, MAX_NESTING, diagnose, isRecord, parsePreservingIntegers, wrapJsonLines, type ConversionError } from './json-to-html';

export type Nested = 'sheets' | 'columns';
export type ExcelOptions = { nested: Nested; rootName: string; valueHeader: string };
export type LimitErrorCode = 'noData' | 'tooManyRows' | 'tooManyColumns';
export type LimitError = { code: LimitErrorCode; sheet: string };
export type ExcelError = ConversionError | LimitError;
// preview holds the header row first when the sheet has one.
export type SheetSummary = { name: string; rows: number; columns: number; header: boolean; preview: string[][] };
export type ExcelConversion = { xlsx: Uint8Array<ArrayBuffer>; sheets: SheetSummary[]; jsonLines: boolean; truncated: number; textNumbers: number };

// Excel's own limits: rows and columns per sheet, and characters per cell.
export const MAX_ROWS = 1048576;
export const MAX_COLUMNS = 16384;
export const MAX_CELL = 32767;
export const PREVIEW_ROWS = 100;
export const PREVIEW_COLUMNS = 30;
const PREVIEW_TEXT = 200;
const WIDTH_ROWS = 200;
// Internal column keys join path segments with characters no header shows, so "a.b" and {"a":{"b"}} stay apart.
const SEP = '\u0001';
const INDEX = '\u0002';

type Value = string | number | boolean | LargeInteger | null | undefined;
class TooDeep {}

class Table {
  readonly keys = new Map<string, number>();
  readonly headers: string[] = [];
  readonly rows: Value[][] = [];
  readonly parents: number[] = [];
  readonly childTables = new Map<string, Table>();
  hasChildren = false;
  // A root object is one row, so its child sheets need no column pointing back to it.
  single = false;
  // An array of arrays is written as it is, without a header row.
  headerless = false;
  sheetName = '';
  constructor(readonly path: string[], readonly parent?: Table) {}
  add(parent: number) { this.parents.push(parent); return this.rows.push([]) - 1; }
  set(row: number, key: string, header: string, value: Value) {
    let index = this.keys.get(key);
    if (index === undefined) { index = this.headers.push(header) - 1; this.keys.set(key, index); }
    this.rows[row][index] = value;
  }
  get linked() { return !!this.parent && !this.parent.single; }
}

function jsonText(value: unknown): string {
  if (value instanceof LargeInteger) return value.digits;
  if (Array.isArray(value)) return `[${value.map(jsonText).join(',')}]`;
  if (isRecord(value)) return `{${Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}:${jsonText(item)}`).join(',')}}`;
  return JSON.stringify(value ?? null);
}
// A list of simple values reads best in one cell; a list holding lists keeps its JSON so nothing is lost.
function listText(value: unknown[]): string {
  if (value.some(item => Array.isArray(item) || isRecord(item))) return jsonText(value);
  return value.map(item => item === null ? '' : item instanceof LargeInteger ? item.digits : String(item)).join(', ');
}

export function flatten(value: unknown, nested: Nested): Table[] {
  const tables: Table[] = [];
  const root = new Table([]);
  tables.push(root);
  const child = (table: Table, path: string[], key: string) => {
    let found = table.childTables.get(key);
    if (!found) { found = new Table([...table.path, ...path], table); table.childTables.set(key, found); tables.push(found); }
    if (!table.single) table.hasChildren = true;
    return found;
  };
  const visit = (table: Table, row: number, path: string[], key: string, item: unknown, level: number): void => {
    if (level > MAX_NESTING) throw new TooDeep();
    if (isRecord(item)) {
      for (const name of Object.keys(item)) visit(table, row, [...path, name], key + SEP + name, item[name], level + 1);
      return;
    }
    if (Array.isArray(item)) {
      if (!item.length) return;
      if (item.some(isRecord)) {
        if (nested === 'columns') { item.forEach((element, i) => visit(table, row, [...path, String(i + 1)], key + SEP + INDEX + (i + 1), element, level + 1)); return; }
        const target = child(table, path, key);
        for (const element of item) {
          const next = target.add(row);
          if (Array.isArray(element)) target.set(next, '', '', listText(element));
          else visit(target, next, [], '', element, level + 1);
        }
        return;
      }
      table.set(row, key, path.join('.'), listText(item));
      return;
    }
    table.set(row, key, path.join('.'), item as Value);
  };
  if (Array.isArray(value) && value.length && value.every(Array.isArray)) {
    root.headerless = true;
    for (const line of value as unknown[][]) {
      const row = root.add(-1);
      line.forEach((item, i) => root.set(row, String(i), '', Array.isArray(item) || isRecord(item) ? jsonText(item) : item as Value));
    }
  } else if (Array.isArray(value)) {
    for (const item of value) {
      const row = root.add(-1);
      if (Array.isArray(item)) root.set(row, '', '', listText(item));
      else visit(root, row, [], '', item, 1);
    }
  } else {
    root.single = isRecord(value);
    visit(root, root.add(-1), [], '', value, 1);
  }
  return tables;
}

// Excel rejects names over 31 characters, with : \ / ? * [ ], starting or ending with an apostrophe, or named History.
export function sheetNames(wanted: string[], fallback = 'Sheet') {
  const used = new Set<string>();
  const fit = (name: string, room: number) => {
    let cut = name.slice(0, room);
    if (/[\ud800-\udbff]$/.test(cut)) cut = cut.slice(0, -1);
    return cut.replace(/^'+|'+$/g, '').trim();
  };
  return wanted.map(name => {
    const base = fit(name.replace(/[:\\/?*[\]\u0000-\u001f]/g, '-'), 31) || fallback;
    let candidate = base;
    for (let n = 2; used.has(candidate.toLowerCase()) || candidate.toLowerCase() === 'history'; n++) candidate = `${fit(base, 31 - ` (${n})`.length)} (${n})`;
    used.add(candidate.toLowerCase());
    return candidate;
  });
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z)?)?$/;
const EPOCH = Date.UTC(1899, 11, 30);
// Dates before March 1900 fall on Excel's 1900 leap-year bug, so they stay as text.
const FIRST_DATE = Date.UTC(1900, 2, 1);
type DateParts = { serial: number; format: string; text: string };
export function parseDate(text: string): DateParts | undefined {
  const match = DATE.exec(text);
  if (!match) return undefined;
  const [, y, mo, d, h, mi, s, fraction] = match;
  const hasTime = h !== undefined;
  const ms = fraction ? Math.round(Number(`0.${fraction}`) * 1000) : 0;
  const time = Date.UTC(+y, +mo - 1, +d, hasTime ? +h : 0, hasTime ? +mi : 0, s ? +s : 0, ms);
  const check = new Date(time);
  // Date.UTC rolls 2024-02-30 over to March, so a mismatch means the date doesn't exist.
  if (check.getUTCFullYear() !== +y || check.getUTCMonth() !== +mo - 1 || check.getUTCDate() !== +d || time < FIRST_DATE) return undefined;
  if (hasTime && (+h > 23 || +mi > 59 || (s !== undefined && +s > 59))) return undefined;
  const format = !hasTime ? 'yyyy-mm-dd' : ms ? 'yyyy-mm-dd hh:mm:ss.000' : s !== undefined ? 'yyyy-mm-dd hh:mm:ss' : 'yyyy-mm-dd hh:mm';
  const shown = `${y}-${mo}-${d}` + (hasTime ? ` ${h}:${mi}` + (s !== undefined ? `:${s}` : '') + (ms ? `.${String(ms).padStart(3, '0')}` : '') : '');
  return { serial: (time - EPOCH) / 86400000, format, text: shown };
}

type Stats = { truncated: number; textNumbers: number };
// Excel shows 15 significant digits, so longer whole numbers such as IDs would come back rounded.
const longInteger = (value: number) => Number.isSafeInteger(value) && Math.abs(value) >= 1e15;
function wellFormed(text: string) {
  if (!/[\ud800-\udfff]/.test(text)) return text;
  return text.replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '�');
}
function toCell(value: Value, stats: Stats): CellObject | undefined {
  if (value === null || value === undefined) return undefined;
  if (value instanceof LargeInteger) { stats.textNumbers++; return { t: 's', v: value.digits }; }
  if (typeof value === 'number') {
    if (longInteger(value)) { stats.textNumbers++; return { t: 's', v: String(value) }; }
    return { t: 'n', v: value };
  }
  if (typeof value === 'boolean') return { t: 'b', v: value };
  const date = value.length <= 30 ? parseDate(value) : undefined;
  if (date) return { t: 'n', v: date.serial, z: date.format };
  let text = wellFormed(value);
  if (text.length > MAX_CELL) {
    stats.truncated++;
    text = text.slice(0, /[\ud800-\udbff]/.test(text[MAX_CELL - 1]) ? MAX_CELL - 1 : MAX_CELL);
  }
  return { t: 's', v: text };
}
function previewText(value: Value): string {
  if (value === null || value === undefined) return '';
  if (value instanceof LargeInteger) return value.digits;
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'number') return String(value);
  const date = value.length <= 30 ? parseDate(value) : undefined;
  if (date) return date.text;
  return value.length > PREVIEW_TEXT ? value.slice(0, PREVIEW_TEXT) + '…' : value;
}

export function buildWorkbook(tables: Table[], options: ExcelOptions): ExcelConversion {
  const [root] = tables;
  // A root object with only lists in it would leave an empty first sheet.
  const kept = tables.filter(table => table !== root || !table.single || table.headers.length || tables.length === 1);
  if (kept.every(table => !table.headers.length)) throw { code: 'noData', sheet: '' } satisfies LimitError;
  const names = sheetNames(kept.map(table => table === root ? options.rootName : table.path.join('.')));
  kept.forEach((table, i) => { table.sheetName = names[i]; });
  const book = utils.book_new();
  const stats: Stats = { truncated: 0, textNumbers: 0 };
  const sheets: SheetSummary[] = [];
  for (const table of kept) {
    const lead: string[] = [];
    if (table.linked) lead.push(`${table.parent!.sheetName} #`);
    if (table.hasChildren) lead.push('#');
    const headers = [...lead, ...table.headers.map(header => header || options.valueHeader)];
    const columns = headers.length;
    const headerRows = table.headerless ? 0 : 1;
    if (columns > MAX_COLUMNS) throw { code: 'tooManyColumns', sheet: table.sheetName } satisfies LimitError;
    if (table.rows.length + headerRows > MAX_ROWS) throw { code: 'tooManyRows', sheet: table.sheetName } satisfies LimitError;
    const data: CellObject[][] = [];
    const preview: string[][] = [];
    const widths = headers.map(header => table.headerless ? 0 : header.length);
    if (!table.headerless) {
      data.push(headers.map(header => ({ t: 's', v: wellFormed(header).slice(0, MAX_CELL) })));
      preview.push(headers.slice(0, PREVIEW_COLUMNS));
    }
    table.rows.forEach((values, r) => {
      const full: Value[] = lead.length ? [...(table.linked ? [table.parents[r] + 1] : []), ...(table.hasChildren ? [r + 1] : []), ...values] : values;
      const cells: CellObject[] = new Array(columns);
      for (let c = 0; c < full.length; c++) { const cell = toCell(full[c], stats); if (cell) cells[c] = cell; }
      data.push(cells);
      // Column widths come from the first rows, which is also where the preview comes from.
      if (r < WIDTH_ROWS) {
        const texts = Array.from({ length: columns }, (_, c) => previewText(full[c]));
        texts.forEach((text, c) => { widths[c] = Math.max(widths[c], text.length); });
        if (r < PREVIEW_ROWS) preview.push(texts.slice(0, PREVIEW_COLUMNS));
      }
    });
    const rowCount = table.rows.length;
    // The cells now hold everything, so free the values before the next sheet is built.
    table.rows.length = 0;
    const sheet = { '!data': data } as WorkSheet;
    const lastRow = Math.max(data.length - 1, 0);
    if (columns) sheet['!ref'] = utils.encode_range({ s: { r: 0, c: 0 }, e: { r: lastRow, c: columns - 1 } });
    sheet['!cols'] = widths.map(width => ({ wch: Math.min(60, Math.max(8, width + 2)) }));
    if (!table.headerless && columns && rowCount) sheet['!autofilter'] = { ref: sheet['!ref']! };
    utils.book_append_sheet(book, sheet, table.sheetName);
    sheets.push({ name: table.sheetName, rows: rowCount, columns, header: !table.headerless, preview });
  }
  const xlsx = new Uint8Array(write(book, { type: 'array', bookType: 'xlsx', compression: true, bookSST: true }) as ArrayBuffer);
  return { xlsx, sheets, jsonLines: false, ...stats };
}

export function convertJsonToExcel(source: string, options: ExcelOptions): ExcelConversion {
  if (!source.trim()) throw diagnose(source);
  let value: unknown;
  let jsonLines = false;
  try { value = parsePreservingIntegers(source).value; }
  catch {
    const error = diagnose(source);
    // JSON Lines exports have one record per line; each line becomes a row.
    if (error.code !== 'jsonLines') throw error;
    value = parsePreservingIntegers(wrapJsonLines(source)).value;
    jsonLines = true;
  }
  let tables: Table[];
  try { tables = flatten(value, options.nested); value = undefined; }
  catch (error) {
    if (error instanceof TooDeep || error instanceof RangeError) throw { code: 'depth', position: 0, line: 1, column: 1 } satisfies ConversionError;
    throw error;
  }
  return { ...buildWorkbook(tables, options), jsonLines };
}
