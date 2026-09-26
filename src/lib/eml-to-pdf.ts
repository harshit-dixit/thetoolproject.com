// Lays out a parsed email as a PDF with real, selectable text: the subject, a header table
// (From, To, Cc, Date…), the body, and page numbers. Attachments can be embedded as PDF file
// attachments. Text uses Noto Sans (Latin, Greek and Cyrillic), passed in by the caller.
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, PDFString, degrees, rgb, type PDFFont, type PDFImage, type PDFPage, type RGB } from 'pdf-lib';
import { base64Binary, fromBinary, type EmlAttachment, type ParsedEmail } from './eml';
import { htmlToBlocks, textToBlocks, type Block, type Run, type TableBlock, type TextBlock } from './eml-html';

export type PageSize = 'letter' | 'a4';
export type BodyChoice = 'html' | 'text';
export type AttachmentMode = 'embed' | 'list';
export type PdfLabels = {
  from: string; to: string; cc: string; bcc: string; replyTo: string; date: string; attachments: string;
  noSubject: string; noBody: string; encrypted: string;
  page: (page: number, total: number) => string;
  size: (bytes: number) => string;
};
export type PdfOptions = {
  pageSize: PageSize;
  body: BodyChoice;
  attachments: AttachmentMode;
  labels: PdfLabels;
  /** Turns an image the PDF can't hold (GIF, WebP, BMP) into PNG, or returns undefined. */
  toPng?: (bytes: Uint8Array) => Promise<Uint8Array | undefined>;
};
export type PdfResult = {
  pdf: Uint8Array;
  pages: number;
  body: BodyChoice | 'none';
  /** Attachments shown in the header, and embedded when the mode is "embed". Inline body images aren't counted. */
  attachments: number;
  remoteImages: number;
  skippedImages: number;
  /** Characters the font can't show (emoji, most non-European scripts), left out of the PDF. */
  droppedCharacters: number;
};
export type PdfErrorCode = 'unsupportedScript' | 'tooManyPages';

export class PdfError extends Error {
  constructor(readonly code: PdfErrorCode) { super(code); }
}

const PAGE_SIZES: Record<PageSize, [number, number]> = { letter: [612, 792], a4: [595.28, 841.89] };
const MARGIN = 54;
const FOOTER = 28;
const SIZE = { body: 10.5, table: 9.5, header: 9.5, title: 16, footer: 8, h1: 16, h2: 13.5, h3: 11.5 };
const LEADING = 1.4;
const QUOTE_STEP = 12;
const LIST_STEP = 18;
const CELL_PAD = 4;
const PX = 0.75; // CSS pixels to PDF points
const MAX_PAGES = 1000;
const INK = rgb(0.08, 0.09, 0.11);
const MUTED = rgb(0.36, 0.39, 0.44);
const LINK = rgb(0.06, 0.3, 0.78);
const RULE = rgb(0.82, 0.84, 0.87);
const ITALIC = degrees(11);

type Style = { font: PDFFont; size: number; color: RGB; italic: boolean; href?: string };
type Piece = Style & { text: string; width: number; space: boolean };
type Line = { pieces: Piece[]; width: number; size: number };

/** Keeps the characters the font can draw, and counts what it drops. */
class Glyphs {
  dropped = 0;
  letters = 0;
  missingLetters = 0;
  constructor(private readonly supported: Set<number>) {}

  clean(text: string): string {
    let out = '';
    for (const char of text.normalize('NFC')) {
      const code = char.codePointAt(0)!;
      if (code === 10) { out += char; continue; }
      if (code === 9 || code === 0xa0 || (code >= 0x2000 && code <= 0x200a) || code === 0x202f || code === 0x205f || code === 0x3000) { out += ' '; continue; }
      if (code < 32 || (code >= 0x7f && code < 0xa0) || code === 0xad) continue;
      const letter = /\p{L}/u.test(char);
      if (letter) this.letters++;
      if (this.supported.has(code)) { out += char; continue; }
      // Invisible joiners, variation selectors and skin-tone modifiers go without a trace.
      if (/[\p{Cf}\p{M}\u{1F3FB}-\u{1F3FF}]/u.test(char)) continue;
      this.dropped++;
      if (letter) this.missingLetters++;
    }
    return out;
  }

