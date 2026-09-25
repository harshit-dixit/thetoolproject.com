// Browser-side translation helper. Each tool component renders the keys its script needs into
// data-strings and its locale into data-locale; this module never imports a dictionary.
// A missing key or a missing {param} throws, so an incomplete translation fails loudly instead
// of showing a key name, "undefined" or an empty gap.

export type Params = Record<string, string | number>;

export function interpolate(template: string, params: Params | undefined, key: string): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = params?.[name];
    if (value === undefined) throw new Error(`Missing parameter "${name}" for translation key "${key}"`);
    return String(value);
  });
}

export function createI18n(strings: Record<string, string>, locale = 'en') {
  const plurals = new Intl.PluralRules(locale);
  const numberFormats = new Map<string, Intl.NumberFormat>();
  const numberFormat = (options: Intl.NumberFormatOptions = {}) => {
    const cacheKey = JSON.stringify(options);
    let format = numberFormats.get(cacheKey);
    if (!format) numberFormats.set(cacheKey, format = new Intl.NumberFormat(locale, options));
    return format;
  };

  const has = (key: string) => typeof strings[key] === 'string';

  function t(key: string, params?: Params): string {
    const template = strings[key];
    if (typeof template !== 'string') throw new Error(`Missing translation key "${key}"`);
    return interpolate(template, params, key);
  }

  function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
    return numberFormat(options).format(value);
  }

  /** Picks `${base}.${pluralRule}`, falling back to `${base}.other`, and fills {count}. */
  function counted(base: string, count: number, params?: Params): string {
    const specific = `${base}.${plurals.select(count)}`;
    return t(has(specific) ? specific : `${base}.other`, { ...params, count: formatNumber(count) });
  }

  /** Bytes with no decimals; KB and MB with at most one decimal. */
  function formatBytes(bytes: number): string {
    if (bytes >= 1048576) return `${formatNumber(bytes / 1048576, { maximumFractionDigits: 1 })} ${t('unit.mb')}`;
    if (bytes >= 1024) return `${formatNumber(bytes / 1024, { maximumFractionDigits: 1 })} ${t('unit.kb')}`;
    return `${formatNumber(bytes, { maximumFractionDigits: 0 })} ${t('unit.bytes')}`;
  }

  /** Formats a ratio (0.45) as a locale percentage ("45%", "45 %"). */
  function formatPercent(ratio: number, maximumFractionDigits = 0): string {
    return formatNumber(ratio, { style: 'percent', maximumFractionDigits });
  }

  return { locale, has, t, counted, formatNumber, formatBytes, formatPercent };
}

export type ClientI18n = ReturnType<typeof createI18n>;

export function i18nFrom(root: HTMLElement): ClientI18n {
  const raw = root.dataset.strings;
  if (!raw) throw new Error(`#${root.id} has no data-strings`);
  return createI18n(JSON.parse(raw) as Record<string, string>, root.dataset.locale || 'en');
}
