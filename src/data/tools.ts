import { locales, reviewedLocales } from '../i18n/locales.mjs';
import { dictionaries, type Locale } from '../i18n/dictionaries';
import { getLocalizedPath, localizedPaths, type LocalizedPathMap } from './localized-paths.mjs';

export { locales };
export type { Locale };
export type ToolLocale = { path: string; title: string; description: string; h1: string; reviewed: boolean };
// category is the schema.org WebApplication applicationCategory.
export type Tool = { id: string; category: 'DeveloperApplication' | 'UtilitiesApplication'; locales: Partial<Record<Locale, ToolLocale>> };

export type ToolRouteOverride = {
  path?: string;
  reviewed?: boolean;
};
export type ToolRouteOverrides = Partial<Record<Locale, ToolRouteOverride>>;

export function createToolLocales(
  id: string,
  prefix: string,
  overrides?: ToolRouteOverrides,
  mapping: LocalizedPathMap = localizedPaths
): Record<Locale, ToolLocale> {
  const result: Partial<Record<Locale, ToolLocale>> = {};
  for (const locale of locales) {
    const d = dictionaries[locale];
    const defaultPath = locale === 'en' ? `/${id}/` : `/${locale}/${id}/`;
    const defaultReviewed = reviewedLocales.includes(locale);
    const override = overrides?.[locale];
    result[locale] = {
      path: override?.path ?? getLocalizedPath('tool', id, locale, defaultPath, mapping),
      title: d[`${prefix}.title`],
      description: d[`${prefix}.description`],
      h1: d[`${prefix}.h1`],
      reviewed: override?.reviewed ?? defaultReviewed,
    };
  }
  return result as Record<Locale, ToolLocale>;
}

