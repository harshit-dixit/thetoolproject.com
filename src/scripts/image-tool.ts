import { createZip } from '../lib/zip';

const root = document.getElementById('image-tool') as HTMLDivElement;
const resize = root.dataset.mode === 'resize';
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const drop = $<HTMLDivElement>('image-drop');
const input = $<HTMLInputElement>('image-files');
const workspace = $<HTMLDivElement>('image-workspace');
const status = $<HTMLParagraphElement>('image-status');
const results = $<HTMLDivElement>('image-results');
const resultList = $<HTMLDivElement>('image-result-list');
const downloadAll = $<HTMLButtonElement>('image-download-all');
const runButton = $<HTMLButtonElement>('image-run');
const estimateButton = $<HTMLButtonElement>('image-estimate-button');
const estimateResult = $<HTMLParagraphElement>('image-estimate-result');
const preview = $<HTMLImageElement>('image-before');
const widthInput = $<HTMLInputElement>('image-width');
const heightInput = $<HTMLInputElement>('image-height');
const percentInput = $<HTMLInputElement>('image-percent');
const percentSlider = $<HTMLInputElement>('image-percent-slider');
const dpiInput = $<HTMLInputElement>('image-dpi');
const lockInput = $<HTMLInputElement>('image-lock');
const noEnlargeInput = $<HTMLInputElement>('image-no-enlarge');
const formatInput = $<HTMLSelectElement>('image-format');

type Output = { name: string; blob: Blob; width: number; height: number; url: string };
let files: File[] = [];
let outputs: Output[] = [];
let previewUrl = '';
let originalWidth = 0;
let originalHeight = 0;
let updatingDimensions = false;
let estimateVersion = 0;

function clearEstimate() {
  estimateVersion++;
  if (resize) {
    estimateResult.textContent = '';
    estimateResult.hidden = true;
    delete estimateResult.dataset.bytes;
  }
}

function message(value: string, error = false) {
  status.textContent = value;
  status.hidden = !value;
  status.classList.toggle('error', error);
}

function clearOutputs() {
  outputs.forEach(item => URL.revokeObjectURL(item.url));
  outputs = [];
  results.hidden = true;
  resultList.replaceChildren();
  downloadAll.hidden = true;
}

