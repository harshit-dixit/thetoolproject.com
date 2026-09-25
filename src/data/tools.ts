import en from '../i18n/en.json';

export const locales = ['en', 'es', 'pt', 'de', 'fr', 'ja'] as const;
export type Locale = typeof locales[number];
export type ToolLocale = { path: string; title: string; description: string; h1: string; reviewed: boolean };
// category is the schema.org WebApplication applicationCategory.
export type Tool = { id: string; category: 'DeveloperApplication' | 'UtilitiesApplication'; locales: Partial<Record<Locale, ToolLocale>> };

export const tools: Record<string, Tool> = {
  compressPdf: {
    id: 'compress-pdf',
    category: 'UtilitiesApplication',
    locales: {
      en: {
        path: '/compress-pdf/',
        title: en['compressPdf.title'],
        description: en['compressPdf.description'],
        h1: en['compressPdf.h1'],
        reviewed: true,
      },
    },
  },
  compressPdf100kb: {
    id: 'compress-pdf-to-100kb',
    category: 'UtilitiesApplication',
    locales: {
      en: {
        path: '/compress-pdf-to-100kb/',
        title: en['compressPdf100kb.title'],
        description: en['compressPdf100kb.description'],
        h1: en['compressPdf100kb.h1'],
        reviewed: true,
      },
    },
  },
  compressPdf200kb: {
    id: 'compress-pdf-to-200kb',
    category: 'UtilitiesApplication',
    locales: {
      en: {
        path: '/compress-pdf-to-200kb/',
        title: en['compressPdf200kb.title'],
        description: en['compressPdf200kb.description'],
        h1: en['compressPdf200kb.h1'],
        reviewed: true,
      },
    },
  },
  compressPdf500kb: {
    id: 'compress-pdf-to-500kb',
    category: 'UtilitiesApplication',
    locales: {
      en: {
        path: '/compress-pdf-to-500kb/',
        title: en['compressPdf500kb.title'],
        description: en['compressPdf500kb.description'],
        h1: en['compressPdf500kb.h1'],
        reviewed: true,
      },
    },
  },
  imageResizer: {
    id: 'image-resizer',
    category: 'UtilitiesApplication',
    locales: {
      en: {
        path: '/image-resizer/',
        title: en['imageResizer.title'],
        description: en['imageResizer.description'],
        h1: en['imageResizer.h1'],
        reviewed: true,
      },
    },
  },
  compressJpg100kb: {
    id: 'compress-jpg-to-100kb',
    category: 'UtilitiesApplication',
    locales: {
      en: {
        path: '/compress-jpg-to-100kb/',
        title: en['compressJpg100kb.title'],
        description: en['compressJpg100kb.description'],
        h1: en['compressJpg100kb.h1'],
        reviewed: true,
      },
    },
  },
  compressJpg50kb: {
    id: 'compress-jpg-to-50kb',
    category: 'UtilitiesApplication',
    locales: {
      en: {
        path: '/compress-jpg-to-50kb/',
        title: en['compressJpg50kb.title'],
        description: en['compressJpg50kb.description'],
        h1: en['compressJpg50kb.h1'],
        reviewed: true,
      },
    },
  },
  qrCodeScanner: {
    id: 'qr-code-scanner',
    category: 'UtilitiesApplication',
    locales: {
      en: {
        path: '/qr-code-scanner/',
        title: en['qrScanner.title'],
        description: en['qrScanner.description'],
        h1: en['qrScanner.h1'],
        reviewed: true,
      },
    },
  },
  csvToJson: {
    id: 'csv-to-json',
    category: 'DeveloperApplication',
    locales: {
      en: {
        path: '/csv-to-json/',
        title: en['csvJson.title'],
        description: en['csvJson.description'],
        h1: en['csvJson.h1'],
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
        title: en['csvViewer.title'],
        description: en['csvViewer.description'],
        h1: en['csvViewer.h1'],
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
        title: en['jsonBeautifier.title'],
        description: en['jsonBeautifier.description'],
        h1: en['jsonBeautifier.h1'],
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
        title: en['csvSql.title'],
        description: en['csvSql.description'],
        h1: en['csvSql.h1'],
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
  dbfToExcel: {
    id: 'dbf-to-excel',
    category: 'UtilitiesApplication',
    locales: {
      en: {
        path: '/dbf-to-excel/',
        title: en['dbfExcel.title'],
        description: en['dbfExcel.description'],
        h1: en['dbfExcel.h1'],
        reviewed: true,
      },
    },
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
