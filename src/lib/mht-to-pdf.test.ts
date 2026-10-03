import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { PdfError } from './eml-to-pdf';
import { parseMht } from './mht';
import { mhtToPdf, type MhtPdfOptions } from './mht-to-pdf';

const fonts = {
  regular: new Uint8Array(readFileSync(new URL('../assets/fonts/noto-sans-regular.ttf', import.meta.url))),
  bold: new Uint8Array(readFileSync(new URL('../assets/fonts/noto-sans-bold.ttf', import.meta.url))),
};
const options: MhtPdfOptions = {
  pageSize: 'letter', header: true,
  labels: {
    untitled: '(untitled page)', address: 'Address', saved: 'Saved', noContent: '(no text)',
    page: (page, total) => `Page ${page} of ${total}`, date: raw => `on ${raw}`,
  },
};
const encode = (text: string) => new TextEncoder().encode(text.replace(/\n/g, '\r\n'));
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const archive = (html: string, extra: string[] = []) => [
  'From: <Saved by Blink>', 'Snapshot-Content-Location: https://example.com/tea.html', 'Subject: Green tea', 'Date: Tue, 12 Mar 2024 14:30:00 -0000',
  'MIME-Version: 1.0', 'Content-Type: multipart/related; type="text/html"; boundary=b', '',
  '--b', 'Content-Type: text/html; charset=utf-8', 'Content-Location: https://example.com/tea.html', '', html,
  '--b', 'Content-Type: image/png', 'Content-Transfer-Encoding: base64', 'Content-Location: https://example.com/img/cup.png', '', PNG,
  ...extra, '--b--', '',
].join('\n');

describe('mhtToPdf', () => {
  it('writes the title, address and page with archive images, and counts web images', async () => {
    const page = '<h1>Green tea</h1><p>Steep at 80 °C. <a href="/brew">How to brew</a></p><img src="img/cup.png" width="40" height="40"><img src="https://ads.example.net/banner.png" alt="Ad"><img src="img/missing.png"><img src="img/broken.png"><table><tr><th>Grade</th><th>Price</th></tr><tr><td>Sencha</td><td>$12</td></tr></table>';
    const broken = ['--b', 'Content-Type: image/png', 'Content-Location: https://example.com/img/broken.png', '', 'not a png'];
    const result = await mhtToPdf(parseMht(encode(archive(page, broken))), fonts, options);
    // A relative image that wasn't saved is still on the web, since the page came from there.
    expect(result).toMatchObject({ pages: 1, images: 1, remoteImages: 2, skippedImages: 1, droppedCharacters: 0 });
    const doc = await PDFDocument.load(result.pdf);
    expect(doc.getTitle()).toBe('Green tea');
    expect(doc.getSubject()).toBe('https://example.com/tea.html');
    expect(doc.getPage(0).getSize()).toEqual({ width: 612, height: 792 });
    // The page link and the address in the header are clickable.
    const links = doc.getPage(0).node.Annots()?.size() ?? 0;
    expect(links).toBe(2);
  });

  it('leaves the header out and uses A4 when asked', async () => {
    const result = await mhtToPdf(parseMht(encode(archive('<p>Only the page.</p>'))), fonts, { ...options, header: false, pageSize: 'a4' });
    const doc = await PDFDocument.load(result.pdf);
    expect(Math.round(doc.getPage(0).getWidth())).toBe(595);
    expect(doc.getPage(0).node.Annots()?.size() ?? 0).toBe(0);
  });

  it('notes a page with nothing to show', async () => {
    const result = await mhtToPdf(parseMht(encode(archive('<script>run()</script>'))), fonts, options);
    expect(result.pages).toBe(1);
  });

  it('refuses pages mostly in scripts the font does not cover', async () => {
    const page = `<p>${'緑茶の淹れ方。'.repeat(10)}</p>`;
    await expect(mhtToPdf(parseMht(encode(archive(page))), fonts, options)).rejects.toEqual(new PdfError('unsupportedScript'));
  });

  it('runs long pages over several pages', async () => {
    const page = Array.from({ length: 200 }, (_, index) => `<p>Paragraph ${index + 1} about tea.</p>`).join('');
    const result = await mhtToPdf(parseMht(encode(archive(page))), fonts, options);
    expect(result.pages).toBeGreaterThan(3);
  });
});
