import { convertDbfToExcel, type DbfEncoding, type DbfError } from '../lib/dbf-to-excel';

export type DbfRequest = { id: number; file: File; encoding: DbfEncoding };

self.addEventListener('message', async (event: MessageEvent<DbfRequest>) => {
  const { id, file, encoding } = event.data;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = convertDbfToExcel(bytes, encoding, file.name.replace(/\.dbf$/i, ''));
    self.postMessage({ id, result }, { transfer: [result.xlsx.buffer] });
  } catch (error) {
    const { code, detail } = error as DbfError;
    self.postMessage({ id, error: { code: code || 'invalid', detail } });
  }
});
