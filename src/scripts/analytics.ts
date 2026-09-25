// Page-wide GA4 events: tool buttons and options, file picks and drops, pastes, navigation and script errors.
// Listeners run in the capture phase so they see every interaction before tool handlers act on it.
import { buttonEvent, fileParams, optionFromDataset, sizeBucket, track } from '../lib/analytics';

const VALUE_INPUTS = new Set(['checkbox', 'radio', 'range', 'number', 'select-one']);

function areaOf(element: Element) {
  if (element.closest('header')) return 'header';
  if (element.closest('footer')) return 'footer';
  return 'main';
}

document.addEventListener('click', event => {
  const target = (event.target as Element | null)?.closest<HTMLElement>('button, a[href], a[id]');
  if (!target || target.closest('footer .language-picker')) return;
  if (target instanceof HTMLAnchorElement && !target.id) {
    const href = target.getAttribute('href') ?? '';
    if (!href || href.startsWith('#') || /^(blob|data|javascript):/.test(href)) return;
    if (href.startsWith('mailto:')) { track('email_click', { link_location: areaOf(target) }); return; }
    const url = new URL(target.href, location.href);
    // Links to other sites are recorded by GA's enhanced measurement as outbound clicks.
    if (url.origin === location.origin) track('internal_link_click', { link_path: url.pathname, link_location: areaOf(target) });
    return;
  }
  if (target.id) { track(buttonEvent(target.id), { button_id: target.id }); return; }
  const option = optionFromDataset(target.dataset);
  if (option) track('option_select', option);
}, { capture: true });

document.addEventListener('change', event => {
  const input = event.target;
  if (input instanceof HTMLInputElement && input.type === 'file') {
    if (input.files?.length) track('file_select', { method: 'picker', ...fileParams(input.files) });
    return;
  }
  if (!(input instanceof HTMLInputElement || input instanceof HTMLSelectElement) || input.closest('footer')) return;
  const name = input.id || input.name;
  if (!name) return;
  // Free text (table names, search terms) stays private: only the fact that it changed is sent.
  const value = input instanceof HTMLInputElement && input.type === 'checkbox' ? String(input.checked) : VALUE_INPUTS.has(input.type) ? input.value : undefined;
  track('option_select', { option_name: name, option_value: value });
}, { capture: true });

document.addEventListener('drop', event => {
  const files = event.dataTransfer?.files;
  if (files?.length) track('file_select', { method: 'drop', ...fileParams(files) });
}, { capture: true });

document.addEventListener('paste', event => {
  const field = event.target;
  if (!(field instanceof HTMLTextAreaElement)) return;
  const text = event.clipboardData?.getData('text') ?? '';
  if (text) track('text_paste', { field_id: field.id, text_size: sizeBucket(new Blob([text]).size) });
}, { capture: true });

document.querySelector<HTMLFormElement>('footer .language-picker')?.addEventListener('submit', event => {
  const select = (event.currentTarget as HTMLFormElement).elements.namedItem('language') as HTMLSelectElement;
  track('language_switch', { from_locale: document.documentElement.dataset.locale, to_locale: select.selectedOptions[0]?.dataset.locale });
});

let reportedErrors = 0;
window.addEventListener('error', event => {
  if (reportedErrors++ >= 5) return;
  const where = event.filename ? ` @ ${new URL(event.filename, location.href).pathname}:${event.lineno}` : '';
  track('exception', { description: `${event.message}${where}`.slice(0, 150), fatal: false });
});
