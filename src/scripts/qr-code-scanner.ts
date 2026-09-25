import wasmUrl from '../../node_modules/zxing-wasm/dist/reader/zxing_reader.wasm?url';
import type { ReaderOptions } from 'zxing-wasm/reader';
import { i18nFrom } from '../i18n/client';

const root = document.getElementById('qr-tool') as HTMLElement;
const { t } = i18nFrom(root);

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const cameraTab = byId<HTMLButtonElement>('qr-camera-tab');
const imageTab = byId<HTMLButtonElement>('qr-image-tab');
const cameraPanel = byId<HTMLDivElement>('qr-camera-panel');
const imagePanel = byId<HTMLDivElement>('qr-image-panel');
const view = byId<HTMLDivElement>('qr-view');
const video = byId<HTMLVideoElement>('qr-video');
const startButton = byId<HTMLButtonElement>('qr-start');
const stopButton = byId<HTMLButtonElement>('qr-stop');
const switchButton = byId<HTMLButtonElement>('qr-switch');
const torchButton = byId<HTMLButtonElement>('qr-torch');
const fileZone = byId<HTMLDivElement>('qr-file-zone');
const fileInput = byId<HTMLInputElement>('qr-file');
const chooseButton = byId<HTMLButtonElement>('qr-choose');
const status = byId<HTMLParagraphElement>('qr-status');
const result = byId<HTMLDivElement>('qr-result');
const resultType = byId<HTMLHeadingElement>('qr-result-type');
const output = byId<HTMLTextAreaElement>('qr-output');
const destination = byId<HTMLParagraphElement>('qr-destination');
const openLink = byId<HTMLAnchorElement>('qr-open');
const copyButton = byId<HTMLButtonElement>('qr-copy');
const clearButton = byId<HTMLButtonElement>('qr-clear');
const resultNote = byId<HTMLParagraphElement>('qr-result-note');

type Decoder = typeof import('zxing-wasm/reader');
const scanOptions: ReaderOptions = { formats: ['QRCode'], maxNumberOfSymbols: 1, tryHarder: true, tryInvert: true, tryRotate: true, tryDenoise: true };
let decoderPromise: Promise<Decoder> | undefined;
let stream: MediaStream | undefined;
let frameId = 0;
let cameraRun = 0;
let imageRun = 0;
let facing: 'environment' | 'user' = 'environment';
let currentMode: 'camera' | 'image' = 'camera';
let torchOn = false;
const canvas = document.createElement('canvas');
const context = canvas.getContext('2d', { willReadFrequently: true });

function decoder() {
  decoderPromise ??= import('zxing-wasm/reader').then(module => {
    module.prepareZXingModule({ overrides: { locateFile: (path: string, prefix: string) => path.endsWith('.wasm') ? wasmUrl : prefix + path } });
    return module;
  }).catch(error => {
    decoderPromise = undefined;
    throw error;
  });
  return decoderPromise;
}

function showStatus(message: string, error = false) {
  status.textContent = message;
  status.hidden = !message;
  status.classList.toggle('error', error);
}

function clearResult() {
  result.hidden = true;
  output.value = '';
  openLink.hidden = true;
  openLink.removeAttribute('href');
  destination.hidden = true;
  copyButton.textContent = t('qr.copyResult');
}

function stopCamera() {
  cameraRun++;
  cancelAnimationFrame(frameId);
  stream?.getTracks().forEach(track => track.stop());
  stream = undefined;
  video.pause();
  video.srcObject = null;
  view.classList.remove('active');
  startButton.hidden = false;
  startButton.disabled = false;
  stopButton.hidden = true;
  switchButton.hidden = true;
  torchButton.hidden = true;
  torchButton.setAttribute('aria-pressed', 'false');
  torchButton.textContent = t('qr.torchOn');
  torchOn = false;
}

function showResult(value: string) {
  stopCamera();
  showStatus('');
  result.hidden = false;
  output.value = value;
  resultType.textContent = t('qr.typeText');
  destination.hidden = true;
  openLink.hidden = true;
  openLink.removeAttribute('href');
  resultNote.textContent = t('qr.noteDefault');
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      if ((url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password) {
        resultType.textContent = t('qr.typeLink');
        destination.textContent = t('qr.destination', { host: `${url.hostname}${url.port ? `:${url.port}` : ''}` });
        destination.hidden = false;
        openLink.href = url.href;
        openLink.hidden = false;
        if (url.protocol === 'http:') resultNote.textContent = t('qr.noteUnencrypted');
      }
    } catch { /* Malformed URLs stay as plain text. */ }
  } else if (/^WIFI:/i.test(value)) {
    resultType.textContent = t('qr.typeWifi');
  } else if (/^BEGIN:VCARD/i.test(value)) {
    resultType.textContent = t('qr.typeContact');
  }
  result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function startCamera() {
  stopCamera();
  clearResult();
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    showStatus(t('qr.errSecureContext'), true);
    return;
  }
  const run = cameraRun;
  startButton.hidden = true;
  showStatus(t('qr.waitingPermission'));
  try {
    const requested = navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } } });
    const acquired = await requested;
    if (run !== cameraRun || currentMode !== 'camera') {
      acquired.getTracks().forEach(track => track.stop());
      return;
    }
    stream = acquired;
    video.srcObject = acquired;
    await video.play();
    if (run !== cameraRun) return;
    view.classList.add('active');
    stopButton.hidden = false;
    showStatus(t('qr.startingReader'));
    const decode = await decoder();
    if (run !== cameraRun) return;
    showStatus(t('qr.looking'));
    try {
      const cameras = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === 'videoinput');
      if (run === cameraRun) switchButton.hidden = cameras.length < 2;
    } catch { /* Camera switching is optional. */ }
    const track = acquired.getVideoTracks()[0];
    const capabilities = (track.getCapabilities?.() || {}) as MediaTrackCapabilities & { torch?: boolean };
    if (run === cameraRun) torchButton.hidden = !capabilities.torch;
    let lastScan = 0;
    const scan = async (now: number) => {
      if (run !== cameraRun || !stream) return;
      if (now - lastScan >= 220 && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && context) {
        lastScan = now;
        const scale = Math.min(1, 1600 / Math.max(video.videoWidth, video.videoHeight));
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        try {
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
          const found = (await decode.readBarcodes(pixels, scanOptions)).find(item => item.isValid);
          if (run !== cameraRun) return;
          if (found) {
            showResult(found.text);
            return;
          }
        } catch {
          if (run !== cameraRun) return;
          stopCamera();
          showStatus(t('qr.errReaderStopped'), true);
          return;
        }
      }
      frameId = requestAnimationFrame(scan);
    };
    frameId = requestAnimationFrame(scan);
  } catch (error) {
    if (run !== cameraRun) return;
    stopCamera();
    const name = error instanceof DOMException ? error.name : '';
    showStatus(name === 'NotAllowedError' ? t('qr.errPermissionDenied') : name === 'NotFoundError' ? t('qr.errNotFound') : t('qr.errStartFailed'), true);
  } finally {
    if (run === cameraRun) startButton.disabled = false;
  }
}

