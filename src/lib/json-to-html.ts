export type Layout = 'table' | 'list';
export type Output = 'fragment' | 'page';
export type ErrorCode = 'empty' | 'trailingComma' | 'singleQuote' | 'unquotedKey' | 'comment' | 'jsonLines' | 'syntax' | 'depth';
export type ConversionError = { code: ErrorCode; position: number; line: number; column: number };
export type Conversion = { html: string; previewHtml: string; rows: number; columns: number; previewRows: number; unsafeNumberFallback: boolean };

export const MAX_NESTING = 128;
export const PREVIEW_ROWS = 500;
export class LargeInteger { constructor(readonly digits: string) {} }
class TooDeep {}
export const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof LargeInteger);
const own = (record: Record<string, unknown>, key: string) => Object.hasOwn(record, key) ? record[key] : undefined;
const parseWithSource = JSON.parse as (text: string, reviver: (key: string, value: unknown, context?: { source: string }) => unknown) => unknown;
const esc = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const pad = (depth: number) => '  '.repeat(depth);
const lineAt = (source: string, position: number) => {
  const before = source.slice(0, position);
  const lines = before.split('\n');
  return { line: lines.length, column: lines.at(-1)!.length + 1 };
};
function failure(code: ErrorCode, source: string, position: number): ConversionError {
  return { code, position, ...lineAt(source, position) };
}

// Every integer outside the safe range has at least 16 digits, so most input skips the slower parse paths.
const mayHaveUnsafeInteger = (source: string) => /\d{16}/.test(source);
function scanNumbers(source: string): { start: number; end: number; value: string }[] {
  const found: { start: number; end: number; value: string }[] = [];
  const numberPattern = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
  let inString = false, escaped = false;
  for (let i = 0; i < source.length; i++) {
    const code = source.charCodeAt(i);
    if (inString) {
      if (escaped) escaped = false;
      else if (code === 92) escaped = true;
      else if (code === 34) inString = false;
      continue;
    }
    if (code === 34) { inString = true; continue; }
    if (code === 45 || (code >= 48 && code <= 57)) {
      numberPattern.lastIndex = i;
      const match = numberPattern.exec(source);
      if (match) {
        const value = match[0];
        if (/^-?(?:0|[1-9]\d*)$/.test(value) && !Number.isSafeInteger(Number(value))) found.push({ start: i, end: i + value.length, value });
        i += value.length - 1;
      }
    }
  }
  return found;
}

const hasSourceContext = (() => {
  let supported = false;
  parseWithSource('9007199254740993', (_key, _value, context) => { supported = context?.source === '9007199254740993'; });
  return supported;
})();

export function parsePreservingIntegers(source: string, useSourceContext = hasSourceContext): { value: unknown; fallback: boolean } {
  if (!mayHaveUnsafeInteger(source)) return { value: JSON.parse(source), fallback: false };
  if (useSourceContext) {
    return { value: parseWithSource(source, (_key, value, context) => {
      if (typeof value === 'number' && Number.isInteger(value) && !Number.isSafeInteger(value) && context?.source && /^-?\d+$/.test(context.source)) return new LargeInteger(context.source);
      return value;
    }), fallback: false };
  }
  const unsafe = scanNumbers(source);
  if (!unsafe.length) return { value: JSON.parse(source), fallback: false };
  let marker = '__TTP_LARGE_INTEGER__';
  while (source.includes(marker)) marker += '_';
  const values = new Map<string, string>();
  const parts: string[] = [];
  let last = 0;
  unsafe.forEach((item, i) => {
    values.set(`${marker}${i}`, item.value);
    parts.push(source.slice(last, item.start), `"${marker}${i}"`);
    last = item.end;
  });
  parts.push(source.slice(last));
  return { value: JSON.parse(parts.join(''), (_key, value) => typeof value === 'string' && values.has(value) ? new LargeInteger(values.get(value)!) : value), fallback: true };
}

