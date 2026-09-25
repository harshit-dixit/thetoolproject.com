import { describe, expect, it } from 'vitest';
import { convertCsvToSql, type CsvSqlOptions } from './csv-to-sql';

const base: CsvSqlOptions = { dialect: 'postgresql', delimiter: 'auto', firstRowHeaders: true, tableName: 'public.people', createTable: true, batchInsert: true, emptyAsNull: false, detectTypes: false };
const convert = (csv: string, options: Partial<CsvSqlOptions> = {}) => convertCsvToSql(csv, { ...base, ...options });

describe('CSV to SQL', () => {
  it('parses quoted delimiters, embedded newlines, doubled quotes and escaped SQL text', () => {
    const result = convert('id,name,note\r\n001,"O\'Neil, Jr.","Line 1\nLine ""2"""\r\n');
    expect(result.rows).toBe(1);
    expect(result.preview[0]).toEqual(['001', "O'Neil, Jr.", 'Line 1\nLine "2"']);
    expect(result.sql).toContain(`('001', 'O''Neil, Jr.', 'Line 1\nLine "2"')`);
  });

  it('detects semicolon and tab CSV, and assigns unique names to blank or duplicate headers', () => {
    expect(convert('name;name;\nA;B;C').headers).toEqual(['name', 'name_2', 'column_3']);
    expect(convert('a\tb\n1\t2').delimiter).toBe('tab');
  });

  it('keeps text exact by default and writes optional NULL and numeric values', () => {
    expect(convert('id,amount,active,empty\n001,2.50,true,').sql).toContain("('001', '2.50', 'true', '')");
    const typed = convert('id,amount,active,empty\n1,2.50,true,\n2,3.25,false,', { detectTypes: true, emptyAsNull: true });
    expect(typed.types).toEqual(['BIGINT', 'NUMERIC', 'BOOLEAN', 'TEXT']);
    expect(typed.sql).toContain('(1, 2.50, TRUE, NULL)');
    expect(convert('id\n001', { detectTypes: true }).types).toEqual(['TEXT']);
  });

  it('uses each database’s identifier and string quoting and respects SQL Server batch size', () => {
    expect(convert('a`b\nx', { dialect: 'mysql', tableName: 'db.t`x' }).sql).toContain('`db`.`t``x` (`a``b`)');
    expect(convert('name\nJosé', { dialect: 'sqlserver', tableName: 'dbo.people' }).sql).toContain("[dbo].[people] ([name]) VALUES\n  (N'José')");
    expect(convert('a]b\nx', { dialect: 'sqlserver' }).sql).toContain('[a]]b]');
    expect(convert('name\na\\b', { dialect: 'mysql' }).sql).toContain("'a\\\\b'");
    const many = convert('id\n' + Array.from({ length: 1001 }, (_, i) => String(i)).join('\n'), { dialect: 'sqlserver' });
    expect(many.sql.match(/INSERT INTO/g)).toHaveLength(3);
  });

  it('rejects malformed quotes and header-only input', () => {
    expect(() => convert('name\n"unfinished')).toThrow();
    expect(() => convert('name\n"okay"x')).toThrow();
    expect(() => convert('name\n')).toThrow();
    expect(() => convert('x\ny', { tableName: 'bad..name' })).toThrow();
  });
});
