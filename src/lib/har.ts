// HAR 1.2 reader (http://www.softwareishard.com/blog/har-12-spec/), as written by Chrome, Edge, Firefox, Safari,
// Charles and Fiddler. The worker keeps the parsed log; the page gets a compact row per request and asks for one
// request's full details when it's opened.

export type ResourceType = 'fetch' | 'doc' | 'js' | 'css' | 'img' | 'font' | 'media' | 'ws' | 'misc';
export const RESOURCE_TYPES: ResourceType[] = ['fetch', 'doc', 'js', 'css', 'img', 'font', 'media', 'ws', 'misc'];

export type HarTimings = { blocked: number; dns: number; connect: number; ssl: number; send: number; wait: number; receive: number };

export type HarRow = {
  index: number;
  method: string;
  url: string;
  /** The last path segment (or the host for "/"), like the Name column in DevTools. */
  name: string;
  host: string;
  /** 0 when the request failed or was blocked before a response. */
  status: number;
  statusText: string;
  type: ResourceType;
  mime: string;
  /** Bytes over the network including headers, or -1 when the file doesn't say. */
  transferred: number;
  /** Decoded body size, or -1 when the file doesn't say. */
  size: number;
  /** Total time in ms, or -1 when the file doesn't say. */
  time: number;
  /** ms after the first request started. */
  start: number;
  page: string;
  cache: '' | 'memory' | 'disk' | 'revalidated';
  error: string;
};

export type HarPage = { id: string; title: string; started: number; onLoad: number; onContentLoad: number };

export type HarSummary = {
  creator: string;
  browser: string;
  version: string;
  /** Epoch ms of the first request, or 0 when no request has a valid start. */
  started: number;
  pages: HarPage[];
  rows: HarRow[];
  totals: { requests: number; errors: number; failed: number; transferred: number; size: number; span: number };
};

export type HarPair = { name: string; value: string };
export type HarCookie = { name: string; value: string; details: string };

export type HarDetail = {
  index: number;
  url: string;
  method: string;
  status: number;
  statusText: string;
  httpVersion: string;
  serverIp: string;
  connection: string;
  started: number;
  initiator: string;
  requestHeaders: HarPair[];
  responseHeaders: HarPair[];
  query: HarPair[];
  post?: { mime: string; text: string; params: HarPair[] };
  requestCookies: HarCookie[];
  responseCookies: HarCookie[];
  timings: HarTimings;
  time: number;
  /** text: readable body; image: base64 for an <img>; binary: not shown; none: the body wasn't saved. */
  content: { kind: 'text' | 'image' | 'binary' | 'none'; mime: string; size: number; text: string; base64: string; truncated: boolean; json: boolean };
  error: string;
};

export class HarError extends Error {
  constructor(public code: 'empty' | 'invalidJson' | 'notHar') { super(code); }
}

type Json = Record<string, unknown>;
const obj = (value: unknown): Json => (value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {});
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const str = (value: unknown): string => (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '');
const num = (value: unknown, fallback = -1): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

/** Shown text is capped so a 40 MB response doesn't freeze the page; the full body can still be downloaded. */
export const MAX_SHOWN_TEXT = 500_000;

export function parseHar(text: string): Json {
  const source = text.replace(/^﻿/, '');
  if (!source.trim()) throw new HarError('empty');
  let data: unknown;
  try { data = JSON.parse(source); } catch { throw new HarError('invalidJson'); }
  const log = obj(obj(data).log);
  if (!Array.isArray(log.entries)) throw new HarError('notHar');
  return log;
}

export function resourceType(entry: Json): ResourceType {
  const hint = str(entry._resourceType).toLowerCase();
  const byHint: Record<string, ResourceType> = {
    xhr: 'fetch', fetch: 'fetch', eventsource: 'fetch', document: 'doc', script: 'js', stylesheet: 'css', image: 'img',
    font: 'font', media: 'media', websocket: 'ws', webtransport: 'ws',
  };
  if (byHint[hint]) return byHint[hint];
  if (hint && hint !== 'other') return 'misc';
  if (arr(entry._webSocketMessages).length) return 'ws';
  const request = obj(entry.request);
  if (/^wss?:/i.test(str(request.url))) return 'ws';
  const mime = str(obj(obj(entry.response).content).mimeType).toLowerCase().split(';')[0].trim();
  if (/^text\/html|xhtml/.test(mime)) return 'doc';
  if (/javascript|ecmascript/.test(mime)) return 'js';
  if (mime === 'text/css') return 'css';
  if (mime.startsWith('image/')) return 'img';
  if (mime.startsWith('font/') || /woff|opentype|truetype|fontobject/.test(mime)) return 'font';
  if (mime.startsWith('audio/') || mime.startsWith('video/') || mime === 'application/vnd.apple.mpegurl') return 'media';
  if (/json|xml|text\/plain|event-stream|x-www-form-urlencoded|protobuf|grpc/.test(mime)) return 'fetch';
  return 'misc';
}

