import { describe, expect, it } from 'vitest';
import { read, utils, type WorkBook } from 'xlsx';
import { MAX_CELL, convertJsonToExcel, parseDate, sheetNames, type ExcelOptions } from './json-to-excel';

const options: ExcelOptions = { nested: 'sheets', rootName: 'Sheet1', valueHeader: 'Value' };
const convert = (source: unknown, extra: Partial<ExcelOptions> = {}) => convertJsonToExcel(typeof source === 'string' ? source : JSON.stringify(source), { ...options, ...extra });
// Tests read the written file back, so cells look the way they do after a user opens the workbook.
const open = (source: unknown, extra: Partial<ExcelOptions> = {}) => {
  const result = convert(source, extra);
  return { result, book: read(result.xlsx, { type: 'array', cellNF: true }) };
};
const rows = (book: WorkBook, sheet = book.SheetNames[0]) => utils.sheet_to_json<unknown[]>(book.Sheets[sheet], { header: 1, raw: true, defval: null });
const cell = (book: WorkBook, ref: string, sheet = book.SheetNames[0]) => book.Sheets[sheet][ref];

describe('JSON to Excel', () => {
  it('writes an array of objects as one row per object with the union of keys in first-seen order', () => {
    const { book, result } = open([{ b: 1, c: 'x' }, { a: 2, b: 3 }]);
    expect(book.SheetNames).toEqual(['Sheet1']);
    expect(rows(book)).toEqual([['b', 'c', 'a'], [1, 'x', null], [3, null, 2]]);
    expect(result.sheets[0]).toMatchObject({ name: 'Sheet1', rows: 2, columns: 3 });
    expect(book.Sheets.Sheet1['!autofilter']?.ref).toBe('A1:C3');
  });
  it('keeps value types: numbers, booleans, text and empty cells for null', () => {
    const { book } = open([{ n: 12.5, t: true, f: false, s: '00123', z: null, e: '=1+1' }]);
    expect(cell(book, 'A2')).toMatchObject({ t: 'n', v: 12.5 });
    expect(cell(book, 'B2')).toMatchObject({ t: 'b', v: true });
    expect(cell(book, 'C2')).toMatchObject({ t: 'b', v: false });
    expect(cell(book, 'D2')).toMatchObject({ t: 's', v: '00123' });
    expect(cell(book, 'E2')).toBeUndefined();
    // Text that looks like a formula stays text.
    expect(cell(book, 'F2')).toMatchObject({ t: 's', v: '=1+1' });
    expect(cell(book, 'F2').f).toBeUndefined();
  });
  it('flattens nested objects into dot-notation columns', () => {
    const { book } = open([{ id: 1, shipping: { city: 'Austin', address: { zip: '78701' } } }]);
    expect(rows(book)).toEqual([['id', 'shipping.city', 'shipping.address.zip'], [1, 'Austin', '78701']]);
  });
  it('keeps a key containing a dot apart from a nested key with the same header', () => {
    const { book } = open([{ 'a.b': 1, a: { b: 2 } }]);
    expect(rows(book)).toEqual([['a.b', 'a.b'], [1, 2]]);
  });
  it('joins arrays of simple values into one cell and keeps lists of lists as JSON', () => {
    const { book } = open([{ tags: ['red', 'blue'], nums: [1, null, 2], grid: [[1, 2], [3, 4]], none: [] }]);
    expect(rows(book)).toEqual([['tags', 'nums', 'grid'], ['red, blue', '1, , 2', '[[1,2],[3,4]]']]);
  });
  it('puts nested lists of objects on their own sheets, linked by row number', () => {
    const { book, result } = open([
      { order: 'A-1', items: [{ sku: 'P1', qty: 2, options: [{ color: 'red' }] }, { sku: 'P2', qty: 1 }] },
      { order: 'A-2', items: [{ sku: 'P3', qty: 5 }] },
    ]);
    expect(book.SheetNames).toEqual(['Sheet1', 'items', 'items.options']);
    expect(rows(book, 'Sheet1')).toEqual([['#', 'order'], [1, 'A-1'], [2, 'A-2']]);
    expect(rows(book, 'items')).toEqual([['Sheet1 #', '#', 'sku', 'qty'], [1, 1, 'P1', 2], [1, 2, 'P2', 1], [2, 3, 'P3', 5]]);
    expect(rows(book, 'items.options')).toEqual([['items #', 'color'], [1, 'red']]);
    expect(result.sheets.map(sheet => sheet.rows)).toEqual([2, 3, 1]);
  });
  it('spreads nested lists across numbered columns when asked', () => {
    const { book } = open([{ order: 'A-1', items: [{ sku: 'P1' }, { sku: 'P2', qty: 1 }] }, { order: 'A-2', items: [{ sku: 'P3' }] }], { nested: 'columns' });
    expect(book.SheetNames).toEqual(['Sheet1']);
    expect(rows(book)).toEqual([['order', 'items.1.sku', 'items.2.sku', 'items.2.qty'], ['A-1', 'P1', 'P2', 1], ['A-2', 'P3', null, null]]);
  });
  it('writes a root object as one row, and its lists of objects as sheets without a link column', () => {
    const { book } = open({ total: 2, page: { next: null }, users: [{ name: 'Ada' }, { name: 'Lin' }] });
    expect(book.SheetNames).toEqual(['Sheet1', 'users']);
    expect(rows(book, 'Sheet1')).toEqual([['total', 'page.next'], [2, null]]);
    expect(rows(book, 'users')).toEqual([['name'], ['Ada'], ['Lin']]);
  });
  it('drops the empty first sheet when a root object only holds lists', () => {
    const { book } = open({ users: [{ name: 'Ada' }] });
    expect(book.SheetNames).toEqual(['users']);
  });
  it('writes simple values and mixed arrays into a Value column', () => {
    expect(rows(open([1, 'two', true]).book)).toEqual([['Value'], [1], ['two'], [true]]);
    expect(rows(open('42').book)).toEqual([['Value'], [42]]);
    expect(rows(open([{ a: 1 }, 5]).book)).toEqual([['a', 'Value'], [1, null], [null, 5]]);
  });
  it('writes an array of arrays as rows without adding a header', () => {
    const { book } = open([['name', 'age'], ['Ada', 36], ['Lin', null, { x: 1 }]]);
    expect(rows(book)).toEqual([['name', 'age', null], ['Ada', 36, null], ['Lin', null, '{"x":1}']]);
    expect(book.Sheets.Sheet1['!autofilter']).toBeUndefined();
  });
  it('turns ISO dates into Excel dates and leaves times with an offset as text', () => {
    const { book } = open([{ d: '2024-01-15', dt: '2024-01-15T14:30:00Z', ms: '2024-01-15T14:30:00.250Z', local: '2024-01-15 09:05', offset: '2024-01-15T14:30:00+02:00', bad: '2024-02-30', old: '1899-12-31' }]);
    expect(cell(book, 'A2')).toMatchObject({ t: 'n', v: 45306, z: 'yyyy-mm-dd' });
    expect(cell(book, 'B2')).toMatchObject({ t: 'n', z: 'yyyy-mm-dd hh:mm:ss' });
    expect(cell(book, 'B2').v).toBeCloseTo(45306 + 14.5 / 24, 9);
    expect(cell(book, 'C2').z).toBe('yyyy-mm-dd hh:mm:ss.000');
    expect(cell(book, 'D2')).toMatchObject({ t: 'n', z: 'yyyy-mm-dd hh:mm' });
    expect(cell(book, 'E2')).toMatchObject({ t: 's', v: '2024-01-15T14:30:00+02:00' });
    expect(cell(book, 'F2')).toMatchObject({ t: 's', v: '2024-02-30' });
    expect(cell(book, 'G2')).toMatchObject({ t: 's', v: '1899-12-31' });
  });
  it('shows dates in the preview the way Excel will', () => {
    expect(parseDate('2024-01-15T14:30:00Z')?.text).toBe('2024-01-15 14:30:00');
    expect(convert([{ d: '2024-01-15T14:30:00.5Z', b: false }]).sheets[0].preview[1]).toEqual(['2024-01-15 14:30:00.500', 'FALSE']);
  });
  it('writes whole numbers over 15 digits as text so Excel does not round them', () => {
    const { book, result } = open('[{"id":12345678901234567890,"safe":1234567890123456,"small":123456789012345,"big":1e300}]');
    expect(cell(book, 'A2')).toMatchObject({ t: 's', v: '12345678901234567890' });
    expect(cell(book, 'B2')).toMatchObject({ t: 's', v: '1234567890123456' });
    expect(cell(book, 'C2')).toMatchObject({ t: 'n', v: 123456789012345 });
    expect(cell(book, 'D2')).toMatchObject({ t: 'n', v: 1e300 });
    expect(result.textNumbers).toBe(2);
  });
  it('cuts text to the Excel cell limit and counts the cells', () => {
    const { book, result } = open([{ long: 'x'.repeat(MAX_CELL + 10), short: 'ok' }]);
    expect(cell(book, 'A2').v).toHaveLength(MAX_CELL);
    expect(result.truncated).toBe(1);
  });
  it('replaces lone surrogates and keeps control characters readable', () => {
    const { book } = open('[{"a":"x\\ud800y","b":"tab\\there\\u0001"}]');
    expect(cell(book, 'A2').v).toBe('x�y');
    expect(cell(book, 'B2').v).toBe('tab\there\u0001');
  });
  it('reads JSON Lines as one row per line', () => {
    const result = convert('{"a":1}\n{"a":2}\n');
    expect(result.jsonLines).toBe(true);
    expect(result.sheets[0].rows).toBe(2);
  });
  it('reports syntax errors with a position', () => {
    expect(() => convert('{\n  "a": 1,\n}')).toThrow(expect.objectContaining({ code: 'trailingComma', line: 2 }));
    expect(() => convert('   ')).toThrow(expect.objectContaining({ code: 'empty' }));
  });
  it('reports JSON with nothing to write', () => {
    for (const source of ['[]', '{}', '[{}]']) expect(() => convert(source)).toThrow(expect.objectContaining({ code: 'noData' }));
  });
  it('reports deep nesting', () => {
    expect(() => convert('[' + '{"a":['.repeat(100) + ']}'.repeat(100) + ']')).toThrow(expect.objectContaining({ code: 'depth' }));
    expect(() => convert('{"a":'.repeat(200) + '1' + '}'.repeat(200))).toThrow(expect.objectContaining({ code: 'depth' }));
  });
  it('reports more columns than Excel allows', () => {
    const wide = Object.fromEntries(Array.from({ length: 16385 }, (_, i) => [`k${i}`, i]));
    expect(() => convert([wide])).toThrow(expect.objectContaining({ code: 'tooManyColumns', sheet: 'Sheet1' }));
  });
  it('caps the preview at 100 rows and 30 columns', () => {
    const record = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`c${i}`, i]));
    const sheet = convert(Array.from({ length: 150 }, () => record)).sheets[0];
    expect(sheet).toMatchObject({ rows: 150, columns: 40 });
    expect(sheet.preview).toHaveLength(101);
    expect(sheet.preview[0]).toHaveLength(30);
  });
  it('makes sheet names Excel accepts', () => {
    expect(sheetNames(['orders', 'Orders', 'a/b:c?*[d]', "'quoted'", 'History', 'x'.repeat(40), ''])).toEqual(['orders', 'Orders (2)', 'a-b-c---d-', 'quoted', 'History (2)', 'x'.repeat(31), 'Sheet']);
    expect(sheetNames(['y'.repeat(31), 'y'.repeat(31)])[1]).toBe('y'.repeat(27) + ' (2)');
  });
});
