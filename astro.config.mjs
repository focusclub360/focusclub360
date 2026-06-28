import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';

// Canlı alan adı. TODO: farklı bir domaine geçilirse burayı güncelle.
const SITE = 'https://focusclub360.com';

// https://astro.build/config
export default defineConfig({
  site: SITE,
  integrations: [tailwind(), sitemap()],
});
