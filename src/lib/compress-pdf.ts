import { PDFDocument } from 'pdf-lib';

export type CompressionMode = 'preserve' | 'visual';
export type CompressionLevel = 'light' | 'balanced' | 'strong';
export type CompressionResult = { bytes: Uint8Array; method: 'original' | 'optimized' | 'visual'; pages: number; reachedTarget: boolean };

const settings: Record<CompressionLevel, { dpi: number; quality: number }> = {
  light: { dpi: 144, quality: 0.78 },
  balanced: { dpi: 108, quality: 0.62 },
  strong: { dpi: 78, quality: 0.43 },
};

function canvasJpeg(canvas: HTMLCanvasElement, quality: number, strings?: Record<string, string>): Promise<Uint8Array> {
  return new Promise((resolve, reject) => canvas.toBlob(async blob => {
    if (!blob) return reject(new Error(strings?.['pdf.errEncode'] || 'Your browser could not encode a PDF page.'));
    resolve(new Uint8Array(await blob.arrayBuffer()));
  }, 'image/jpeg', quality));
}

export async function compressPdf(
  file: File,
  options: { mode: CompressionMode; level: CompressionLevel; targetBytes?: number; onProgress?: (message: string) => void; strings?: Record<string, string> },
): Promise<CompressionResult> {
  const { targetBytes, onProgress = () => {}, strings } = options;
  const original = new Uint8Array(await file.arrayBuffer());
  if (original.length < 5 || new TextDecoder('ascii').decode(original.subarray(0, 5)) !== '%PDF-') {
    throw new Error(strings?.['pdf.errInvalidPdf'] || 'Choose a valid PDF file.');
  }
  onProgress(strings?.['pdf.checkingStructure'] || 'Checking PDF structure…');
  let source: PDFDocument;
  try {
    source = await PDFDocument.load(original);
  } catch {
    throw new Error(strings?.['pdf.errPasswordOrDamaged'] || 'This PDF could not be opened. Password-protected or damaged PDFs are not supported.');
  }
  const pages = source.getPageCount();
  if (!pages) throw new Error(strings?.['pdf.errNoPages'] || 'This PDF has no pages.');
  if (pages > 60) throw new Error(strings?.['pdf.errPageLimit'] || 'This tool supports PDFs with up to 60 pages.');

  let best: Uint8Array = original;
  let method: CompressionResult['method'] = 'original';
  if (targetBytes && original.length <= targetBytes) return { bytes: original, method, pages, reachedTarget: true };

  try {
    const optimized = await source.save({ useObjectStreams: true });
    if (optimized.length < best.length) { best = optimized; method = 'optimized'; }
  } catch {
    // The original is still usable if structural rewriting fails.
  }
  if (options.mode === 'preserve' || (targetBytes && best.length <= targetBytes)) {
    return { bytes: best, method, pages, reachedTarget: !targetBytes || best.length <= targetBytes };
  }

  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const loading = pdfjs.getDocument({ data: new Uint8Array(original), useSystemFonts: true });
  let input: Awaited<typeof loading.promise>;
  try {
    input = await loading.promise;
  } catch {
    throw new Error(strings?.['pdf.errRender'] || 'This PDF could not be rendered. Try a different file.');
  }

  const base = settings[options.level];
  const candidates = targetBytes
    ? [
        base,
        { dpi: 96, quality: 0.58 },
        { dpi: 78, quality: 0.45 },
        { dpi: 62, quality: 0.35 },
        { dpi: 48, quality: 0.28 },
        { dpi: 36, quality: 0.22 },
      ]
    : [base];
  try {
    for (const candidate of candidates) {
      const output = await PDFDocument.create();
      for (let number = 1; number <= pages; number++) {
        const progressTemplate = strings?.['pdf.compressingPage'] || 'Compressing page {current} of {total}…';
        onProgress(progressTemplate.replace('{current}', String(number)).replace('{total}', String(pages)));
        const page = await input.getPage(number);
        const pdfViewport = page.getViewport({ scale: 1 });
        const scale = Math.min(candidate.dpi / 72, 2400 / Math.max(pdfViewport.width, pdfViewport.height));
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        const context = canvas.getContext('2d', { alpha: false });
        if (!context) throw new Error(strings?.['pdf.errCanvas'] || 'Your browser could not create a drawing surface.');
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvas, canvasContext: context, viewport }).promise;
        const jpeg = await canvasJpeg(canvas, candidate.quality, strings);
        const image = await output.embedJpg(jpeg);
        const newPage = output.addPage([pdfViewport.width, pdfViewport.height]);
        newPage.drawImage(image, { x: 0, y: 0, width: pdfViewport.width, height: pdfViewport.height });
        canvas.width = 0;
        canvas.height = 0;
        page.cleanup();
      }
      const bytes = await output.save({ useObjectStreams: true });
      if (bytes.length < best.length) { best = bytes; method = 'visual'; }
      if (!targetBytes || best.length <= targetBytes) break;
    }
  } finally {
    await loading.destroy();
  }
  return { bytes: best, method, pages, reachedTarget: !targetBytes || best.length <= targetBytes };
}
