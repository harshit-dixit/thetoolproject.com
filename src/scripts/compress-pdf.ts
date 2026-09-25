import type { CompressionErrorCode, CompressionLevel, CompressionMode, CompressionProgress } from '../lib/compress-pdf';
import { i18nFrom } from '../i18n/client';

const errorKeys: Record<CompressionErrorCode, string> = {
  invalidPdf: 'pdf.errInvalidPdf',
  passwordOrDamaged: 'pdf.errPasswordOrDamaged',
  noPages: 'pdf.errNoPages',
  pageLimit: 'pdf.errPageLimit',
  render: 'pdf.errRender',
  canvas: 'pdf.errCanvas',
  encode: 'pdf.errEncode',
};

const root = document.querySelector<HTMLElement>('#pdf-tool');
if (root) {
  const { t, formatNumber, formatBytes, formatPercent } = i18nFrom(root);

  const get = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  const input = get<HTMLInputElement>('#pdf-file');
  const drop = get<HTMLElement>('#pdf-drop');
  const workspace = get<HTMLElement>('#pdf-workspace');
  const result = get<HTMLElement>('#pdf-result');
  const status = get<HTMLElement>('#pdf-status');
  const target = get<HTMLSelectElement>('#pdf-target');
  const level = get<HTMLSelectElement>('#pdf-level');
  const run = get<HTMLButtonElement>('#pdf-run');
  let file: File | null = null;
  let compressionError: typeof import('../lib/compress-pdf').CompressionError | undefined;
  let downloadUrl: string | null = null;

  const message = (text: string, error = false) => {
    status.textContent = text;
    status.hidden = !text;
    status.classList.toggle('error', error);
  };

  const progress = (update: CompressionProgress) => message(update.stage === 'checking'
    ? t('pdf.checkingStructure')
    : t('pdf.compressingPage', { current: formatNumber(update.current), total: formatNumber(update.total) }));

  const clearResult = () => {
    result.hidden = true;
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    downloadUrl = null;
  };

  const syncMode = () => {
    const preserve = get<HTMLInputElement>('input[name="pdf-mode"]:checked').value === 'preserve';
    level.disabled = preserve;
    clearResult();
    message('');
  };

  const select = (chosen?: File) => {
    if (!chosen) return;
    if (chosen.size > 30 * 1024 * 1024) {
      message(t('pdf.errTooLarge'), true);
      return;
    }
    if (!chosen.name.toLowerCase().endsWith('.pdf') && chosen.type !== 'application/pdf') {
      message(t('pdf.errNotPdf'), true);
      return;
    }
    file = chosen;
    get<HTMLElement>('#pdf-name').textContent = chosen.name;
    get<HTMLElement>('#pdf-original-size').textContent = formatBytes(chosen.size);
    drop.hidden = true;
    workspace.hidden = false;
    message('');
    clearResult();
  };

  if (root.dataset.targetKb) target.value = root.dataset.targetKb;
  root.querySelectorAll<HTMLInputElement>('input[name="pdf-mode"]').forEach(radio => radio.addEventListener('change', syncMode));
  target.addEventListener('change', clearResult);
  level.addEventListener('change', clearResult);
  get<HTMLButtonElement>('#pdf-choose').addEventListener('click', () => input.click());
  get<HTMLButtonElement>('#pdf-change').addEventListener('click', () => input.click());
  input.addEventListener('change', () => select(input.files?.[0]));
  for (const event of ['dragenter', 'dragover']) drop.addEventListener(event, e => { e.preventDefault(); drop.classList.add('over'); });
  for (const event of ['dragleave', 'drop']) drop.addEventListener(event, e => { e.preventDefault(); drop.classList.remove('over'); });
  drop.addEventListener('drop', e => select((e as DragEvent).dataTransfer?.files[0]));

  run.addEventListener('click', async () => {
    if (!file) return;
    clearResult();
    run.disabled = true;
    const mode = get<HTMLInputElement>('input[name="pdf-mode"]:checked').value as CompressionMode;
    const selectedTarget = target.value ? Number(target.value) * 1024 : undefined;
    try {
      message(t('pdf.opening'));
      const { compressPdf, CompressionError } = await import('../lib/compress-pdf');
      compressionError = CompressionError;
      const output = await compressPdf(file, {
        mode,
        level: level.value as CompressionLevel,
        targetBytes: selectedTarget,
        onProgress: progress,
      });
      downloadUrl = URL.createObjectURL(new Blob([output.bytes as BlobPart], { type: 'application/pdf' }));
      const link = get<HTMLAnchorElement>('#pdf-download');
      link.href = downloadUrl;
      link.download = `${file.name.replace(/\.pdf$/i, '')}-compressed.pdf`;
      get<HTMLElement>('#pdf-before').textContent = formatBytes(file.size);
      get<HTMLElement>('#pdf-after').textContent = formatBytes(output.bytes.length);
      get<HTMLElement>('#pdf-saved').textContent = formatPercent(Math.max(0, 1 - output.bytes.length / file.size));

      let note = output.method === 'visual'
        ? t('pdf.noteVisual')
        : output.method === 'optimized'
          ? t('pdf.noteOptimized')
          : t('pdf.noteOriginal');

      if (selectedTarget) {
        const targetStatus = output.reachedTarget
          ? t('pdf.targetReached', { target: formatNumber(Number(target.value)) })
          : t('pdf.targetNotReached', { target: formatNumber(Number(target.value)) });
        note = `${targetStatus} ${note}`;
      }
      get<HTMLElement>('#pdf-result-note').textContent = note;
      result.hidden = false;
      message('');
    } catch (error) {
      // pdf.js and pdf-lib throw English, technical messages; only known failures get a specific explanation.
      message(compressionError && error instanceof compressionError ? t(errorKeys[error.code]) : t('pdf.errGeneral'), true);
    } finally {
      run.disabled = false;
    }
  });

  window.addEventListener('pagehide', () => { if (downloadUrl) URL.revokeObjectURL(downloadUrl); });
}