// Finds the first character JSON.parse would reject. Browsers word and place their own errors differently, so we don't rely on them.
type Expected = 'value' | 'key' | 'colon' | 'commaOrClose' | 'end' | 'string';
export function findSyntaxError(source: string): { position: number; expected: Expected } | null {
  const numberPattern = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
  const stack: string[] = [];
  let i = 0;
  let mode: 'value' | 'firstValue' | 'key' | 'firstKey' | 'after' = 'value';
  const skipSpace = () => { while (i < source.length && (source[i] === ' ' || source[i] === '\t' || source[i] === '\n' || source[i] === '\r')) i++; };
  const readString = () => {
    i++;
    while (i < source.length) {
      const code = source.charCodeAt(i);
      if (code === 34) { i++; return true; }
      if (code < 32) return false;
      if (code === 92) {
        const next = source[i + 1];
        if (next === 'u') { if (!/^[0-9a-fA-F]{4}$/.test(source.slice(i + 2, i + 6))) return false; i += 6; }
        else if (next && '"\\/bfnrt'.includes(next)) i += 2;
        else return false;
        continue;
      }
      i++;
    }
    return false;
  };
  for (;;) {
    skipSpace();
    const ch = source[i];
    if (mode === 'value' || mode === 'firstValue') {
      if (mode === 'firstValue' && ch === ']') { stack.pop(); i++; mode = 'after'; continue; }
      if (ch === '{') { stack.push('{'); i++; mode = 'firstKey'; continue; }
      if (ch === '[') { stack.push('['); i++; mode = 'firstValue'; continue; }
      if (ch === '"') { if (!readString()) return { position: i, expected: 'string' }; mode = 'after'; continue; }
      const literal = ['true', 'false', 'null'].find(word => source.startsWith(word, i));
      if (literal) { i += literal.length; mode = 'after'; continue; }
      numberPattern.lastIndex = i;
      const number = numberPattern.exec(source);
      if (number) { i += number[0].length; mode = 'after'; continue; }
      return { position: i, expected: 'value' };
    }
    if (mode === 'key' || mode === 'firstKey') {
      if (mode === 'firstKey' && ch === '}') { stack.pop(); i++; mode = 'after'; continue; }
      if (ch !== '"') return { position: i, expected: 'key' };
      if (!readString()) return { position: i, expected: 'string' };
      skipSpace();
      if (source[i] !== ':') return { position: i, expected: 'colon' };
      i++; mode = 'value'; continue;
    }
    if (!stack.length) return i < source.length ? { position: i, expected: 'end' } : null;
    const open = stack.at(-1);
    if (ch === ',') { i++; mode = open === '{' ? 'key' : 'value'; continue; }
    if ((ch === '}' && open === '{') || (ch === ']' && open === '[')) { stack.pop(); i++; continue; }
    return { position: i, expected: 'commaOrClose' };
  }
}

function isJsonLines(source: string): boolean {
  const lines = source.split('\n').map(line => line.trim()).filter(Boolean);
  if (lines.length < 2) return false;
  try { lines.forEach(line => JSON.parse(line)); return true; }
  catch { return false; }
}
export function wrapJsonLines(source: string): string {
  return `[\n${source.split('\n').filter(line => line.trim()).map(line => `  ${line.trim()}`).join(',\n')}\n]`;
}
export function diagnose(source: string): ConversionError {
  if (!source.trim()) return failure('empty', source, 0);
  const found = findSyntaxError(source);
  if (!found) return failure('syntax', source, source.length);
  const { position, expected } = found;
  const ch = source[position];
  if (ch === '/' && (source[position + 1] === '/' || source[position + 1] === '*')) return failure('comment', source, position);
  if (ch === "'" && expected !== 'string') return failure('singleQuote', source, position);
  if (expected === 'key' && /[A-Za-z_$]/.test(ch ?? '')) return failure('unquotedKey', source, position);
  if ((expected === 'key' || expected === 'value') && (ch === '}' || ch === ']')) {
    let before = position - 1;
    while (before >= 0 && /\s/.test(source[before])) before--;
    if (source[before] === ',') return failure('trailingComma', source, before);
  }
  if (expected === 'end' && isJsonLines(source)) return failure('jsonLines', source, position);
  return failure('syntax', source, position);
}

