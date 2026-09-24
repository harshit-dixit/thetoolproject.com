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
