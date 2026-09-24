import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://thetoolproject.com',
  trailingSlash: 'always',
  build: { format: 'directory' },
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'es', 'pt', 'de', 'fr', 'ja'],
    routing: { prefixDefaultLocale: false },
  },
  
  vite: { worker: { format: 'es' } },
  integrations: [sitemap({ filter: (page) => !/\/(?:404|500)(?:\/|\.html)?$/.test(new URL(page).pathname) })],
});
