export type SqlDialect = 'postgresql' | 'mysql' | 'sqlite' | 'sqlserver';
export type CsvDelimiter = 'auto' | 'comma' | 'semicolon' | 'tab' | 'pipe';
export type CsvSqlOptions = {
  dialect: SqlDialect;
  delimiter: CsvDelimiter;
  firstRowHeaders: boolean;
  tableName: string;
  createTable: boolean;
  batchInsert: boolean;
  emptyAsNull: boolean;
  detectTypes: boolean;
};
export type CsvSqlResult = { sql: string; rows: number; columns: number; headers: string[]; preview: string[][]; delimiter: Exclude<CsvDelimiter, 'auto'>; types: string[] };
export type CsvSqlErrorCode = 'empty' | 'invalidCsv' | 'noRows' | 'tooManyColumns' | 'invalidTable';
export class CsvSqlError extends Error {
  constructor(public code: CsvSqlErrorCode, public row?: number) { super(code); }
}

const delimiters = { comma: ',', semicolon: ';', tab: '\t', pipe: '|' } as const;
type ColumnType = 'text' | 'integer' | 'decimal' | 'boolean';

function parseCsv(source: string, separator: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let closed = false;
  let started = false;
  const value = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  function endRow() {
    row.push(field);
    if (started || row.length > 1 || field !== '') rows.push(row);
    row = []; field = ''; closed = false; started = false;
  }
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (quoted) {
      if (char === '"' && value[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') { quoted = false; closed = true; }
      else field += char;
    } else if (char === separator) {
      row.push(field); field = ''; closed = false; started = true;
    } else if (char === '\r' || char === '\n') {
      endRow();
      if (char === '\r' && value[i + 1] === '\n') i++;
    } else if (char === '"') {
      if (field !== '' || closed) throw new CsvSqlError('invalidCsv', rows.length + 1);
      quoted = true; started = true;
    } else if (closed) {
      if (char !== ' ' && char !== '\t') throw new CsvSqlError('invalidCsv', rows.length + 1);
    } else { field += char; started = true; }
  }
  if (quoted) throw new CsvSqlError('invalidCsv', rows.length + 1);
  if (started || row.length || field) endRow();
  return rows;
}

function detectDelimiter(source: string): Exclude<CsvDelimiter, 'auto'> {
  // Sample complete records so a long quoted field cannot cut the sample in half.
  let quote = false;
  let records = 0;
  let end = source.length;
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '"') {
      if (quote && source[i + 1] === '"') i++;
      else quote = !quote;
    } else if (!quote && (source[i] === '\r' || source[i] === '\n')) {
      if (++records === 12) { end = i + 1; break; }
      if (source[i] === '\r' && source[i + 1] === '\n') i++;
    }
  }
  const sampleText = source.slice(0, end);
  let best: Exclude<CsvDelimiter, 'auto'> = 'comma';
  let bestScore = 0;
  for (const name of Object.keys(delimiters) as Exclude<CsvDelimiter, 'auto'>[]) {
    try {
      const sample = parseCsv(sampleText, delimiters[name]).slice(0, 12);
      const widths = sample.map(row => row.length);
      const common = widths.filter(width => width > 1 && width === widths[0]).length;
      const score = common * 10 + (widths[0] > 1 ? widths[0] - 1 : 0);
      if (score > bestScore) { best = name; bestScore = score; }
    } catch { /* Invalid CSV is reported by the chosen parser below. */ }
  }
  return best;
}

function uniqueHeaders(raw: string[]): string[] {
  const used = new Set<string>();
  return raw.map((value, index) => {
    const base = value.trim() || `column_${index + 1}`;
    let name = base;
    let n = 2;
    while (used.has(name.toLowerCase())) name = `${base}_${n++}`;
    used.add(name.toLowerCase());
    return name;
  });
}

function quoteIdentifier(value: string, dialect: SqlDialect): string {
  if (dialect === 'mysql') return '`' + value.replaceAll('`', '``') + '`';
  if (dialect === 'sqlserver') return '[' + value.replaceAll(']', ']]') + ']';
  return '"' + value.replaceAll('"', '""') + '"';
}

function tableIdentifier(raw: string, dialect: SqlDialect): string {
  const parts = raw.trim().split('.').map(part => part.trim());
  if (!parts.length || parts.length > 2 || parts.some(part => !part || /[\x00-\x1f]/.test(part))) throw new CsvSqlError('invalidTable');
  return parts.map(part => quoteIdentifier(part, dialect)).join('.');
}

