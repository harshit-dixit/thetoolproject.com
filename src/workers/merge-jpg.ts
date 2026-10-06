import type { ImageOptions, PdfOptions, Size } from '../lib/merge-jpg';
import { measure, MergeError, mergeImage, mergePdf, type MergeResult } from '../lib/merge-jpg-render';

export type { MergeResult };

export type MergeRequest =
  | { type: 'measure'; id: number; file: Blob }
  | { type: 'image'; id: number; files: Blob[]; sizes: Size[]; options: ImageOptions }
  | { type: 'pdf'; id: number; files: Blob[]; options: PdfOptions };

export type MergeResponse =
  | { id: number; size: Size }
  | { id: number; progress: number }
  | { id: number; result: MergeResult }
  | { id: number; error: { code: string } };

self.addEventListener('message', async (event: MessageEvent<MergeRequest>) => {
  const request = event.data;
  const progress = (done: number) => self.postMessage({ id: request.id, progress: done } satisfies MergeResponse);
  try {
    if (request.type === 'measure') {
      self.postMessage({ id: request.id, size: await measure(request.file) } satisfies MergeResponse);
      return;
    }
    const result = request.type === 'image'
      ? await mergeImage(request.files, request.sizes, request.options, progress)
      : await mergePdf(request.files, request.options, progress);
    self.postMessage({ id: request.id, result } satisfies MergeResponse, { transfer: [result.data.buffer as ArrayBuffer] });
  } catch (error) {
    self.postMessage({ id: request.id, error: { code: error instanceof MergeError ? error.code : 'general' } } satisfies MergeResponse);
  }
});
