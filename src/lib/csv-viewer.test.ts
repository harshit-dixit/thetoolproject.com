import { describe, expect, it } from 'vitest';
import { decodeCsv, parseCsv, serializeCsv, CsvViewerError } from './csv-viewer';

describe('CSV viewer parsing', () => {
  it('detects semicolons outside quoted fields and preserves multiline values', () => {
    const table = parseCsv('name;note\r\nAda;"one; two"\r\nGrace;"line 1\nline 2"\r\n');
    expect(table.separator).toBe('semicolon');
    expect(table.rows).toEqual([['Ada', 'one; two'], ['Grace', 'line 1\nline 2']]);
  });
  it('names blank and duplicate headers and counts irregular rows', () => {
    const table = parseCsv('id,id,\n1,2\n3,4,5,6');
    expect(table.headers).toEqual(['id', 'id (2)', 'Column 3', 'Column 4']);
    expect(table.irregularRows).toBe(2);
    expect(table.irregularIndices).toEqual([0, 1]);
    expect(table.rows[0]).toEqual(['1', '2', '', '']);
  });
  it('round trips escaping and keeps leading zeros', () => {
    const source = 'code,note\n001,"a,""b"""';
    const table = parseCsv(source);
    expect(parseCsv(serializeCsv(table.headers, table.rows, ','))).toMatchObject({ rows: table.rows });
  });
  it('reports an unclosed quote with its record number', () => {
    try { parseCsv('name\n"bad'); throw new Error('Expected an invalid CSV error'); }
    catch (error) { expect(error).toBeInstanceOf(CsvViewerError); expect(error).toMatchObject({ code: 'invalid', row: 2 }); }
  });
  it('detects Windows-1252 and UTF-16 files', () => {
    expect(decodeCsv(Uint8Array.from([0x63, 0x61, 0x66, 0xe9]).buffer)).toEqual({ text: 'café', encoding: 'windows-1252' });
    expect(decodeCsv(Uint8Array.from([0xff, 0xfe, 0x61, 0, 0x2c, 0, 0x62, 0]).buffer)).toEqual({ text: 'a,b', encoding: 'utf-16le' });
  });
});
