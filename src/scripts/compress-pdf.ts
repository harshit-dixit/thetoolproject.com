import type { CompressionLevel, CompressionMode } from '../lib/compress-pdf';

const root = document.querySelector<HTMLElement>('#pdf-tool');
if (root) {
  const strings = JSON.parse(root.dataset.strings || '{}') as Record<string, string>;
  const locale = root.dataset.locale || 'en';

  function t(key: string, values?: Record<string, string | number>): string {
    const str = strings[key];
    if (typeof str !== 'string') {
      throw new Error(`Missing translation key: ${key}`);
    }
    if (!values) return str;
    return str.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? ''));
  }

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
  let downloadUrl: string | null = null;

  const formatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });

  const size = (bytes: number) => {
    const unit = bytes >= 1048576 ? 'unit.mb' : bytes >= 1024 ? 'unit.kb' : 'unit.bytes';
    const amount = bytes >= 1048576 ? bytes / 1048576 : bytes >= 1024 ? bytes / 1024 : bytes;
    return `${formatter.format(amount)} ${t(unit)}`;
  };

  const message = (text: string, error = false) => {
    status.textContent = text;
    status.hidden = !text;
    status.classList.toggle('error', error);
  };

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
    get<HTMLElement>('#pdf-original-size').textContent = size(chosen.size);
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
      const { compressPdf } = await import('../lib/compress-pdf');
      const output = await compressPdf(file, {
        mode,
        level: level.value as CompressionLevel,
        targetBytes: selectedTarget,
        onProgress: message,
        strings,
      });
      downloadUrl = URL.createObjectURL(new Blob([output.bytes as BlobPart], { type: 'application/pdf' }));
      const link = get<HTMLAnchorElement>('#pdf-download');
      link.href = downloadUrl;
      link.download = `${file.name.replace(/\.pdf$/i, '')}-compressed.pdf`;
      get<HTMLElement>('#pdf-before').textContent = size(file.size);
      get<HTMLElement>('#pdf-after').textContent = size(output.bytes.length);
      get<HTMLElement>('#pdf-saved').textContent = `${Math.max(0, Math.round((1 - output.bytes.length / file.size) * 100))}%`;

      let note = output.method === 'visual'
        ? t('pdf.noteVisual')
        : output.method === 'optimized'
          ? t('pdf.noteOptimized')
          : t('pdf.noteOriginal');

      if (selectedTarget) {
        const targetStatus = output.reachedTarget
          ? t('pdf.targetReached', { target: target.value })
          : t('pdf.targetNotReached', { target: target.value });
        note = `${targetStatus} ${note}`;
      }
      get<HTMLElement>('#pdf-result-note').textContent = note;
      result.hidden = false;
      message('');
    } catch (error) {
      message(error instanceof Error ? error.message : t('pdf.errGeneral'), true);
    } finally {
      run.disabled = false;
    }
  });

  window.addEventListener('pagehide', () => { if (downloadUrl) URL.revokeObjectURL(downloadUrl); });
}
