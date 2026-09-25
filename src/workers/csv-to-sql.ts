import { convertCsvToSql, CsvSqlError, type CsvSqlOptions } from '../lib/csv-to-sql';

export type CsvSqlRequest = { id: number; source: string; options: CsvSqlOptions };
self.onmessage = (event: MessageEvent<CsvSqlRequest>) => {
  const { id, source, options } = event.data;
  try { self.postMessage({ id, result: convertCsvToSql(source, options) }); }
  catch (error) {
    self.postMessage({ id, error: error instanceof CsvSqlError ? { code: error.code, row: error.row } : { code: 'workerError' } });
  }
};
