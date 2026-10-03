// A small made-up recording for "Try an example": one page load on example.com with the usual mix of
// documents, scripts, images, API calls, a redirect, a cached file, two errors and a blocked request.

type Spec = [method: string, url: string, status: number, mime: string, type: string, offset: number, time: number, size: number, extra?: Record<string, unknown>];

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const specs: Spec[] = [
  ['GET', 'http://example.com/', 301, '', 'document', 0, 38, 0, { location: 'https://example.com/' }],
  ['GET', 'https://example.com/', 200, 'text/html', 'document', 42, 212, 18_430, { text: '<!doctype html>\n<html lang="en">\n<head><title>Example shop</title><link rel="stylesheet" href="/assets/site.css"></head>\n<body><h1>Example shop</h1><script src="/assets/app.js"></script></body>\n</html>\n' }],
  ['GET', 'https://example.com/assets/site.css', 200, 'text/css', 'stylesheet', 270, 64, 24_210, { text: 'body { font-family: system-ui, sans-serif; margin: 0; }\nh1 { font-size: 2rem; }\n' }],
  ['GET', 'https://example.com/assets/app.js', 200, 'application/javascript', 'script', 272, 148, 182_540, { text: 'fetch("/api/cart").then(response => response.json()).then(render);\n' }],
  ['GET', 'https://example.com/assets/inter.woff2', 200, 'font/woff2', 'font', 340, 51, 48_256, { cache: 'disk' }],
  ['GET', 'https://example.com/img/logo.png', 200, 'image/png', 'image', 346, 22, 67, { base64: PNG }],
  ['GET', 'https://cdn.example.net/img/hero.webp', 200, 'image/webp', 'image', 350, 410, 286_912],
  ['GET', 'https://example.com/api/cart', 200, 'application/json', 'fetch', 430, 96, 214, { text: '{"items":[{"sku":"TEA-01","name":"Green tea","qty":2,"price":8.5}],"total":17}', cookie: true }],
  ['POST', 'https://example.com/api/events', 204, '', 'xhr', 445, 71, 0, { post: '{"event":"page_view","path":"/"}' }],
  ['GET', 'https://example.com/api/recommendations?limit=4', 500, 'application/json', 'fetch', 452, 1_204, 61, { text: '{"error":"upstream timeout"}' }],
  ['GET', 'https://example.com/img/missing-banner.jpg', 404, 'text/html', 'image', 460, 33, 162, { text: '<h1>Not found</h1>' }],
  ['GET', 'https://tracker.example.org/pixel.gif?id=42', 0, '', 'image', 470, 2, 0, { error: 'net::ERR_BLOCKED_BY_CLIENT' }],
  ['GET', 'https://example.com/assets/site.css', 304, 'text/css', 'stylesheet', 1_690, 18, 24_210, {}],
];

export function exampleHar(): string {
  const base = Date.UTC(2026, 2, 12, 14, 30, 0);
  const entries = specs.map(([method, url, status, mime, type, offset, time, size, extra = {}]) => {
    const wait = Math.round(time * 0.6);
    const dns = offset < 50 ? 12 : -1;
    const connect = offset < 50 ? 18 : -1;
    const headers = [{ name: 'content-type', value: mime || 'text/plain' }, { name: 'date', value: 'Thu, 12 Mar 2026 14:30:00 GMT' }];
    if (extra.location) headers.push({ name: 'location', value: String(extra.location) });
    if (extra.cookie) headers.push({ name: 'set-cookie', value: 'cart=abc123; Path=/; HttpOnly; Secure' });
    const text = extra.text as string | undefined;
    const base64 = extra.base64 as string | undefined;
    return {
      pageref: 'page_1',
      startedDateTime: new Date(base + offset).toISOString(),
      time,
      _resourceType: type,
      ...(extra.cache ? { _fromCache: extra.cache } : {}),
      request: {
        method, url, httpVersion: 'HTTP/2',
        headers: [{ name: 'accept', value: '*/*' }, { name: 'user-agent', value: 'Mozilla/5.0 (example)' }, ...(extra.cookie ? [{ name: 'cookie', value: 'session=example-only' }] : [])],
        queryString: [...new URL(url).searchParams].map(([name, value]) => ({ name, value })),
        cookies: extra.cookie ? [{ name: 'session', value: 'example-only', path: '/', httpOnly: true, secure: true }] : [],
        headersSize: -1, bodySize: extra.post ? String(extra.post).length : 0,
        ...(extra.post ? { postData: { mimeType: 'application/json', text: extra.post } } : {}),
      },
      response: {
        status, statusText: ({ 0: '', 200: 'OK', 204: 'No Content', 301: 'Moved Permanently', 304: 'Not Modified', 404: 'Not Found', 500: 'Internal Server Error' } as Record<number, string>)[status],
        httpVersion: 'HTTP/2', headers: status ? headers : [],
        cookies: extra.cookie ? [{ name: 'cart', value: 'abc123', path: '/', httpOnly: true, secure: true }] : [],
        content: { size, mimeType: mime, ...(text ? { text } : base64 ? { text: base64, encoding: 'base64' } : {}) },
        redirectURL: extra.location ? String(extra.location) : '', headersSize: -1,
        bodySize: extra.cache || status === 304 ? 0 : status ? Math.round(size * 0.35) : -1,
        _transferSize: extra.cache ? 0 : status === 0 ? 0 : Math.round(size * 0.35) + 180,
        ...(extra.error ? { _error: extra.error } : {}),
      },
      cache: {},
      timings: { blocked: 2, dns, connect, ssl: connect > 0 ? 9 : -1, send: 1, wait, receive: Math.max(0, time - wait - 3 - Math.max(0, dns) - Math.max(0, connect)) },
      serverIPAddress: status ? '93.184.215.14' : '',
    };
  });
  return JSON.stringify({ log: {
    version: '1.2', creator: { name: 'WebInspector', version: '537.36' },
    pages: [{ startedDateTime: new Date(base).toISOString(), id: 'page_1', title: 'https://example.com/', pageTimings: { onContentLoad: 612, onLoad: 1_480 } }],
    entries,
  } });
}
