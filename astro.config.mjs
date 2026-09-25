import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultLocale, locales } from './src/i18n/locales.mjs';

export function localized404Integration() {
  return {
    name: 'localized-404',
    hooks: {
      'astro:build:done': async ({ dir }) => {
        const outDir = fileURLToPath(dir);
        if (!fs.existsSync(outDir)) return;
        const entries = fs.readdirSync(outDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && entry.name !== defaultLocale && locales.includes(entry.name)) {
            const locale404Dir = path.join(outDir, entry.name, '404');
            const locale404Index = path.join(locale404Dir, 'index.html');
            const target404File = path.join(outDir, entry.name, '404.html');
            if (fs.existsSync(locale404Index)) {
              fs.copyFileSync(locale404Index, target404File);
              fs.rmSync(locale404Dir, { recursive: true, force: true });
            }
          }
        }
      },
    },
  };
}

export default defineConfig({
  site: 'https://thetoolproject.com',
  trailingSlash: 'always',
  build: { format: 'directory' },
  i18n: {
    defaultLocale,
    locales: [...locales],
    routing: { prefixDefaultLocale: false },
  },
  // ES module workers can split off chunks they load on demand, such as the legacy .xls code pages.
  vite: { worker: { format: 'es' } },
  integrations: [
    sitemap({ filter: (page) => !/\/(?:404|500)(?:\/|\.html)?$/.test(new URL(page).pathname) }),
    localized404Integration(),
  ],
});
