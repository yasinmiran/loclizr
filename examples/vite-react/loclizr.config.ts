import { defineConfig } from 'loclizr'

export default defineConfig({
  locales: ['en', 'de', 'de-AT'],
  sourceLocale: 'en',
  groups: { errors: 'errors' },
  severity: { 'ambiguous-source': 'error' },
})