function detectColumnType(values: string[], emptyAsNull: boolean): ColumnType {
  const filled = values.filter(value => value !== '');
  if (!filled.length || (!emptyAsNull && filled.length !== values.length)) return 'text';
  if (filled.every(value => /^(true|false)$/i.test(value))) return 'boolean';
  if (filled.every(value => /^-?(?:0|[1-9]\d*)$/.test(value) && BigInt(value) >= -9223372036854775808n && BigInt(value) <= 9223372036854775807n)) return 'integer';
  if (filled.every(value => /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) && value.replace(/[-.]/g, '').length <= 26 && (value.split('.')[1]?.length ?? 0) <= 12)) return 'decimal';
  return 'text';
}

function sqlType(type: ColumnType, dialect: SqlDialect): string {
  if (type === 'integer') return dialect === 'sqlite' ? 'INTEGER' : 'BIGINT';
  if (type === 'decimal') return dialect === 'postgresql' || dialect === 'sqlite' ? 'NUMERIC' : 'DECIMAL(38, 12)';
  if (type === 'boolean') return dialect === 'postgresql' ? 'BOOLEAN' : dialect === 'sqlserver' ? 'BIT' : 'INTEGER';
  return dialect === 'mysql' ? 'LONGTEXT' : dialect === 'sqlserver' ? 'NVARCHAR(MAX)' : 'TEXT';
}

function sqlValue(value: string, type: ColumnType, options: CsvSqlOptions): string {
  if (value === '' && options.emptyAsNull) return 'NULL';
  if (type === 'integer' || type === 'decimal') return value === '' ? "''" : value;
  if (type === 'boolean' && value !== '') return options.dialect === 'postgresql' ? value.toUpperCase() : /^true$/i.test(value) ? '1' : '0';
  const escaped = options.dialect === 'mysql' ? value.replaceAll('\\', '\\\\').replaceAll("'", "''") : value.replaceAll("'", "''");
  return (options.dialect === 'sqlserver' ? 'N' : '') + "'" + escaped + "'";
}

export function convertCsvToSql(source: string, options: CsvSqlOptions): CsvSqlResult {
  if (!source.trim()) throw new CsvSqlError('empty');
  const delimiter = options.delimiter === 'auto' ? detectDelimiter(source) : options.delimiter;
  const parsed = parseCsv(source, delimiters[delimiter]);
  if (!parsed.length) throw new CsvSqlError('noRows');
  let width = 0;
  for (const row of parsed) width = Math.max(width, row.length);
  if (width > 500) throw new CsvSqlError('tooManyColumns');
  const data = options.firstRowHeaders ? parsed.slice(1) : parsed;
  if (!data.length) throw new CsvSqlError('noRows');
  const headers = uniqueHeaders(Array.from({ length: width }, (_, i) => options.firstRowHeaders ? parsed[0][i] ?? '' : `column_${i + 1}`));
  const rows = data.map(row => Array.from({ length: width }, (_, i) => row[i] ?? ''));
  const types: ColumnType[] = headers.map((_, index) => options.detectTypes ? detectColumnType(rows.map(row => row[index]), options.emptyAsNull) : 'text');
  const table = tableIdentifier(options.tableName, options.dialect);
  const columns = headers.map(header => quoteIdentifier(header, options.dialect));
  const parts: string[] = [];
  if (options.createTable) {
    const definition = columns.map((column, index) => `  ${column} ${sqlType(types[index], options.dialect)}`).join(',\n');
    parts.push(`CREATE TABLE ${table} (\n${definition}\n);`);
  }
  const insertHead = `INSERT INTO ${table} (${columns.join(', ')}) VALUES`;
  const batches = options.batchInsert ? 500 : 1;
  for (let start = 0; start < rows.length; start += batches) {
    const tuples = rows.slice(start, start + batches).map(row => `  (${row.map((value, index) => sqlValue(value, types[index], options)).join(', ')})`);
    parts.push(`${insertHead}\n${tuples.join(',\n')};`);
  }
  return { sql: parts.join('\n\n') + '\n', rows: rows.length, columns: width, headers, preview: rows.slice(0, 100).map(row => row.slice(0, 30)), delimiter, types: types.map(type => sqlType(type, options.dialect)) };
}
