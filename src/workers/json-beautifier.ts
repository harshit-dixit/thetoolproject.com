import { beautifyJson, type JsonBeautifierError, type JsonBeautifierResult, type JsonIndent } from '../lib/json-beautifier';

export type JsonBeautifierRequest = { id: number; source: string; spacing: JsonIndent };

self.onmessage = (event: MessageEvent<JsonBeautifierRequest>) => {
  const { id, source, spacing } = event.data;
  try {
    const result: JsonBeautifierResult = beautifyJson(source, spacing);
    self.postMessage({ id, result });
  } catch (error) {
    const issue = error as JsonBeautifierError;
    self.postMessage({ id, error: issue?.code ? issue : { code: 'workerError' } });
  }
};
