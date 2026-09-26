import type { BuildResult, Config, Program, Summary } from '../../types'

export function config(): Config {
  return {
    root: '/project',
    locales: ['de', 'en'],
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
    scan: { include: ['src/**/*.ts'], exclude: [] },
    severity: {},
  }
}

export function program(): Program {
  return {
    config: config(),
    sourceLocale: 'en',
    locales: ['de', 'en'],
    messages: [],
    extras: [],
    groups: [],
    usages: [],
    diagnostics: [],
  }
}

export function summary(fields?: Partial<Summary>): Summary {
  return {
    errors: 0,
    warnings: 0,
    messages: 0,
    locales: 0,
    fellBack: [],
    ...fields,
  }
}

export function buildResult(fields?: Partial<BuildResult>): BuildResult {
  return {
    ok: true,
    exitCode: 0,
    program: program(),
    diagnostics: [],
    files: [],
    record: null,
    written: [],
    summary: summary(),
    ...fields,
  }
}
