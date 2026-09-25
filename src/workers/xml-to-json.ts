import { convertXmlToJson, type XmlJsonOptions, type XmlJsonError } from '../lib/xml-to-json';

export type XmlJsonRequest = { id: number; source: string; options: XmlJsonOptions };
self.onmessage = (event: MessageEvent<XmlJsonRequest>) => {
  const { id, source, options } = event.data;
  try { self.postMessage({ id, result: convertXmlToJson(source, options) }); }
  catch (error) { self.postMessage({ id, error: error && typeof error === 'object' && 'code' in error ? error as XmlJsonError : { code: 'workerError' } }); }
};
