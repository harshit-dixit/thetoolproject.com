import { convertXmlToCsv, type XmlCsvError, type XmlCsvOptions } from '../lib/xml-to-csv';

export type XmlCsvRequest = { id: number; source: string; options: XmlCsvOptions };
self.onmessage = (event: MessageEvent<XmlCsvRequest>) => {
  const { id, source, options } = event.data;
  try { self.postMessage({ id, result: convertXmlToCsv(source, options) }); }
  catch (error) { self.postMessage({ id, error: error && typeof error === 'object' && 'code' in error ? error as XmlCsvError : { code: 'workerError' } }); }
};
