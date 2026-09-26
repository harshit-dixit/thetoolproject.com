// Turns an email's HTML or plain-text body into simple blocks for the PDF layout: paragraphs,
// headings, list items, quotes, images, rules and small data tables. Web Workers have no DOM, so this
// reads HTML with a small, forgiving tokenizer. Nothing is fetched: remote images are only counted.

export type Run = { text: string; bold?: boolean; italic?: boolean; href?: string; muted?: boolean };
type Placement = { indent: number; quote: number; gap: boolean };
export type TextBlock = Placement & { kind: 'text'; runs: Run[]; level: 0 | 1 | 2 | 3; marker?: string; pre?: boolean };
export type ImageBlock = Placement & { kind: 'image'; src: string; width?: number; height?: number };
export type RuleBlock = Placement & { kind: 'rule' };
export type TableCell = { runs: Run[]; span: number };
export type TableBlock = Placement & { kind: 'table'; rows: TableCell[][] };
export type Block = TextBlock | ImageBlock | RuleBlock | TableBlock;
export type Body = { blocks: Block[]; remoteImages: number };

type State = {
  bold: boolean; italic: boolean; href?: string; pre: boolean; hidden: boolean;
  level: 0 | 1 | 2 | 3; indent: number; quote: number;
};
type Flow = { blocks: Block[]; para: TextBlock | null; space: boolean };
type Cell = { flow: Flow; span: number };
type Table = { rows: Cell[][]; open: Cell | null; nested: boolean; flowDepth: number };
type Entry = { name: string; state: State; close?: () => void };

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr', 'basefont', 'bgsound', 'frame', 'keygen']);
const RAW_TEXT = new Set(['script', 'style', 'title', 'textarea', 'xmp', 'noembed', 'noframes', 'iframe', 'noscript', 'template']);
const INVISIBLE = new Set(['head', 'select', 'svg', 'math', 'object', 'video', 'audio', 'canvas', 'map', 'datalist']);
const BLOCK = new Set(['address', 'article', 'aside', 'body', 'center', 'dd', 'details', 'dialog', 'dir', 'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'header', 'hgroup', 'html', 'legend', 'li', 'main', 'menu', 'nav', 'ol', 'section', 'summary', 'ul', 'caption', 'tbody', 'thead', 'tfoot']);
// Block elements that close an open <p>, as in HTML parsing.
const CLOSES_P = new Set([...BLOCK, 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'blockquote', 'table', 'hr']);
const GAP = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'blockquote', 'ul', 'ol', 'dl', 'table', 'figure']);
const MAX_TABLE_COLUMNS = 8;

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ensp: ' ', emsp: ' ', thinsp: ' ',
  zwnj: '‌', zwj: '‍', lrm: '‎', rlm: '‏', shy: '­', copy: '©', reg: '®', trade: '™',
  hellip: '…', mdash: '—', ndash: '–', minus: '−', lsquo: '‘', rsquo: '’', sbquo: '‚', ldquo: '“', rdquo: '”', bdquo: '„',
  laquo: '«', raquo: '»', lsaquo: '‹', rsaquo: '›', bull: '•', middot: '·', prime: '′', Prime: '″', dagger: '†', Dagger: '‡',
  permil: '‰', euro: '€', pound: '£', yen: '¥', cent: '¢', curren: '¤', sect: '§', para: '¶', deg: '°', plusmn: '±',
  times: '×', divide: '÷', frac12: '½', frac14: '¼', frac34: '¾', sup1: '¹', sup2: '²', sup3: '³', micro: 'µ',
  iexcl: '¡', iquest: '¿', ordf: 'ª', ordm: 'º', not: '¬', macr: '¯', acute: '´', cedil: '¸', uml: '¨', brvbar: '¦',
  larr: '←', rarr: '→', uarr: '↑', darr: '↓', harr: '↔', check: '✓', hearts: '♥', star: '☆', infin: '∞', ne: '≠', le: '≤', ge: '≥',
  Agrave: 'À', Aacute: 'Á', Acirc: 'Â', Atilde: 'Ã', Auml: 'Ä', Aring: 'Å', AElig: 'Æ', Ccedil: 'Ç', Egrave: 'È', Eacute: 'É',
  Ecirc: 'Ê', Euml: 'Ë', Igrave: 'Ì', Iacute: 'Í', Icirc: 'Î', Iuml: 'Ï', ETH: 'Ð', Ntilde: 'Ñ', Ograve: 'Ò', Oacute: 'Ó',
  Ocirc: 'Ô', Otilde: 'Õ', Ouml: 'Ö', Oslash: 'Ø', Ugrave: 'Ù', Uacute: 'Ú', Ucirc: 'Û', Uuml: 'Ü', Yacute: 'Ý', THORN: 'Þ',
  szlig: 'ß', agrave: 'à', aacute: 'á', acirc: 'â', atilde: 'ã', auml: 'ä', aring: 'å', aelig: 'æ', ccedil: 'ç', egrave: 'è',
  eacute: 'é', ecirc: 'ê', euml: 'ë', igrave: 'ì', iacute: 'í', icirc: 'î', iuml: 'ï', eth: 'ð', ntilde: 'ñ', ograve: 'ò',
  oacute: 'ó', ocirc: 'ô', otilde: 'õ', ouml: 'ö', oslash: 'ø', ugrave: 'ù', uacute: 'ú', ucirc: 'û', uuml: 'ü', yacute: 'ý',
  thorn: 'þ', yuml: 'ÿ', OElig: 'Œ', oelig: 'œ', Scaron: 'Š', scaron: 'š', Yuml: 'Ÿ', fnof: 'ƒ', circ: 'ˆ', tilde: '˜',
};
// HTML maps numeric references 128–159 to Windows-1252, as browsers do.
const CP1252 = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ';

