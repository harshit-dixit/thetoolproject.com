import { MhtError, parseMht, type MhtArchive } from '../lib/mht';
import { mhtToPdf, type MhtPdfResult } from '../lib/mht-to-pdf';
import { PdfError, type PageSize } from '../lib/eml-to-pdf';
import { readZip } from '../lib/zip';
import { createI18n } from '../i18n/client';
import regularUrl from '../assets/fonts/noto-sans-regular.ttf?url';
import boldUrl from '../assets/fonts/noto-sans-bold.ttf?url';

export type MhtRequest =
  | { id: number; kind: 'pdf'; file: File; pageSize: PageSize; header: boolean; strings: Record<string, string>; locale: string }
  | { id: number; kind: 'page'; file: File };
/** What the print view needs: the page and its parts. */
export type MhtPage = Pick<MhtArchive, 'html' | 'base' | 'url' | 'parts'>;
export type MhtSummary = { title: string; url: string; charsetFallback: boolean; zipEntry: string };
export type MhtResponse =
  | { id: number; result: MhtPdfResult; summary: MhtSummary }
  | { id: number; page: MhtPage }
  // The summary is there when the file was read but no PDF could be made, so the print view can still be offered.
  | { id: number; error: { code: string }; summary?: MhtSummary };

class FontError extends Error {}
class InputError extends Error {
  constructor(readonly code: 'zipNoMht' | 'zipUnreadable') { super(code); }
}

let fonts: Promise<{ regular: Uint8Array; bold: Uint8Array }> | undefined;
const fetchFont = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok) throw new FontError();
  return new Uint8Array(await response.arrayBuffer());
};
const loadFonts = () => fonts ??= Promise.all([fetchFont(regularUrl), fetchFont(boldUrl)])
  .then(([regular, bold]) => ({ regular, bold }))
  .catch(() => { fonts = undefined; throw new FontError(); });

// Changing an option or printing reads the same file again, so keep the last parsed archive.
let cached: { key: string; archive: MhtArchive; zipEntry: string } | undefined;

const isMhtName = (name: string) => /\.mht(ml)?$/i.test(name);

/** Windows Steps Recorder saves its .mht inside a ZIP file, so the first .mht in a ZIP is read. */
async function readArchive(file: File) {
  const key = `${file.name}\u0000${file.size}\u0000${file.lastModified}`;
  if (cached?.key === key) return cached;
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  let bytes: Uint8Array;
  let zipEntry = '';
  if (head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) {
    let entries;
    try { entries = await readZip(file); } catch { throw new InputError('zipUnreadable'); }
    const entry = entries.find(item => isMhtName(item.path) && !item.path.split('/').some(part => part === '__MACOSX' || part.startsWith('.')));
    if (!entry) throw new InputError('zipNoMht');
    if (!entry.readable) throw new InputError('zipUnreadable');
    try { bytes = new Uint8Array(await (await entry.blob()).arrayBuffer()); } catch { throw new InputError('zipUnreadable'); }
    zipEntry = entry.path.split('/').pop()!;
  } else bytes = new Uint8Array(await file.arrayBuffer());
  cached = { key, archive: parseMht(bytes), zipEntry };
  return cached;
}

// GIF, WebP and BMP images become PNG through the browser's own decoder.
async function toPng(bytes: Uint8Array): Promise<Uint8Array | undefined> {
  if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') return undefined;
  try {
    const bitmap = await createImageBitmap(new Blob([bytes as BlobPart]));
    const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
  } catch {
    return undefined;
  }
}

self.addEventListener('message', async (event: MessageEvent<MhtRequest>) => {
  const request = event.data;
  const { id } = request;
  let summary: MhtSummary | undefined;
  try {
    const fontsReady = request.kind === 'pdf' ? loadFonts() : undefined;
    // A failed font load is reported once the file has been read.
    fontsReady?.catch(() => {});
    const { archive, zipEntry } = await readArchive(request.file);
    summary = { title: archive.title, url: archive.url, charsetFallback: archive.charsetFallback, zipEntry };
    if (request.kind === 'page') {
      // Copied, not transferred, so the cached archive stays usable.
      self.postMessage({ id, page: { html: archive.html, base: archive.base, url: archive.url, parts: archive.parts } } satisfies MhtResponse);
      return;
    }
    const { t } = createI18n(request.strings, request.locale);
    const dates = new Intl.DateTimeFormat(request.locale, { dateStyle: 'long', timeStyle: 'short' });
    const result = await mhtToPdf(archive, await fontsReady!, {
      pageSize: request.pageSize, header: request.header, toPng,
      labels: {
        untitled: t('mht.untitled'), address: t('mht.pdfAddress'), saved: t('mht.pdfSaved'), noContent: t('mht.pdfNoContent'),
        page: (page, total) => t('eml.pdfPage', { page, total }),
        date: raw => { const date = new Date(raw); return Number.isNaN(date.getTime()) ? raw : dates.format(date); },
      },
    });
    self.postMessage({ id, result, summary } satisfies MhtResponse, { transfer: [result.pdf.buffer] });
  } catch (error) {
    const code = error instanceof MhtError || error instanceof PdfError || error instanceof InputError ? error.code : error instanceof FontError ? 'font' : 'general';
    self.postMessage({ id, error: { code }, ...(summary ? { summary } : {}) } satisfies MhtResponse);
  }
});