function primitive(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof LargeInteger) return esc(value.digits);
  return esc(String(value));
}
// `level` counts JSON nesting; `depth` counts indentation, which grows faster in table layout.
function child(value: unknown, depth: number, level: number, layout: Layout): string[] {
  if (value === null || value === undefined || (Array.isArray(value) && !value.length) || (isRecord(value) && !Object.keys(value).length)) return [];
  if (level > MAX_NESTING && (Array.isArray(value) || isRecord(value))) throw new TooDeep();
  if (Array.isArray(value)) return layout === 'list' || !value.every(isRecord) ? listArray(value, depth, level) : tableArray(value, depth, level);
  if (isRecord(value)) return layout === 'list' ? listObject(value, depth, level) : tableObject(value, depth, level);
  return [pad(depth) + primitive(value)];
}
function cell(tag: string, nested: string[], depth: number): string[] {
  if (nested.length === 1 && !nested[0].trim().startsWith('<')) return [pad(depth) + `<${tag}>${nested[0].trim()}</${tag}>`];
  if (!nested.length) return [pad(depth) + `<${tag}></${tag}>`];
  return [pad(depth) + `<${tag}>`, ...nested, pad(depth) + `</${tag}>`];
}
function tableObject(value: Record<string, unknown>, depth: number, level: number): string[] {
  const out = [pad(depth) + '<table>', pad(depth + 1) + '<tbody>'];
  for (const [key, item] of Object.entries(value)) {
    out.push(pad(depth + 2) + '<tr>', pad(depth + 3) + `<th scope="row">${esc(key)}</th>`);
    out.push(...cell('td', child(item, depth + 4, level + 1, 'table'), depth + 3));
    out.push(pad(depth + 2) + '</tr>');
  }
  out.push(pad(depth + 1) + '</tbody>', pad(depth) + '</table>');
  return out;
}
function tableArray(value: Record<string, unknown>[], depth: number, level: number): string[] {
  const columns = [...new Set(value.flatMap(row => Object.keys(row)))];
  const out = [pad(depth) + '<table>', pad(depth + 1) + '<thead>', pad(depth + 2) + '<tr>'];
  columns.forEach(key => out.push(pad(depth + 3) + `<th scope="col">${esc(key)}</th>`));
  out.push(pad(depth + 2) + '</tr>', pad(depth + 1) + '</thead>', pad(depth + 1) + '<tbody>');
  for (const row of value) {
    out.push(pad(depth + 2) + '<tr>');
    for (const key of columns) out.push(...cell('td', child(own(row, key), depth + 4, level + 2, 'table'), depth + 3));
    out.push(pad(depth + 2) + '</tr>');
  }
  out.push(pad(depth + 1) + '</tbody>', pad(depth) + '</table>');
  return out;
}
function listObject(value: Record<string, unknown>, depth: number, level: number): string[] {
  const out = [pad(depth) + '<dl>'];
  for (const [key, item] of Object.entries(value)) {
    out.push(pad(depth + 1) + `<dt>${esc(key)}</dt>`);
    out.push(...cell('dd', child(item, depth + 2, level + 1, 'list'), depth + 1));
  }
  out.push(pad(depth) + '</dl>');
  return out;
}
function listArray(value: unknown[], depth: number, level: number): string[] {
  const out = [pad(depth) + '<ul>'];
  for (const item of value) out.push(...cell('li', child(item, depth + 2, level + 1, 'list'), depth + 1));
  out.push(pad(depth) + '</ul>');
  return out;
}
function fragment(value: unknown, layout: Layout): string {
  if (layout === 'list') return (Array.isArray(value) ? listArray(value, 0, 1) : isRecord(value) ? listObject(value, 0, 1) : [`<ul>`, `  <li>${primitive(value)}</li>`, `</ul>`]).join('\n');
  if (Array.isArray(value) && value.length && value.every(isRecord)) return tableArray(value, 0, 1).join('\n');
  if (isRecord(value)) return tableObject(value, 0, 1).join('\n');
  if (Array.isArray(value)) {
    const lines = ['<table>', '  <tbody>'];
    for (const item of value) lines.push('    <tr>', ...cell('td', child(item, 4, 2, 'table'), 3), '    </tr>');
    lines.push('  </tbody>', '</table>');
    return lines.join('\n');
  }
  return `<table>\n  <tbody>\n    <tr><td>${primitive(value)}</td></tr>\n  </tbody>\n</table>`;
}
function wrapPage(html: string): string {
  return ['<!doctype html>', '<html lang="en">', '<head>', '  <meta charset="utf-8">', '  <meta name="viewport" content="width=device-width, initial-scale=1">', '  <title>Converted JSON</title>', '  <style>', '    body { font: 16px/1.5 system-ui, sans-serif; margin: 24px; }', '    table { border-collapse: collapse; }', '    th, td { border: 1px solid #999; padding: 8px; vertical-align: top; text-align: start; }', '    dl { margin: 0; }', '    dt { font-weight: 700; }', '    dd { margin-inline-start: 20px; }', '  </style>', '</head>', '<body>', ...html.split('\n').map(line => '  ' + line), '</body>', '</html>'].join('\n');
}
function previewOf(value: unknown): unknown {
  if (Array.isArray(value)) return value.length > PREVIEW_ROWS ? value.slice(0, PREVIEW_ROWS) : value;
  if (isRecord(value)) {
    const entries = Object.entries(value);
    return entries.length > PREVIEW_ROWS ? Object.fromEntries(entries.slice(0, PREVIEW_ROWS)) : value;
  }
  return value;
}
export function convertJson(source: string, layout: Layout = 'table', output: Output = 'fragment'): Conversion {
  if (!source.trim()) throw diagnose(source);
  let parsed: { value: unknown; fallback: boolean };
  try { parsed = parsePreservingIntegers(source); }
  catch { throw diagnose(source); }
  const value = parsed.value;
  const rows = Array.isArray(value) ? value.length : isRecord(value) ? Object.keys(value).length : 1;
  const columns = Array.isArray(value) && value.every(isRecord) ? new Set(value.flatMap(row => Object.keys(row))).size : isRecord(value) ? 2 : 1;
  try {
    const htmlFragment = fragment(value, layout);
    const previewValue = previewOf(value);
    const previewFragment = previewValue === value ? htmlFragment : fragment(previewValue, layout);
    return { html: output === 'page' ? wrapPage(htmlFragment) : htmlFragment, previewHtml: wrapPage(previewFragment), rows, columns, previewRows: Math.min(rows, PREVIEW_ROWS), unsafeNumberFallback: parsed.fallback };
  } catch (error) {
    if (error instanceof TooDeep || error instanceof RangeError) throw failure('depth', source, 0);
    throw error;
  }
}
