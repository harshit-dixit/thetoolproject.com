import { describe, expect, it } from 'vitest';
import { bodyText, detail, HarError, MAX_SHOWN_TEXT, parseHar, resourceType, sanitize, summarize } from './har';
import { exampleHar } from './har-example';

const entry = (overrides: Record<string, unknown> = {}) => ({
  startedDateTime: '2026-03-12T14:30:00.000Z',
  time: 120,
  request: { method: 'get', url: 'https://example.com/api/items?page=2', headers: [{ name: 'Accept', value: '*/*' }], queryString: [{ name: 'page', value: '2' }], cookies: [] },
  response: { status: 200, statusText: 'OK', headers: [], cookies: [], content: { size: 100, mimeType: 'application/json; charset=utf-8', text: '{"a":1}' }, headersSize: 50, bodySize: 40 },
  timings: { blocked: 1, dns: -1, connect: -1, ssl: -1, send: 2, wait: 100, receive: 17 },
  ...overrides,
});
const har = (entries: unknown[], extra: Record<string, unknown> = {}) => JSON.stringify({ log: { version: '1.2', creator: { name: 'Firefox', version: '131.0' }, entries, ...extra } });

describe('parseHar', () => {
  it('rejects empty, broken and non-HAR input with a code', () => {
    const code = (text: string) => { try { parseHar(text); } catch (error) { return (error as HarError).code; } };
    expect(code('  ')).toBe('empty');
    expect(code('{"log": {"entries": [')).toBe('invalidJson');
    expect(code('{"items": []}')).toBe('notHar');
    expect(code('{"log": {"entries": {}}}')).toBe('notHar');
  });

  it('accepts a byte order mark', () => {
    expect(parseHar('﻿' + har([])).entries).toEqual([]);
  });
});

describe('summarize', () => {
  it('builds one row per request with names, sizes and start offsets', () => {
    const log = parseHar(har([
      entry(),
      entry({ startedDateTime: '2026-03-12T14:30:00.500Z', time: 1000, request: { method: 'GET', url: 'https://cdn.example.com/' }, response: { status: 404, content: { size: -1, mimeType: 'text/html' }, headersSize: -1, bodySize: -1, _transferSize: 321 } }),
      entry({ startedDateTime: '2026-03-12T14:30:00.200Z', request: { url: 'https://example.com/a%20b.png' }, response: { status: 0, _error: 'net::ERR_BLOCKED_BY_CLIENT', content: { mimeType: '' } } }),
    ]));
    const result = summarize(log);
    expect(result.creator).toBe('Firefox');
    expect(result.version).toBe('131.0');
    expect(result.rows.map(row => [row.name, row.host, row.method, row.status, row.start])).toEqual([
      ['items?page=2', 'example.com', 'GET', 200, 0],
      ['cdn.example.com', 'cdn.example.com', 'GET', 404, 500],
      ['a b.png', 'example.com', 'GET', 0, 200],
    ]);
    expect(result.rows[0]).toMatchObject({ transferred: 90, size: 100, mime: 'application/json', type: 'fetch' });
    expect(result.rows[1]).toMatchObject({ transferred: 321, size: -1, type: 'doc' });
    expect(result.rows[2]).toMatchObject({ transferred: -1, error: 'net::ERR_BLOCKED_BY_CLIENT' });
    expect(result.totals).toEqual({ requests: 3, errors: 2, failed: 1, transferred: 411, size: 100, span: 1500 });
  });

  it('reads cache state and survives missing fields', () => {
    const result = summarize(parseHar(har([{ _fromCache: 'disk', response: { status: 200 } }, { response: { status: 304 } }, {}])));
    expect(result.rows.map(row => row.cache)).toEqual(['disk', 'revalidated', '']);
    expect(result.started).toBe(0);
    expect(result.rows[2]).toMatchObject({ url: '', method: 'GET', status: 0, time: -1 });
  });
});

describe('resourceType', () => {
  it('prefers Chrome’s _resourceType and falls back to the MIME type', () => {
    const typed = (mimeType: string, extra: Record<string, unknown> = {}) => resourceType({ response: { content: { mimeType } }, ...extra });
    expect(typed('text/html', { _resourceType: 'xhr' })).toBe('fetch');
    expect(typed('', { _resourceType: 'websocket' })).toBe('ws');
    expect(typed('', { _resourceType: 'manifest' })).toBe('misc');
    expect(typed('text/html; charset=utf-8')).toBe('doc');
    expect(typed('application/javascript')).toBe('js');
    expect(typed('text/css')).toBe('css');
    expect(typed('image/svg+xml')).toBe('img');
    expect(typed('font/woff2')).toBe('font');
    expect(typed('video/mp4')).toBe('media');
    expect(typed('application/json')).toBe('fetch');
    expect(typed('application/octet-stream')).toBe('misc');
    expect(resourceType({ request: { url: 'wss://example.com/live' } })).toBe('ws');
  });
});