function setMode(mode: 'camera' | 'image') {
  if (mode === currentMode) return;
  stopCamera();
  imageRun++;
  currentMode = mode;
  cameraPanel.hidden = mode !== 'camera';
  imagePanel.hidden = mode !== 'image';
  cameraTab.setAttribute('aria-pressed', String(mode === 'camera'));
  imageTab.setAttribute('aria-pressed', String(mode === 'image'));
  showStatus('');
  clearResult();
  if (mode === 'camera') void startCamera();
}

async function scanImage(file: File) {
  const run = ++imageRun;
  stopCamera();
  clearResult();
  const supportedMime = /^image\/(png|jpeg|webp|gif|bmp)$/i.test(file.type);
  const supportedExtension = /\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name);
  if ((file.type && !supportedMime) || (!supportedMime && !supportedExtension)) {
    showStatus(t('qr.errImageType'), true);
    return;
  }
  if (file.size > 20 * 1024 * 1024) {
    showStatus(t('qr.errImageTooLarge'), true);
    return;
  }
  showStatus(t('qr.readingImage', { name: file.name || t('qr.pastedImage') }));
  try {
    if (!context) throw new Error('Canvas is unavailable');
    const [decode, bitmap] = await Promise.all([decoder(), createImageBitmap(file)]);
    if (run !== imageRun) { bitmap.close(); return; }
    const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const found = (await decode.readBarcodes(pixels, scanOptions)).find(item => item.isValid);
    if (run !== imageRun) return;
    if (found) showResult(found.text);
    else showStatus(t('qr.errNotFoundInImage'), true);
  } catch {
    if (run === imageRun) showStatus(t('qr.errImageRead'), true);
  }
}

cameraTab.addEventListener('click', () => setMode('camera'));
imageTab.addEventListener('click', () => setMode('image'));
startButton.addEventListener('click', startCamera);
stopButton.addEventListener('click', () => { stopCamera(); showStatus(t('qr.cameraStopped')); });
switchButton.addEventListener('click', () => { facing = facing === 'environment' ? 'user' : 'environment'; void startCamera(); });
torchButton.addEventListener('click', async () => {
  const track = stream?.getVideoTracks()[0];
  if (!track) return;
  try {
    await track.applyConstraints({ advanced: [{ torch: !torchOn } as MediaTrackConstraintSet] });
    torchOn = !torchOn;
    torchButton.textContent = torchOn ? t('qr.torchOff') : t('qr.torchOn');
    torchButton.setAttribute('aria-pressed', String(torchOn));
  } catch { showStatus(t('qr.errTorch'), true); }
});
chooseButton.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => { const file = fileInput.files?.[0]; if (file) void scanImage(file); fileInput.value = ''; });
for (const name of ['dragenter', 'dragover']) fileZone.addEventListener(name, event => { event.preventDefault(); fileZone.classList.add('over'); });
for (const name of ['dragleave', 'drop']) fileZone.addEventListener(name, event => { event.preventDefault(); fileZone.classList.remove('over'); });
fileZone.addEventListener('drop', event => { const file = event.dataTransfer?.files[0]; if (file) void scanImage(file); });
window.addEventListener('paste', event => {
  const file = [...(event.clipboardData?.items || [])].find(item => item.type.startsWith('image/'))?.getAsFile();
  if (file) { event.preventDefault(); setMode('image'); void scanImage(file); }
});
copyButton.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(output.value);
    copyButton.textContent = t('qr.copied');
  } catch {
    output.focus();
    output.select();
    showStatus(t('qr.clipboardSelected'));
  }
});
clearButton.addEventListener('click', () => { imageRun++; clearResult(); showStatus(''); if (currentMode === 'camera') void startCamera(); else chooseButton.focus(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && stream) { stopCamera(); showStatus(t('qr.cameraHidden')); } });
window.addEventListener('pagehide', stopCamera);
void startCamera();
