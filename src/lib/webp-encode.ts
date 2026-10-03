// The encoders behind the WebP converter: GIF frames (gif-writer.ts), and SVG from traced or embedded pixels.
// Only the worker imports this, after a file is chosen. Decoding and canvas work are in src/workers/webp-converter.ts.
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

export { createGifWriter } from './gif-writer';