function splitUrl(url: string): { name: string; host: string } {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'data:') return { name: url.slice(0, 40), host: '' };
    const segments = parsed.pathname.split('/').filter(Boolean);
    const last = segments.length ? decodeSafe(segments[segments.length - 1]) : parsed.host;
    return { name: last + parsed.search, host: parsed.host };
  } catch {
    return { name: url, host: '' };
  }
}

function decodeSafe(value: string) {
  try { return decodeURIComponent(value); } catch { return value; }
}

function transferSize(response: Json): number {
  const reported = num(response._transferSize);
  if (reported >= 0) return reported;
  const body = num(response.bodySize);
  if (body < 0) return -1;
  return Math.max(0, num(response.headersSize, 0)) + body;
}

function cacheOf(entry: Json, status: number): HarRow['cache'] {
  const fromCache = str(entry._fromCache).toLowerCase();
  if (fromCache === 'memory' || fromCache === 'disk') return fromCache;
  if (status === 304) return 'revalidated';
  return '';
}

export function summarize(log: Json): HarSummary {
  const entries = arr(log.entries).map(obj);
  const creator = obj(log.creator);
  const browser = obj(log.browser);
  const starts = entries.map(entry => Date.parse(str(entry.startedDateTime)));
  const valid = starts.filter(Number.isFinite);
  // reduce, not Math.min(...valid): a spread of 100,000+ arguments overflows the stack.
  const started = valid.length ? valid.reduce((min, value) => Math.min(min, value)) : 0;
  let end = started;
  const totals = { requests: entries.length, errors: 0, failed: 0, transferred: 0, size: 0, span: 0 };
  const rows = entries.map((entry, index): HarRow => {
    const request = obj(entry.request);
    const response = obj(entry.response);
    const content = obj(response.content);
    const url = str(request.url);
    const status = num(response.status, 0);
    const error = str(response._error) || str(obj(entry._error).message);
    const time = num(entry.time);
    const start = Number.isFinite(starts[index]) ? starts[index] - started : 0;
    if (Number.isFinite(starts[index])) end = Math.max(end, starts[index] + Math.max(0, time));
    const transferred = transferSize(response);
    const size = num(content.size);
    if (status === 0 || error) totals.failed++;
    if (status >= 400 || status === 0 || error) totals.errors++;
    if (transferred > 0) totals.transferred += transferred;
    if (size > 0) totals.size += size;
    return {
      index, url, method: str(request.method).toUpperCase() || 'GET', ...splitUrl(url),
      status, statusText: str(response.statusText), type: resourceType(entry),
      mime: str(content.mimeType).split(';')[0].trim(), transferred, size, time, start,
      page: str(entry.pageref), cache: cacheOf(entry, status), error,
    };
  });
  totals.span = Math.max(0, end - started);
  const pages = arr(log.pages).map(obj).map((page): HarPage => {
    const timings = obj(page.pageTimings);
    return { id: str(page.id), title: str(page.title), started: Date.parse(str(page.startedDateTime)) || 0, onLoad: num(timings.onLoad), onContentLoad: num(timings.onContentLoad) };
  });
  return { creator: str(creator.name), browser: str(browser.name), version: str(browser.version) || str(creator.version), started, pages, rows, totals };
}

const pairs = (list: unknown): HarPair[] => arr(list).map(obj).map(item => ({ name: str(item.name), value: str(item.value) }));

function cookies(list: unknown): HarCookie[] {
  return arr(list).map(obj).map(cookie => {
    const details = [
      cookie.domain ? `Domain=${str(cookie.domain)}` : '', cookie.path ? `Path=${str(cookie.path)}` : '',
      cookie.expires ? `Expires=${str(cookie.expires)}` : '', cookie.httpOnly ? 'HttpOnly' : '', cookie.secure ? 'Secure' : '',
      cookie.sameSite ? `SameSite=${str(cookie.sameSite)}` : '',
    ].filter(Boolean).join('; ');
    return { name: str(cookie.name), value: str(cookie.value), details };
  });
}

