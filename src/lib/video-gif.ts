// Video to GIF settings, limits, clip timing and output names, shared by the page and the worker.
// Kept free of libraries so the page's first load stays small; gifenc is loaded by the worker only.

export type GifWidth = 320 | 480 | 640 | 'original';
export type Loop = 'forever' | 'once';
export type GifSettings = { width: GifWidth; fps: number; speed: number; loop: Loop };

export const WIDTHS: GifWidth[] = [320, 480, 640, 'original'];
// Browsers show GIF frames shorter than 20 ms at 100 ms, so 25 fps (40 ms) is the top, leaving room for 2× speed.
export const FRAME_RATES = [5, 10, 15, 20, 25];
export const SPEEDS = [0.5, 1, 2];
export const DEFAULT_SETTINGS: GifSettings = { width: 480, fps: 10, speed: 1, loop: 'forever' };

export const LIMITS = {
  fileBytes: 2 * 1024 * 1024 * 1024,
  frames: 1000,
  // Frames × pixels in one GIF, which bounds the memory and time it takes.
  pixels: 300_000_000,
  // The part chosen when a video opens: all of it, or its first 10 seconds.
  defaultSeconds: 10,
  // Above this the page suggests ways to make the GIF smaller.
  largeBytes: 10 * 1024 * 1024,
};

const VIDEO_EXTENSIONS = /\.(mp4|m4v|mov|qt|webm|mkv|ogv|ogg|avi|wmv|flv|3gp|3g2|mpe?g|ts|mts|m2ts)$/i;

/** A file worth trying: anything the browser labels as video, or a video extension (some systems leave the type empty). */
export function isVideoFile(file: { name: string; type: string }) {
  return file.type.startsWith('video/') || VIDEO_EXTENSIONS.test(file.name);
}

/** The GIF size for a video: the chosen width, never wider than the video, with the height in proportion. */
export function outputSize(videoWidth: number, videoHeight: number, width: GifWidth) {
  const target = width === 'original' ? videoWidth : Math.min(width, videoWidth);
  return { width: Math.max(1, Math.round(target)), height: Math.max(1, Math.round(videoHeight * target / videoWidth)) };
}

/** The video times to take frames at: every 1/fps seconds from the start, before the end. Always at least one frame. */
export function frameTimes(start: number, end: number, fps: number) {
  const count = frameCount(start, end, fps);
  return Array.from({ length: count }, (_, i) => start + i / fps);
}

export function frameCount(start: number, end: number, fps: number) {
  // The small allowance stops 0.3 s at 10 fps from becoming 2.9999… frames.
  return Math.max(1, Math.ceil((end - start) * fps - 1e-6));
}

/**
 * Each frame's delay in milliseconds. GIF counts delays in hundredths of a second, so rates that don't divide 100
 * alternate (15 fps gives 70, 60, 70 ms…) and the total keeps time with the video instead of drifting.
 */
export function frameDelays(count: number, fps: number, speed: number) {
  const at = (i: number) => Math.round(i * 100 / (fps * speed));
  return Array.from({ length: count }, (_, i) => Math.max(2, at(i + 1) - at(i)) * 10);
}

/** gifenc's repeat value: 0 loops forever, -1 plays once. */
export const gifRepeat = (loop: Loop) => loop === 'forever' ? 0 : -1;

export type ClipCheck = { ok: true; frames: number; width: number; height: number } | { ok: false; code: 'order' | 'tooLong'; frames: number; width: number; height: number };

/** Whether a part of the video fits the limits at these settings. */
export function checkClip(start: number, end: number, video: { width: number; height: number }, settings: GifSettings): ClipCheck {
  const size = outputSize(video.width, video.height, settings.width);
  const frames = end > start ? frameCount(start, end, settings.fps) : 0;
  if (end <= start) return { ok: false, code: 'order', frames, ...size };
  if (frames > LIMITS.frames || frames * size.width * size.height > LIMITS.pixels) return { ok: false, code: 'tooLong', frames, ...size };
  return { ok: true, frames, ...size };
}

/**
 * Reads a typed time: seconds ("12", "12.5", "12,5"), minutes and seconds ("1:05", "1:05.5") or hours too ("1:02:05").
 * Undefined for anything else.
 */
export function parseTime(text: string) {
  const match = /^(?:(?:(\d+):)?(\d+):)?(\d+(?:[.,]\d*)?|[.,]\d+)$/.exec(text.trim());
  if (!match) return undefined;
  const [, hours, minutes, seconds] = match;
  if ((hours || minutes) && Number(seconds.replace(',', '.')) >= 60) return undefined;
  if (hours && Number(minutes) >= 60) return undefined;
  return Number(hours ?? 0) * 3600 + Number(minutes ?? 0) * 60 + Number(seconds.replace(',', '.'));
}

/** "1:05.5", or "1:02:05.5" for an hour or more, with the page language's decimal separator. Tenths are cut, not rounded. */
export function formatTime(seconds: number, decimal = '.') {
  const tenths = Math.max(0, Math.floor(seconds * 10 + 1e-6));
  const whole = Math.floor(tenths / 10);
  const h = Math.floor(whole / 3600);
  const m = Math.floor(whole / 60) % 60;
  const s = String(whole % 60).padStart(2, '0');
  return `${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${s}${decimal}${tenths % 10}`;
}

/** "holiday clip.mp4" → "holiday clip.gif". Characters file systems reject are replaced. */
export function gifName(fileName: string) {
  const base = fileName.replace(/\.[^.]*$/, '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim();
  return `${base || 'video'}.gif`;
}
