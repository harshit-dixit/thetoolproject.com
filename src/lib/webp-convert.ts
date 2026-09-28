// WebP converter settings, limits and output names, shared by the page and the worker. Kept free of libraries so the
// page's first load stays small; the encoders are in webp-encode.ts, which only the worker loads.

export type OutputFormat = 'png' | 'jpg' | 'gif' | 'svg';
export type SvgMode = 'trace' | 'embed';
export type Background = 'white' | 'black';
export type ConvertOptions = { format: OutputFormat; quality: number; background: Background; svgMode: SvgMode; colors: number };

export const OUTPUT_FORMATS: OutputFormat[] = ['png', 'jpg', 'gif', 'svg'];
export const MIME: Record<OutputFormat, string> = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml' };
export const QUALITIES = [0.95, 0.9, 0.75];
export const TRACE_COLORS = [2, 8, 16, 32];

/** Per-image and per-batch limits. WebP itself stops at 16,383 px a side. */
export const LIMITS = {
  files: 200,
  fileBytes: 50 * 1024 * 1024,
  zipBytes: 1024 * 1024 * 1024,
  pixels: 50_000_000,
  // Frames × pixels decoded for one animated GIF, which bounds the time it takes.
  animationPixels: 300_000_000,
  // Tracing time and SVG size grow with the pixel count, so larger images are traced at this size.
  tracePixels: 1_000_000,
};

export type ImagePixels = { width: number; height: number; data: Uint8ClampedArray };

/** "photos/cat.webp" → "photos/cat.png". Folders from a ZIP are kept; characters file systems reject are replaced. */
export function outputPath(inputPath: string, format: OutputFormat) {
  const parts = inputPath.split('/').filter(part => part && part !== '.' && part !== '..');
  const file = parts.pop() ?? '';
  const base = file.replace(/\.[^.]*$/, '').replace(/[<>:"|?*\u0000-\u001f]/g, '_').trim() || 'image';
  const folders = parts.map(part => part.replace(/[<>:"|?*\u0000-\u001f]/g, '_'));
  return [...folders, `${base}.${format}`].join('/');
}

/** Adds -2, -3 … before the extension to paths that would otherwise overwrite each other. Case-insensitive, like Windows and macOS. */
export function uniquePaths(paths: string[]) {
  const taken = new Set<string>();
  return paths.map(path => {
    let candidate = path;
    for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = path.replace(/(\.[^./]*)?$/, `-${n}$1`);
    taken.add(candidate.toLowerCase());
    return candidate;
  });
}

export function baseName(path: string) { return path.slice(path.lastIndexOf('/') + 1); }

/** A ZIP entry worth converting: a .webp file that isn't macOS metadata (__MACOSX/, ._name) or hidden. */
export function isWebpEntry(path: string) {
  return /\.webp$/i.test(path) && !path.split('/').some(part => part === '__MACOSX' || part.startsWith('.'));
}

/** The size an image is traced at: its own size, or scaled down to LIMITS.tracePixels. */
export function traceSize(width: number, height: number, maxPixels = LIMITS.tracePixels) {
  const scale = Math.min(1, Math.sqrt(maxPixels / (width * height)));
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}

/** WebP counts plays (0 = forever); GIF's NETSCAPE block counts repeats and gifenc uses -1 for "play once". */
export function gifRepeat(webpLoopCount: number) {
  return webpLoopCount === 0 ? 0 : webpLoopCount === 1 ? -1 : webpLoopCount - 1;
}

/** Browsers slow down GIF frames shorter than 20 ms to 100 ms, so very short WebP frames are held for 20 ms instead. */
export function gifDelay(milliseconds: number) {
  return Math.max(20, Math.round(milliseconds / 10) * 10);
}
