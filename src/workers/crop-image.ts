import type { Rect, Size } from '../lib/crop-image';
import { cropImage, CropError, type CropOptions, type CropResult } from '../lib/crop-image-render';

export type { CropResult };

export type CropRequest = { id: number; file: Blob; shown: Size; rect: Rect; options: CropOptions };

export type CropResponse =
  | { id: number; result: CropResult }
  | { id: number; error: { code: string } };

self.addEventListener('message', async (event: MessageEvent<CropRequest>) => {
  const { id, file, shown, rect, options } = event.data;
  try {
    const result = await cropImage(file, shown, rect, options);
    self.postMessage({ id, result } satisfies CropResponse, { transfer: [result.data.buffer as ArrayBuffer] });
  } catch (error) {
    self.postMessage({ id, error: { code: error instanceof CropError ? error.code : 'general' } } satisfies CropResponse);
  }
});
