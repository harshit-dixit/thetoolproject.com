import { bodyText, detail, HarError, parseHar, sanitize, summarize } from '../lib/har';

export type HarRequest =
  | { id: number; type: 'open'; file: File }
  | { id: number; type: 'example' }
  | { id: number; type: 'detail' | 'body'; index: number }
  | { id: number; type: 'sanitize' };

// The parsed log stays here, so the page only ever holds one row per request and the request it shows.
let log: Record<string, unknown> | undefined;
// Reading a file is asynchronous, so an earlier, slower import must not replace a later one.
let latestOpen = 0;

self.onmessage = async (event: MessageEvent<HarRequest>) => {
  const request = event.data;
  try {
    if (request.type === 'open' || request.type === 'example') {
      log = undefined;
      const generation = ++latestOpen;
      const text = request.type === 'open' ? await request.file.text() : (await import('../lib/har-example')).exampleHar();
      if (generation !== latestOpen) { self.postMessage({ id: request.id, ok: false, code: 'stale' }); return; }
      log = parseHar(text);
      self.postMessage({ id: request.id, ok: true, summary: summarize(log) });
    } else if (!log) {
      self.postMessage({ id: request.id, ok: false, code: 'general' });
    } else if (request.type === 'detail') {
      self.postMessage({ id: request.id, ok: true, detail: detail(log, request.index) });
    } else if (request.type === 'body') {
      self.postMessage({ id: request.id, ok: true, text: bodyText(log, request.index) });
    } else {
      self.postMessage({ id: request.id, ok: true, ...sanitize(log) });
    }
  } catch (error) {
    self.postMessage({ id: request.id, ok: false, code: error instanceof HarError ? error.code : 'general' });
  }
};
