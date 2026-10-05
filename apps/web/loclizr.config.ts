import { defineConfig } from 'loclizr'

export default defineConfig({
  locales: ['en', 'de', 'fr', 'es', 'pt', 'it', 'pl', 'uk', 'ar', 'hi', 'ja', 'zh', 'ko'],
  sourceLocale: 'en',
  groups: { nav: 'nav', section: 'section', ui: 'ui', home: 'home' },
})
