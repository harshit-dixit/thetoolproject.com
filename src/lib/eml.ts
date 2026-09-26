// Reads an .eml message (RFC 5322 + MIME) into headers, body text and attachments.
// The file is handled as a "binary string" (one byte per UTF-16 code unit), so MIME structure can be
// found with string methods before each part is decoded with its own transfer encoding and charset.

export type EmlAttachment = { name: string; type: string; bytes: Uint8Array; cid?: string };
export type EmlHeaders = { subject: string; from: string; to: string; cc: string; bcc: string; replyTo: string; date: string };
export type ParsedEmail = {
  headers: EmlHeaders;
  /** HTML body parts, in message order. */
  html: string[];
  /** Plain-text body parts, in message order. */
  text: string[];
  attachments: EmlAttachment[];
  /** An S/MIME or PGP encrypted part was found; its content can't be shown. */
  encrypted: boolean;
  /** A body part named a charset the browser doesn't know, so it was read as UTF-8 or Windows-1252. */
  charsetFallback: boolean;
};
export type EmlErrorCode = 'empty' | 'outlookMsg' | 'notEmail';

/** A file the page can explain; the caller maps the code to a translated message. */
export class EmlError extends Error {
  constructor(readonly code: EmlErrorCode) { super(code); }
}

type Context = { encrypted: boolean; charsetFallback: boolean; unnamed: number };
type Collected = { html: string[]; text: string[]; attachments: EmlAttachment[] };

const MAX_DEPTH = 20;
// Headers that only a message has; a file with none of them is something else.
const MESSAGE_HEADERS = ['from', 'date', 'subject', 'message-id', 'to', 'mime-version', 'received'];
const EXTENSIONS: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'application/pdf': 'pdf',
  'text/calendar': 'ics', 'message/rfc822': 'eml', 'text/plain': 'txt', 'text/html': 'html', 'application/zip': 'zip',
};

export function toBinary(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000) as unknown as number[]);
  return out;
}

export function fromBinary(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return bytes;
}

const ASCII_LABELS = new Set(['', 'us-ascii', 'ascii', 'ansi_x3.4-1968', 'iso646-us', 'default', 'unknown-8bit', 'x-unknown']);

