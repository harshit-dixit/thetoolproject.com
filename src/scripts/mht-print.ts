// The print view: the saved page with its own layout and styles, printed through the browser so the
// visitor can choose "Save as PDF". Loaded only when asked for. The page's parts become blob: URLs;
// scripts, frames, plugins and anything that could reach the internet are removed, and the copy runs
// in a sandboxed frame without scripts, under a policy that only allows blob: and data: resources.
import { decodeBytes } from '../lib/eml';
import { createResolver, linkUrl, rewriteCss, rewriteSrcset } from '../lib/mht';
import type { MhtPage } from '../workers/mht-to-pdf';

const POLICY = "default-src 'none'; img-src blob: data:; style-src blob: data: 'unsafe-inline'; font-src blob: data:; media-src blob: data:";
// An address that isn't in the file is replaced with one that loads nothing.
const NOTHING = 'about:invalid';
const REMOVE = 'script, noscript, base, iframe, frame, frameset, object, embed, applet, portal, meta[http-equiv], template';

let frame: HTMLIFrameElement | undefined;
let urls: string[] = [];

/** Removes the print frame and releases its blob: URLs. */
export function clearPrint() {
  frame?.remove();
  frame = undefined;
  for (const url of urls) URL.revokeObjectURL(url);
  urls = [];
}

export function buildPrintPage(page: MhtPage): string {
  const resolve = createResolver(page);
  const made = new Map<number, string | null>();

  const partUrl = (index: number): string | undefined => {
    // null marks a style sheet that is being rewritten, so an @import loop ends.
    if (made.has(index)) return made.get(index) ?? undefined;
    const part = page.parts[index];
    if (/^(text\/html|application\/xhtml\+xml)$/.test(part.type)) return undefined;
    made.set(index, null);
    const blob = part.type === 'text/css'
      ? new Blob([rewriteCss(decodeBytes(part.bytes).text, ref => address(ref, part.location))], { type: 'text/css' })
      : new Blob([part.bytes as BlobPart], { type: part.type });
    const url = URL.createObjectURL(blob);
    urls.push(url);
    made.set(index, url);
    return url;
  };
  const address = (ref: string, from?: string): string | undefined => {
    if (/^data:/i.test(ref.trim()) || !ref.trim()) return undefined;
    const index = resolve(ref, from);
    return (index === undefined ? undefined : partUrl(index)) ?? NOTHING;
  };
  const swap = (element: Element, name: string) => {
    const value = element.getAttribute(name);
    if (value === null) return;
    const next = address(value);
    if (next) element.setAttribute(name, next);
  };

  const doc = new DOMParser().parseFromString(page.html, 'text/html');
  doc.querySelectorAll(REMOVE).forEach(element => element.remove());
  doc.querySelectorAll('link').forEach(link => {
    if (!/(^|\s)stylesheet(\s|$)/i.test(link.rel)) { link.remove(); return; }
    const href = address(link.getAttribute('href') ?? '');
    if (href && href !== NOTHING) link.setAttribute('href', href);
    else link.remove();
  });
  for (const element of doc.querySelectorAll('*')) {
    for (const { name } of [...element.attributes]) if (/^on/i.test(name) || name === 'ping') element.removeAttribute(name);
    if (element.hasAttribute('style')) element.setAttribute('style', rewriteCss(element.getAttribute('style')!, ref => address(ref)));
    for (const name of ['src', 'poster', 'background', 'data', 'href', 'xlink:href']) {
      if (name === 'href' || name === 'xlink:href') {
        if (element.namespaceURI === 'http://www.w3.org/2000/svg') swap(element, name);
        continue;
      }
      swap(element, name);
    }
    if (element.hasAttribute('srcset')) element.setAttribute('srcset', rewriteSrcset(element.getAttribute('srcset')!, ref => address(ref)));
    if (element instanceof HTMLAnchorElement || element instanceof HTMLAreaElement) {
      const href = element.getAttribute('href');
      const absolute = href ? linkUrl(href, page) : undefined;
      if (absolute) element.setAttribute('href', absolute);
      else element.removeAttribute('href');
    }
  }
  doc.querySelectorAll('style').forEach(style => { style.textContent = rewriteCss(style.textContent ?? '', ref => address(ref)); });

  const policy = doc.createElement('meta');
  policy.httpEquiv = 'Content-Security-Policy';
  policy.content = POLICY;
  doc.head.prepend(policy);
  // Print backgrounds and colors as they look on screen.
  const print = doc.createElement('style');
  print.textContent = '@media print { html { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }';
  doc.head.append(print);
  // Pages without a doctype were made for quirks mode (Word's are), so they keep it.
  return `${doc.doctype ? '<!DOCTYPE html>' : ''}${doc.documentElement.outerHTML}`;
}

/** Opens the browser's print dialog for the page. `name` becomes the suggested PDF file name. */
export async function printPage(page: MhtPage, name: string, label: string): Promise<void> {
  clearPrint();
  const html = buildPrintPage(page);
  const next = document.createElement('iframe');
  // Same origin so this script can call print(); no scripts, forms, pop-ups or navigation inside.
  next.setAttribute('sandbox', 'allow-same-origin allow-modals');
  next.className = 'mht-print-frame';
  next.title = label;
  next.tabIndex = -1;
  next.setAttribute('aria-hidden', 'true');
  const loaded = new Promise(resolve => next.addEventListener('load', resolve, { once: true }));
  next.srcdoc = html;
  document.body.append(next);
  frame = next;
  await loaded;
  const view = next.contentWindow!;
  view.document.title = name;
  view.focus();
  view.print();
}
