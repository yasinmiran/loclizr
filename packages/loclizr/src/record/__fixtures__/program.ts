import type {
  Arg,
  Body,
  Config,
  LocaleOrigin,
  LocaleSpan,
  Message,
  MessageUsage,
  Node,
  PlaceholderNote,
  Program,
  Span,
  UsageSite,
} from '../../types'
import { hash16 } from '../../util'

const BASE_CONFIG: Config = {
  root: '/repo',
  locales: ['en', 'de', 'de-AT'],
  sourceLocale: 'en',
  catalogs: 'locales/{locale}.json',
  catalogFormat: 'i18next',
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
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
  severity: {},
}

export interface MessageInput {
  readonly key: string
  readonly id: string
  readonly namespace: string
  readonly module?: string | undefined
  readonly source: string
  readonly kind?: 'text' | 'markup' | undefined
  readonly args?: readonly Arg[] | undefined
  readonly markupTags?: readonly string[] | undefined
  readonly description?: string | null | undefined
  readonly placeholders?: readonly PlaceholderNote[] | undefined
  readonly nodes?: readonly Node[] | undefined
  readonly bodies?: readonly Body[] | undefined
  readonly origins?: readonly LocaleOrigin[] | undefined
  readonly spans?: readonly LocaleSpan[] | undefined
}

export interface ProgramInput {
  readonly messages: readonly Message[]
  readonly locales?: readonly string[] | undefined
  readonly usages?: readonly MessageUsage[] | undefined
  readonly meta?: string | false | undefined
}

export function span(line: number, column: number, offset: number): Span {
  return { line, column, offset, length: 4 }
}

export function message(input: MessageInput): Message {
  const args = input.args ?? []
  const markupTags = input.markupTags ?? []
  const nodes: readonly Node[] = input.nodes ?? [{ kind: 'text', value: input.source }]
  return {
    key: input.key,
    id: input.id,
    namespace: input.namespace,
    module: input.module ?? `messages/${input.namespace}.js`,
    kind: input.kind ?? 'text',
    source: input.source,
    sourceHash: hash16(input.source),
    args,
    markupTags,
    description: input.description ?? null,
    placeholders: input.placeholders ?? [],
    bodies: input.bodies ?? [{ locale: 'en', nodes, args, markupTags }],
    origins: input.origins ?? [{ locale: 'en', origin: { status: 'translated' } }],
    spans: input.spans ?? [{ locale: 'en', file: 'locales/en.json', span: span(1, 1, 0) }],
  }
}

export function program(input: ProgramInput): Program {
  return {
    config: { ...BASE_CONFIG, meta: input.meta ?? BASE_CONFIG.meta },
    sourceLocale: 'en',
    locales: input.locales ?? ['en', 'de', 'de-AT'],
    messages: input.messages,
    extras: [],
    groups: [],
    usages: input.usages ?? [],
    diagnostics: [],
  }
}

export function site(file: string, scope: string | null, line: number, column: number): UsageSite {
  return { file, line, column, scope, snippet: `m.example({ count })` }
}

export function threeLocales(): readonly LocaleOrigin[] {
  return [
    { locale: 'en', origin: { status: 'translated' } },
    { locale: 'de', origin: { status: 'translated' } },
    { locale: 'de-AT', origin: { status: 'inherited', from: 'de' } },
  ]
}
