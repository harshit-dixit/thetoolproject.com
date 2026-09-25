import { readdirSync, readFileSync } from 'node:fs';
import { locales } from '../src/i18n/locales.mjs';

export const CONFIGURED_LOCALES = [...locales];

export function extractTokens(str) {
  if (typeof str !== 'string') return new Set();
  const matches = str.matchAll(/\{(\w+)\}/g);
  return new Set([...matches].map(m => m[1]));
}

// RichText markup: <code>, <strong> and <a:linkId>. Each translation must use the same tags.
const MARKUP_TAG = /<\/?(?:code|strong|a:[\w-]+)>/g;

export function extractMarkup(str) {
  if (typeof str !== 'string') return [];
  return [...str.matchAll(MARKUP_TAG)].map(m => m[0]).sort();
}

function markupIsBalanced(str) {
  const stack = [];
  for (const [tag] of str.matchAll(MARKUP_TAG)) {
    if (tag[1] !== '/') stack.push(tag.slice(1, -1));
    else if (stack.pop() !== tag.slice(2, -1)) return false;
  }
  return stack.length === 0;
}

// Numbers with their group/decimal separators removed, so 1,048,576 and 1.048.576 compare equal.
export function extractNumbers(str) {
  if (typeof str !== 'string') return [];
  const ascii = str.replace(/[０-９]/g, d => String.fromCharCode(d.charCodeAt(0) - 0xfee0));
  return [...ascii.matchAll(/\d+(?:[.,\u00a0\u202f ]\d+)*/g)].map(m => m[0].replace(/\D/g, ''));
}

const PLURAL_SUFFIX = /\.(zero|one|two|few|many|other)$/;

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
      continue;
    }
    if (!markupIsBalanced(val)) errors.push(`en.json key "${key}" has unbalanced markup`);
    if (PLURAL_SUFFIX.test(key) && !extractTokens(val).has('count')) {
      errors.push(`en.json plural key "${key}" must contain {count}`);
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

      const enMarkup = extractMarkup(en[key]).join(' ');
      const fileMarkup = extractMarkup(val).join(' ');
      if (enMarkup !== fileMarkup) {
        errors.push(`${locale}.json key "${key}" markup mismatch. Expected [${enMarkup}], found [${fileMarkup}]`);
      } else if (!markupIsBalanced(val)) {
        errors.push(`${locale}.json key "${key}" has unbalanced markup`);
      }

      // Every number in the English copy (limits, sizes, examples) must survive translation.
      // Extra numbers are allowed, e.g. a digit where English spells out "eight".
      const fileNumbers = new Set(extractNumbers(val));
      const lostNumbers = [...new Set(extractNumbers(en[key]))].filter(n => !fileNumbers.has(n));
      if (lostNumbers.length > 0) {
        errors.push(`${locale}.json key "${key}" is missing number(s) from English: ${lostNumbers.join(', ')}`);
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