export function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(/&(?:#(\d{1,7})|#[xX]([0-9A-Fa-f]{1,6})|([A-Za-z][A-Za-z0-9]{1,31}));?/g, (match, dec?: string, hex?: string, name?: string) => {
    if (name) return ENTITIES[name] ?? match;
    const code = dec ? parseInt(dec, 10) : parseInt(hex!, 16);
    if (code >= 128 && code <= 159) return CP1252[code - 128];
    if (!code || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '�';
    return String.fromCodePoint(code);
  });
}

function parseAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of source.matchAll(/([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
    const name = match[1].toLowerCase();
    if (!(name in attributes)) attributes[name] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attributes;
}

function cssValue(style: string, property: string): string | undefined {
  const match = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, 'i').exec(style);
  return match?.[1].replace(/!important/i, '').trim().toLowerCase();
}

function isHidden(attributes: Record<string, string>): boolean {
  if ('hidden' in attributes) return true;
  const style = attributes.style ?? '';
  if (!style) return false;
  if (cssValue(style, 'display') === 'none' || cssValue(style, 'visibility') === 'hidden') return true;
  if (cssValue(style, 'mso-hide') === 'all' || cssValue(style, 'opacity') === '0') return true;
  if (/^0(?:\.0+)?(?:px|pt|em|rem|%)?$/.test(cssValue(style, 'font-size') ?? '')) return true;
  // Newsletter preheaders: a box squeezed to nothing that hides its overflow.
  const squeezed = /^0(?:px)?$/.test(cssValue(style, 'max-height') ?? cssValue(style, 'height') ?? '');
  return squeezed && cssValue(style, 'overflow') === 'hidden';
}

function pixels(value: string | undefined): number | undefined {
  const match = /^\s*(\d+(?:\.\d+)?)\s*(px)?\s*$/i.exec(value ?? '');
  return match ? Number(match[1]) : undefined;
}

/** Text runs that differ only in text can share one run. */
function sameStyle(a: Run, b: Run) {
  return !!a.bold === !!b.bold && !!a.italic === !!b.italic && a.href === b.href && !!a.muted === !!b.muted;
}

function pushRun(runs: Run[], run: Run) {
  const last = runs.at(-1);
  if (last && sameStyle(last, run)) last.text += run.text;
  else runs.push(run);
}

const safeHref = (href: string | undefined) => (href && /^(https?:|mailto:)/i.test(href.trim()) ? href.trim() : undefined);

class Builder {
  flows: Flow[] = [{ blocks: [], para: null, space: true }];
  tables: Table[] = [];
  gap = false;
  marker: string | undefined;
  remoteImages = 0;

  get flow() { return this.flows.at(-1)!; }

  private place(state: State): Placement {
    const gap = this.gap && this.flow.blocks.length > 0;
    this.gap = false;
    return { indent: state.indent, quote: state.quote, gap };
  }

  private paragraph(state: State): TextBlock {
    const flow = this.flow;
    if (!flow.para) {
      flow.para = { kind: 'text', runs: [], level: state.level, ...this.place(state), ...(state.pre ? { pre: true } : {}) };
      if (this.marker) {
        flow.para.marker = this.marker;
        this.marker = undefined;
      }
      flow.space = true;
    }
    return flow.para;
  }

  /** Inside a table but outside its cells, where only whitespace is expected. */
  private fostered() {
    const table = this.tables.at(-1);
    return !!table && !table.open && this.flows.length === table.flowDepth;
  }

  text(raw: string, state: State) {
    if (state.hidden) return;
    let text = raw;
    if (state.pre) text = text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ');
    else {
      text = text.replace(/[ \t\n\r\f]+/g, ' ');
      if (this.flow.space || !this.flow.para) text = text.replace(/^ /, '');
    }
    // Stray text between table tags lands in the flow around the table, and closeTable puts it first, as browsers do.
    if (!text || (this.fostered() && !text.trim())) return;
    const para = this.paragraph(state);
    pushRun(para.runs, { text, ...(state.bold ? { bold: true } : {}), ...(state.italic ? { italic: true } : {}), ...(state.href ? { href: state.href } : {}) });
    this.flow.space = /[ \n]$/.test(text);
  }

  muted(text: string, state: State) {
    if (state.hidden || this.fostered()) return;
    const para = this.paragraph(state);
    const lead = this.flow.space ? '' : ' ';
    pushRun(para.runs, { text: `${lead}[${text}] `, muted: true });
    this.flow.space = true;
  }

  lineBreak(state: State) {
    if (state.hidden || this.fostered()) return;
    pushRun(this.paragraph(state).runs, { text: '\n' });
    this.flow.space = true;
  }

  endBlock(gap: boolean) {
    const flow = this.flow;
    const para = flow.para;
    flow.para = null;
    flow.space = true;
    if (para) {
      // A trailing <br> ends the line it's on; it doesn't add an empty one, unless it's all there is.
      const last = para.runs.at(-1)!;
      last.text = last.text.replace(/ +$/, '');
      if (last.text.endsWith('\n') && para.runs.some(run => run.text.trim())) last.text = last.text.slice(0, -1);
      para.runs = para.runs.filter(run => run.text);
      if (para.runs.length) flow.blocks.push(para);
    }
    if (gap) this.gap = true;
  }

  block(block: Omit<ImageBlock, keyof Placement> | Omit<RuleBlock, keyof Placement>, state: State) {
    if (state.hidden || this.fostered()) return;
    this.endBlock(false);
    this.flow.blocks.push({ ...block, ...this.place(state) } as Block);
  }

  openTable(): Table {
    this.endBlock(true);
    const parent = this.tables.at(-1);
    if (parent) parent.nested = true;
    const table: Table = { rows: [], open: null, nested: false, flowDepth: this.flows.length };
    this.tables.push(table);
    return table;
  }

  row(table: Table) {
    this.closeCell(table);
    table.rows.push([]);
  }

  cell(table: Table, span: number) {
    this.closeCell(table);
    if (!table.rows.length) table.rows.push([]);
    const cell: Cell = { flow: { blocks: [], para: null, space: true }, span };
    table.rows.at(-1)!.push(cell);
    table.open = cell;
    this.flows.push(cell.flow);
    this.gap = false;
  }

  closeCell(table: Table) {
    if (!table.open) return;
    this.endBlock(false);
    this.flows.length = table.flowDepth;
    table.open = null;
  }

  closeTable(table: Table, state: State) {
    this.closeCell(table);
    this.endBlock(false);
    this.tables.splice(this.tables.indexOf(table), 1);
    const rows = table.rows.filter(row => row.length);
    const columns = Math.max(0, ...rows.map(row => row.reduce((sum, cell) => sum + cell.span, 0)));
    const textOnly = rows.every(row => row.every(cell => cell.flow.blocks.every(block => block.kind === 'text')));
    const simple = !table.nested && textOnly && columns >= 2 && columns <= MAX_TABLE_COLUMNS
      && rows.some(row => row.filter(cell => cell.flow.blocks.length).length >= 2);
    if (simple) {
      this.flow.blocks.push({
        kind: 'table',
        rows: rows.map(row => row.map(cell => ({ span: cell.span, runs: cellRuns(cell.flow.blocks as TextBlock[]) }))),
        ...this.place(state),
      });
    } else {
      // Layout tables (and anything too complex for a grid) read top to bottom, cell by cell.
      for (const row of rows) for (const cell of row) this.flow.blocks.push(...cell.flow.blocks);
    }
    this.gap = true;
  }
}

function cellRuns(blocks: TextBlock[]): Run[] {
  const runs: Run[] = [];
  blocks.forEach((block, index) => {
    if (index) pushRun(runs, { text: '\n' });
    if (block.marker) pushRun(runs, { text: `${block.marker} ` });
    for (const run of block.runs) pushRun(runs, { ...run });
  });
  return runs;
}

export function htmlToBlocks(html: string): Body {
  const builder = new Builder();
  const root: State = { bold: false, italic: false, pre: false, hidden: false, level: 0, indent: 0, quote: 0 };
  const stack: Entry[] = [];
  const state = () => stack.at(-1)?.state ?? root;
  const lists: { ordered: boolean; count: number }[] = [];

  const pop = (index: number) => {
    while (stack.length > index) stack.pop()!.close?.();
  };
  // The innermost open element with this name, not looking past a table cell or table.
  const find = (name: string, boundaries: string[]) => {
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].name === name) return i;
      if (boundaries.includes(stack[i].name)) return -1;
    }
    return -1;
  };
  const closeIfOpen = (name: string, boundaries: string[]) => {
    const index = find(name, boundaries);
    if (index >= 0) pop(index);
  };

  // As in browsers, "<div/>" opens a div: only void elements have no content.
  function start(name: string, attributes: Record<string, string>) {
    const parent = state();
    if (parent.hidden) {
      if (!VOID.has(name)) stack.push({ name, state: parent });
      return;
    }
    if (CLOSES_P.has(name)) closeIfOpen('p', ['td', 'th', 'table', 'blockquote']);
    if (name === 'li') closeIfOpen('li', ['ul', 'ol', 'td', 'th', 'table']);
    if (name === 'dt' || name === 'dd') { closeIfOpen('dt', ['dl', 'td', 'th', 'table']); closeIfOpen('dd', ['dl', 'td', 'th', 'table']); }
    if (name === 'td' || name === 'th') { closeIfOpen('td', ['table']); closeIfOpen('th', ['table']); }
    if (name === 'tr') { closeIfOpen('td', ['table']); closeIfOpen('th', ['table']); closeIfOpen('tr', ['table']); }

    const current = state();
    const next: State = { ...current };
    if (isHidden(attributes) || INVISIBLE.has(name) || RAW_TEXT.has(name)) next.hidden = true;
    const style = attributes.style ?? '';

    if (name === 'br') { builder.lineBreak(current); return; }
    if (name === 'hr') {
      if (!next.hidden) { builder.block({ kind: 'rule' }, next); builder.gap = true; }
      return;
    }
    if (name === 'img') {
      if (next.hidden) return;
      const src = (attributes.src ?? '').trim();
      const width = pixels(attributes.width) ?? pixels(cssValue(style, 'width'));
      const height = pixels(attributes.height) ?? pixels(cssValue(style, 'height'));
      if ((width !== undefined && width <= 3) || (height !== undefined && height <= 3)) return; // spacers and tracking pixels
      if (/^(cid:|data:image\/)/i.test(src)) builder.block({ kind: 'image', src, ...(width ? { width } : {}), ...(height ? { height } : {}) }, current);
      else if (src) {
        builder.remoteImages++;
        const alt = (attributes.alt ?? '').replace(/\s+/g, ' ').trim();
        if (alt.length > 1) builder.muted(alt, current);
      }
      return;
    }
    if (VOID.has(name)) return;

    let close: (() => void) | undefined;
    if (name === 'b' || name === 'strong' || name === 'th') next.bold = true;
    if (name === 'i' || name === 'em' || name === 'cite' || name === 'var' || name === 'dfn') next.italic = true;
    const weight = cssValue(style, 'font-weight');
    if (weight) next.bold = /^(bold|bolder|[6-9]00)$/.test(weight) ? true : /^(normal|lighter|[1-5]00)$/.test(weight) ? false : next.bold;
    const fontStyle = cssValue(style, 'font-style');
    if (fontStyle) next.italic = fontStyle === 'italic' || fontStyle === 'oblique';
    if (name === 'a') next.href = safeHref(attributes.href) ?? current.href;
    if (name === 'pre' || name === 'plaintext' || name === 'listing') next.pre = true;
    if (/^h[1-6]$/.test(name)) { next.level = name === 'h1' ? 1 : name === 'h2' ? 2 : 3; next.bold = true; }
    if (name === 'blockquote') next.quote = current.quote + 1;
    if (!next.hidden && (name === 'ul' || name === 'ol' || name === 'dir' || name === 'menu')) {
      next.indent = current.indent + 1;
      // Only the outermost list has space around it.
      builder.endBlock(!lists.length);
      lists.push({ ordered: name === 'ol', count: Math.max(0, (Number(attributes.start) || 1) - 1) });
      const depth = lists.length;
      close = () => { builder.endBlock(depth === 1); lists.length = depth - 1; };
    }
    if (name === 'dd') next.indent = current.indent + 1;

    if (!next.hidden) {
      if (name === 'table') {
        const table = builder.openTable();
        close = () => builder.closeTable(table, next);
      } else if (name === 'tr') {
        const table = builder.tables.at(-1);
        if (table) { builder.row(table); close = () => builder.closeCell(table); }
      } else if (name === 'td' || name === 'th') {
        const table = builder.tables.at(-1);
        if (table) {
          builder.cell(table, Math.min(MAX_TABLE_COLUMNS, Math.max(1, Number(attributes.colspan) || 1)));
          close = () => builder.closeCell(table);
        }
      } else if (name === 'li') {
        builder.endBlock(false);
        const list = lists.at(-1);
        if (list) list.count++;
        builder.marker = list?.ordered ? `${list.count}.` : '•';
        if (!list) next.indent = current.indent + 1;
      }
      if (!close && (BLOCK.has(name) || CLOSES_P.has(name))) {
        builder.endBlock(GAP.has(name));
        close = () => builder.endBlock(GAP.has(name));
      }
    }
    stack.push({ name, state: next, close });
  }

  function end(name: string) {
    if (name === 'br') { builder.lineBreak(state()); return; }
    const boundaries = name === 'table' ? [] : name === 'td' || name === 'th' || name === 'tr' ? ['table'] : ['td', 'th', 'table'];
    const index = find(name, boundaries);
    if (index >= 0) pop(index);
    // A stray </p> still ends a paragraph in browsers.
    else if (name === 'p' && !state().hidden) builder.endBlock(true);
  }

  const tag = /<(\/?)([A-Za-z][A-Za-z0-9:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/y;
  // A tag with an unmatched quote ends at the next ">".
  const looseTag = /<(\/?)([A-Za-z][A-Za-z0-9:-]*)([^>]*)>/y;
  let i = 0;
  let textStart = 0;
  const flushText = (until: number) => {
    if (until > textStart) builder.text(decodeEntities(html.slice(textStart, until)), state());
  };
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) break;
    i = lt;
    if (html.startsWith('<!--', i)) {
      flushText(i);
      const endComment = html.indexOf('-->', i + 4);
      i = textStart = endComment < 0 ? html.length : endComment + 3;
      continue;
    }
    if (html.startsWith('<!', i) || html.startsWith('<?', i)) {
      flushText(i);
      const endDecl = html.indexOf('>', i);
      i = textStart = endDecl < 0 ? html.length : endDecl + 1;
      continue;
    }
    tag.lastIndex = looseTag.lastIndex = i;
    const match = tag.exec(html) ?? looseTag.exec(html);
    if (!match) { i++; continue; }
    flushText(i);
    const name = match[2].toLowerCase();
    i = textStart = i + match[0].length;
    if (match[1]) { end(name); continue; }
    start(name, parseAttributes(match[3]));
    if (RAW_TEXT.has(name)) {
      const closing = new RegExp(`</${name}\\s*>`, 'ig');
      closing.lastIndex = i;
      const found = closing.exec(html);
      i = textStart = found ? closing.lastIndex : html.length;
      end(name);
    }
  }
  flushText(html.length);
  pop(0);
  builder.flows.length = 1;
  builder.endBlock(false);
  return { blocks: builder.flow.blocks, remoteImages: builder.remoteImages };
}

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"]*[^\s<>"'.,;:!?)\]}]/g;

