// The encoders behind the WebP converter: GIF frames with gifenc, and SVG from traced or embedded pixels.
// Only the worker imports this, after a file is chosen. Decoding and canvas work are in src/workers/webp-converter.ts.
import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import ImageTracer from 'imagetracerjs';
import type { ImagePixels } from './webp-convert';

type TracePath = { isholepath: boolean };
type TraceData = { width: number; height: number; palette: { r: number; g: number; b: number; a: number }[]; layers: TracePath[][] };

/**
 * Traces pixels into filled vector paths, one color layer at a time, and wraps them in an SVG that displays at
 * `displayWidth` × `displayHeight` (the original size, when the pixels were scaled down for tracing).
 */
export function traceSvg(image: ImagePixels, colors: number, displayWidth = image.width, displayHeight = image.height) {
  const options = ImageTracer.checkoptions({ numberofcolors: colors, pathomit: 8, roundcoords: 1, strokewidth: 1, viewbox: true, desc: false });
  const trace = ImageTracer.imagedataToTracedata(image, options) as TraceData;
  const paths: string[] = [];
  trace.layers.forEach((layer, color) => {
    // Layers that quantized to (almost) fully transparent would only add invisible shapes.
    if (trace.palette[color].a < 16) return;
    layer.forEach((path, index) => { if (!path.isholepath) paths.push(ImageTracer.svgpathstring(trace, color, index, options) as string); });
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${displayWidth}" height="${displayHeight}" viewBox="0 0 ${trace.width} ${trace.height}">${paths.join('')}</svg>`;
}

function base64(bytes: Uint8Array) {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

/**
 * An SVG that holds the image as a PNG: every pixel is kept, but it stays a bitmap inside the SVG file.
 * xlink:href rather than SVG 2's href, because design and cutting apps that read SVG 1.1 ignore href.
 */
export function embedSvg(png: Uint8Array, width: number, height: number) {
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><image width="${width}" height="${height}" xlink:href="data:image/png;base64,${base64(png)}"/></svg>`;
}

/**
 * Writes a GIF one frame at a time, so an animation never has to be held in memory as raw pixels.
 * Each frame gets its own 256-color palette; pixels less than half opaque become transparent, because GIF has no partial transparency.
 * Frames are whole, composited images, so each one is cleared before the next (disposal 2) and transparent areas stay see-through.
 */
export function createGifWriter(repeat: number) {
  const gif = GIFEncoder();
  let partialAlpha = false;
  return {
    addFrame(frame: ImagePixels, delayMs: number) {
      const rgba = new Uint8Array(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength);
      for (let i = 3; i < rgba.length && !partialAlpha; i += 4) if (rgba[i] !== 0 && rgba[i] !== 255) partialAlpha = true;
      const palette = quantize(rgba, 256, { format: 'rgba4444', oneBitAlpha: true });
      const index = applyPalette(rgba, palette, 'rgba4444');
      const transparentIndex = palette.findIndex(color => color[3] === 0);
      gif.writeFrame(index, frame.width, frame.height, { palette, delay: delayMs, repeat, transparent: transparentIndex >= 0, transparentIndex: Math.max(0, transparentIndex), dispose: 2 });
    },
    finish() {
      gif.finish();
      return { bytes: gif.bytes(), partialAlpha };
    },
  };
}