function formatBytes(bytes: number) {
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function selectedMode() {
  return (document.querySelector<HTMLInputElement>('input[name="resize-mode"]:checked')?.value || 'pixels') as 'pixels' | 'percent' | 'cm' | 'kb';
}

function updateMode() {
  if (!resize) return;
  clearEstimate();
  const mode = selectedMode();
  $('image-dim-fields').hidden = mode !== 'pixels' && mode !== 'cm';
  $('image-percent-field').hidden = mode !== 'percent';
  $('image-kb-field').hidden = mode !== 'kb';
  $('image-dpi-field').hidden = mode !== 'cm';
  $('image-dim-options').hidden = mode === 'kb';
  $('image-format-row').hidden = mode === 'kb';
  const unit = mode === 'cm' ? 'cm' : 'px';
  $('image-width-unit').textContent = unit;
  $('image-height-unit').textContent = unit;
  $('image-mode-hint').textContent = mode === 'cm'
    ? 'Centimetres are converted to pixels using PPI. The JPG, PNG or WebP file will not contain a print-size setting.'
    : 'With aspect ratio on, width and height form a maximum-size box for each image.';
  if (mode === 'cm') {
    const dpi = Number(dpiInput.value) || 300;
    widthInput.value = (originalWidth / dpi * 2.54).toFixed(2);
    heightInput.value = (originalHeight / dpi * 2.54).toFixed(2);
    widthInput.step = heightInput.step = '0.01';
  } else if (mode === 'pixels') {
    widthInput.value = String(originalWidth);
    heightInput.value = String(originalHeight);
    widthInput.step = heightInput.step = '1';
  }
  clearOutputs();
  message('');
}

function syncDimension(changed: 'width' | 'height') {
  if (!resize || !lockInput.checked || updatingDimensions || !originalWidth || !originalHeight) return;
  updatingDimensions = true;
  const other = changed === 'width' ? heightInput : widthInput;
  const active = changed === 'width' ? widthInput : heightInput;
  const value = Number(active.value);
  if (Number.isFinite(value) && value > 0) {
    const ratio = changed === 'width' ? originalHeight / originalWidth : originalWidth / originalHeight;
    other.value = selectedMode() === 'cm' ? (value * ratio).toFixed(2) : String(Math.max(1, Math.round(value * ratio)));
  }
  updatingDimensions = false;
}

async function decode(file: File): Promise<ImageBitmap> {
  try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { throw new Error(`Could not read ${file.name}. Choose a valid JPG, PNG or WebP image.`); }
}

async function setFiles(next: File[]) {
  clearOutputs();
  clearEstimate();
  message('');
  if (!next.length) return;
  files = [];
  workspace.hidden = true;
  drop.hidden = false;
  if ((!resize && next.length !== 1) || (resize && next.length > 20)) { message(resize ? 'Choose no more than 20 images at once.' : 'Choose one JPG at a time.', true); return; }
  const allowed = resize ? ['image/jpeg', 'image/png', 'image/webp'] : ['image/jpeg'];
  const bad = next.find(file => !allowed.includes(file.type) || file.size > 25 * 1024 * 1024);
  if (bad) { message(`${bad.name} is not a supported ${resize ? 'JPG, PNG or WebP' : 'JPG'} image under 25MB.`, true); return; }
  try {
    const bitmap = await decode(next[0]);
    originalWidth = bitmap.width;
    originalHeight = bitmap.height;
    bitmap.close();
    if (!originalWidth || !originalHeight) throw new Error('This image has no usable dimensions.');
    files = next;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(next[0]);
    preview.src = previewUrl;
    $('image-selection-title').textContent = next.length === 1 ? next[0].name : `${next.length} images selected`;
    $('image-selection-detail').textContent = next.length === 1 ? 'Ready to process' : `Previewing ${next[0].name}`;
    $('image-original-size').textContent = formatBytes(next[0].size);
    $('image-original-dimensions').textContent = `${originalWidth} × ${originalHeight} px`;
    drop.hidden = true;
    workspace.hidden = false;
    if (resize) updateMode();
  } catch (error) { message(error instanceof Error ? error.message : 'Could not read the image.', true); }
}

function dimensions(sourceWidth: number, sourceHeight: number) {
  const mode = selectedMode();
  if (mode === 'kb') return { width: sourceWidth, height: sourceHeight };
  let width: number;
  let height: number;
  if (mode === 'percent') {
    const scale = Number($<HTMLInputElement>('image-percent').value) / 100;
    if (!Number.isFinite(scale) || scale < .01 || scale > 5) throw new Error('Enter a percentage from 1 to 500.');
    width = Math.round(sourceWidth * scale);
    height = Math.round(sourceHeight * scale);
  } else {
    const w = Number(widthInput.value);
    const h = Number(heightInput.value);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) throw new Error('Enter a width and height greater than zero.');
    const dpi = Number(dpiInput.value);
    if (mode === 'cm' && (!Number.isFinite(dpi) || dpi < 1 || dpi > 1200)) throw new Error('Enter a resolution from 1 to 1200 PPI.');
    const factor = mode === 'cm' ? dpi / 2.54 : 1;
    const targetWidth = Math.round(w * factor);
    const targetHeight = Math.round(h * factor);
    if (lockInput.checked) {
      const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
      width = Math.round(sourceWidth * scale);
      height = Math.round(sourceHeight * scale);
    } else {
      width = targetWidth;
      height = targetHeight;
    }
  }
  if (noEnlargeInput.checked) {
    const scale = Math.min(1, sourceWidth / width, sourceHeight / height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }
  width = Math.max(1, width);
  height = Math.max(1, height);
  if (width > 16000 || height > 16000 || width * height > 40_000_000) throw new Error('The output is too large. Choose dimensions under 16,000 px and 40 megapixels.');
  return { width, height };
}

function canvasFor(bitmap: ImageBitmap, width: number, height: number, mime: string) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser could not create an image canvas.');
  if (mime === 'image/jpeg') { context.fillStyle = '#ffffff'; context.fillRect(0, 0, width, height); }
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, 0, 0, width, height);
  return canvas;
}

