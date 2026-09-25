import en from '../i18n/en.json';

export const locales = ['en', 'es', 'pt', 'de', 'fr', 'ja'] as const;
export type Locale = typeof locales[number];
export type ToolLocale = { path: string; title: string; description: string; h1: string; reviewed: boolean };
// category is the schema.org WebApplication applicationCategory.
export type Tool = { id: string; category: 'DeveloperApplication' | 'UtilitiesApplication'; locales: Partial<Record<Locale, ToolLocale>> };

export const tools: Record<string, Tool> = {
  jsonToHtml: {
    id: 'json-to-html',
    category: 'DeveloperApplication',
    locales: {
      en: {
        path: '/json-to-html/',
        title: en['tool.title'],
        description: en['tool.description'],
        h1: en['tool.h1'],
        reviewed: true,
      },
    },
  },
  jsonToExcel: {
    id: 'json-to-excel',
    category: 'UtilitiesApplication',
    locales: {
      en: {
        path: '/json-to-excel/',
        title: en['jsonExcel.title'],
        description: en['jsonExcel.description'],
        h1: en['jsonExcel.h1'],
        reviewed: true,
      },
    },
  },
  jsonToCsv: {
    id: 'json-to-csv',
    category: 'UtilitiesApplication',
    locales: {
      en: {
        path: '/json-to-csv/',
        title: en['jsonCsv.title'],
        description: en['jsonCsv.description'],
        h1: en['jsonCsv.h1'],
        reviewed: true,
      },
    },
  },
  xmlToCsv: {
    id: 'xml-to-csv',
    category: 'UtilitiesApplication',
    locales: {
      en: {
        path: '/xml-to-csv/',
        title: en['xmlCsv.title'],
        description: en['xmlCsv.description'],
        h1: en['xmlCsv.h1'],
        reviewed: true,
      },
    },
  },
  xmlToJson: {
    id: 'xml-to-json',
    category: 'DeveloperApplication',
    locales: {
      en: {
        path: '/xml-to-json/',
        title: en['xmlJson.title'],
        description: en['xmlJson.description'],
        h1: en['xmlJson.h1'],
        reviewed: true,
      },
    },
  },
  excelToCsv: {
    id: 'excel-to-csv',
    category: 'UtilitiesApplication',
    locales: {
      en: {
        path: '/excel-to-csv/',
        title: en['excel.title'],
        description: en['excel.description'],
        h1: en['excel.h1'],
        reviewed: true,
      },
    },
  },
};

export function publishedToolLocales(tool: Tool) {
  return Object.entries(tool.locales).filter((entry): entry is [Locale, ToolLocale] => !!entry[1]?.reviewed);
}
