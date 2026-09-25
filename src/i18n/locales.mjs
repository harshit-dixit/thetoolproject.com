// Single source of truth for the configured locales. Plain JS so astro.config.mjs and the
// Node translation checker can import it as well as the TypeScript code.

export const defaultLocale = 'en';

/** @type {readonly ['en', 'es', 'pt', 'de', 'fr', 'ja']} */
export const locales = /** @type {const} */ (['en', 'es', 'pt', 'de', 'fr', 'ja']);

// BCP 47 tags for <html lang> and hreflang. The URL prefix stays /pt/, but the copy is
// Brazilian Portuguese, so search engines and screen readers are told pt-BR.
export const htmlLang = /** @type {const} */ ({
  en: 'en',
  es: 'es',
  pt: 'pt-BR',
  de: 'de',
  fr: 'fr',
  ja: 'ja',
});
