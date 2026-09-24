import { convertJsonToExcel, type ExcelOptions } from '../lib/json-to-excel';

export type ExcelRequest = { id: number; source: string; options: ExcelOptions };

self.addEventListener('message', (event: MessageEvent<ExcelRequest>) => {
  const { id, source, options } = event.data;
  try {
    const result = convertJsonToExcel(source, options);
    self.postMessage({ id, result }, { transfer: [result.xlsx.buffer] });
  } catch (error) {
    // Parse and limit errors carry a code; anything else is a bug or memory failure, reported as a stopped conversion.
    self.postMessage({ id, error: typeof (error as { code?: unknown })?.code === 'string' ? error : undefined });
  }
});
