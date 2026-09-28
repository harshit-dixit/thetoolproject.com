// Types for the untyped libraries the WebP converter uses. Only the parts it calls are declared.

declare module 'gifenc' {
  export type Palette = number[][];
  export function quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number, options?: { format?: 'rgb565' | 'rgb444' | 'rgba4444'; oneBitAlpha?: boolean | number; clearAlpha?: boolean; clearAlphaThreshold?: number; clearAlphaColor?: number }): Palette;
  export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: Palette, format?: 'rgb565' | 'rgb444' | 'rgba4444'): Uint8Array;
  export function GIFEncoder(options?: { initialCapacity?: number; auto?: boolean }): {
    writeFrame(index: Uint8Array, width: number, height: number, options?: { palette?: Palette; delay?: number; repeat?: number; transparent?: boolean; transparentIndex?: number; colorDepth?: number; dispose?: number; first?: boolean }): void;
    finish(): void;
    bytes(): Uint8Array;
    bytesView(): Uint8Array;
  };
}

declare module 'imagetracerjs' {
  const ImageTracer: {
    checkoptions(options: Record<string, unknown>): Record<string, unknown>;
    imagedataToTracedata(image: { width: number; height: number; data: Uint8ClampedArray }, options?: Record<string, unknown>): unknown;
    svgpathstring(tracedata: unknown, layer: number, path: number, options: Record<string, unknown>): string;
  };
  export default ImageTracer;
}
