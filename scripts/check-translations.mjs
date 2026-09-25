import { readdirSync, readFileSync } from 'node:fs';

export const CONFIGURED_LOCALES = ['en', 'es', 'pt', 'de', 'fr', 'ja'];

export function extractTokens(str) {
  if (typeof str !== 'string') return new Set();
  const matches = str.matchAll(/\{(\w+)\}/g);
  return new Set([...matches].map(m => m[1]));
}

/**
 * Validates translations dictionaries against source 'en' dictionary.
 * @param {Record<string, Record<string, string>>} dictByLocale - Map of locale to dictionary object
 * @param {string[]} [configuredLocales] - Allowed locale codes
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateTranslations(dictByLocale, configuredLocales = CONFIGURED_LOCALES) {
  const errors = [];
  const en = dictByLocale.en;

  if (!en || typeof en !== 'object') {
    return { valid: false, errors: ['Source dictionary "en" is missing or invalid'] };
  }

  const enKeys = Object.keys(en);
  if (enKeys.length === 0) {
    errors.push('en.json has no keys');
  }

  // Validate English source dictionary
  for (const key of enKeys) {
    const val = en[key];
    if (typeof val !== 'string' || val.trim().length === 0) {
      errors.push(`en.json key "${key}" must be a non-empty string`);
    }
  }

  // Validate configured locales
  for (const locale of Object.keys(dictByLocale)) {
    if (!configuredLocales.includes(locale)) {
      errors.push(`Unexpected locale "${locale}". Allowed locales are: ${configuredLocales.join(', ')}`);
    }
  }

  // Validate each non-English locale
  for (const [locale, data] of Object.entries(dictByLocale)) {
    if (locale === 'en') continue;

    if (!data || typeof data !== 'object') {
      errors.push(`${locale}.json is not a valid dictionary object`);
      continue;
    }

    const fileKeys = Object.keys(data);

    // Key parity: missing keys
    const missing = enKeys.filter(k => !(k in data));
    if (missing.length > 0) {
      errors.push(`${locale}.json is missing ${missing.length} keys: ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? '...' : ''}`);
    }

    // Key parity: extra / orphan keys
    const extra = fileKeys.filter(k => !(k in en));
    if (extra.length > 0) {
      errors.push(`${locale}.json has ${extra.length} extra keys not in en.json: ${extra.slice(0, 10).join(', ')}${extra.length > 10 ? '...' : ''}`);
    }

    // Value non-emptiness and interpolation tokens
    for (const key of enKeys) {
      if (!(key in data)) continue;
      const val = data[key];
      if (typeof val !== 'string' || val.trim().length === 0) {
        errors.push(`${locale}.json key "${key}" must be a non-empty string`);
        continue;
      }

      const enTokens = extractTokens(en[key]);
      const fileTokens = extractTokens(val);

      const missingTokens = [...enTokens].filter(t => !fileTokens.has(t));
      const extraTokens = [...fileTokens].filter(t => !enTokens.has(t));

      if (missingTokens.length > 0 || extraTokens.length > 0) {
        errors.push(
          `${locale}.json key "${key}" token mismatch. Expected [${[...enTokens].join(', ')}], found [${[...fileTokens].join(', ')}]` +
          (missingTokens.length ? ` (missing: ${missingTokens.join(', ')})` : '') +
          (extraTokens.length ? ` (extra: ${extraTokens.join(', ')})` : '')
        );
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// CLI runner
const isDirectRun = !process.argv[1] || process.argv[1].endsWith('check-translations.mjs');
if (isDirectRun) {
  const folder = new URL('../src/i18n/', import.meta.url);
  const jsonFiles = readdirSync(folder).filter(name => name.endsWith('.json'));

  const dictByLocale = {};
  for (const file of jsonFiles) {
    const locale = file.replace(/\.json$/, '');
    const raw = readFileSync(new URL(file, folder), 'utf8');
    try {
      dictByLocale[locale] = JSON.parse(raw);
    } catch (err) {
      throw new Error(`Failed to parse JSON in ${file}: ${err.message}`);
    }
  }

  const result = validateTranslations(dictByLocale, CONFIGURED_LOCALES);
  if (!result.valid) {
    console.error('Translation validation failed:');
    for (const error of result.errors) {
      console.error(`  - ${error}`);
    }
    process.exit(1);
  }

  console.log('Translation keys checked');
}