function decodeBase64Text(base64: string): string | undefined {
  try {
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch { return undefined; }
}

const TEXT_MIME = /^text\/|json|xml|javascript|ecmascript|x-www-form-urlencoded|svg|graphql|csv|yaml/;

/** The full body as text, decoded from base64 when the HAR stored it that way. Empty when it isn't text. */
export function bodyText(log: Json, index: number): string {
  const content = obj(obj(obj(arr(log.entries)[index]).response).content);
  const text = str(content.text);
  return str(content.encoding).toLowerCase() === 'base64' ? decodeBase64Text(text) ?? '' : text;
}

export function detail(log: Json, index: number): HarDetail {
  const entry = obj(arr(log.entries)[index]);
  const request = obj(entry.request);
  const response = obj(entry.response);
  const content = obj(response.content);
  const timings = obj(entry.timings);
  const post = obj(request.postData);
  const initiator = obj(entry._initiator);
  const mime = str(content.mimeType).split(';')[0].trim().toLowerCase();
  const raw = str(content.text);
  const base64 = str(content.encoding).toLowerCase() === 'base64';
  let kind: HarDetail['content']['kind'] = 'none';
  let text = '';
  let image = '';
  if (raw) {
    if (base64 && mime.startsWith('image/') && mime !== 'image/svg+xml') { kind = 'image'; image = raw; }
    else if (base64) {
      const decoded = decodeBase64Text(raw);
      if (decoded !== undefined && (TEXT_MIME.test(mime) || !mime)) { kind = 'text'; text = decoded; } else kind = 'binary';
    } else { kind = 'text'; text = raw; }
  }
  let json = false;
  if (kind === 'text' && text.length <= 5_000_000 && (/json/.test(mime) || /^\s*[[{]/.test(text))) {
    try { text = JSON.stringify(JSON.parse(text), null, 2); json = true; } catch { /* Shown as it is. */ }
  }
  const truncated = text.length > MAX_SHOWN_TEXT;
  const initiatorUrl = str(initiator.url) || str(obj(arr(obj(initiator.stack).callFrames)[0]).url);
  return {
    index, url: str(request.url), method: str(request.method).toUpperCase() || 'GET',
    status: num(response.status, 0), statusText: str(response.statusText),
    httpVersion: str(response.httpVersion) || str(request.httpVersion), serverIp: str(entry.serverIPAddress), connection: str(entry.connection),
    started: Date.parse(str(entry.startedDateTime)) || 0,
    initiator: [str(initiator.type), initiatorUrl].filter(Boolean).join(': '),
    requestHeaders: pairs(request.headers), responseHeaders: pairs(response.headers), query: pairs(request.queryString),
    post: Object.keys(post).length ? { mime: str(post.mimeType), text: str(post.text).slice(0, MAX_SHOWN_TEXT), params: pairs(post.params) } : undefined,
    requestCookies: cookies(request.cookies), responseCookies: cookies(response.cookies),
    timings: {
      blocked: num(timings.blocked), dns: num(timings.dns), connect: num(timings.connect), ssl: num(timings.ssl),
      send: num(timings.send), wait: num(timings.wait), receive: num(timings.receive),
    },
    time: num(entry.time),
    content: { kind, mime, size: num(content.size), text: truncated ? text.slice(0, MAX_SHOWN_TEXT) : text, base64: image, truncated, json },
    error: str(response._error) || str(obj(entry._error).message),
  };
}

// Header names that carry sign-in state or secrets. Matching is by name only; values are never inspected.
const SECRET_HEADER = /^(cookie|set-cookie|authorization|proxy-authorization)$|token|key|secret|session|csrf|xsrf|password/i;

/** A copy of the log with cookies removed and secret-looking header values replaced, as a HAR file. */
export function sanitize(log: Json): { har: string; removed: number } {
  let removed = 0;
  const copy = structuredClone(log);
  const clean = (message: Json) => {
    for (const header of arr(message.headers).map(obj)) {
      if (SECRET_HEADER.test(str(header.name)) && str(header.value)) { header.value = '[removed]'; removed++; }
    }
    if (arr(message.cookies).length) { removed += arr(message.cookies).length; message.cookies = []; }
  };
  for (const entry of arr(copy.entries).map(obj)) { clean(obj(entry.request)); clean(obj(entry.response)); }
  return { har: JSON.stringify({ log: copy }, null, 2) + '\n', removed };
}