  runs(runs: Run[]): Run[] {
    return runs.map(run => ({ ...run, text: this.clean(run.text) })).filter(run => run.text);
  }
}

class Measure {
  private cache = new Map<string, number>();
  width(font: PDFFont, text: string, size: number): number {
    const key = `${font.name}\u0000${text}`;
    let width = this.cache.get(key);
    if (width === undefined) this.cache.set(key, width = font.widthOfTextAtSize(text, 1));
    return width * size;
  }
}

/** Breaks styled text into lines no wider than `width`. Breaks at spaces, and inside words only when a word is too long. */
function wrap(runs: { text: string; style: Style }[], lineWidthLimit: number, measure: Measure, preserveSpaces: boolean): Line[] {
  // Table columns are sized to their longest word, so allow for rounding when that word is placed.
  const width = lineWidthLimit + 0.01;
  const lines: Line[] = [];
  let line: Piece[] = [];
  let lineWidth = 0;
  let space: Piece | null = null;
  let word: Piece[] = [];
  const size = Math.max(...runs.map(run => run.style.size), 1);
  const endLine = () => {
    lines.push({ pieces: line, width: lineWidth, size: Math.max(size, ...line.map(piece => piece.size)) });
    line = [];
    lineWidth = 0;
    space = null;
  };
  const place = (pieces: Piece[]) => {
    const total = pieces.reduce((sum, piece) => sum + piece.width, 0);
    const gap: number = space ? (space as Piece).width : 0;
    if (line.length && lineWidth + gap + total > width) endLine();
    if (space && line.length) { line.push(space); lineWidth += (space as Piece).width; }
    space = null;
    if (lineWidth + total <= width || !pieces.length) {
      line.push(...pieces);
      lineWidth += total;
      return;
    }
    // A word wider than the line (a long URL, say) is split between characters.
    for (const piece of pieces) {
      let chunk = '';
      let chunkWidth = 0;
      for (const char of piece.text) {
        const charWidth = measure.width(piece.font, char, piece.size);
        if (lineWidth + chunkWidth + charWidth > width && (line.length || chunk)) {
          if (chunk) line.push({ ...piece, text: chunk, width: chunkWidth });
          lineWidth += chunkWidth;
          endLine();
          chunk = '';
          chunkWidth = 0;
        }
        chunk += char;
        chunkWidth += charWidth;
      }
      if (chunk) { line.push({ ...piece, text: chunk, width: chunkWidth }); lineWidth += chunkWidth; }
    }
  };
  const flushWord = () => { if (word.length) { place(word); word = []; } };

  for (const { text, style } of runs) {
    for (const token of text.match(/\n| +|[^ \n]+/g) ?? []) {
      if (token === '\n') { flushWord(); endLine(); continue; }
      if (token[0] === ' ') {
        flushWord();
        const spaceText = preserveSpaces ? token : ' ';
        if (preserveSpaces && !line.length && !space) {
          // Leading spaces in plain text are indentation.
          const indent = { ...style, text: spaceText, width: measure.width(style.font, spaceText, style.size), space: true };
          line.push(indent);
          lineWidth += indent.width;
          continue;
        }
        space = { ...style, text: spaceText, width: measure.width(style.font, spaceText, style.size), space: true };
        continue;
      }
      word.push({ ...style, text: token, width: measure.width(style.font, token, style.size), space: false });
    }
  }
  flushWord();
  if (line.length || !lines.length) endLine();
  return lines;
}

function longestWord(runs: { text: string; style: Style }[], measure: Measure): number {
  let longest = 0;
  for (const { text, style } of runs) for (const word of text.split(/[ \n]+/)) longest = Math.max(longest, measure.width(style.font, word, style.size));
  return longest;
}

