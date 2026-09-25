import { SaxesParser } from 'saxes';

export type XmlJsonOptions = { attributePrefix: '@_' | '@'; alwaysArray: boolean; pretty: boolean };
export type XmlJsonError = { code: 'empty' | 'doctype' | 'invalidXml' | 'noRoot' | 'tooDeep'; line?: number; column?: number; detail?: string };
export type XmlJsonConversion = { json: string; elements: number; bytes: number };
type JsonValue = string | JsonValue[] | { [key: string]: JsonValue };
type Frame = { name: string; attributes: Record<string, string>; children: Record<string, JsonValue>; counts: Record<string, number>; content: (string | { [key: string]: JsonValue })[]; text: string };

const MAX_DEPTH = 100;
export function convertXmlToJson(source: string, options: XmlJsonOptions): XmlJsonConversion {
  if (!source.trim()) throw { code: 'empty' } satisfies XmlJsonError;
  const parser = new SaxesParser();
  const stack: Frame[] = [];
  let root: { name: string; value: JsonValue } | undefined;
  let elements = 0;
  parser.on('doctype', () => { throw { code: 'doctype' } satisfies XmlJsonError; });
  parser.on('opentag', tag => {
    if (stack.length >= MAX_DEPTH) throw { code: 'tooDeep' } satisfies XmlJsonError;
    elements++;
    stack.push({
      name: tag.name,
      attributes: Object.fromEntries(Object.entries(tag.attributes).map(([key, value]) => [key, String(value)])),
      children: Object.create(null), counts: Object.create(null), content: [], text: '',
    });
  });
  const addText = (text: string) => {
    if (!stack.length) return;
    const frame = stack[stack.length - 1];
    frame.text += text;
    const previous = frame.content.at(-1);
    if (typeof previous === 'string') frame.content[frame.content.length - 1] = previous + text;
    else frame.content.push(text);
  };
  parser.on('text', addText);
  parser.on('cdata', addText);
  parser.on('closetag', () => {
    const frame = stack.pop()!;
    const keys = Object.keys(frame.children);
    const attributes = Object.keys(frame.attributes);
    const text = frame.text.trim();
    let value: JsonValue;
    if (!keys.length && !attributes.length) value = text;
    else {
      const object: Record<string, JsonValue> = Object.create(null);
      for (const key of attributes) object[`${options.attributePrefix}${key}`] = frame.attributes[key];
      for (const key of keys) object[key] = frame.children[key];
      if (text) object['#text'] = text;
      // Mixed content needs its own ordered sequence: child keys and #text alone lose order.
      if (keys.length && frame.content.some(part => typeof part === 'string' && part.trim())) {
        object['#content'] = frame.content;
      }
      value = object;
    }
    if (!stack.length) { root = { name: frame.name, value }; return; }
    const parent = stack[stack.length - 1];
    const seen = parent.counts[frame.name] ?? 0;
    parent.counts[frame.name] = seen + 1;
    if (!seen) parent.children[frame.name] = options.alwaysArray ? [value] : value;
    else if (seen === 1 && !options.alwaysArray) parent.children[frame.name] = [parent.children[frame.name], value];
    else (parent.children[frame.name] as JsonValue[]).push(value);
    const item: Record<string, JsonValue> = Object.create(null);
    item[frame.name] = value;
    parent.content.push(item);
  });
  try { parser.write(source).close(); }
  catch (error) {
    if (error && typeof error === 'object' && 'code' in error) throw error;
    throw { code: 'invalidXml', line: parser.line, column: parser.column, detail: error instanceof Error ? error.message.replace(/^\d+:\d+:\s*/, '') : undefined } satisfies XmlJsonError;
  }
  if (!root) throw { code: 'noRoot' } satisfies XmlJsonError;
  const output: Record<string, JsonValue> = Object.create(null);
  output[root.name] = root.value;
  const json = JSON.stringify(output, null, options.pretty ? 2 : 0);
  return { json, elements, bytes: new Blob([json]).size };
}
