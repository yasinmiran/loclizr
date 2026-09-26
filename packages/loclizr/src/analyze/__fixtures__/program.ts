import type {
  Body,
  CatalogMeta,
  Config,
  Diagnostic,
  LocaleOrigin,
  Message,
  Program,
  RawCatalog,
  RawEntry,
  RuleName,
  Span,
} from '../../types'
import { analyze } from '../index'

const BASE: Config = {
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
  scan: { include: ['src/**/*.ts'], exclude: [] },
  severity: {},
}

export function config(overrides: Partial<Config> = {}): Config {
  return { ...BASE, ...overrides }
}

export function span(line: number, length: number): Span {
  return { line, column: 5, offset: line * 100, length }
}

export function catalog(input: {
  readonly locale: string
  readonly entries: Readonly<Record<string, string>>
  readonly format?: 'icu' | 'i18next' | undefined
  readonly file?: string | undefined
  readonly ns?: string | undefined
  // The line the first entry sits on, so two files of one locale carry spans a
  // test can tell apart.
  readonly line?: number | undefined
}): RawCatalog {
  const first = input.line ?? 1
  const entries: RawEntry[] = Object.entries(input.entries).map(([key, value], position) => ({
    key,
    value,
    span: span(first + position, value.length),
  }))
  return {
    locale: input.locale,
    ns: input.ns ?? null,
    file: input.file ?? `locales/${input.locale}.json`,
    format: input.format ?? 'icu',
    entries,
  }
}

export function run(input: {
  readonly config: Config
  readonly catalogs: readonly RawCatalog[]
  readonly meta?: CatalogMeta | null | undefined
}): Program {
  return analyze({ config: input.config, catalogs: input.catalogs, meta: input.meta ?? null })
}

export function messageFor(program: Program, key: string): Message {
  const message = program.messages.find((candidate) => candidate.key === key)
  if (message === undefined) throw new Error(`no message for ${key}`)
  return message
}

export function originFor(message: Message, locale: string): LocaleOrigin['origin'] {
  const origin = message.origins.find((candidate) => candidate.locale === locale)
  if (origin === undefined) throw new Error(`no origin for ${locale}`)
  return origin.origin
}

export function bodyFor(message: Message, locale: string): Body | undefined {
  return message.bodies.find((candidate) => candidate.locale === locale)
}

export function codes(diagnostics: readonly Diagnostic[]): readonly string[] {
  return diagnostics.map((diagnostic) => diagnostic.code)
}

export function forRule(program: Program, rule: RuleName): readonly Diagnostic[] {
  return program.diagnostics.filter((diagnostic) => diagnostic.rule === rule)
}
