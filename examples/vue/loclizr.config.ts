import { defineConfig } from 'loclizr'

export default defineConfig({
  sourceLocale: 'en',
  catalogs: 'locales/{locale}.json',
  outDir: 'src/loclizr',
  severity: { 'ambiguous-source': 'error' },
  scan: { include: ['src/**/*.{ts,vue}'] },
})
