import en from '../i18n/en.json';

export const locales = ['en', 'es', 'pt', 'de', 'fr', 'ja'] as const;
export type Locale = typeof locales[number];
export type ToolLocale = { path: string; title: string; description: string; h1: string; reviewed: boolean };
// category is the schema.org WebApplication applicationCategory.
export type Tool = { id: string; category: 'DeveloperApplication' | 'UtilitiesApplication'; locales: Partial<Record<Locale, ToolLocale>> };

export const tools: Record<string, Tool> = {
  csvToJson: {
    id: 'csv-to-json',
    category: 'DeveloperApplication',
    locales: {
      en: {
        path: '/csv-to-json/',
        title: 'CSV to JSON converter online | thetoolproject',
        description: 'Convert CSV or TSV to JSON instantly in your browser. Preview rows, choose delimiters and types, then copy or download JSON or JSON Lines. Your data stays on your device.',
        h1: 'CSV to JSON',
        reviewed: true,
      },
    },
  },
  csvViewer: {
    id: 'csv-viewer',
    category: 'UtilitiesApplication',
    locales: {
      en: {
        path: '/csv-viewer/',
        title: 'CSV viewer online: open, search and edit CSV files | thetoolproject',
        description: 'Open CSV and TSV files in your browser. Search, filter, sort, edit and inspect columns, then download CSV or JSON. Your file is never uploaded.',
        h1: 'CSV viewer',
        reviewed: true,
      },
    },
  },
  jsonBeautifier: {
    id: 'json-beautifier',
    category: 'DeveloperApplication',
    locales: {
      en: {
        path: '/json-beautifier/',
        title: 'JSON beautifier and formatter online | thetoolproject',
        description: 'Beautify and validate JSON in your browser. Choose indentation, fix syntax errors, then copy or download formatted JSON. Nothing is uploaded.',
        h1: 'JSON beautifier',
        reviewed: true,
      },
    },
  },
  csvToSql: {
    id: 'csv-to-sql',
    category: 'DeveloperApplication',
    locales: {
      en: {
        path: '/csv-to-sql/',
        title: 'CSV to SQL converter: generate INSERT statements | thetoolproject',
        description: 'Convert CSV to SQL INSERT statements in your browser. Choose PostgreSQL, MySQL, SQLite or SQL Server, preview the result, and copy or download SQL. Nothing is uploaded.',
        h1: 'CSV to SQL',
        reviewed: true,
      },
    },
  },
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
