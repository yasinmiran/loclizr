import { defineConfig } from 'loclizr'

export default defineConfig({
  sourceLocale: 'en',
  catalogs: 'locales/{locale}.json',
  outDir: 'src/loclizr',
  scan: { include: ['src/**/*.{ts,tsx,js,jsx,mts,mjs,astro}'] },
  severity: { 'ambiguous-source': 'error' },
})