/** Decodes with the declared charset. Without a usable one: UTF-8 when the bytes are valid UTF-8, else Windows-1252. */
export function decodeBytes(bytes: Uint8Array, charset = ''): { text: string; fallback: boolean } {
  const label = charset.trim().replace(/^["']|["']$/g, '').toLowerCase();
  if (!ASCII_LABELS.has(label)) {
    try {
      return { text: new TextDecoder(label).decode(bytes), fallback: false };
    } catch {
      // Unknown label (utf-7, x-mac-*…): read it as below and tell the user.
    }
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder('windows-1252').decode(bytes);
  }
  return { text, fallback: !ASCII_LABELS.has(label) };
}

export function base64Binary(data: string): string {
  let clean = data.replace(/[^A-Za-z0-9+/]/g, '');
  const rest = clean.length % 4;
  if (rest === 1) clean = clean.slice(0, -1);
  else if (rest) clean += '='.repeat(4 - rest);
  try {
    return atob(clean);
  } catch {
    return '';
  }
}

export function quotedPrintableBinary(data: string): string {
  return data
    .replace(/[ \t]+(?=\r?\n|$)/g, '')
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

const ENCODED_WORD = /=\?([^?\s]+)\?([bBqQ])\?([^?\s]*)\?=/g;

/** RFC 2047 encoded words. Adjacent words are joined before decoding, since a character can be split across them. */
export function decodeWords(text: string): string {
  let out = '';
  let last = 0;
  // The bytes of the encoded words seen since the last plain text, all in one charset.
  const pending = { charset: '', data: '', active: false };
  const flush = () => {
    if (pending.active) out += decodeBytes(fromBinary(pending.data), pending.charset).text;
    pending.active = false;
  };
  for (const match of text.matchAll(ENCODED_WORD)) {
    const between = text.slice(last, match.index);
    if (!(pending.active && /^[ \t\r\n]*$/.test(between))) {
      flush();
      out += between;
    }
    // RFC 2231 allows a language after the charset: utf-8*en.
    const charset = match[1].replace(/\*.*$/, '').toLowerCase();
    const data = match[2].toUpperCase() === 'B'
      ? base64Binary(match[3])
      : match[3].replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
    if (pending.active && pending.charset === charset) pending.data += data;
    else {
      flush();
      Object.assign(pending, { charset, data, active: true });
    }
    last = match.index + match[0].length;
  }
  flush();
  return out + text.slice(last);
}

/** An unstructured header value as text: raw UTF-8 (RFC 6532) and encoded words, with folding whitespace collapsed. */
export function headerText(raw: string | undefined): string {
  if (!raw) return '';
  return decodeWords(decodeBytes(fromBinary(raw)).text).replace(/\s+/g, ' ').trim();
}

/** Splits an entity into its unfolded headers (first occurrence of each, lowercased names) and its body. */
export function splitEntity(raw: string): { headers: Map<string, string>; body: string } {
  let headerBlock = raw;
  let body = '';
  const leading = /^\r?\n/.exec(raw);
  if (leading) {
    headerBlock = '';
    body = raw.slice(leading[0].length);
  } else {
    const blank = /\r?\n\r?\n/.exec(raw);
    if (blank) {
      headerBlock = raw.slice(0, blank.index);
      body = raw.slice(blank.index + blank[0].length);
    }
  }
  const headers = new Map<string, string>();
  let name = '';
  let value = '';
  const store = () => { if (name && !headers.has(name)) headers.set(name, value.trim()); };
  for (const line of headerBlock.split(/\r?\n/)) {
    if (/^[ \t]/.test(line)) {
      if (name) value += line;
      continue;
    }
    store();
    const colon = line.indexOf(':');
    const field = colon > 0 ? line.slice(0, colon).trimEnd() : '';
    if (field && /^[!-9;-~]+$/.test(field)) {
      name = field.toLowerCase();
      value = line.slice(colon + 1);
    } else name = '';
  }
  store();
  return { headers, body };
}

/** A structured header such as Content-Type: its lowercased value and its parameters, including RFC 2231 ones. */
export function parseStructured(raw: string | undefined): { value: string; params: Record<string, string> } {
  const parts: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < (raw ?? '').length; i++) {
    const char = raw![i];
    if (quoted) {
      if (char === '\\' && i + 1 < raw!.length) current += char + raw![++i];
      else {
        if (char === '"') quoted = false;
        current += char;
      }
    } else if (char === '"') {
      quoted = true;
      current += char;
    } else if (char === ';') {
      parts.push(current);
      current = '';
    } else current += char;
  }
  parts.push(current);

  const segments = new Map<string, { index: number; extended: boolean; text: string }[]>();
  for (const part of parts.slice(1)) {
    const equals = part.indexOf('=');
    if (equals < 0) continue;
    const key = /^([^*\s]+)(?:\*(\d+))?(\*)?$/.exec(part.slice(0, equals).trim().toLowerCase());
    if (!key) continue;
    let text = part.slice(equals + 1).trim();
    if (text.startsWith('"')) text = text.slice(1, text.endsWith('"') && text.length > 1 ? -1 : undefined).replace(/\\(.)/g, '$1');
    const list = segments.get(key[1]) ?? [];
    list.push({ index: Number(key[2] ?? 0), extended: !!key[3], text });
    segments.set(key[1], list);
  }

  const params: Record<string, string> = {};
  for (const [name, list] of segments) {
    list.sort((a, b) => a.index - b.index);
    let charset = '';
    let data = '';
    for (const segment of list) {
      let text = segment.text;
      if (!segment.extended) {
        data += text;
        continue;
      }
      if (segment.index === 0) {
        const prefix = /^([^']*)'[^']*'([\s\S]*)$/.exec(text);
        if (prefix) {
          charset = prefix[1];
          text = prefix[2];
        }
      }
      data += text.replace(/%([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
    }
    params[name] = charset ? decodeBytes(fromBinary(data), charset).text : headerText(data);
  }
  return { value: parts[0].trim().toLowerCase(), params };
}

export function splitMultipart(body: string, boundary: string): string[] {
  const escaped = boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const delimiter = new RegExp(`(?:^|\\r?\\n)--${escaped}(--)?[ \\t]*(?=\\r?\\n|$)`, 'g');
  const parts: string[] = [];
  let start = -1;
  for (const match of body.matchAll(delimiter)) {
    if (start >= 0) parts.push(body.slice(start, match.index));
    if (match[1]) {
      start = -1;
      break;
    }
    start = match.index + match[0].length;
    const newline = /^\r?\n/.exec(body.slice(start, start + 2));
    if (newline) start += newline[0].length;
  }
  // A message cut off before its closing delimiter still has a usable last part.
  if (start >= 0) parts.push(body.slice(start));
  return parts;
}

function decodeTransfer(body: string, encoding: string): string {
  if (encoding === 'base64') return base64Binary(body);
  if (encoding === 'quoted-printable') return quotedPrintableBinary(body);
  return body;
}

/** RFC 3676 format=flowed: lines ending in a space continue on the next line. */
export function unflow(text: string, delsp: boolean): string {
  const out: string[] = [];
  let open: { quote: string; text: string } | null = null;
  for (const line of text.split('\n')) {
    const quote = /^>*/.exec(line)![0];
    let content = line.slice(quote.length);
    if (content.startsWith(' ')) content = content.slice(1);
    const soft = content.endsWith(' ') && content !== '-- ';
    if (open && open.quote === quote) open.text += content;
    else {
      if (open) out.push(open.quote + (open.quote ? ' ' : '') + open.text);
      open = { quote, text: content };
    }
    if (soft) {
      if (delsp) open.text = open.text.slice(0, -1);
    } else {
      out.push(open.quote + (open.quote ? ' ' : '') + open.text);
      open = null;
    }
  }
  if (open) out.push(open.quote + (open.quote ? ' ' : '') + open.text);
  return out.join('\n');
}

function safeFileName(name: string): string {
  return name.split(/[\\/]/).pop()!.replace(/[\u0000-\u001f\u007f]/g, '').trim();
}

function walk(raw: string, context: Context, out: Collected, depth: number, digest = false) {
  if (depth > MAX_DEPTH) return;
  const { headers, body } = splitEntity(raw);
  const contentType = parseStructured(headers.get('content-type') ?? (digest ? 'message/rfc822' : 'text/plain'));
  const type = /^[\w.+-]+\/[\w.+-]+$/.test(contentType.value) ? contentType.value : 'text/plain';
  const disposition = parseStructured(headers.get('content-disposition'));
  const encoding = (headers.get('content-transfer-encoding') ?? '').trim().toLowerCase();

  if (type.startsWith('multipart/') && contentType.params.boundary) {
    if (type === 'multipart/encrypted') context.encrypted = true;
    const parts = splitMultipart(body, contentType.params.boundary);
    if (type === 'multipart/alternative') {
      // Keep the last (richest) HTML and plain-text alternatives; attachments from every branch.
      let html: string[] | undefined;
      let text: string[] | undefined;
      for (const part of parts) {
        const branch: Collected = { html: [], text: [], attachments: [] };
        walk(part, context, branch, depth + 1);
        if (branch.html.length) html = branch.html;
        if (branch.text.length) text = branch.text;
        out.attachments.push(...branch.attachments);
      }
      if (html) out.html.push(...html);
      if (text) out.text.push(...text);
    } else {
      for (const part of parts) walk(part, context, out, depth + 1, type === 'multipart/digest');
    }
    return;
  }

  const content = decodeTransfer(body, encoding);
  const fileName = safeFileName(disposition.params.filename || contentType.params.name || '');
  const attached = disposition.value === 'attachment' || (!!fileName && disposition.value !== 'inline');
  if ((type === 'text/plain' || type === 'text/html') && !attached) {
    const decoded = decodeBytes(fromBinary(content), contentType.params.charset);
    if (decoded.fallback) context.charsetFallback = true;
    let text = decoded.text.replace(/\r\n?/g, '\n');
    if (type === 'text/plain' && contentType.params.format?.toLowerCase() === 'flowed') {
      text = unflow(text, contentType.params.delsp?.toLowerCase() === 'yes');
    }
    (type === 'text/html' ? out.html : out.text).push(text);
    return;
  }

  if (type === 'application/pkcs7-mime' || type === 'application/x-pkcs7-mime') {
    if ((contentType.params['smime-type'] ?? 'enveloped-data').toLowerCase() === 'enveloped-data') context.encrypted = true;
  }
  let name = fileName;
  if (!name && type === 'message/rfc822') {
    const subject = headerText(splitEntity(content).headers.get('subject'));
    name = `${subject.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').trim().slice(0, 80) || 'message'}.eml`;
  }
  if (!name) {
    context.unnamed++;
    name = `attachment-${context.unnamed}${EXTENSIONS[type] ? `.${EXTENSIONS[type]}` : ''}`;
  }
  const cid = headerText(headers.get('content-id')).replace(/^<|>$/g, '');
  out.attachments.push({ name, type, bytes: fromBinary(content), ...(cid ? { cid } : {}) });
}

export function parseEml(bytes: Uint8Array): ParsedEmail {
  // Outlook .msg files are OLE compound documents, not MIME text.
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) throw new EmlError('outlookMsg');
  let raw = toBinary(bytes);
  if (raw.startsWith('\xef\xbb\xbf')) raw = raw.slice(3);
  // Apple Mail .emlx: a byte count line, the message, then an XML property list.
  const emlx = /^(\d+)[ \t]*\r?\n/.exec(raw);
  if (emlx) raw = raw.slice(emlx[0].length, emlx[0].length + Number(emlx[1]));
  raw = raw.replace(/^(?:[ \t]*\r?\n)+/, '');
  // An mbox export starts with a "From sender date" separator line.
  raw = raw.replace(/^From [^\r\n]*\r?\n/, '');
  if (!raw.trim()) throw new EmlError('empty');

  const { headers } = splitEntity(raw);
  if (!MESSAGE_HEADERS.some(name => headers.has(name))) throw new EmlError('notEmail');

  const context: Context = { encrypted: false, charsetFallback: false, unnamed: 0 };
  const out: Collected = { html: [], text: [], attachments: [] };
  walk(raw, context, out, 0);
  return {
    headers: {
      subject: headerText(headers.get('subject')),
      from: headerText(headers.get('from')),
      to: headerText(headers.get('to')),
      cc: headerText(headers.get('cc')),
      bcc: headerText(headers.get('bcc')),
      replyTo: headerText(headers.get('reply-to')),
      date: headerText(headers.get('date')),
    },
    ...out,
    encrypted: context.encrypted,
    charsetFallback: context.charsetFallback,
  };
}