describe('detail', () => {
  it('formats JSON responses and keeps headers, query and timings', () => {
    const result = detail(parseHar(har([entry()])), 0);
    expect(result.content).toMatchObject({ kind: 'text', json: true, text: '{\n  "a": 1\n}', mime: 'application/json' });
    expect(result.query).toEqual([{ name: 'page', value: '2' }]);
    expect(result.requestHeaders).toEqual([{ name: 'Accept', value: '*/*' }]);
    expect(result.timings.wait).toBe(100);
    expect(result.method).toBe('GET');
  });

  it('decodes base64 text, keeps base64 images and marks other bodies', () => {
    const body = (content: Record<string, unknown>) => detail(parseHar(har([entry({ response: { status: 200, content } })])), 0).content;
    expect(body({ mimeType: 'text/plain', text: btoa('hello'), encoding: 'base64' })).toMatchObject({ kind: 'text', text: 'hello' });
    expect(body({ mimeType: 'image/png', text: 'iVBOR', encoding: 'base64' })).toMatchObject({ kind: 'image', base64: 'iVBOR' });
    expect(body({ mimeType: 'application/octet-stream', text: btoa('ÿþ\u0000'), encoding: 'base64' }).kind).toBe('binary');
    expect(body({ mimeType: 'text/html' }).kind).toBe('none');
  });

  it('caps very long text and lets the full body be downloaded', () => {
    const long = 'x'.repeat(MAX_SHOWN_TEXT + 10);
    const log = parseHar(har([entry({ response: { status: 200, content: { mimeType: 'text/plain', text: long } } })]));
    expect(detail(log, 0).content).toMatchObject({ truncated: true });
    expect(detail(log, 0).content.text).toHaveLength(MAX_SHOWN_TEXT);
    expect(bodyText(log, 0)).toHaveLength(MAX_SHOWN_TEXT + 10);
  });

  it('describes cookies with their attributes', () => {
    const log = parseHar(har([entry({ response: { status: 200, cookies: [{ name: 'id', value: '1', path: '/', httpOnly: true, secure: true }] } })]));
    expect(detail(log, 0).responseCookies).toEqual([{ name: 'id', value: '1', details: 'Path=/; HttpOnly; Secure' }]);
  });
});

describe('sanitize', () => {
  it('removes cookies and secret-looking header values, and keeps the rest', () => {
    const log = parseHar(har([entry({
      request: { url: 'https://example.com/', headers: [{ name: 'Cookie', value: 'a=1' }, { name: 'Authorization', value: 'Bearer x' }, { name: 'X-CSRF-Token', value: 'y' }, { name: 'Accept', value: '*/*' }], cookies: [{ name: 'a', value: '1' }] },
      response: { status: 200, headers: [{ name: 'set-cookie', value: 'a=1' }, { name: 'Content-Type', value: 'text/html' }], cookies: [{ name: 'a', value: '1' }] },
    })]));
    const { har: text, removed } = sanitize(log);
    const clean = JSON.parse(text).log.entries[0];
    expect(removed).toBe(6);
    expect(clean.request.headers.map((header: { value: string }) => header.value)).toEqual(['[removed]', '[removed]', '[removed]', '*/*']);
    expect(clean.response.headers[1].value).toBe('text/html');
    expect(clean.request.cookies).toEqual([]);
    // The original log is untouched, so the viewer still shows the real values.
    expect(detail(log, 0).requestHeaders[0].value).toBe('a=1');
  });

  it('removes the value of any header whose name contains key', () => {
    const log = parseHar(har([entry({ request: { url: 'https://example.com/', headers: [{ name: 'X-Key', value: 's1' }, { name: 'X-API-Key', value: 's2' }, { name: 'Keep-Alive', value: 'timeout=5' }] } })]));
    const clean = JSON.parse(sanitize(log).har).log.entries[0];
    expect(clean.request.headers.map((header: { value: string }) => header.value)).toEqual(['[removed]', '[removed]', 'timeout=5']);
  });
});

describe('exampleHar', () => {
  it('is a valid recording with a mix of types and statuses', () => {
    const result = summarize(parseHar(exampleHar()));
    expect(result.rows.length).toBeGreaterThan(10);
    expect(new Set(result.rows.map(row => row.type))).toEqual(new Set(['doc', 'css', 'js', 'font', 'img', 'fetch']));
    expect(result.totals.errors).toBe(3);
    expect(result.pages).toHaveLength(1);
  });
});
