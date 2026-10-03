// Reads an .mht / .mhtml web archive (RFC 2557): a MIME message whose first HTML part is the page and
// whose other parts are the images, style sheets and frames it uses, named by Content-Location or
// Content-ID. Internet Explorer, Chrome and Edge ("Webpage, single file"), Word and Windows Steps
// Recorder all write this format. The MIME primitives are shared with the EML reader.
import { decodeBytes, decodeTransfer, fromBinary, headerText, parseStructured, splitEntity, splitMultipart, toBinary } from './eml';
import { decodeEntities } from './eml-html';

export type MhtPart = { type: string; bytes: Uint8Array; location?: string; cid?: string };
export type MhtArchive = {
  /** The Subject header or the page's <title>. */
  title: string;
  /** The web address the page was saved from, when it was saved from the web. */
  url: string;
  /** The Date header as written, usually the time the page was saved. */
  date: string;
  /** The page's HTML, decoded to text. */
  html: string;
  /** The page's own Content-Location, which its relative addresses are resolved against. */
  base: string;
  /** Every other part: images, style sheets, fonts, frames. */
  parts: MhtPart[];
  /** The page named a charset the browser doesn't know, so it was read as UTF-8 or Windows-1252. */
  charsetFallback: boolean;
};
export type MhtErrorCode = 'empty' | 'notMht' | 'noPage';

/** A file the page can explain; the caller maps the code to a translated message. */
export class MhtError extends Error {
  constructor(readonly code: MhtErrorCode) { super(code); }
}

type Leaf = { type: string; charset: string; bytes: Uint8Array; location: string; cid: string };

const MAX_DEPTH = 20;
// Relative Content-Locations (Steps Recorder writes "main.htm" and "screenshot0001.JPEG") are resolved
// against this stand-in, so they compare equal to the page's relative references.
const STAND_IN = 'http://mht.invalid/';

function walk(raw: string, leaves: Leaf[], depth: number) {
  if (depth > MAX_DEPTH) return;
  const { headers, body } = splitEntity(raw);
  const contentType = parseStructured(headers.get('content-type') ?? 'text/plain');
  const type = /^[\w.+-]+\/[\w.+-]+$/.test(contentType.value) ? contentType.value : 'text/plain';
  if (type.startsWith('multipart/') && contentType.params.boundary) {
    for (const part of splitMultipart(body, contentType.params.boundary)) walk(part, leaves, depth + 1);
    return;
  }
  const encoding = (headers.get('content-transfer-encoding') ?? '').trim().toLowerCase();
  leaves.push({
    type,
    charset: contentType.params.charset ?? '',
    bytes: fromBinary(decodeTransfer(body, encoding)),
    location: headerText(headers.get('content-location')),
    cid: headerText(headers.get('content-id')).replace(/^<|>$/g, ''),
  });
}

