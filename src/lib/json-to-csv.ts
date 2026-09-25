import { LargeInteger, MAX_NESTING, diagnose, isRecord, parsePreservingIntegers, wrapJsonLines, type ConversionError } from './json-to-html';

export type CsvSeparator = 'comma' | 'semicolon' | 'tab';
export type CsvOptions = { separator: CsvSeparator; bom: boolean; spreadsheetSafe: boolean };
export type CsvError = ConversionError | { code: 'noData' | 'tooManyColumns' };
export type CsvConversion = { csv: string; rows: number; columns: number; headers: string[]; preview: string[][]; headerless: boolean; jsonLines: boolean; protectedCells: number; unsafeNumberFallback: boolean };

const PREVIEW_ROWS = 100;
const PREVIEW_COLUMNS = 30;
const MAX_COLUMNS = 100000;
const separators: Record<CsvSeparator, string> = { comma: ',', semicolon: ';', tab: '\t' };
type Scalar = string | number | boolean | LargeInteger | null;
type Row = Map<string, Scalar>;

function jsonText(value: unknown): string {
  if (value instanceof LargeInteger) return value.digits;
  if (Array.isArray(value)) return `[${value.map(jsonText).join(',')}]`;
  if (isRecord(value)) return `{${Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}:${jsonText(item)}`).join(',')}}`;
  return JSON.stringify(value ?? null);
}
function label(parts: string[]) { return parts.map(part => part.replaceAll('\\', '\\\\').replaceAll('.', '\\.')).join('.'); }
function flatten(value: unknown, path: string[], row: Row, level: number) {
  if (level > MAX_NESTING) throw { code: 'depth', position: 0, line: 1, column: 1 } satisfies ConversionError;
  if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) flatten(item, [...path, key], row, level + 1);
  } else row.set(label(path), Array.isArray(value) ? jsonText(value) : value as Scalar);
}
function cellText(value: Scalar | undefined): string {
  if (value == null) return '';
  return value instanceof LargeInteger ? value.digits : String(value);
}
// Quoting a formula is insufficient: spreadsheet programs can still evaluate quoted CSV fields.
function safeCell(value: Scalar | undefined, enabled: boolean): { text: string; protected: boolean } {
  const text = cellText(value);
  const dangerous = enabled && typeof value === 'string' && /^[\s\uFEFF]*[=+\-@]/.test(text);
  return { text: dangerous ? `'${text}` : text, protected: !!dangerous };
}
function quote(text: string, separator: string): string {
  return text.includes(separator) || /["\r\n]/.test(text) || /^\s|\s$/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
function parse(source: string): { value: unknown; jsonLines: boolean; fallback: boolean } {
  if (!source.trim()) throw diagnose(source);
  try { const parsed = parsePreservingIntegers(source); return { value: parsed.value, fallback: parsed.fallback, jsonLines: false }; }
  catch {
    const error = diagnose(source);
    if (error.code !== 'jsonLines') throw error;
    const parsed = parsePreservingIntegers(wrapJsonLines(source));
    return { value: parsed.value, fallback: parsed.fallback, jsonLines: true };
  }
}

export function convertJsonToCsv(source: string, options: CsvOptions): CsvConversion {
  const parsed = parse(source);
  let records: unknown[];
  let headerless = false;
  if (Array.isArray(parsed.value)) {
    records = parsed.value;
    headerless = records.length > 0 && records.every(Array.isArray);
  } else if (isRecord(parsed.value)) {
    const entries = Object.entries(parsed.value);
    // A common API response wraps its records in one named property.
    records = entries.length === 1 && Array.isArray(entries[0][1]) && entries[0][1].every(isRecord) ? entries[0][1] : [parsed.value];
  } else records = [parsed.value];
  if (!records.length) throw { code: 'noData' } satisfies CsvError;

  const rows: Row[] = [];
  const headers: string[] = [];
  const seen = new Set<string>();
  const addHeader = (name: string) => { if (!seen.has(name)) { seen.add(name); headers.push(name); if (headers.length > MAX_COLUMNS) throw { code: 'tooManyColumns' } satisfies CsvError; } };
  for (const record of records) {
    const row: Row = new Map();
    if (headerless) (record as unknown[]).forEach((item, i) => row.set(String(i), Array.isArray(item) || isRecord(item) ? jsonText(item) : item as Scalar));
    else if (isRecord(record)) flatten(record, [], row, 1);
    else row.set('Value', Array.isArray(record) ? jsonText(record) : record as Scalar);
    row.forEach((_value, name) => addHeader(name));
    rows.push(row);
  }
  if (!headers.length) throw { code: 'noData' } satisfies CsvError;
  if (headerless) headers.sort((a, b) => Number(a) - Number(b));
  const delimiter = separators[options.separator];
  let protectedCells = 0;
  const preview: string[][] = [];
  const lines: string[] = [];
  const shownHeaders = headerless ? headers : headers.map(header => {
    const cell = safeCell(header, options.spreadsheetSafe);
    if (cell.protected) protectedCells++;
    return cell.text;
  });
  if (!headerless) lines.push(shownHeaders.map(header => quote(header, delimiter)).join(delimiter));
  for (let i = 0; i < rows.length; i++) {
    const cells = headers.map(header => { const cell = safeCell(rows[i].get(header), options.spreadsheetSafe); if (cell.protected) protectedCells++; return cell.text; });
    lines.push(cells.map(value => quote(value, delimiter)).join(delimiter));
    if (i < PREVIEW_ROWS) preview.push(cells.slice(0, PREVIEW_COLUMNS));
  }
  return { csv: (options.bom ? '\uFEFF' : '') + lines.join('\r\n') + '\r\n', rows: rows.length, columns: headers.length, headers: shownHeaders.slice(0, PREVIEW_COLUMNS), preview, headerless, jsonLines: parsed.jsonLines, protectedCells, unsafeNumberFallback: parsed.fallback };
}