function encode(canvas: HTMLCanvasElement, mime: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob && blob.type === mime ? resolve(blob) : reject(new Error(`Your browser could not save ${mime.split('/')[1].toUpperCase()}.`)), mime, quality));
}

async function fitJpeg(bitmap: ImageBitmap, maxBytes: number) {
  let width = bitmap.width;
  let height = bitmap.height;
  if (width > 16000 || height > 16000 || width * height > 40_000_000) {
    const scale = Math.min(16000 / width, 16000 / height, Math.sqrt(40_000_000 / (width * height)));
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));
  }
  for (let pass = 0; pass < 12; pass++) {
    const canvas = canvasFor(bitmap, width, height, 'image/jpeg');
    let best: Blob | undefined;
    let low = .05;
    let high = .95;
    for (let attempt = 0; attempt < 9; attempt++) {
      const quality = (low + high) / 2;
      const candidate = await encode(canvas, 'image/jpeg', quality);
      if (candidate.size <= maxBytes) { best = candidate; low = quality; }
      else high = quality;
    }
    if (best) return { blob: best, width, height };
    if (width <= 1 && height <= 1) break;
    width = Math.max(1, Math.floor(width * .8));
    height = Math.max(1, Math.floor(height * .8));
  }
  throw new Error('This image could not be reduced to the requested file size. Try a larger KB limit.');
}

function extension(mime: string) { return mime === 'image/jpeg' ? 'jpg' : mime === 'image/png' ? 'png' : 'webp'; }
function outputName(file: File, mime: string) { return `${file.name.replace(/\.[^.]+$/, '').replace(/[^\w .()-]/g, '_')}-${resize ? 'resized' : '100kb'}.${extension(mime)}`; }

async function process(file: File): Promise<Output> {
  const bitmap = await decode(file);
  try {
    let blob: Blob;
    let width: number;
    let height: number;
    let mime: string;
    if (!resize || selectedMode() === 'kb') {
      mime = 'image/jpeg';
      const limit = resize ? Number($<HTMLInputElement>('image-kb').value) : 100;
      if (!Number.isInteger(limit) || limit < 1 || limit > 20000) throw new Error('Enter a file size from 1 to 20,000 KB.');
      if (file.type === mime && file.size <= limit * 1024) {
        blob = file;
        width = bitmap.width;
        height = bitmap.height;
      } else ({ blob, width, height } = await fitJpeg(bitmap, limit * 1024));
    } else {
      mime = formatInput.value === 'original' ? file.type : formatInput.value;
      ({ width, height } = dimensions(bitmap.width, bitmap.height));
      blob = await encode(canvasFor(bitmap, width, height, mime), mime, mime === 'image/png' ? undefined : .9);
    }
    const name = outputName(file, mime);
    return { name, blob, width, height, url: URL.createObjectURL(blob) };
  } finally { bitmap.close(); }
}

async function run() {
  if (!files.length) return;
  clearOutputs();
  message('');
  runButton.disabled = true;
  if (resize) estimateButton.disabled = true;
  try {
    for (let i = 0; i < files.length; i++) {
      message(`Processing ${i + 1} of ${files.length}…`);
      // Let the status paint before canvas work starts on the main thread.
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      outputs.push(await process(files[i]));
    }
    message('');
    $('image-results-summary').textContent = `${outputs.length} ${outputs.length === 1 ? 'image' : 'images'} processed`;
    outputs.forEach(item => {
      const row = document.createElement('div');
      row.className = 'image-result-row';
      const image = document.createElement('img');
      image.src = item.url;
      image.alt = '';
      const detail = document.createElement('div');
      const name = document.createElement('strong');
      name.textContent = item.name;
      const meta = document.createElement('span');
      meta.textContent = `${item.width} × ${item.height} px · ${formatBytes(item.blob.size)}${resize ? '' : ` (${item.blob.size.toLocaleString()} bytes)`}`;
      detail.append(name, meta);
      const link = document.createElement('a');
      link.href = item.url;
      link.download = item.name;
      link.textContent = 'Download';
      row.append(image, detail, link);
      resultList.append(row);
    });
    downloadAll.hidden = outputs.length < 2;
    results.hidden = false;
    results.scrollIntoView({ block: 'nearest' });
  } catch (error) {
    clearOutputs();
    message(error instanceof Error ? error.message : 'The image could not be processed.', true);
  } finally {
    runButton.disabled = false;
    if (resize) estimateButton.disabled = false;
  }
}

