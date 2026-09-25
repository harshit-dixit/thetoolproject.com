import { convertCsvToJson, type CsvJsonOptions } from '../lib/csv-to-json';
import { CsvViewerError } from '../lib/csv-viewer';

export type CsvJsonRequest = { id: number; source: string; options: CsvJsonOptions };
self.onmessage = (event: MessageEvent<CsvJsonRequest>) => {
  const { id, source, options } = event.data;
  try {
    self.postMessage({ id, result: convertCsvToJson(source, options) });
  } catch (error) {
    self.postMessage({ id, error: error instanceof CsvViewerError ? { code: error.code, row: error.row } : { code: 'workerError' } });
  }
};
