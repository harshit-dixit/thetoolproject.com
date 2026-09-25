import { LargeInteger, diagnose, isRecord, parsePreservingIntegers, type ConversionError } from './json-to-html';

export type JsonIndent = 2 | 4 | 'tab' | 'compact';
export type JsonBeautifierError = ConversionError;
export type JsonBeautifierResult = { json: string; bytes: number };

// Keep unsafe integer tokens as numbers. JSON.stringify would round them or quote them.
function serialize(value: unknown, indent: string, level = 0): string {
  if (value instanceof LargeInteger) return value.digits;
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    const items = value.map(item => serialize(item, indent, level + 1));
    if (!indent) return `[${items.join(',')}]`;
    const pad = indent.repeat(level + 1);
    return `[\n${items.map(item => pad + item).join(',\n')}\n${indent.repeat(level)}]`;
  }
  if (isRecord(value)) {
    const entries = Object.entries(value);
    if (!entries.length) return '{}';
    const items = entries.map(([key, item]) => `${JSON.stringify(key)}:${indent ? ' ' : ''}${serialize(item, indent, level + 1)}`);
    if (!indent) return `{${items.join(',')}}`;
    const pad = indent.repeat(level + 1);
    return `{\n${items.map(item => pad + item).join(',\n')}\n${indent.repeat(level)}}`;
  }
  return JSON.stringify(value);
}

export function beautifyJson(source: string, spacing: JsonIndent = 2): JsonBeautifierResult {
  if (!source.trim()) throw diagnose(source);
  if (![2, 4, 'tab', 'compact'].includes(spacing)) throw new RangeError('Unsupported JSON indentation');
  let value: unknown;
  try { value = parsePreservingIntegers(source).value; }
  catch { throw diagnose(source); }
  const indent = spacing === 'tab' ? '\t' : spacing === 'compact' ? '' : ' '.repeat(spacing);
  const json = serialize(value, indent);
  return { json, bytes: new TextEncoder().encode(json).length };
}
