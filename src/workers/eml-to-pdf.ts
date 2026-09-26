import { EmlError, parseEml, type ParsedEmail } from '../lib/eml';
import { emailToPdf, PdfError, type AttachmentMode, type BodyChoice, type PageSize, type PdfResult } from '../lib/eml-to-pdf';
import { createI18n } from '../i18n/client';
import regularUrl from '../assets/fonts/noto-sans-regular.ttf?url';
import boldUrl from '../assets/fonts/noto-sans-bold.ttf?url';

export type EmlRequest = {
  id: number; file: File; pageSize: PageSize; body: BodyChoice; attachments: AttachmentMode;
  strings: Record<string, string>; locale: string;
};
export type EmlSummary = { subject: string; from: string; hasHtml: boolean; hasText: boolean; encrypted: boolean; charsetFallback: boolean };
export type EmlResponse =
  | { id: number; result: PdfResult; summary: EmlSummary }
  | { id: number; error: { code: string } };

class FontError extends Error {}

let fonts: Promise<{ regular: Uint8Array; bold: Uint8Array }> | undefined;
const fetchFont = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok) throw new FontError();
  return new Uint8Array(await response.arrayBuffer());
};
const loadFonts = () => fonts ??= Promise.all([fetchFont(regularUrl), fetchFont(boldUrl)])
  .then(([regular, bold]) => ({ regular, bold }))
  .catch(() => { fonts = undefined; throw new FontError(); });

// Changing an option converts the same file again, so keep the last parsed message.
let cached: { key: string; email: ParsedEmail } | undefined;

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

self.addEventListener('message', async (event: MessageEvent<EmlRequest>) => {
  const { id, file, pageSize, body, attachments, strings, locale } = event.data;
  try {
    const fontsReady = loadFonts();
    const key = `${file.name}\u0000${file.size}\u0000${file.lastModified}`;
    if (cached?.key !== key) cached = { key, email: parseEml(new Uint8Array(await file.arrayBuffer())) };
    const email = cached.email;
    const { t, formatBytes } = createI18n(strings, locale);
    const result = await emailToPdf(email, await fontsReady, {
      pageSize, body, attachments, toPng,
      labels: {
        from: t('eml.pdfFrom'), to: t('eml.pdfTo'), cc: t('eml.pdfCc'), bcc: t('eml.pdfBcc'), replyTo: t('eml.pdfReplyTo'),
        date: t('eml.pdfDate'), attachments: t('eml.pdfAttachments'), noSubject: t('eml.noSubject'), noBody: t('eml.pdfNoBody'),
        encrypted: t('eml.pdfEncrypted'), page: (page, total) => t('eml.pdfPage', { page, total }), size: formatBytes,
      },
    });
    const summary: EmlSummary = {
      subject: email.headers.subject, from: email.headers.from,
      hasHtml: email.html.some(part => part.trim()), hasText: email.text.some(part => part.trim()),
      encrypted: email.encrypted, charsetFallback: email.charsetFallback,
    };
    self.postMessage({ id, result, summary } satisfies EmlResponse, { transfer: [result.pdf.buffer] });
  } catch (error) {
    const code = error instanceof EmlError || error instanceof PdfError ? error.code : error instanceof FontError ? 'font' : 'general';
    self.postMessage({ id, error: { code } } satisfies EmlResponse);
  }
});
