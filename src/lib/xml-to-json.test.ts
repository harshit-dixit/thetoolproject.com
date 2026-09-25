import { describe, expect, it } from 'vitest';
import { convertXmlToJson, type XmlJsonOptions } from './xml-to-json';

const defaults: XmlJsonOptions = { attributePrefix: '@_', alwaysArray: false, pretty: true };
const convert = (xml: string, overrides: Partial<XmlJsonOptions> = {}) => JSON.parse(convertXmlToJson(xml, { ...defaults, ...overrides }).json);

describe('XML to JSON', () => {
  it('keeps the root, attributes, repeated elements, entities and CDATA', () => {
    expect(convert('<orders><order id="001"><name>A &amp; B</name><tag>x</tag><tag><![CDATA[y & z]]></tag></order></orders>')).toEqual({ orders: { order: { '@_id': '001', name: 'A & B', tag: ['x', 'y & z'] } } });
  });

  it('supports stable arrays and alternate attribute prefixes', () => {
    expect(convert('<r><item id="1"/><item id="2"/></r>', { attributePrefix: '@', alwaysArray: true })).toEqual({ r: { item: [{ '@id': '1' }, { '@id': '2' }] } });
    expect(convert('<r><item>one</item></r>', { alwaysArray: true })).toEqual({ r: { item: ['one'] } });
  });

  it('preserves ordered mixed content', () => {
    expect(convert('<p>Hello <b>world</b> again</p>')).toEqual({ p: { b: 'world', '#text': 'Hello  again', '#content': ['Hello ', { b: 'world' }, ' again'] } });
  });

  it('handles empty elements and prototype-looking names', () => {
    expect(convert('<root><empty/><__proto__>safe</__proto__><constructor>x</constructor></root>')).toEqual(JSON.parse('{"root":{"empty":"","__proto__":"safe","constructor":"x"}}'));
  });

  it('rejects DTDs and malformed XML', () => {
    expect(() => convert('<!DOCTYPE r [<!ENTITY x "hello">]><r>&x;</r>')).toThrow();
    expect(() => convert('<r><a></r>')).toThrow();
    expect(() => convert('<a/><b/>')).toThrow();
  });

  it('can produce compact JSON', () => {
    expect(convertXmlToJson('<r><a>1</a></r>', { ...defaults, pretty: false }).json).toBe('{"r":{"a":"1"}}');
  });
});