function naturalWidth(runs: { text: string; style: Style }[], measure: Measure): number {
  let widest = 0;
  let current = 0;
  for (const { text, style } of runs) {
    const parts = text.split('\n');
    parts.forEach((part, index) => {
      if (index) { widest = Math.max(widest, current); current = 0; }
      current += measure.width(style.font, part, style.size);
    });
  }
  return Math.max(widest, current);
}

function sniffImage(bytes: Uint8Array): 'png' | 'jpg' | 'other' {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpg';
  return 'other';
}

/**
 * pdf-lib's PNG decoder can loop forever on damaged image data instead of failing, so a PNG is only
 * embedded when its chunks are intact and its pixel data inflates to the size the header promises.
 */
export async function isIntactPng(bytes: Uint8Array): Promise<boolean> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 33 || sniffImage(bytes) !== 'png') return false;
  let offset = 8;
  let header: { width: number; height: number; depth: number; color: number; interlaced: boolean } | undefined;
  const data: Uint8Array[] = [];
  let ended = false;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (offset + 12 + length > bytes.length) return false;
    const body = bytes.subarray(offset + 8, offset + 8 + length);
    if (!header && type !== 'IHDR') return false;
    if (type === 'IHDR') {
      const chunk = new DataView(body.buffer, body.byteOffset, body.byteLength);
      header = { width: chunk.getUint32(0), height: chunk.getUint32(4), depth: body[8], color: body[9], interlaced: body[12] === 1 };
    } else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') { ended = true; break; }
    offset += 12 + length;
  }
  if (!header || !ended || !data.length || !header.width || !header.height || header.width * header.height > 40_000_000) return false;
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[header.color];
  if (!channels || ![1, 2, 4, 8, 16].includes(header.depth)) return false;
  let inflated = 0;
  try {
    const reader = new Blob(data as BlobPart[]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      inflated += value.length;
    }
  } catch {
    return false;
  }
  // Interlaced images are stored in seven passes, so only check that there's at least one byte per row.
  const expected = header.height * (Math.ceil((header.width * channels * header.depth) / 8) + 1);
  return header.interlaced ? inflated >= header.height : inflated === expected;
}

class Writer {
  readonly doc: PDFDocument;
  readonly measure = new Measure();
  readonly width: number;
  readonly height: number;
  page!: PDFPage;
  y = 0;
  lastQuote = 0;

  constructor(doc: PDFDocument, readonly fonts: { regular: PDFFont; bold: PDFFont }, size: [number, number]) {
    this.doc = doc;
    [this.width, this.height] = size;
    this.newPage();
  }

  get contentWidth() { return this.width - 2 * MARGIN; }
  get bottom() { return MARGIN + FOOTER; }
  get pageHeight() { return this.height - MARGIN - this.bottom; }

  newPage() {
    if (this.doc.getPageCount() >= MAX_PAGES) throw new PdfError('tooManyPages');
    this.page = this.doc.addPage([this.width, this.height]);
    this.y = this.height - MARGIN;
  }

  /** Starts a new page unless `height` fits below the current position. */
  ensure(height: number) {
    if (this.y - height < this.bottom && this.y < this.height - MARGIN) this.newPage();
  }

  atTop() { return this.y >= this.height - MARGIN; }

  style(run: Run, base: { size: number; bold?: boolean; color?: RGB }): Style {
    const color = run.href ? LINK : run.muted ? MUTED : base.color ?? INK;
    return { font: run.bold || base.bold ? this.fonts.bold : this.fonts.regular, size: base.size, color, italic: !!run.italic || !!run.muted, href: run.href };
  }

  quoteBars(depth: number, top: number, bottom: number) {
    for (let level = 0; level < depth; level++) {
      const x = MARGIN + level * QUOTE_STEP + 1;
      this.page.drawLine({ start: { x, y: top }, end: { x, y: bottom }, thickness: 1.5, color: RULE });
    }
  }

