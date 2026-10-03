// Encodes the frames the page reads from the video into one GIF. The page sends frames as raw RGBA pixels, a few at a
// time, and waits for each "frame" reply before sending more, so frames never pile up in memory.
import { createGifWriter } from '../lib/gif-writer';

export type VideoGifRequest =
  | { type: 'start'; width: number; height: number; repeat: number }
  | { type: 'frame'; pixels: ArrayBuffer; delay: number }
  | { type: 'finish' };

export type VideoGifResponse =
  | { type: 'frame' }
  | { type: 'done'; data: Uint8Array }
  | { type: 'error'; code: string };

let writer: ReturnType<typeof createGifWriter> | undefined;
let size = { width: 0, height: 0 };

self.addEventListener('message', (event: MessageEvent<VideoGifRequest>) => {
  const request = event.data;
  try {
    if (request.type === 'start') {
      writer = createGifWriter(request.repeat, { opaque: true });
      size = { width: request.width, height: request.height };
    } else if (request.type === 'frame') {
      if (!writer) throw new Error('not started');
      writer.addFrame({ ...size, data: new Uint8ClampedArray(request.pixels) }, request.delay);
      self.postMessage({ type: 'frame' } satisfies VideoGifResponse);
    } else {
      if (!writer) throw new Error('not started');
      const { bytes } = writer.finish();
      writer = undefined;
      self.postMessage({ type: 'done', data: bytes } satisfies VideoGifResponse, { transfer: [bytes.buffer] });
    }
  } catch {
    writer = undefined;
    self.postMessage({ type: 'error', code: 'general' } satisfies VideoGifResponse);
  }
});
