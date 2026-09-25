export type Separator = 'auto' | 'comma' | 'semicolon' | 'tab' | 'pipe';
export type Encoding = 'auto' | 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252';
export type CsvTable = { headers: string[]; rows: string[][]; separator: Exclude<Separator, 'auto'>; irregularRows: number; irregularIndices: number[]; rawHeaders: string[] };
export type DecodedCsv = { text: string; encoding: Exclude<Encoding, 'auto'> };

const separators = { comma: ',', semicolon: ';', tab: '\t', pipe: '|' } as const;

export class CsvViewerError extends Error {
  constructor(public code: 'empty' | 'invalid' | 'tooManyColumns', public row?: number) { super(code); }
}

export function decodeCsv(buffer: ArrayBuffer, requested: Encoding = 'auto'): DecodedCsv {
  const bytes = new Uint8Array(buffer);
  let encoding: Exclude<Encoding, 'auto'> = requested === 'auto' ? 'utf-8' : requested;
  if (requested === 'auto') {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = 'utf-16le';
    else if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = 'utf-16be';
    else if (!(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)) {
      const sample = bytes.subarray(0, Math.min(bytes.length, 2000));
      let evenZeros = 0; let oddZeros = 0;
      for (let i = 0; i < sample.length; i++) if (sample[i] === 0) (i % 2 ? oddZeros++ : evenZeros++);
      if (oddZeros > sample.length / 8 && oddZeros > evenZeros * 3) encoding = 'utf-16le';
      else if (evenZeros > sample.length / 8 && evenZeros > oddZeros * 3) encoding = 'utf-16be';
      else {
        try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
        catch { encoding = 'windows-1252'; }
      }
    }
  }
  return { text: new TextDecoder(encoding).decode(bytes).replace(/^\uFEFF/, ''), encoding };
}

function parse(source: string, separator: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = []; let field = ''; let quoted = false; let closed = false; let started = false;
  const text = source.replace(/^\uFEFF/, '');
  const finish = () => {
    row.push(field);
    if (started || row.length > 1 || field !== '') rows.push(row);
    row = []; field = ''; closed = false; started = false;
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') { quoted = false; closed = true; }
      else field += char;
    } else if (char === separator) {
      row.push(field); field = ''; closed = false; started = true;
    } else if (char === '\n' || char === '\r') {
      finish();
      if (char === '\r' && text[i + 1] === '\n') i++;
    } else if (char === '"') {
      if (field || closed) throw new CsvViewerError('invalid', rows.length + 1);
      quoted = true; started = true;
    } else if (closed) {
      if (char !== ' ' && char !== '\t') throw new CsvViewerError('invalid', rows.length + 1);
    } else { field += char; started = true; }
  }
  if (quoted) throw new CsvViewerError('invalid', rows.length + 1);
  if (started || row.length || field) finish();
  return rows;
}

export function detectSeparator(source: string): Exclude<Separator, 'auto'> {
  // Keep complete quoted records in the sample, including embedded newlines.
  let quoted = false; let records = 0; let end = source.length;
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '"') { if (quoted && source[i + 1] === '"') i++; else quoted = !quoted; }
    else if (!quoted && (source[i] === '\n' || source[i] === '\r')) {
      if (++records === 15) { end = i + 1; break; }
      if (source[i] === '\r' && source[i + 1] === '\n') i++;
    }
  }
  const sample = source.slice(0, end);
  let best: Exclude<Separator, 'auto'> = 'comma'; let score = 0;
  for (const name of Object.keys(separators) as Exclude<Separator, 'auto'>[]) {
    try {
      const rows = parse(sample, separators[name]);
      if (!rows.length) continue;
      const widths = rows.map(row => row.length);
      const matches = widths.filter(width => width > 1 && width === widths[0]).length;
      const current = matches * 10 + (widths[0] > 1 ? Math.min(widths[0], 12) : 0);
      if (current > score) { score = current; best = name; }
    } catch { /* The full parse reports malformed input. */ }
  }
  return best;
}

export function parseCsv(source: string, choice: Separator = 'auto', firstRowHeaders = true): CsvTable {
  if (!source.trim()) throw new CsvViewerError('empty');
  const separator = choice === 'auto' ? detectSeparator(source) : choice;
  const parsed = parse(source, separators[separator]);
  if (!parsed.length) throw new CsvViewerError('empty');
  let width = 0;
  for (const row of parsed) width = Math.max(width, row.length);
  if (width > 500) throw new CsvViewerError('tooManyColumns');
  const data = parsed.slice(firstRowHeaders ? 1 : 0);
  const expectedWidth = firstRowHeaders ? parsed[0].length : width;
  const irregularIndices = data.flatMap((row, index) => row.length === expectedWidth ? [] : [index]);
  const used = new Set<string>();
  const headers = Array.from({ length: width }, (_, index) => {
    const base = (firstRowHeaders ? parsed[0][index]?.trim() : '') || `Column ${index + 1}`;
    let header = base; let suffix = 2;
    while (used.has(header.toLowerCase())) header = `${base} (${suffix++})`;
    used.add(header.toLowerCase());
    return header;
  });
  const rows = data.map(row => Array.from({ length: width }, (_, index) => row[index] ?? ''));
  return { headers, rows, separator, irregularRows: irregularIndices.length, irregularIndices, rawHeaders: firstRowHeaders ? parsed[0] : [] };
}

export function serializeCsv(headers: string[], rows: string[][], separator: string, includeHeaders = true): string {
  const escape = (value: string) => /["\r\n]/.test(value) || value.includes(separator) ? `"${value.replaceAll('"', '""')}"` : value;
  return [...(includeHeaders ? [headers] : []), ...rows].map(row => row.map(escape).join(separator)).join('\r\n') + '\r\n';
}