  drawLine(line: Line, x: number, baseline: number) {
    let cursor = x;
    // Neighbouring pieces with the same look are drawn as one string.
    const segments: Piece[] = [];
    for (const piece of line.pieces) {
      const last = segments.at(-1);
      if (last && last.font === piece.font && last.size === piece.size && last.color === piece.color && last.italic === piece.italic && last.href === piece.href) {
        last.text += piece.text;
        last.width += piece.width;
      } else segments.push({ ...piece });
    }
    for (const segment of segments) {
      if (segment.text.trim()) {
        this.page.drawText(segment.text, { x: cursor, y: baseline, size: segment.size, font: segment.font, color: segment.color, ...(segment.italic ? { ySkew: ITALIC } : {}) });
      }
      if (segment.href && segment.text.trim()) {
        const text = segment.text.trimEnd();
        const width = segment.width - (segment.text.length - text.length ? this.measure.width(segment.font, segment.text.slice(text.length), segment.size) : 0);
        this.page.drawLine({ start: { x: cursor, y: baseline - 1.4 }, end: { x: cursor + width, y: baseline - 1.4 }, thickness: 0.5, color: LINK });
        this.link([cursor, baseline - segment.size * 0.28, cursor + width, baseline + segment.size * 0.92], segment.href);
      }
      cursor += segment.width;
    }
  }

  link(rect: number[], href: string) {
    let uri: string;
    try {
      uri = new URL(href).href;
    } catch {
      return;
    }
    const annotation = this.doc.context.obj({
      Type: 'Annot', Subtype: 'Link', Rect: rect, Border: [0, 0, 0],
      A: { Type: 'Action', S: 'URI', URI: PDFString.of(uri) },
    });
    this.page.node.addAnnot(this.doc.context.register(annotation));
  }

  /** Draws wrapped lines starting at the current position, breaking pages between lines. */
  lines(lines: Line[], x: number, quote: number, marker?: { text: string; style: Style }) {
    lines.forEach((line, index) => {
      const height = line.size * LEADING;
      this.ensure(height);
      const top = this.y;
      const baseline = top - height + line.size * 0.36;
      if (quote) this.quoteBars(quote, top, top - height);
      if (marker && index === 0) {
        const width = this.measure.width(marker.style.font, marker.text, marker.style.size);
        this.page.drawText(marker.text, { x: x - width - 5, y: baseline, size: marker.style.size, font: marker.style.font, color: marker.style.color });
      }
      this.drawLine(line, x, baseline);
      this.y -= height;
    });
  }

  gap(size: number, quote: number) {
    if (this.atTop()) return;
    const height = size * 0.7;
    const shared = Math.min(quote, this.lastQuote);
    if (shared && this.y - height > this.bottom) this.quoteBars(shared, this.y, this.y - height);
    this.y -= height;
  }
}

const levelSize = (level: TextBlock['level']) => (level === 1 ? SIZE.h1 : level === 2 ? SIZE.h2 : level === 3 ? SIZE.h3 : SIZE.body);

function indentOf(block: Block) { return block.quote * QUOTE_STEP + block.indent * LIST_STEP + (block.quote ? 6 : 0); }

function drawText(writer: Writer, block: TextBlock) {
  const size = levelSize(block.level);
  if (block.gap || block.level) writer.gap(block.level ? size : SIZE.body, block.quote);
  const x = MARGIN + indentOf(block);
  const base = { size, bold: block.level > 0 };
  const runs = block.runs.map(run => ({ text: run.text, style: writer.style(run, base) }));
  const lines = wrap(runs, writer.width - MARGIN - x, writer.measure, !!block.pre);
  const marker = block.marker ? { text: block.marker, style: writer.style({ text: '' }, { size: SIZE.body }) } : undefined;
  writer.lines(lines, x, block.quote, marker);
  writer.lastQuote = block.quote;
}

