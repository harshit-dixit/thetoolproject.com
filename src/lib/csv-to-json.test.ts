import { describe, expect, it } from 'vitest';
import { convertCsvToJson, type CsvJsonOptions } from './csv-to-json';

const defaults: CsvJsonOptions = { separator: 'auto', firstRowHeaders: true, detectTypes: false, emptyAsNull: false, format: 'pretty' };

describe('convertCsvToJson', () => {
  it('preserves quoted fields, line breaks, leading zeros and Unicode', () => {
    const result = convertCsvToJson('id,name,note\r\n001,"Grace, Jr.","line 1\nline 2"\r\n002,"Zoë ""Z""",ok', defaults);
    expect(JSON.parse(result.json)).toEqual([
      { id: '001', name: 'Grace, Jr.', note: 'line 1\nline 2' },
      { id: '002', name: 'Zoë "Z"', note: 'ok' },
    ]);
    expect(result.rows).toBe(2);
    expect(result.separator).toBe('comma');
  });

  it('names blank and duplicate columns and reports uneven rows', () => {
    const result = convertCsvToJson('name,name,\nAda,1\nBob,2,x,extra', defaults);
    expect(result.headers).toEqual(['name', 'name (2)', 'Column 3', 'Column 4']);
    expect(result.renamedHeaders).toBe(3);
    expect(result.irregularRows).toBe(2);
    expect(JSON.parse(result.json)[1]).toEqual({ name: 'Bob', 'name (2)': '2', 'Column 3': 'x', 'Column 4': 'extra' });
  });

  it('converts conservative values only when requested', () => {
    const result = convertCsvToJson('id,count,active,empty,big,decimal\n001,42,TRUE,,9007199254740993,19.5', { ...defaults, detectTypes: true, emptyAsNull: true });
    expect(JSON.parse(result.json)[0]).toEqual({ id: '001', count: 42, active: true, empty: null, big: '9007199254740993', decimal: 19.5 });
  });

  it('supports no headers, tabs and JSON Lines', () => {
    const result = convertCsvToJson('A\t1\nB\t2', { ...defaults, firstRowHeaders: false, format: 'lines' });
    expect(result.separator).toBe('tab');
    expect(result.json.split('\n').map(line => JSON.parse(line))).toEqual([{ 'Column 1': 'A', 'Column 2': '1' }, { 'Column 1': 'B', 'Column 2': '2' }]);
  });

  it('keeps special property names as data', () => {
    const result = convertCsvToJson('__proto__,constructor\na,b', defaults);
    const record = JSON.parse(result.json)[0];
    expect(record.__proto__).toBe('a');
    expect(record.constructor).toBe('b');
  });
});
