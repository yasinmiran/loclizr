import type { Config } from '../../types'

// A stand-in for M9's resolved config, so the scan's tests need no config module.
export function testConfig(overrides: Partial<Config>): Config {
  return {
    root: '/project',
    locales: ['en'],
    sourceLocale: 'en',
    catalogs: 'locales/{locale}.json',
    catalogFormat: 'auto',
    i18nextMarkup: 'literal',
    meta: 'locales/{sourceLocale}.meta.json',
    outDir: 'src/loclizr',
    record: 'locales/loclizr.context.json',
    cookie: 'locale',
    augmentLocale: true,
    groups: {},
    identifiers: {},
    fallback: 'bcp47',
    formats: { timeZone: null, number: {}, dateTime: {} },
    scan: {
      include: ['src/**/*.{ts,tsx,js,jsx,mts,mjs}'],
      exclude: ['**/node_modules/**', '**/dist/**', 'src/loclizr'],
    },
    severity: {},
    ...overrides,
  }
}
