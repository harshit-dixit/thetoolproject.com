import { describe, expect, it } from 'vitest';
import { convertXmlToCsv, type XmlCsvOptions } from './xml-to-csv';

const options: XmlCsvOptions = { separator: 'comma', bom: false, spreadsheetSafe: true };
const convert = (xml: string, overrides: Partial<XmlCsvOptions> = {}) => convertXmlToCsv(xml, { ...options, ...overrides });

describe('XML to CSV', () => {
  it('detects repeated records and unions attributes and nested fields', () => {
    const data = convert('<orders><order id="A-1"><customer>Ana</customer><shipping><city>Delhi</city></shipping></order><order id="A-2"><customer>Bo</customer><total>12</total></order></orders>');
    expect(data.recordPath).toBe('/orders/order');
    expect(data.csv).toBe('@id,customer,shipping.city,total\r\nA-1,Ana,Delhi,\r\nA-2,Bo,,12\r\n');
    expect(data.rows).toBe(2);
  });

  it('offers nested record paths and preserves repeated leaf values', () => {
    const xml = '<root><item><name>A</name><tag>x</tag><tag>y</tag></item><item><name>B</name><tag>z</tag></item></root>';
    const parent = convert(xml);
    expect(parent.paths).toEqual(['/root', '/root/item', '/root/item/tag']);
    expect(parent.csv).toBe('name,tag\r\nA,"[""x"",""y""]"\r\nB,z\r\n');
    expect(convert(xml, { recordPath: '/root/item/tag' }).csv).toBe('Value\r\nx\r\ny\r\nz\r\n');
  });

  it('keeps a single record together when its child values repeat', () => {
    const data = convert('<orders><order id="A-1"><tag>x</tag><tag>y</tag></order></orders>');
    expect(data.recordPath).toBe('/orders/order');
    expect(data.csv).toBe('@id,tag\r\nA-1,"[""x"",""y""]"\r\n');
  });

  it('quotes CSV fields and protects formula-like text while keeping XML strings exact', () => {
    const xml = '<items><item id="001"><name> A,"B" </name><formula>=1+1</formula></item></items>';
    expect(convert(xml).csv).toBe('@id,name,formula\r\n001,"A,""B""",\'=1+1\r\n');
    expect(convert(xml, { separator: 'tab', spreadsheetSafe: false, bom: true }).csv).toBe('\uFEFF@id\tname\tformula\r\n001\t"A,""B"""\t=1+1\r\n');
  });

  it('decodes XML entities, CDATA and namespaced elements, and omits namespace declarations', () => {
    const data = convert('<r xmlns:x="urn:test"><x:row code="&amp;"><x:name><![CDATA[A & B]]></x:name></x:row></r>');
    expect(data.csv).toBe('@code,x:name\r\n&,A & B\r\n');
  });

  it('rejects malformed XML, multiple roots, undefined entities and DTDs', () => {
    for (const xml of ['<root><item></root>', '<a/><b/>', '<a>&unknown;</a>']) {
      expect(() => convert(xml)).toThrow();
    }
    expect(() => convert('<!DOCTYPE root [<!ENTITY x "hello">]><root>&x;</root>')).toThrow();
    expect(() => convert('')).toThrow();
  });
});
