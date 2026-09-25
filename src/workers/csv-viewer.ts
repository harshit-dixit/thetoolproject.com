import { decodeCsv, parseCsv, type Encoding, type Separator } from '../lib/csv-viewer';

export type CsvViewerRequest = { id: number; source: string | ArrayBuffer; separator: Separator; firstRowHeaders: boolean; encoding: Encoding };

self.onmessage = (event: MessageEvent<CsvViewerRequest>) => {
  const { id, source, separator, firstRowHeaders, encoding } = event.data;
  try {
    const decoded = typeof source === 'string' ? { text: source, encoding: 'pasted' } : decodeCsv(source, encoding);
    const table = parseCsv(decoded.text, separator, firstRowHeaders);
    self.postMessage({ id, ok: true, table, encoding: decoded.encoding });
  } catch (error) {
    self.postMessage({ id, ok: false, code: error instanceof Error && 'code' in error ? error.code : 'invalid', row: error instanceof Error && 'row' in error ? error.row : undefined });
  }
};
