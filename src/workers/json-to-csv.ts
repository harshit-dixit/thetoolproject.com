import { convertJsonToCsv, type CsvOptions, type CsvError } from '../lib/json-to-csv';

export type CsvRequest = { id: number; source: string; options: CsvOptions };
self.onmessage = (event: MessageEvent<CsvRequest>) => {
  const { id, source, options } = event.data;
  try { self.postMessage({ id, result: convertJsonToCsv(source, options) }); }
  catch (error) { self.postMessage({ id, error: error && typeof error === 'object' && 'code' in error ? error as CsvError : { code: 'workerError' } }); }
};
