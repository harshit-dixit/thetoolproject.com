import { parseCsv, type Separator } from './csv-viewer';

export type CsvJsonOptions = {
  separator: Separator;
  firstRowHeaders: boolean;
  detectTypes: boolean;
  emptyAsNull: boolean;
  format: 'pretty' | 'compact' | 'lines';
};

export type CsvJsonResult = {
  json: string;
  headers: string[];
  preview: string[][];
  rows: number;
  columns: number;
  separator: Exclude<Separator, 'auto'>;
  irregularRows: number;
  irregularIndices: number[];
  renamedHeaders: number;
};

function valueFromCell(value: string, options: CsvJsonOptions): string | number | boolean | null {
  if (value === '' && options.emptyAsNull) return null;
  if (!options.detectTypes) return value;
  if (/^(true|false)$/i.test(value)) return value.toLowerCase() === 'true';
  if (/^-?(?:0|[1-9]\d*)$/.test(value)) {
    const number = Number(value);
    if (Number.isSafeInteger(number) && !Object.is(number, -0)) return number;
  }
  if (/^-?(?:0|[1-9]\d*)\.\d+(?:[eE][+-]?\d+)?$/.test(value) || /^-?(?:0|[1-9]\d*)[eE][+-]?\d+$/.test(value)) {
    const number = Number(value);
    if (Number.isFinite(number) && !Object.is(number, -0) && value.replace(/^[+-]?0*(?=\d)/, '').replace(/[.eE+-]/g, '').length <= 15) return number;
  }
  return value;
}

export function convertCsvToJson(source: string, options: CsvJsonOptions): CsvJsonResult {
  const table = parseCsv(source, options.separator, options.firstRowHeaders);
  const headers = table.headers;
  const records = table.rows.map(row => {
    const record: Record<string, string | number | boolean | null> = Object.create(null);
    headers.forEach((header, index) => { record[header] = valueFromCell(row[index], options); });
    return record;
  });
  const json = options.format === 'lines'
    ? records.map(record => JSON.stringify(record)).join('\n')
    : JSON.stringify(records, null, options.format === 'pretty' ? 2 : undefined);
  // Original header names may be blank or duplicated; expose that as a useful import diagnostic.
  const renamedHeaders = options.firstRowHeaders ? headers.filter((header, index) => header !== (table.rawHeaders[index] ?? '').trim()).length : 0;
  return {
    json, headers, preview: table.rows.slice(0, 8), rows: table.rows.length,
    columns: headers.length, separator: table.separator,
    irregularRows: table.irregularRows, irregularIndices: table.irregularIndices.slice(0, 5),
    renamedHeaders,
  };
}
