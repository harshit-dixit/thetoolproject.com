import { set_cptable, type WorkBook } from 'xlsx';
import { openWorkbook, describeWorkbook, sheetNames, sheetToCsv, csvFileNames, type CsvOptions, type CsvResult, type ExcelError } from '../lib/excel-to-csv';
import { createZip } from '../lib/zip';

export type ExcelRequest =
  | { id: number; type: 'open'; file: File }
  | { id: number; type: 'convert'; sheet: string; options: CsvOptions }
  | { id: number; type: 'zip'; options: CsvOptions; bom: boolean };

export type ConvertedSheet = Omit<CsvResult, 'csv'> & { csv: Blob };

let workbook: WorkBook | undefined;

async function handle(request: ExcelRequest) {
  if (request.type === 'open') {
    workbook = undefined;
    // Only Excel 95 and older .xls files need code page tables, so other formats skip the extra download.
    if (/\.xls$/i.test(request.file.name)) set_cptable(await import('xlsx/dist/cpexcel.full.mjs'));
    workbook = openWorkbook(await request.file.arrayBuffer());
    return { sheets: describeWorkbook(workbook) };
  }
  if (!workbook) throw { code: 'unreadable' } satisfies ExcelError;
  if (request.type === 'convert') {
    // Posting a Blob shares the bytes; posting the string would copy tens of MB onto the main thread.
    const { csv, ...result } = sheetToCsv(workbook, request.sheet, request.options);
    return { result: { ...result, csv: new Blob([csv]) } satisfies ConvertedSheet };
  }
  const encoder = new TextEncoder();
  const names = sheetNames(workbook);
  const files = csvFileNames(names, request.options.separator === 'tab' ? 'tsv' : 'csv');
  const zip = createZip(names.map((name, i) => {
    const text = (request.bom ? String.fromCharCode(0xfeff) : '') + sheetToCsv(workbook!, name, request.options).csv;
    return { name: files[i], data: encoder.encode(text) };
  }));
  return { zip };
}

self.addEventListener('message', async (event: MessageEvent<ExcelRequest>) => {
  const { id } = event.data;
  try {
    const response = await handle(event.data);
    if ('zip' in response && response.zip) self.postMessage({ id, ...response }, { transfer: [response.zip.buffer] });
    else self.postMessage({ id, ...response });
  } catch (error) {
    const code = (error as ExcelError)?.code;
    self.postMessage({ id, error: { code: code ?? 'unreadable' } });
  }
});