async function estimateSize() {
  if (!resize || !files.length) return;
  const revision = ++estimateVersion;
  const file = files[0];
  delete estimateResult.dataset.bytes;
  estimateResult.textContent = `Estimating ${file.name}…`;
  estimateResult.hidden = false;
  message('');
  estimateButton.disabled = true;
  runButton.disabled = true;
  try {
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const output = await process(file);
    URL.revokeObjectURL(output.url);
    if (revision !== estimateVersion) return;
    estimateResult.dataset.bytes = String(output.blob.size);
    estimateResult.textContent = `Estimated size${files.length > 1 ? ` for ${file.name}` : ''}: ${formatBytes(file.size)} → ${formatBytes(output.blob.size)} (${output.width} × ${output.height} px).${files.length > 1 ? ' Other images may have different sizes.' : ''}`;
  } catch (error) {
    if (revision !== estimateVersion) return;
    estimateResult.hidden = true;
    message(error instanceof Error ? error.message : 'Could not estimate this image.', true);
  } finally {
    estimateButton.disabled = false;
    runButton.disabled = false;
  }
}

$('image-choose').addEventListener('click', () => input.click());
$('image-change').addEventListener('click', () => input.click());
input.addEventListener('change', () => { void setFiles(Array.from(input.files || [])); input.value = ''; });
for (const eventName of ['dragenter', 'dragover']) drop.addEventListener(eventName, event => { event.preventDefault(); drop.classList.add('over'); });
for (const eventName of ['dragleave', 'drop']) drop.addEventListener(eventName, event => { event.preventDefault(); drop.classList.remove('over'); });
drop.addEventListener('drop', event => { void setFiles(Array.from(event.dataTransfer?.files || [])); });
runButton.addEventListener('click', () => { void run(); });
if (resize) {
  estimateButton.addEventListener('click', () => { void estimateSize(); });
  const settingsChanged = (event: Event) => {
    if (!(event.target instanceof HTMLElement) || !event.target.closest('.image-settings')) return;
    clearEstimate();
    clearOutputs();
  };
  root.addEventListener('input', settingsChanged);
  root.addEventListener('change', settingsChanged);
}
downloadAll.addEventListener('click', async () => {
  const entries = await Promise.all(outputs.map(async (item, index) => ({ name: `${String(index + 1).padStart(2, '0')}-${item.name}`, data: new Uint8Array(await item.blob.arrayBuffer()) })));
  const zip = new Blob([createZip(entries) as BlobPart], { type: 'application/zip' });
  const url = URL.createObjectURL(zip);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'resized-images.zip';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
});
if (resize) {
  document.querySelectorAll<HTMLInputElement>('input[name="resize-mode"]').forEach(radio => radio.addEventListener('change', updateMode));
  percentInput.addEventListener('input', () => {
    const value = Number(percentInput.value);
    if (percentInput.value && Number.isFinite(value)) percentSlider.value = String(Math.min(500, Math.max(1, Math.round(value))));
  });
  percentInput.addEventListener('change', () => {
    const value = Number(percentInput.value);
    if (percentInput.value && Number.isFinite(value) && value >= 1 && value <= 500) percentInput.value = String(Math.round(value));
  });
  percentSlider.addEventListener('input', () => { percentInput.value = percentSlider.value; });
  widthInput.addEventListener('input', () => syncDimension('width'));
  heightInput.addEventListener('input', () => syncDimension('height'));
  dpiInput.addEventListener('change', () => { if (selectedMode() === 'cm') updateMode(); });
}
window.addEventListener('pagehide', () => { clearOutputs(); if (previewUrl) URL.revokeObjectURL(previewUrl); });
