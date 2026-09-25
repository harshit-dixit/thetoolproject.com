import { locales } from '../i18n/locales.mjs';
import { dictionaries, type Locale } from '../i18n/dictionaries';

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
  overrides?: ToolRouteOverrides
): Record<Locale, ToolLocale> {
  const result: Partial<Record<Locale, ToolLocale>> = {};
  for (const locale of locales) {
    const d = dictionaries[locale];
    const defaultPath = locale === 'en' ? `/${id}/` : `/${locale}/${id}/`;
    const defaultReviewed = locale === 'en';
    const override = overrides?.[locale];
    result[locale] = {
      path: override?.path ?? defaultPath,
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
  jsonBeautifier: {
    id: 'json-beautifier',
    category: 'DeveloperApplication',
    locales: createToolLocales('json-beautifier', 'jsonBeautifier'),
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
};

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