/** Returns false when a row is taller than a page; the caller then shows the cells as paragraphs instead. */
function drawTable(writer: Writer, block: TableBlock): boolean {
  const x0 = MARGIN + indentOf(block);
  const available = writer.width - MARGIN - x0;
  const columns = Math.max(...block.rows.map(row => row.reduce((sum, cell) => sum + cell.span, 0)));
  const styled = block.rows.map(row => row.map(cell => ({ span: cell.span, runs: cell.runs.map(run => ({ text: run.text, style: writer.style(run, { size: SIZE.table }) })) })));

  const min = new Array<number>(columns).fill(0);
  const natural = new Array<number>(columns).fill(0);
  for (const row of styled) {
    let column = 0;
    for (const cell of row) {
      if (cell.span === 1) {
        min[column] = Math.max(min[column], longestWord(cell.runs, writer.measure));
        natural[column] = Math.max(natural[column], naturalWidth(cell.runs, writer.measure));
      }
      column += cell.span;
    }
  }
  const pad = 2 * CELL_PAD;
  const naturalTotal = natural.reduce((sum, width) => sum + width + pad, 0);
  const minTotal = min.reduce((sum, width) => sum + width + pad, 0);
  let widths: number[];
  if (naturalTotal <= available) widths = natural.map(width => width + pad);
  else if (minTotal >= available) widths = min.map(width => ((width + pad) / minTotal) * available);
  else {
    const flexible = natural.reduce((sum, width, index) => sum + (width - min[index]), 0) || 1;
    widths = min.map((width, index) => width + pad + ((available - minTotal) * (natural[index] - width)) / flexible);
  }

  const laidOut = styled.map(row => {
    let column = 0;
    const cells = row.map(cell => {
      const x = x0 + widths.slice(0, column).reduce((sum, width) => sum + width, 0);
      const width = widths.slice(column, column + cell.span).reduce((sum, value) => sum + value, 0);
      column += cell.span;
      const lines = cell.runs.length ? wrap(cell.runs, Math.max(width - pad, 1), writer.measure, false) : [];
      return { x, lines, height: lines.reduce((sum, line) => sum + line.size * LEADING, 0) };
    });
    return { cells, height: Math.max(0, ...cells.map(cell => cell.height)) + pad };
  });
  if (laidOut.some(row => row.height > writer.pageHeight)) return false;

  if (block.gap) writer.gap(SIZE.body, block.quote);
  const tableWidth = widths.reduce((sum, width) => sum + width, 0);
  for (const row of laidOut) {
    writer.ensure(row.height);
    const top = writer.y;
    if (block.quote) writer.quoteBars(block.quote, top, top - row.height);
    for (const cell of row.cells) {
      let y = top - CELL_PAD;
      for (const line of cell.lines) {
        const height = line.size * LEADING;
        writer.drawLine(line, cell.x + CELL_PAD, y - height + line.size * 0.36);
        y -= height;
      }
    }
    writer.y = top - row.height;
    writer.page.drawLine({ start: { x: x0, y: writer.y }, end: { x: x0 + tableWidth, y: writer.y }, thickness: 0.5, color: RULE });
  }
  writer.lastQuote = block.quote;
  return true;
}

function tableAsText(block: TableBlock): TextBlock[] {
  return block.rows.flatMap(row => row.filter(cell => cell.runs.length).map((cell, index): TextBlock => ({
    kind: 'text', runs: cell.runs, level: 0, indent: block.indent, quote: block.quote, gap: index === 0 && block.gap,
  })));
}

