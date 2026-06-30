import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';
import vercel from '@astrojs/vercel';

// Canlı alan adı. TODO: farklı bir domaine geçilirse burayı güncelle.
const SITE = 'https://focusclub360.com';

// https://astro.build/config
// output 'static' kalır: tüm sayfalar statik üretilir, hız aynı.
// Yalnızca `export const prerender = false` işaretli rotalar (ör. /api/uye-ol)
// Vercel serverless fonksiyonu olarak çalışır.
export default defineConfig({
  site: SITE,
  output: 'static',
  adapter: vercel(),
  integrations: [tailwind(), sitemap()],
});
