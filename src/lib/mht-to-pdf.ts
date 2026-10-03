// Lays out a saved web page (.mht) as a PDF with real, selectable text, using the EML to PDF layout:
// an optional title with the address and save date, then the page's text, headings, lists, tables,
// links and the images saved in the archive, with page numbers. Styling and multi-column layouts
// are not copied; the page reads top to bottom.
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, type PDFImage } from 'pdf-lib';
import { htmlToBlocks } from './eml-html';
import {
  cleanBlocks, dataUrlBytes, drawBlocks, drawPageNumbers, embedImage, Glyphs, INK, LEADING, MARGIN, MUTED, PAGE_SIZES,
  PdfError, RULE, SIZE, wrap, Writer, type PageSize, type PdfOptions, type Style,
} from './eml-to-pdf';
import { createResolver, isWebAddress, linkUrl, type MhtArchive } from './mht';

export type MhtPdfLabels = {
  untitled: string; address: string; saved: string; noContent: string;
  page: (page: number, total: number) => string;
  /** Formats the archive's Date header, or returns it as written. */
  date: (raw: string) => string;
};
export type MhtPdfOptions = {
  pageSize: PageSize;
  /** Start the PDF with the page title, the address it was saved from and the date. */
  header: boolean;
  labels: MhtPdfLabels;
  toPng?: PdfOptions['toPng'];
};
export type MhtPdfResult = {
  pdf: Uint8Array;
  pages: number;
  /** Images from the archive placed in the PDF. */
  images: number;
  /** Images the page loaded from the internet that weren't saved in the file. */
  remoteImages: number;
  /** Images in the file that couldn't be read, or that the page names but the file doesn't hold. */
  skippedImages: number;
  droppedCharacters: number;
};

const PART = 'mht:';
const MISSING = 'missing:';

export async function mhtToPdf(archive: MhtArchive, fontBytes: { regular: Uint8Array; bold: Uint8Array }, options: MhtPdfOptions): Promise<MhtPdfResult> {
  const { labels } = options;
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const regular = await doc.embedFont(fontBytes.regular, { subset: true });
  const bold = await doc.embedFont(fontBytes.bold, { subset: true });
  const glyphs = new Glyphs(new Set(regular.getCharacterSet()));

  const resolve = createResolver(archive);
  let remoteImages = 0;
  const body = htmlToBlocks(archive.html, {
    image: src => {
      if (/^data:image\//i.test(src)) return src;
      const index = resolve(src);
      if (index !== undefined) return `${PART}${index}`;
      if (isWebAddress(src, archive)) { remoteImages++; return undefined; }
      // Named by the page but not saved in the file.
      return `${MISSING}${src}`;
    },
    link: href => linkUrl(href, archive),
  });
  const blocks = body.blocks;

  // Clean every string first, so a page the font can't show fails before any work.
  cleanBlocks(blocks, glyphs);
  const title = glyphs.clean(archive.title);
  const address = glyphs.clean(archive.url);
  const saved = archive.date ? glyphs.clean(labels.date(archive.date)) : '';
  if (glyphs.mostlyMissing) throw new PdfError('unsupportedScript');

  const images = new Map<string, PDFImage | null>();
  let skippedImages = 0;
  for (const block of blocks) {
    if (block.kind !== 'image' || images.has(block.src)) continue;
    const bytes = block.src.startsWith(PART) ? archive.parts[Number(block.src.slice(PART.length))]?.bytes : dataUrlBytes(block.src);
    const image = bytes?.length ? await embedImage(doc, bytes, options.toPng) : null;
    if (!image) skippedImages++;
    images.set(block.src, image);
  }

  const writer = new Writer(doc, { regular, bold }, PAGE_SIZES[options.pageSize]);
  if (options.header) {
    writer.lines(wrap([{ text: title || labels.untitled, style: { font: bold, size: SIZE.title, color: INK, italic: false } }], writer.contentWidth, writer.measure, false), MARGIN, 0);
    writer.y -= 8;
    const labelStyle: Style = { font: bold, size: SIZE.header, color: MUTED, italic: false };
    const rows: [string, Style & { text: string }][] = [];
    if (address) rows.push([labels.address, { ...writer.style({ text: address, href: archive.url }, { size: SIZE.header }), text: address }]);
    if (saved) rows.push([labels.saved, { font: regular, size: SIZE.header, color: INK, italic: false, text: saved }]);
    if (rows.length) {
      const labelWidth = Math.min(writer.contentWidth / 3, Math.max(...rows.map(([label]) => writer.measure.width(bold, glyphs.clean(label), SIZE.header)))) + 12;
      for (const [label, { text, ...style }] of rows) {
        const lines = wrap([{ text, style }], writer.contentWidth - labelWidth, writer.measure, false);
        writer.ensure(SIZE.header * LEADING);
        const baseline = writer.y - SIZE.header * LEADING + SIZE.header * 0.36;
        writer.page.drawText(glyphs.clean(label), { x: MARGIN, y: baseline, size: SIZE.header, font: labelStyle.font, color: labelStyle.color });
        writer.lines(lines, MARGIN + labelWidth, 0);
      }
    }
    writer.y -= 8;
    writer.page.drawLine({ start: { x: MARGIN, y: writer.y }, end: { x: writer.width - MARGIN, y: writer.y }, thickness: 1, color: RULE });
    writer.y -= 14;
  }

  const visible = blocks.some(block => block.kind === 'text' ? block.runs.length : block.kind === 'image' ? images.get(block.src) : block.kind === 'table');
  if (!visible) {
    const notice = glyphs.clean(labels.noContent);
    writer.lines(wrap([{ text: notice, style: { font: regular, size: SIZE.body, color: MUTED, italic: true } }], writer.contentWidth, writer.measure, false), MARGIN, 0);
  }
  drawBlocks(writer, blocks, images);
  const pages = drawPageNumbers(writer, glyphs, labels.page);

  doc.setTitle(title || labels.untitled);
  if (archive.url) doc.setSubject(archive.url);
  doc.setCreator('thetoolproject.com MHT to PDF');
  const pdf = await doc.save({ useObjectStreams: true });
  return {
    pdf,
    pages: pages.length,
    images: [...images.values()].filter(Boolean).length,
    remoteImages,
    skippedImages,
    droppedCharacters: glyphs.dropped,
  };
}