export async function emailToPdf(email: ParsedEmail, fontBytes: { regular: Uint8Array; bold: Uint8Array }, options: PdfOptions): Promise<PdfResult> {
  const { labels } = options;
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const regular = await doc.embedFont(fontBytes.regular, { subset: true });
  const bold = await doc.embedFont(fontBytes.bold, { subset: true });
  const glyphs = new Glyphs(new Set(regular.getCharacterSet()));

  const hasHtml = email.html.some(part => part.trim());
  const hasText = email.text.some(part => part.trim());
  const body: PdfResult['body'] = options.body === 'text' ? (hasText ? 'text' : hasHtml ? 'html' : 'none') : hasHtml ? 'html' : hasText ? 'text' : 'none';
  const parsed = body === 'html'
    ? email.html.map(htmlToBlocks)
    : body === 'text' ? email.text.map(textToBlocks) : [];
  const remoteImages = parsed.reduce((sum, part) => sum + part.remoteImages, 0);
  const blocks = parsed.flatMap((part, index) => index && part.blocks[0] ? [{ ...part.blocks[0], gap: true }, ...part.blocks.slice(1)] : part.blocks);

  // Clean every string first, so a message the font can't show fails before any work.
  for (const block of blocks) {
    if (block.kind === 'text') block.runs = glyphs.runs(block.runs);
    if (block.kind === 'table') for (const row of block.rows) for (const cell of row) cell.runs = glyphs.runs(cell.runs);
  }
  const headers = Object.fromEntries(Object.entries(email.headers).map(([key, value]) => [key, glyphs.clean(value)])) as ParsedEmail['headers'];

  // Images the body shows by Content-ID are part of the message, not attachments.
  const byCid = new Map(email.attachments.filter(file => file.cid).map(file => [file.cid!.toLowerCase(), file]));
  const shown = new Set<EmlAttachment>();
  const images = new Map<string, PDFImage | null>();
  let skippedImages = 0;
  const loadImage = async (src: string): Promise<PDFImage | null> => {
    if (images.has(src)) return images.get(src)!;
    let bytes: Uint8Array | undefined;
    if (/^cid:/i.test(src)) {
      let id = src.slice(4).trim();
      try { id = decodeURIComponent(id); } catch { /* keep it as written */ }
      const file = byCid.get(id.replace(/^<|>$/g, '').toLowerCase());
      if (file) { shown.add(file); bytes = file.bytes; }
    } else {
      const data = /^data:image\/[\w.+-]+(;[^,]*)?,(.*)$/is.exec(src);
      if (data) bytes = /;base64/i.test(data[1] ?? '') ? fromBinary(base64Binary(data[2])) : new TextEncoder().encode(decodeURIComponent(data[2]));
    }
    let image: PDFImage | null = null;
    if (bytes?.length) {
      try {
        let kind = sniffImage(bytes);
        if (kind === 'other' && options.toPng) {
          const png = await options.toPng(bytes);
          if (png) { bytes = png; kind = 'png'; }
        }
        if (kind === 'png' && (await isIntactPng(bytes))) image = await doc.embedPng(bytes);
        else if (kind === 'jpg') image = await doc.embedJpg(bytes);
      } catch {
        image = null;
      }
    }
    if (!image) skippedImages++;
    images.set(src, image);
    return image;
  };
  for (const block of blocks) if (block.kind === 'image') await loadImage(block.src);

  const listed = email.attachments.filter(file => !shown.has(file));
  const names = listed.map(file => glyphs.clean(file.name) || file.name.replace(/[^\x20-\x7e]/g, '_'));

  if (glyphs.missingLetters >= 20 && glyphs.missingLetters > glyphs.letters * 0.25) throw new PdfError('unsupportedScript');

  const writer = new Writer(doc, { regular, bold }, PAGE_SIZES[options.pageSize]);

  // Subject and header table.
  const title = headers.subject || labels.noSubject;
  writer.lines(wrap([{ text: title, style: { font: bold, size: SIZE.title, color: INK, italic: false } }], writer.contentWidth, writer.measure, false), MARGIN, 0);
  writer.y -= 8;
  const rows: [string, string][] = [
    [labels.from, headers.from], [labels.to, headers.to], [labels.cc, headers.cc], [labels.bcc, headers.bcc],
    [labels.replyTo, headers.replyTo], [labels.date, headers.date],
    [labels.attachments, listed.map((file, index) => `${names[index]} (${labels.size(file.bytes.length)})`).join('\n')],
  ];
  const visible = rows.filter(([, value]) => value);
  const labelStyle: Style = { font: bold, size: SIZE.header, color: MUTED, italic: false };
  const valueStyle: Style = { font: regular, size: SIZE.header, color: INK, italic: false };
  const labelWidth = Math.min(writer.contentWidth / 3, Math.max(...visible.map(([label]) => writer.measure.width(bold, glyphs.clean(label), SIZE.header)))) + 12;
  for (const [label, value] of visible) {
    const lines = wrap([{ text: value, style: valueStyle }], writer.contentWidth - labelWidth, writer.measure, false);
    writer.ensure(SIZE.header * LEADING);
    const baseline = writer.y - SIZE.header * LEADING + SIZE.header * 0.36;
    writer.page.drawText(glyphs.clean(label), { x: MARGIN, y: baseline, size: SIZE.header, font: labelStyle.font, color: labelStyle.color });
    writer.lines(lines, MARGIN + labelWidth, 0);
  }
  writer.y -= 8;
  writer.page.drawLine({ start: { x: MARGIN, y: writer.y }, end: { x: writer.width - MARGIN, y: writer.y }, thickness: 1, color: RULE });
  writer.y -= 14;

  // Body.
  const notice = email.encrypted && body === 'none' ? labels.encrypted : body === 'none' ? labels.noBody : '';
  if (notice) writer.lines(wrap([{ text: glyphs.clean(notice), style: { ...valueStyle, size: SIZE.body, color: MUTED, italic: true } }], writer.contentWidth, writer.measure, false), MARGIN, 0);
  for (const block of blocks) {
    if (block.kind === 'text') {
      if (block.runs.length) drawText(writer, block);
    } else if (block.kind === 'table') {
      if (!drawTable(writer, block)) for (const text of tableAsText(block)) drawText(writer, text);
    } else if (block.kind === 'rule') {
      writer.gap(SIZE.body, block.quote);
      writer.ensure(6);
      const x = MARGIN + indentOf(block);
      writer.page.drawLine({ start: { x, y: writer.y - 3 }, end: { x: writer.width - MARGIN, y: writer.y - 3 }, thickness: 0.75, color: RULE });
      writer.y -= 6;
      writer.lastQuote = block.quote;
    } else {
      const image = images.get(block.src);
      if (!image) continue;
      const x = MARGIN + indentOf(block);
      let width = (block.width ?? (block.height ? (block.height * image.width) / image.height : image.width)) * PX;
      let height = (block.height ?? (block.width ? (block.width * image.height) / image.width : image.height)) * PX;
      const scale = Math.min(1, (writer.width - MARGIN - x) / width, writer.pageHeight / height);
      width *= scale;
      height *= scale;
      if (block.gap) writer.gap(SIZE.body, block.quote);
      writer.ensure(height + 4);
      if (block.quote) writer.quoteBars(block.quote, writer.y, writer.y - height - 4);
      writer.page.drawImage(image, { x, y: writer.y - height - 2, width, height });
      writer.y -= height + 4;
      writer.lastQuote = block.quote;
    }
  }

  const pages = doc.getPages();
  pages.forEach((page, index) => {
    const text = glyphs.clean(labels.page(index + 1, pages.length));
    const width = writer.measure.width(regular, text, SIZE.footer);
    page.drawText(text, { x: (writer.width - width) / 2, y: MARGIN - 6, size: SIZE.footer, font: regular, color: MUTED });
  });

  if (options.attachments === 'embed') {
    const used = new Set<string>();
    for (const [index, file] of listed.entries()) {
      let name = file.name;
      for (let copy = 2; used.has(name.toLowerCase()); copy++) name = file.name.replace(/(\.[^.]*)?$/, ext => ` (${copy})${ext}`);
      used.add(name.toLowerCase());
      await doc.attach(file.bytes, name, { mimeType: file.type, description: names[index] });
    }
  }

  doc.setTitle(headers.subject || labels.noSubject);
  if (headers.from) doc.setAuthor(headers.from);
  doc.setCreator('thetoolproject.com EML to PDF');
  const pdf = await doc.save({ useObjectStreams: true });
  return {
    pdf,
    pages: pages.length,
    body,
    attachments: listed.length,
    remoteImages,
    skippedImages,
    droppedCharacters: glyphs.dropped,
  };
}
