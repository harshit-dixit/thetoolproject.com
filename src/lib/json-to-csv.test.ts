import { describe, expect, it } from 'vitest';
import { convertJsonToCsv, type CsvOptions } from './json-to-csv';

const options: CsvOptions = { separator: 'comma', bom: false, spreadsheetSafe: true };
const convert = (source: string, overrides: Partial<CsvOptions> = {}) => convertJsonToCsv(source, { ...options, ...overrides });

describe('JSON to CSV', () => {
  it('unions fields, flattens nested objects and retains arrays as JSON', () => {
    const result = convert('[{"name":"Asha","shipping":{"city":"Delhi"},"tags":["a","b"]},{"name":"Luis","age":31}]');
    expect(result.csv).toBe('name,shipping.city,tags,age\r\nAsha,Delhi,"[""a"",""b""]",\r\nLuis,,,31\r\n');
    expect(result.rows).toBe(2);
    expect(result.columns).toBe(4);
  });

  it('quotes separators, quotes and newlines with CRLF records', () => {
    expect(convert('[{"a":"x,y","b":"a\\\"b","c":"two\\nlines"}]').csv).toBe('a,b,c\r\n"x,y","a""b","two\nlines"\r\n');
  });

  it('supports a named record list, arrays of arrays, JSON Lines, and TSV', () => {
    expect(convert('{"people":[{"name":"Asha"},{"name":"Luis"}]}').csv).toBe('name\r\nAsha\r\nLuis\r\n');
    expect(convert('[[1,2],[3,4]]').csv).toBe('1,2\r\n3,4\r\n');
    expect(convert('{"a":1}\n{"a":2}', { separator: 'tab' }).csv).toBe('a\r\n1\r\n2\r\n');
    expect(convert('{"a":1}\n{"a":2}').jsonLines).toBe(true);
  });

  it('protects formula-like text and header names, with a raw opt-out', () => {
    const source = '[{"=key":" =SUM(1,2)","negative":-4,"text":"-1+2"}]';
    const safe = convert(source);
    expect(safe.csv).toBe("'=key,negative,text\r\n\"' =SUM(1,2)\",-4,'-1+2\r\n");
    expect(safe.protectedCells).toBe(3);
    expect(convert(source, { spreadsheetSafe: false }).csv).toBe('=key,negative,text\r\n" =SUM(1,2)",-4,-1+2\r\n');
  });

  it('preserves large integer digits and supports BOM', () => {
    expect(convert('[{"id":9007199254740993}]', { bom: true }).csv).toBe('\uFEFFid\r\n9007199254740993\r\n');
  });

  it('reports invalid JSON and empty input', () => {
    expect(() => convert('{"a":1,}')).toThrow();
    expect(() => convert('[]')).toThrow();
  });
});
