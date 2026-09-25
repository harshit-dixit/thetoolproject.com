// Google Analytics 4 events. The gtag loader lives in layouts/Base.astro; scripts/analytics.ts wires page-wide listeners.
// Events carry only coarse, non-identifying details: which tool and button, a file's extension and size range.
// File names, file contents, pasted text and typed values never leave the browser.

export type EventParams = Record<string, string | number | boolean | undefined>;

declare global {
  interface Window { gtag?: (...args: unknown[]) => void }
}

export function track(event: string, params: EventParams = {}) {
  const clean = Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined && value !== ''));
  if (import.meta.env.DEV) console.debug('[analytics]', event, clean);
  window.gtag?.('event', event, clean);
}

// A finished conversion (or scan, compression, resize). `code` is a fixed error code, never a message that could echo the input.
export function trackResult(outcome: 'success' | 'error', params: EventParams & { code?: string } = {}) {
  const { code, ...rest } = params;
  track(outcome === 'success' ? 'conversion_success' : 'conversion_error', { ...rest, error_code: outcome === 'error' ? code ?? 'unknown' : undefined });
}

// Tool buttons are named <tool>-<action> or just <action>, e.g. "xml-json-convert", "download-zip", "choose-file".
const BUTTON_ACTIONS: [RegExp, string][] = [
  [/(^|-)(convert|format|run)$/, 'convert_click'],
  [/(^|-)download(-|$)/, 'download_click'],
  [/(^|-)copy$/, 'copy_click'],
  [/(^|-)(choose|choose-file|choose-again|change)$/, 'choose_file_click'],
  [/(^|-)example$/, 'example_click'],
  [/(^|-)(start-over|reset|clear|revert)$/, 'reset_click'],
];

export function buttonEvent(id: string) {
  return BUTTON_ACTIONS.find(([pattern]) => pattern.test(id))?.[1] ?? 'tool_button_click';
}

// Option chips carry their choice in a data attribute, e.g. data-separator="tab".
export function optionFromDataset(dataset: DOMStringMap): { option_name: string; option_value: string } | undefined {
  const entry = Object.entries(dataset).find(([key]) => !key.startsWith('astro'));
  return entry ? { option_name: entry[0], option_value: entry[1] ?? '' } : undefined;
}

export function fileExtension(name: string) {
  const match = /\.([a-z0-9]{1,8})$/i.exec(name);
  return match ? match[1].toLowerCase() : 'none';
}

const KB = 1024;
const MB = KB * KB;
export function sizeBucket(bytes: number) {
  if (bytes < 10 * KB) return '<10KB';
  if (bytes < 100 * KB) return '10-100KB';
  if (bytes < MB) return '100KB-1MB';
  if (bytes < 10 * MB) return '1-10MB';
  if (bytes < 50 * MB) return '10-50MB';
  return '50MB+';
}

export function fileParams(files: ArrayLike<File>) {
  const list = Array.from(files);
  const total = list.reduce((sum, file) => sum + file.size, 0);
  return { file_count: list.length, file_type: list[0] ? fileExtension(list[0].name) : undefined, file_size: sizeBucket(total) };
}