/** The charset a page declares in a <meta> tag, for HTML parts whose Content-Type doesn't say. */
export function metaCharset(bytes: Uint8Array): string {
  const head = toBinary(bytes.subarray(0, 4096));
  return /<meta[^>]+charset\s*=\s*["']?\s*([\w.:-]+)/i.exec(head)?.[1] ?? '';
}

function pageTitle(html: string): string {
  const match = /<title[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html);
  return match ? decodeEntities(match[1]).replace(/\s+/g, ' ').trim() : '';
}

const looksLikeHtml = (raw: string) => /^\s*(?:<!--[\s\S]*?-->\s*)*<(?:!doctype\s+html|html|head|body|meta|title)\b/i.test(raw.slice(0, 2048));

export function parseMht(bytes: Uint8Array): MhtArchive {
  let raw = toBinary(bytes);
  if (raw.startsWith('\xef\xbb\xbf')) raw = raw.slice(3);
  raw = raw.replace(/^(?:[ \t]*\r?\n)+/, '');
  if (!raw.trim()) throw new MhtError('empty');

  // A web page saved as plain HTML but named .mht still converts, without images.
  if (looksLikeHtml(raw)) {
    const decoded = decodeBytes(bytes, metaCharset(bytes));
    return { title: pageTitle(decoded.text), url: '', date: '', html: decoded.text, base: '', parts: [], charsetFallback: decoded.fallback };
  }

  const { headers } = splitEntity(raw);
  if (!headers.has('content-type') && !headers.has('mime-version')) throw new MhtError('notMht');
  const top = parseStructured(headers.get('content-type'));
  const leaves: Leaf[] = [];
  walk(raw, leaves, 0);

  // The root is the part named by the "start" parameter, else the first HTML part.
  const start = (top.params.start ?? '').replace(/^<|>$/g, '').toLowerCase();
  let rootIndex = start ? leaves.findIndex(leaf => leaf.cid.toLowerCase() === start) : -1;
  if (rootIndex < 0) rootIndex = leaves.findIndex(leaf => leaf.type === 'text/html' || leaf.type === 'application/xhtml+xml');
  if (rootIndex < 0) throw new MhtError('noPage');
  const root = leaves[rootIndex];
  const decoded = decodeBytes(root.bytes, root.charset || metaCharset(root.bytes));
  const html = decoded.text.replace(/\r\n?/g, '\n');

  // Chrome and Edge record the address in Snapshot-Content-Location; Internet Explorer in the page's Content-Location.
  const address = headerText(headers.get('snapshot-content-location')) || root.location;
  return {
    title: headerText(headers.get('subject')) || pageTitle(html),
    url: /^https?:\/\//i.test(address) ? address : '',
    date: headerText(headers.get('date')),
    html,
    base: root.location,
    parts: leaves.filter((_, index) => index !== rootIndex).map(leaf => ({
      type: leaf.type, bytes: leaf.bytes,
      ...(leaf.location ? { location: leaf.location } : {}),
      ...(leaf.cid ? { cid: leaf.cid } : {}),
    })),
    charsetFallback: decoded.fallback,
  };
}

function absolute(reference: string, base?: string): URL | undefined {
  try {
    return new URL(reference, base ? new URL(base, STAND_IN) : STAND_IN);
  } catch {
    return undefined;
  }
}

const withoutHash = (url: URL) => url.href.replace(/#.*$/, '');
const fileName = (url: URL) => {
  const name = url.pathname.split(/[/\\]/).pop() ?? '';
  try { return decodeURIComponent(name).toLowerCase(); } catch { return name.toLowerCase(); }
};

/**
 * Finds the archive part a reference points to: by Content-ID for cid: references, else by resolving it
 * against `from` (the referring part's location, the page's by default) and comparing Content-Locations,
 * then ignoring case, then by file name when only one part has it.
 */
export function createResolver(archive: Pick<MhtArchive, 'base' | 'parts'>) {
  const byCid = new Map<string, number>();
  const byLocation = new Map<string, number>();
  const byLowerLocation = new Map<string, number>();
  const byName = new Map<string, number | null>();
  archive.parts.forEach((part, index) => {
    if (part.cid) byCid.set(part.cid.toLowerCase(), index);
    const url = part.location ? absolute(part.location) : undefined;
    if (!url) return;
    const key = withoutHash(url);
    if (!byLocation.has(key)) byLocation.set(key, index);
    if (!byLowerLocation.has(key.toLowerCase())) byLowerLocation.set(key.toLowerCase(), index);
    const name = fileName(url);
    if (name) byName.set(name, byName.has(name) && byName.get(name) !== index ? null : index);
  });

  return (reference: string, from = archive.base): number | undefined => {
    const ref = reference.trim();
    if (!ref || /^(data|javascript|about|blob):/i.test(ref)) return undefined;
    if (/^cid:/i.test(ref)) {
      let id = ref.slice(4);
      try { id = decodeURIComponent(id); } catch { /* keep it as written */ }
      return byCid.get(id.replace(/^<|>$/g, '').toLowerCase());
    }
    const url = absolute(ref, from);
    if (!url) return undefined;
    const key = withoutHash(url);
    return byLocation.get(key) ?? byLowerLocation.get(key.toLowerCase()) ?? byName.get(fileName(url)) ?? undefined;
  };
}

/** A link in the page made absolute against the address it was saved from, when that is a web address. */
export function linkUrl(href: string, archive: Pick<MhtArchive, 'base' | 'url'>): string | undefined {
  const ref = href.trim();
  if (/^(https?:|mailto:)/i.test(ref)) return ref;
  const base = archive.url || archive.base;
  if (!/^https?:\/\//i.test(base)) return undefined;
  try {
    return new URL(ref, base).href;
  } catch {
    return undefined;
  }
}

/** Whether an address that isn't in the archive points to the internet, rather than to a file that wasn't saved. */
export function isWebAddress(reference: string, archive: Pick<MhtArchive, 'base'>): boolean {
  const url = absolute(reference.trim(), archive.base);
  return !!url && /^https?:$/.test(url.protocol) && url.hostname !== new URL(STAND_IN).hostname;
}

/** Rewrites every url(…) and @import in a style sheet with `map`, which returns the new address or undefined to leave it. */
export function rewriteCss(css: string, map: (url: string) => string | undefined): string {
  const swap = (url: string) => map(url.trim());
  return css
    .replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"]*?))\s*\)/gi, (match, double?: string, single?: string, bare?: string) => {
      const next = swap(double ?? single ?? bare ?? '');
      return next ? `url("${next}")` : match;
    })
    .replace(/@import\s+(["'])([^"']*)\1/gi, (match, _quote: string, url: string) => {
      const next = swap(url);
      return next ? `@import url("${next}")` : match;
    });
}

/** Rewrites the addresses in a srcset ("a.png 1x, b.png 2x"), keeping each descriptor. */
export function rewriteSrcset(srcset: string, map: (url: string) => string | undefined): string {
  // Candidates are split at a comma followed by a space or ending a descriptor, so data: URLs stay whole.
  return srcset.split(/,\s+|(?<=\s\d+(?:\.\d+)?[xw]),/).map(candidate => {
    const [url, ...descriptor] = candidate.trim().split(/\s+/);
    return [map(url) ?? url, ...descriptor].join(' ');
  }).join(', ');
}
