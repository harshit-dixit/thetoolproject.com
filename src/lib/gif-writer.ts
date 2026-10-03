// Animated GIF output with gifenc, shared by the WebP converter and Video to GIF. Only workers import this.
import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import type { ImagePixels } from './webp-convert';

/**
 * Writes a GIF one frame at a time, so an animation never has to be held in memory as raw pixels.
 * Each frame gets its own 256-color palette. `repeat` is gifenc's: 0 loops forever, -1 plays once, n repeats n times.
 * With transparency, pixels less than half opaque become transparent, because GIF has no partial transparency, and
 * each frame is cleared before the next (disposal 2) so transparent areas stay see-through.
 * `opaque` is for video frames, which have no transparency: the palette then spends its bits on color alone.
 */
export function createGifWriter(repeat: number, { opaque = false } = {}) {
  const gif = GIFEncoder();
  const format = opaque ? 'rgb565' : 'rgba4444';
  let partialAlpha = false;
  return {
    addFrame(frame: ImagePixels, delayMs: number) {
      const rgba = new Uint8Array(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength);
      if (opaque) {
        const palette = quantize(rgba, 256, { format });
        gif.writeFrame(applyPalette(rgba, palette, format), frame.width, frame.height, { palette, delay: delayMs, repeat });
        return;
      }
      for (let i = 3; i < rgba.length && !partialAlpha; i += 4) if (rgba[i] !== 0 && rgba[i] !== 255) partialAlpha = true;
      const palette = quantize(rgba, 256, { format, oneBitAlpha: true });
      const index = applyPalette(rgba, palette, format);
      const transparentIndex = palette.findIndex(color => color[3] === 0);
      gif.writeFrame(index, frame.width, frame.height, { palette, delay: delayMs, repeat, transparent: transparentIndex >= 0, transparentIndex: Math.max(0, transparentIndex), dispose: 2 });
    },
    finish() {
      gif.finish();
      return { bytes: gif.bytes(), partialAlpha };
    },
  };
}
