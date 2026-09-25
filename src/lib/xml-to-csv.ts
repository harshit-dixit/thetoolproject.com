import { SaxesParser } from 'saxes';

export type XmlCsvSeparator = 'comma' | 'semicolon' | 'tab';
export type XmlCsvOptions = { separator: XmlCsvSeparator; bom: boolean; spreadsheetSafe: boolean; recordPath?: string };
export type XmlCsvError = { code: 'empty' | 'invalidXml' | 'doctype' | 'tooDeep' | 'noData' | 'tooManyColumns' | 'invalidPath'; line?: number; column?: number; detail?: string };
export type XmlCsvConversion = { csv: string; rows: number; columns: number; headers: string[]; preview: string[][]; recordPath: string; paths: string[]; protectedCells: number };

const PREVIEW_ROWS = 100;
const PREVIEW_COLUMNS = 30;
const MAX_COLUMNS = 10000;
const MAX_DEPTH = 100;
const delimiters: Record<XmlCsvSeparator, string> = { comma: ',', semicolon: ';', tab: '\t' };
type XmlValue = string | number | boolean | null | XmlValue[] | { [key: string]: XmlValue };
type Row = Map<string, string>;

function isObject(value: XmlValue): value is { [key: string]: XmlValue } {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function label(parts: string[]) { return parts.map(part => part.replaceAll('\\', '\\\\').replaceAll('.', '\\.')).join('.'); }
function column(part: string) { return part.startsWith('@_') ? `@${part.slice(2)}` : part; }
function flatten(value: XmlValue, path: string[], row: Row, depth: number) {
  if (depth > MAX_DEPTH) throw { code: 'tooDeep' } satisfies XmlCsvError;
  if (isObject(value)) {
    const entries = Object.entries(value).filter(([key]) => key !== '@_xmlns' && !key.startsWith('@_xmlns:'));
    // Put attributes before child elements, independent of the parser's object order.
    for (const [key, item] of entries.filter(([key]) => key.startsWith('@_'))) flatten(item, [...path, column(key)], row, depth + 1);
    for (const [key, item] of entries.filter(([key]) => !key.startsWith('@_'))) flatten(item, [...path, column(key)], row, depth + 1);
  } else row.set(label(path.length ? path : ['Value']), Array.isArray(value) ? JSON.stringify(value) : String(value ?? ''));
}
function collectPaths(value: XmlValue, path: string, paths: Set<string>, repeated: Set<string>, depth: number) {
  if (depth > MAX_DEPTH || !isObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (key.startsWith('@_') || key === '#text') continue;
    const childPath = `${path}/${key}`;
    if (Array.isArray(child)) {
      paths.add(childPath);
      repeated.add(childPath);
      for (const item of child) collectPaths(item, childPath, paths, repeated, depth + 1);
    } else if (isObject(child)) {
      paths.add(childPath);
      collectPaths(child, childPath, paths, repeated, depth + 1);
    }
  }
}
function parseXml(source: string): { name: string; value: XmlValue } {
  type Frame = { name: string; children: Record<string, XmlValue>; text: string; attributes: Record<string, string> };
  const parser = new SaxesParser();
  const stack: Frame[] = [];
  let root: { name: string; value: XmlValue } | undefined;
  parser.on('doctype', () => { throw { code: 'doctype' } satisfies XmlCsvError; });
  parser.on('opentag', tag => {
    if (stack.length >= MAX_DEPTH) throw { code: 'tooDeep' } satisfies XmlCsvError;
    stack.push({ name: tag.name, children: {}, text: '', attributes: Object.fromEntries(Object.entries(tag.attributes).map(([name, value]) => [name, String(value)])) });
  });
  parser.on('text', value => { if (stack.length) stack[stack.length - 1].text += value; });
  parser.on('cdata', value => { if (stack.length) stack[stack.length - 1].text += value; });
  parser.on('closetag', () => {
    const frame = stack.pop()!;
    const text = frame.text.trim();
    const value: XmlValue = Object.keys(frame.children).length || Object.keys(frame.attributes).length
      ? { ...frame.children, ...(text ? { '#text': text } : {}), ...Object.fromEntries(Object.entries(frame.attributes).map(([name, item]) => [`@_${name}`, item])) }
      : text;
    if (!stack.length) { root = { name: frame.name, value }; return; }
    const siblings = stack[stack.length - 1].children;
    if (!(frame.name in siblings)) siblings[frame.name] = value;
    else if (Array.isArray(siblings[frame.name])) (siblings[frame.name] as XmlValue[]).push(value);
    else siblings[frame.name] = [siblings[frame.name], value];
  });
  try { parser.write(source).close(); }
  catch (error) {
    if (error && typeof error === 'object' && 'code' in error) throw error;
    throw { code: 'invalidXml', line: parser.line, column: parser.column, detail: error instanceof Error ? error.message.replace(/^\d+:\d+:\s*/, '') : undefined } satisfies XmlCsvError;
  }
  if (!root) throw { code: 'noData' } satisfies XmlCsvError;
  return root;
}
function atPath(root: XmlValue, path: string): XmlValue[] {
  let current: XmlValue[] = [root];
  for (const part of path.split('/').slice(2)) {
    current = current.flatMap(item => isObject(item) && part in item ? (Array.isArray(item[part]) ? item[part] as XmlValue[] : [item[part]]) : []);
  }
  return current;
}
function safe(value: string, enabled: boolean) {
  const dangerous = enabled && /^[\s\uFEFF]*[=+\-@]/.test(value);
  return { text: dangerous ? `'${value}` : value, protected: dangerous };
}
function quote(value: string, separator: string) {
  return value.includes(separator) || /["\r\n]/.test(value) || /^\s|\s$/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function convertXmlToCsv(source: string, options: XmlCsvOptions): XmlCsvConversion {
  if (!source.trim()) throw { code: 'empty' } satisfies XmlCsvError;
  const parsed = parseXml(source);
  const root = parsed.value;
  const rootPath = `/${parsed.name}`;
  const candidates = new Set<string>();
  const repeated = new Set<string>();
  collectPaths(root, rootPath, candidates, repeated, 0);
  const paths = [rootPath, ...candidates];
  const childElements = isObject(root) ? Object.entries(root).filter(([key]) => !key.startsWith('@_') && key !== '#text') : [];
  const singleChildPath = childElements.length === 1 && isObject(childElements[0][1]) ? `${rootPath}/${childElements[0][0]}` : undefined;
  const singleChild = childElements.length === 1 ? childElements[0][1] : undefined;
  const childFields = singleChild && isObject(singleChild) ? Object.entries(singleChild).filter(([key]) => !key.startsWith('@_') && key !== '#text') : [];
  const childIsOnlyWrapper = childFields.length === 1 && Array.isArray(childFields[0][1]) && (childFields[0][1] as XmlValue[]).some(isObject)
    && singleChild && isObject(singleChild) && !Object.keys(singleChild).some(key => key.startsWith('@_') || key === '#text');
  const recordPath = options.recordPath || (singleChildPath && !childIsOnlyWrapper ? singleChildPath : undefined) || repeated.values().next().value || singleChildPath || rootPath;
  if (!paths.includes(recordPath)) throw { code: 'invalidPath' } satisfies XmlCsvError;
  const records = atPath(root, recordPath);
  if (!records.length) throw { code: 'noData' } satisfies XmlCsvError;
  const rows: Row[] = [];
  const headers: string[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    const row: Row = new Map();
    flatten(record, [], row, 0);
    for (const key of row.keys()) if (!seen.has(key)) {
      seen.add(key); headers.push(key);
      if (headers.length > MAX_COLUMNS) throw { code: 'tooManyColumns' } satisfies XmlCsvError;
    }
    rows.push(row);
  }
  if (!headers.length) throw { code: 'noData' } satisfies XmlCsvError;
  const separator = delimiters[options.separator];
  let protectedCells = 0;
  const protect = (value: string) => { const cell = safe(value, options.spreadsheetSafe); if (cell.protected) protectedCells++; return cell.text; };
  // XML names form structural headers, so the generated @ attribute prefix is safe as-is.
  const shownHeaders = headers;
  const lines = [shownHeaders.map(value => quote(value, separator)).join(separator)];
  const preview: string[][] = [];
  for (const [index, row] of rows.entries()) {
    const cells = headers.map(header => protect(row.get(header) ?? ''));
    lines.push(cells.map(value => quote(value, separator)).join(separator));
    if (index < PREVIEW_ROWS) preview.push(cells.slice(0, PREVIEW_COLUMNS));
  }
  return { csv: (options.bom ? '\uFEFF' : '') + lines.join('\r\n') + '\r\n', rows: rows.length, columns: headers.length, headers: shownHeaders.slice(0, PREVIEW_COLUMNS), preview, recordPath, paths, protectedCells };
}
