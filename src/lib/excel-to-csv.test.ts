import { describe, expect, it } from 'vitest';
import { utils, write, type CellObject, type WorkBook } from 'xlsx';
import { openWorkbook, describeWorkbook, sheetToCsv, csvFileNames, cellText, quote, plainNumber } from './excel-to-csv';
import { createZip, crc32 } from './zip';

type Cells = (CellObject | string | number | boolean | null)[][];
const toCell = (value: Cells[number][number]): CellObject | undefined =>
  value === null ? undefined : typeof value === 'object' ? value : typeof value === 'string' ? { t: 's', v: value } : typeof value === 'number' ? { t: 'n', v: value } : { t: 'b', v: value };

function build(sheets: Record<string, Cells>, hidden: string[] = []): WorkBook {
  const workbook = utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    const sheet = utils.aoa_to_sheet([]);
    rows.forEach((row, r) => row.forEach((value, c) => { const cell = toCell(value); if (cell) sheet[utils.encode_cell({ r, c })] = cell; }));
    sheet['!ref'] = utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(rows.length - 1, 0), c: Math.max(0, ...rows.map(row => row.length - 1)) } });
    utils.book_append_sheet(workbook, sheet, name);
  }
  workbook.Workbook = { Sheets: workbook.SheetNames.map(name => ({ name, Hidden: hidden.includes(name) ? 1 : 0 })) };
  return workbook;
}
const roundTrip = (workbook: WorkBook, bookType: 'xlsx' | 'xls' | 'ods' | 'xlsb' = 'xlsx') => openWorkbook(write(workbook, { type: 'array', bookType }) as ArrayBuffer);
// Tests read a real file back, so cells look the way they do after a user opens a workbook.
const book = (sheets: Record<string, Cells>, hidden: string[] = []) => roundTrip(build(sheets, hidden));
const csvOf = (workbook: WorkBook, sheet = workbook.SheetNames[0], separator: 'comma' | 'semicolon' | 'tab' = 'comma', numbers: 'formatted' | 'plain' = 'formatted') => sheetToCsv(workbook, sheet, { separator, numbers });

describe('reading workbooks', () => {
  for (const bookType of ['xlsx', 'xls', 'ods', 'xlsb'] as const) {
    it(`reads ${bookType}`, () => {
      const result = csvOf(roundTrip(build({ Orders: [['Order', 'Total'], ['A-1', 12.5], ['A-2', 7]] }), bookType));
      expect(result.csv).toBe('Order,Total\r\nA-1,12.5\r\nA-2,7\r\n');
      expect(result.rows).toBe(3);
      expect(result.columns).toBe(2);
    });
  }

  it('lists sheets with their size and hidden state', () => {
    const workbook = book({ Visible: [['a', 'b', 'c']], Secret: [['x'], ['y']] }, ['Secret']);
    expect(describeWorkbook(workbook)).toEqual([
      { name: 'Visible', hidden: false, rows: 1, columns: 3 },
      { name: 'Secret', hidden: true, rows: 2, columns: 1 },
    ]);
  });

  it('rejects files that are not spreadsheets', () => {
    expect(() => openWorkbook(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5]))).toThrow();
    try { openWorkbook(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5])); } catch (error) { expect(error).toEqual({ code: 'unreadable' }); }
  });

  it('reports password-protected workbooks', async () => {
    // Excel saves an encrypted .xlsx as a CFB container with EncryptionInfo and EncryptedPackage streams.
    const { CFB } = await import('xlsx');
    const container = CFB.utils.cfb_new();
    CFB.utils.cfb_add(container, '/EncryptionInfo', new Uint8Array([4, 0, 4, 0, 0x40, 0, 0, 0]));
    CFB.utils.cfb_add(container, '/EncryptedPackage', new Uint8Array(64));
    const bytes = CFB.write(container, { type: 'array' }) as Uint8Array;
    let caught: unknown;
    try { openWorkbook(bytes); } catch (error) { caught = error; }
    expect(caught).toEqual({ code: 'passwordProtected' });
  });
});

describe('CSV output', () => {
  it('quotes separators, quotes and line breaks', () => {
    const workbook = book({ S: [['a,b', 'say "hi"', 'two\nlines', 'plain']] });
    expect(csvOf(workbook).csv).toBe('"a,b","say ""hi""","two\nlines",plain\r\n');
    expect(csvOf(workbook, 'S', 'semicolon').csv).toBe('a,b;"say ""hi""";"two\nlines";plain\r\n');
    expect(csvOf(workbook, 'S', 'tab').csv).toBe('a,b\t"say ""hi"""\t"two\nlines"\tplain\r\n');
  });

  it('keeps empty cells and rows inside the data, and trims empty ones at the end', () => {
    const workbook = book({ S: [['a', null, 'c'], [], ['x'], [null, null], [{ t: 's', v: '' }]] });
    expect(csvOf(workbook).csv).toBe('a,,c\r\n,,\r\nx,,\r\n');
  });

  it('gives every row the same number of fields', () => {
    const lines = csvOf(book({ S: [['a'], ['a', 'b', 'c'], ['a', 'b']] })).csv.trim().split('\r\n');
    expect(lines.map(line => line.split(',').length)).toEqual([3, 3, 3]);
  });

  it('keeps Unicode and emoji text', () => {
    const workbook = book({ S: [['Zoë', '東京', '😀', 'Ünïcödé']] });
    expect(csvOf(workbook).csv).toBe('Zoë,東京,😀,Ünïcödé\r\n');
  });

  it('returns an empty CSV for an empty sheet', () => {
    const result = csvOf(book({ Empty: [], Data: [['x']] }), 'Empty');
    expect(result).toMatchObject({ csv: '', rows: 0, columns: 0 });
  });

  it('writes formula results, not formulas', () => {
    const workbook = book({ S: [[2, 3, { t: 'n', v: 5, f: 'A1+B1' }]] });
    expect(csvOf(workbook).csv).toBe('2,3,5\r\n');
  });

  it('caps the preview but not the CSV', () => {
    const rows = Array.from({ length: 150 }, (_, i) => Array.from({ length: 40 }, (_, c) => `${i}-${c}`));
    const result = csvOf(book({ S: rows }));
    expect(result.preview).toHaveLength(100);
    expect(result.preview[0]).toHaveLength(30);
    expect(result.previewText.split('\r\n')).toHaveLength(100);
    expect(result.csv.trim().split('\r\n')).toHaveLength(150);
  });
});