function linkify(line: string): Run[] {
  const runs: Run[] = [];
  let last = 0;
  for (const match of line.matchAll(URL_PATTERN)) {
    if (match.index > last) runs.push({ text: line.slice(last, match.index) });
    runs.push({ text: match[0], href: match[0] });
    last = match.index + match[0].length;
  }
  if (last < line.length) runs.push({ text: line.slice(last) });
  return runs;
}

/** Plain text keeps its line breaks and spacing. Lines starting with ">" are shown as quotes. */
export function textToBlocks(text: string): Body {
  const blocks: Block[] = [];
  let lines: string[] = [];
  let quote = 0;
  let gap = false;
  const flush = () => {
    if (lines.length) {
      const runs: Run[] = [];
      lines.forEach((line, index) => {
        if (index) pushRun(runs, { text: '\n' });
        for (const run of linkify(line)) pushRun(runs, run);
      });
      blocks.push({ kind: 'text', runs, level: 0, indent: 0, quote, gap: gap && blocks.length > 0, pre: true });
      gap = false;
    }
    lines = [];
  };
  for (const raw of text.replace(/\t/g, '    ').split('\n')) {
    const marker = /^(?:> ?)+/.exec(raw)?.[0] ?? '';
    const depth = (marker.match(/>/g) ?? []).length;
    const line = raw.slice(marker.length).trimEnd();
    if (depth !== quote) { flush(); quote = depth; }
    if (!line.trim()) { flush(); gap = true; continue; }
    lines.push(line);
  }
  flush();
  return { blocks, remoteImages: 0 };
}