export const tools: Record<string, Tool> = {
  compressPdf: {
    id: 'compress-pdf',
    category: 'UtilitiesApplication',
    locales: createToolLocales('compress-pdf', 'compressPdf'),
  },
  compressPdf100kb: {
    id: 'compress-pdf-to-100kb',
    category: 'UtilitiesApplication',
    locales: createToolLocales('compress-pdf-to-100kb', 'compressPdf100kb'),
  },
  compressPdf200kb: {
    id: 'compress-pdf-to-200kb',
    category: 'UtilitiesApplication',
    locales: createToolLocales('compress-pdf-to-200kb', 'compressPdf200kb'),
  },
  compressPdf500kb: {
    id: 'compress-pdf-to-500kb',
    category: 'UtilitiesApplication',
    locales: createToolLocales('compress-pdf-to-500kb', 'compressPdf500kb'),
  },
  imageResizer: {
    id: 'image-resizer',
    category: 'UtilitiesApplication',
    locales: createToolLocales('image-resizer', 'imageResizer'),
  },
  compressJpg100kb: {
    id: 'compress-jpg-to-100kb',
    category: 'UtilitiesApplication',
    locales: createToolLocales('compress-jpg-to-100kb', 'compressJpg100kb'),
  },
  compressJpg50kb: {
    id: 'compress-jpg-to-50kb',
    category: 'UtilitiesApplication',
    locales: createToolLocales('compress-jpg-to-50kb', 'compressJpg50kb'),
  },
  webpConverter: {
    id: 'webp-converter',
    category: 'UtilitiesApplication',
    locales: createToolLocales('webp-converter', 'webpConverter'),
  },
  webpToPng: {
    id: 'webp-to-png',
    category: 'UtilitiesApplication',
    locales: createToolLocales('webp-to-png', 'webpPng'),
  },
  // One page for JPG and JPEG: they are the same format, and two near-identical pages would compete with each other.
  webpToJpg: {
    id: 'webp-to-jpg',
    category: 'UtilitiesApplication',
    locales: createToolLocales('webp-to-jpg', 'webpJpg'),
  },
  webpToGif: {
    id: 'webp-to-gif',
    category: 'UtilitiesApplication',
    locales: createToolLocales('webp-to-gif', 'webpGif'),
  },
  webpToSvg: {
    id: 'webp-to-svg',
    category: 'UtilitiesApplication',
    locales: createToolLocales('webp-to-svg', 'webpSvg'),
  },
  // AVIF and JFIF conversion pages reuse the WebP engine and Merge JPG PDF mode.
  avifToJpg: {
    id: 'avif-to-jpg',
    category: 'UtilitiesApplication',
    locales: createToolLocales('avif-to-jpg', 'avifJpg', {
      es: { path: '/es/avif-a-jpg/' },
      pt: { path: '/pt/avif-para-jpg/' },
      de: { path: '/de/avif-in-jpg/' },
      fr: { path: '/fr/avif-en-jpg/' },
    }),
  },
  avifToPng: {
    id: 'avif-to-png',
    category: 'UtilitiesApplication',
    locales: createToolLocales('avif-to-png', 'avifPng', {
      es: { path: '/es/avif-a-png/' },
      pt: { path: '/pt/avif-para-png/' },
      de: { path: '/de/avif-in-png/' },
      fr: { path: '/fr/avif-en-png/' },
    }),
  },
  avifToWebp: {
    id: 'avif-to-webp',
    category: 'UtilitiesApplication',
    locales: createToolLocales('avif-to-webp', 'avifWebp', {
      es: { path: '/es/avif-a-webp/' },
      pt: { path: '/pt/avif-para-webp/' },
      de: { path: '/de/avif-in-webp/' },
      fr: { path: '/fr/avif-en-webp/' },
    }),
  },
  jfifToJpg: {
    id: 'jfif-to-jpg',
    category: 'UtilitiesApplication',
    locales: createToolLocales('jfif-to-jpg', 'jfifJpg', {
      es: { path: '/es/jfif-a-jpg/' },
      pt: { path: '/pt/jfif-para-jpg/' },
      de: { path: '/de/jfif-in-jpg/' },
      fr: { path: '/fr/jfif-en-jpg/' },
    }),
  },
  jfifToPng: {
    id: 'jfif-to-png',
    category: 'UtilitiesApplication',
    locales: createToolLocales('jfif-to-png', 'jfifPng', {
      es: { path: '/es/jfif-a-png/' },
      pt: { path: '/pt/jfif-para-png/' },
      de: { path: '/de/jfif-in-png/' },
      fr: { path: '/fr/jfif-en-png/' },
    }),
  },
  jfifToPdf: {
    id: 'jfif-to-pdf',
    category: 'UtilitiesApplication',
    locales: createToolLocales('jfif-to-pdf', 'jfifPdf', {
      es: { path: '/es/jfif-a-pdf/' },
      pt: { path: '/pt/jfif-para-pdf/' },
      de: { path: '/de/jfif-in-pdf/' },
      fr: { path: '/fr/jfif-en-pdf/' },
    }),
  },
  // One page for JPG and JPEG, as for WebP to JPG. Merging into one image and merging into a PDF are different
  // searches, so the PDF has its own page; both share one tool. Published after the localized URL migration, so
  // they start at their translated URLs and have no old paths to redirect.
  mergeJpg: {
    id: 'merge-jpg',
    category: 'UtilitiesApplication',
    locales: createToolLocales('merge-jpg', 'mergeJpg', {
      es: { path: '/es/unir-jpg/' },
      pt: { path: '/pt/juntar-jpg/' },
      de: { path: '/de/jpg-zusammenfuegen/' },
      fr: { path: '/fr/fusionner-jpg/' },
    }),
  },
  mergeJpgPdf: {
    id: 'merge-jpg-to-pdf',
    category: 'UtilitiesApplication',
    locales: createToolLocales('merge-jpg-to-pdf', 'mergeJpgPdf', {
      es: { path: '/es/unir-jpg-a-pdf/' },
      pt: { path: '/pt/juntar-jpg-em-pdf/' },
      de: { path: '/de/jpg-zu-pdf-zusammenfuegen/' },
      fr: { path: '/fr/fusionner-jpg-en-pdf/' },
    }),
  },
  videoToGif: {
    id: 'video-to-gif',
    category: 'UtilitiesApplication',
    locales: createToolLocales('video-to-gif', 'videoGif'),
  },
  qrCodeScanner: {
    id: 'qr-code-scanner',
    category: 'UtilitiesApplication',
    locales: createToolLocales('qr-code-scanner', 'qrScanner'),
  },
  csvToJson: {
    id: 'csv-to-json',
    category: 'DeveloperApplication',
    locales: createToolLocales('csv-to-json', 'csvJson'),
  },
  csvViewer: {
    id: 'csv-viewer',
    category: 'UtilitiesApplication',
    locales: createToolLocales('csv-viewer', 'csvViewer'),
  },
  harAnalyzer: {
    id: 'har-analyzer',
    category: 'DeveloperApplication',
    locales: createToolLocales('har-analyzer', 'harAnalyzer'),
  },
  jsonBeautifier: {
    id: 'json-beautifier',
    category: 'DeveloperApplication',
    locales: createToolLocales('json-beautifier', 'jsonBeautifier'),
  },
  wordCounter: {
    id: 'word-counter',
    category: 'UtilitiesApplication',
    locales: createToolLocales('word-counter', 'wordCounter'),
  },
  tipCalculator: {
    id: 'tip-calculator',
    category: 'UtilitiesApplication',
    locales: createToolLocales('tip-calculator', 'tip'),
  },
  highSchoolGpa: {
    id: 'high-school-gpa-calculator',
    category: 'UtilitiesApplication',
    locales: createToolLocales('high-school-gpa-calculator', 'hsGpa'),
  },
  gpaCalculator: {
    id: 'gpa-calculator',
    category: 'UtilitiesApplication',
    locales: createToolLocales('gpa-calculator', 'gpa'),
  },
  autoLoan: {
    id: 'auto-loan-calculator',
    category: 'UtilitiesApplication',
    locales: createToolLocales('auto-loan-calculator', 'autoLoan'),
  },
  overtimeCalculator: {
    id: 'overtime-calculator',
    category: 'UtilitiesApplication',
    // Published after the localized URL migration, so it starts at its translated URLs and has no old paths to redirect.
    locales: createToolLocales('overtime-calculator', 'overtime', {
      es: { path: '/es/calculadora-de-horas-extras/' },
      pt: { path: '/pt/calculadora-de-horas-extras/' },
      de: { path: '/de/ueberstundenrechner/' },
      fr: { path: '/fr/calcul-heures-supplementaires/' },
    }),
  },
  // A US federal tax deduction, so it's published in English only; the overtime calculator links to it from every language.
  noTaxOvertime: {
    id: 'no-tax-on-overtime-calculator',
    category: 'UtilitiesApplication',
    locales: createToolLocales('no-tax-on-overtime-calculator', 'noTax', {
      es: { reviewed: false }, pt: { reviewed: false }, de: { reviewed: false }, fr: { reviewed: false }, ja: { reviewed: false },
    }),
  },
  ageCalculator: {
    id: 'age-calculator',
    category: 'UtilitiesApplication',
    locales: createToolLocales('age-calculator', 'age'),
  },
  diceRoller: {
    id: 'dice-roller',
    category: 'UtilitiesApplication',
    locales: createToolLocales('dice-roller', 'dice'),
  },
  volumeCalculator: {
    id: 'volume-calculator',
    category: 'UtilitiesApplication',
    locales: createToolLocales('volume-calculator', 'vol'),
  },
  areaCalculator: {
    id: 'area-calculator',
    category: 'UtilitiesApplication',
    locales: createToolLocales('area-calculator', 'area'),
  },
  csvToSql: {
    id: 'csv-to-sql',
    category: 'DeveloperApplication',
    locales: createToolLocales('csv-to-sql', 'csvSql'),
  },
  jsonToHtml: {
    id: 'json-to-html',
    category: 'DeveloperApplication',
    locales: createToolLocales('json-to-html', 'tool'),
  },
  jsonToExcel: {
    id: 'json-to-excel',
    category: 'UtilitiesApplication',
    locales: createToolLocales('json-to-excel', 'jsonExcel'),
  },
  jsonToCsv: {
    id: 'json-to-csv',
    category: 'UtilitiesApplication',
    locales: createToolLocales('json-to-csv', 'jsonCsv'),
  },
  xmlToCsv: {
    id: 'xml-to-csv',
    category: 'UtilitiesApplication',
    locales: createToolLocales('xml-to-csv', 'xmlCsv'),
  },
  xmlToJson: {
    id: 'xml-to-json',
    category: 'DeveloperApplication',
    locales: createToolLocales('xml-to-json', 'xmlJson'),
  },
  excelToCsv: {
    id: 'excel-to-csv',
    category: 'UtilitiesApplication',
    locales: createToolLocales('excel-to-csv', 'excel'),
  },
  dbfToExcel: {
    id: 'dbf-to-excel',
    category: 'UtilitiesApplication',
    locales: createToolLocales('dbf-to-excel', 'dbfExcel'),
  },
  emlToPdf: {
    id: 'eml-to-pdf',
    category: 'UtilitiesApplication',
    // The PDF font covers Latin, Greek and Cyrillic only, so a Japanese page would promise emails it can't convert.
    // Publish ja once a Japanese font is added.
    locales: createToolLocales('eml-to-pdf', 'emlPdf', { ja: { reviewed: false } }),
  },
  mhtToPdf: {
    id: 'mht-to-pdf',
    category: 'UtilitiesApplication',
    // Same PDF font as EML to PDF (Latin, Greek and Cyrillic), so no Japanese page until a Japanese font is added.
    locales: createToolLocales('mht-to-pdf', 'mhtPdf', { ja: { reviewed: false } }),
  },
};

/** Tool locales held back on purpose, with the reason in tools.ts. Everything else must be published in every locale. */
export const unpublishedToolLocales: Partial<Record<string, Locale[]>> = { emlToPdf: ['ja'], mhtToPdf: ['ja'], noTaxOvertime: ['es', 'pt', 'de', 'fr', 'ja'] };

export function publishedToolLocales(tool: Tool): [Locale, ToolLocale][] {
  return Object.entries(tool.locales).filter((entry): entry is [Locale, ToolLocale] => !!entry[1]?.reviewed);
}

export function getPublishedToolPath(toolKeyOrId: string, locale: Locale): string {
  const tool = tools[toolKeyOrId] || Object.values(tools).find(t => t.id === toolKeyOrId);
  if (!tool) throw new Error(`Unknown tool: ${toolKeyOrId}`);
  const localized = tool.locales[locale];
  if (localized?.reviewed) return localized.path;
  const english = tool.locales.en;
  if (english?.reviewed) return english.path;
  throw new Error(`Tool ${toolKeyOrId} has no published route`);
}
