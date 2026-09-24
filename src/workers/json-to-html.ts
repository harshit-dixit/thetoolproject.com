import { convertJson } from '../lib/json-to-html';
import type { Layout, Output, ConversionError } from '../lib/json-to-html';

self.addEventListener('message', (event: MessageEvent<{ id: number; source: string; layout: Layout; output: Output }>) => {
  const { id, source, layout, output } = event.data;
  try { self.postMessage({ id, result: convertJson(source, layout, output) }); }
  catch (error) { self.postMessage({ id, error: error as ConversionError }); }
});
