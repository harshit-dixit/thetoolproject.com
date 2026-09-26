import { readFileSync } from 'node:fs';
import { PDFDocument, PDFName, PDFDict, PDFArray } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { parseEml } from './eml';
import { emailToPdf, isIntactPng, PdfError, type PdfOptions } from './eml-to-pdf';

const fonts = {
  regular: new Uint8Array(readFileSync(new URL('../assets/fonts/noto-sans-regular.ttf', import.meta.url))),
  bold: new Uint8Array(readFileSync(new URL('../assets/fonts/noto-sans-bold.ttf', import.meta.url))),
};
const options: PdfOptions = {
  pageSize: 'a4', body: 'html', attachments: 'embed',
  labels: {
    from: 'From', to: 'To', cc: 'Cc', bcc: 'Bcc', replyTo: 'Reply-To', date: 'Date', attachments: 'Attachments',
    noSubject: '(no subject)', noBody: '(no text)', encrypted: '(encrypted)',
    page: (page, total) => `Page ${page} of ${total}`, size: bytes => `${bytes} bytes`,
  },
};
const encode = (text: string) => new TextEncoder().encode(text.replace(/\n/g, '\r\n'));
// A 1×1 PNG.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const message = [
  'From: Maya Chen <maya@example.com>', 'To: Luis <luis@example.com>', 'Subject: Q1 invoice', 'Date: Tue, 12 Mar 2024 14:30:00 +0100',
  'Content-Type: multipart/mixed; boundary=outer', '',
  '--outer', 'Content-Type: multipart/related; boundary=rel', '',
  '--rel', 'Content-Type: text/html; charset=utf-8', '',
  '<p>Hi <b>Luis</b>, the <a href="https://example.com/invoice">invoice</a> is attached.</p><img src="cid:logo" width="40" height="40"><table><tr><th>Item</th><th>Total</th></tr><tr><td>Tea</td><td>4,00 €</td></tr></table>',
  '--rel', 'Content-Type: image/png', 'Content-ID: <logo>', 'Content-Transfer-Encoding: base64', '', PNG,
  '--rel--',
  '--outer', 'Content-Type: text/plain; name=notes.txt', 'Content-Disposition: attachment; filename=notes.txt', '', 'remember the tea',
  '--outer--', '',
].join('\n');

describe('emailToPdf', () => {
  it('writes a PDF with the attachment embedded and the inline image left out of the list', async () => {
    const result = await emailToPdf(parseEml(encode(message)), fonts, options);
    expect(result).toMatchObject({ pages: 1, body: 'html', attachments: 1, remoteImages: 0, skippedImages: 0, droppedCharacters: 0 });
    const doc = await PDFDocument.load(result.pdf);
    expect(doc.getTitle()).toBe('Q1 invoice');
    expect(doc.getAuthor()).toBe('Maya Chen <maya@example.com>');
    const names = doc.catalog.lookup(PDFName.of('Names'), PDFDict).lookup(PDFName.of('EmbeddedFiles'), PDFDict).lookup(PDFName.of('Names'), PDFArray);
    expect(names.size()).toBe(2); // [name, filespec]
    const annotations = doc.getPage(0).node.Annots();
    expect(annotations?.size()).toBe(1);
  });

  it('lists attachments without embedding them when asked', async () => {
    const result = await emailToPdf(parseEml(encode(message)), fonts, { ...options, attachments: 'list', pageSize: 'letter' });
    const doc = await PDFDocument.load(result.pdf);
    expect(doc.catalog.get(PDFName.of('Names'))).toBeUndefined();
    expect(doc.getPage(0).getSize()).toEqual({ width: 612, height: 792 });
  });

  it('uses the plain-text body when chosen and breaks long messages across pages', async () => {
    const lines = Array.from({ length: 400 }, (_, i) => `Line ${i + 1} ${'word '.repeat(12)}`).join('\n');
    const email = parseEml(encode(`From: a@example.com\nSubject: Long\nContent-Type: multipart/alternative; boundary=b\n\n--b\nContent-Type: text/plain\n\n${lines}\n--b\nContent-Type: text/html\n\n<p>short</p>\n--b--`));
    const html = await emailToPdf(email, fonts, options);
    const text = await emailToPdf(email, fonts, { ...options, body: 'text' });
    expect(html.pages).toBe(1);
    expect(text.body).toBe('text');
    expect(text.pages).toBeGreaterThan(5);
  });

  it('drops emoji and counts them', async () => {
    const result = await emailToPdf(parseEml(encode('From: a@example.com\nSubject: Party 🎉\n\nSee you there 👍🏽')), fonts, options);
    expect(result.droppedCharacters).toBe(2);
    expect(result.body).toBe('text');
  });

  it('refuses a message mostly in a script the font lacks', async () => {
    const email = parseEml(encode('From: a@example.com\nSubject: 会議\nContent-Type: text/plain; charset=utf-8\n\n明日の会議は午後三時に始まります。資料を事前に確認してください。よろしくお願いします。'));
    await expect(emailToPdf(email, fonts, options)).rejects.toThrow(PdfError);
  });

  it('skips a damaged PNG instead of hanging on it', async () => {
    // Valid chunk layout, but the pixel data doesn't inflate. pdf-lib's decoder never returns on this.
    const damaged = 'iVBORw0KGgoAAAANSUhEUgAAAEAAAAAgCAIAAAAt/+nTAAAAR0lEQVR42u3PMQ0AAAgDoC251a3gHjgZgRpmZiaH9gIBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAYHlAfW6AUHnd9xxAAAAAElFTkSuQmCC';
    const email = parseEml(encode(`From: a@example.com\nContent-Type: text/html\n\n<p>Logo:</p><img src="data:image/png;base64,${damaged}"><img src="data:image/png;base64,${PNG}">`));
    const result = await emailToPdf(email, fonts, options);
    expect(result.skippedImages).toBe(1);
    expect(await isIntactPng(Uint8Array.from(atob(PNG), char => char.charCodeAt(0)))).toBe(true);
  });

  it('writes a page for a message with no body', async () => {
    const result = await emailToPdf(parseEml(encode('From: a@example.com\nSubject: Empty\n\n')), fonts, options);
    expect(result).toMatchObject({ pages: 1, body: 'none', attachments: 0 });
  });
});