describe('cell values', () => {
  it('writes dates as ISO 8601', () => {
    const workbook = book({ S: [[
      { t: 'n', v: 45306, z: 'm/d/yy' },
      { t: 'n', v: 45306.5, z: 'm/d/yyyy h:mm' },
      { t: 'n', v: 0.75, z: 'h:mm AM/PM' },
      { t: 'n', v: 45306, z: 'dddd, mmmm d, yyyy' },
      { t: 'n', v: 45306, z: '[$-409]mmm-yy' },
      { t: 'n', v: 1.5, z: '[h]:mm' },
    ]] });
    expect(csvOf(workbook).csv).toBe('2024-01-15,2024-01-15 12:00:00,18:00:00,2024-01-15,2024-01-15,36:00\r\n');
  });

  it('writes dates as ISO 8601 in plain number mode too', () => {
    expect(cellText({ t: 'n', v: 45306, z: 'yyyy-mm-dd' }, 'plain')).toBe('2024-01-15');
  });

  it('handles the 1904 date system', () => {
    expect(cellText({ t: 'n', v: 43844, z: 'm/d/yy' }, 'formatted', true)).toBe('2024-01-15');
  });

  it('keeps number formats in formatted mode', () => {
    expect(cellText({ t: 'n', v: 1234.5, z: '$#,##0.00', w: '$1,234.50' }, 'formatted')).toBe('$1,234.50');
    expect(cellText({ t: 'n', v: 0.125, z: '0.0%', w: '12.5%' }, 'formatted')).toBe('12.5%');
    expect(cellText({ t: 'n', v: 2134, z: '00000', w: '02134' }, 'formatted')).toBe('02134');
  });

  it('drops number formats in plain mode', () => {
    expect(cellText({ t: 'n', v: 1234.5, z: '$#,##0.00', w: '$1,234.50' }, 'plain')).toBe('1234.5');
    expect(cellText({ t: 'n', v: 0.125, z: '0.0%', w: '12.5%' }, 'plain')).toBe('0.125');
  });

  it('keeps 15 significant digits for General numbers instead of the rounded display text', () => {
    expect(cellText({ t: 'n', v: 3.14159265358979, z: 'General', w: '3.141592654' }, 'formatted')).toBe('3.14159265358979');
    expect(cellText({ t: 'n', v: 0.1 + 0.2 }, 'formatted')).toBe('0.3');
    expect(plainNumber(123456789012345)).toBe('123456789012345');
  });

  it('writes booleans, errors and text', () => {
    expect(cellText({ t: 'b', v: true }, 'formatted')).toBe('TRUE');
    expect(cellText({ t: 'b', v: false }, 'formatted')).toBe('FALSE');
    expect(cellText({ t: 'e', v: 7, w: '#DIV/0!' }, 'formatted')).toBe('#DIV/0!');
    expect(cellText({ t: 's', v: '007' }, 'plain')).toBe('007');
    expect(cellText(undefined, 'formatted')).toBe('');
  });

  it('only quotes fields that need it', () => {
    expect(quote('plain', ',')).toBe('plain');
    expect(quote('a;b', ',')).toBe('a;b');
    expect(quote('a;b', ';')).toBe('"a;b"');
    expect(quote('line\r\nbreak', '\t')).toBe('"line\r\nbreak"');
  });
});

describe('file names', () => {
  it('makes sheet names safe and unique', () => {
    expect(csvFileNames(['Q1/Q2', 'Sales', 'sales', '  .. ', 'a:b*c?', 'CON'], 'csv')).toEqual(['Q1-Q2.csv', 'Sales.csv', 'sales (2).csv', 'Sheet.csv', 'a-b-c-.csv', 'CON-Sheet.csv']);
    expect(csvFileNames(['Data'], 'tsv')).toEqual(['Data.tsv']);
  });
});

describe('ZIP', () => {
  it('computes CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('writes a ZIP that SheetJS can read back', async () => {
    const { CFB } = await import('xlsx');
    const zip = createZip([{ name: 'Säles.csv', data: new TextEncoder().encode('a,b\r\n') }, { name: 'Two.csv', data: new Uint8Array() }]);
    const archive = CFB.read(zip, { type: 'array' });
    // CFB reads names as Latin-1 and ignores the UTF-8 flag, so decode them again here.
    const names = archive.FullPaths.filter((path: string) => path.endsWith('.csv')).map((path: string) => Buffer.from(path.split('/').pop()!, 'latin1').toString('utf8'));
    expect(names).toEqual(['Säles.csv', 'Two.csv']);
    expect(new TextDecoder().decode(archive.FileIndex.find((file: { name: string }) => file.name.endsWith('les.csv'))!.content as Uint8Array)).toBe('a,b\r\n');
    expect(zip[7] & 0x08).toBe(0x08);
  });
});
