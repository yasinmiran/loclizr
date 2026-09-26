import type { Config, LocaleOrigin, Message, Program, Span } from '../../../src/types'
import type { LowerResult } from '../../../src/icu'
import { lower } from '../../../src/icu'
import { hash16 } from '../../../src/util'

const SPAN: Span = { line: 1, column: 1, offset: 0, length: 1 }

export function englishConfig(): Config {
  return {
    root: '/app',
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
    scan: { include: ['src/**/*.{ts,tsx}'], exclude: ['**/node_modules/**'] },
    severity: {},
  }
}

export function lowerEnglish(key: string, value: string): LowerResult {
  return lower(value, {
    key,
    locale: 'en',
    file: 'locales/en.json',
    span: SPAN,
    catalogFormat: 'icu',
    formats: { timeZone: null, number: {}, dateTime: {} },
  })
}

// One source locale, one message, lowered from the catalog string a translator
// would have committed, so the emitted arm is what the app would really ship.
export function singleMessageProgram(key: string, value: string): Program {
  const result = lowerEnglish(key, value)
  const namespace = key.includes('.') ? (key.split('.')[0] ?? '_root') : '_root'
  const origins: readonly LocaleOrigin[] = [{ locale: 'en', origin: { status: 'translated' } }]
  const message: Message = {
    key,
    id: key.replaceAll('.', '_'),
    namespace,
    module: `messages/${namespace}.js`,
    kind: result.kind,
    source: result.normalized,
    sourceHash: hash16(result.normalized),
    args: result.args,
    markupTags: result.markupTags,
    description: null,
    placeholders: [],
    bodies: [
      { locale: 'en', nodes: result.nodes, args: result.args, markupTags: result.markupTags },
    ],
    origins,
    spans: [{ locale: 'en', file: 'locales/en.json', span: SPAN }],
  }
  const config = englishConfig()
  return {
    config,
    sourceLocale: 'en',
    locales: config.locales,
    messages: [message],
    extras: [],
    groups: [],
    usages: [],
    diagnostics: [],
  }
}
