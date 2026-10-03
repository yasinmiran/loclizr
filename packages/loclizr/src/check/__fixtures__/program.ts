import type {
  Arg,
  Body,
  CatalogExtra,
  Config,
  ExactBranch,
  IntlOptions,
  LocaleOrigin,
  LocaleSpan,
  Message,
  Node,
  PluralBranch,
  Program,
  SelectBranch,
  Span,
} from '../../types'
import { hash16 } from '../../util'

export function span(line: number, column: number): Span {
  return { line, column, offset: line * 100 + column, length: 4 }
}

export function config(overrides: Partial<Config> = {}): Config {
  return {
    root: '/repo',
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
    scan: { include: [], exclude: [] },
    severity: {},
    ...overrides,
  }
}

export interface BodyInput {
  readonly nodes?: readonly Node[]
  readonly args?: readonly Arg[]
  readonly markupTags?: readonly string[]
  readonly format?: 'icu' | 'i18next'
}

export function body(locale: string, input: BodyInput = {}): Body {
  return {
    locale,
    nodes: input.nodes ?? [],
    args: input.args ?? [],
    markupTags: input.markupTags ?? [],
    format: input.format ?? 'icu',
  }
}

export interface MessageInput {
  readonly key: string
  readonly bodies: readonly Body[]
  readonly args?: readonly Arg[]
  readonly markupTags?: readonly string[]
  readonly origins?: readonly LocaleOrigin[]
  readonly spans?: readonly LocaleSpan[]
  readonly source?: string
  readonly description?: string | null
  readonly kind?: 'text' | 'markup'
}

export function message(input: MessageInput): Message {
  const source = input.source ?? input.key
  const namespace = input.key.includes('.') ? (input.key.split('.')[0] ?? '_root') : '_root'
  return {
    key: input.key,
    id: input.key.replaceAll('.', '_'),
    namespace,
    module: `messages/${namespace}.js`,
    kind: input.kind ?? 'text',
    source,
    sourceHash: hash16(source),
    args: input.args ?? [],
    markupTags: input.markupTags ?? [],
    description: input.description ?? null,
    placeholders: [],
    bodies: input.bodies,
    origins: input.origins ?? input.bodies.map((each) => translated(each.locale)),
    spans: input.spans ?? input.bodies.map((each) => at(each.locale, 1, 1)),
  }
}

export interface ProgramInput {
  readonly messages?: readonly Message[]
  readonly extras?: readonly CatalogExtra[]
  readonly config?: Config
}

export function program(input: ProgramInput = {}): Program {
  const resolved = input.config ?? config()
  return {
    config: resolved,
    sourceLocale: resolved.sourceLocale,
    locales: resolved.locales,
    messages: input.messages ?? [],
    extras: input.extras ?? [],
    groups: [],
    usages: [],
    diagnostics: [],
  }
}

export function translated(locale: string): LocaleOrigin {
  return { locale, origin: { status: 'translated' } }
}

export function inherited(locale: string, from: string): LocaleOrigin {
  return { locale, origin: { status: 'inherited', from } }
}

export function fellBack(
  locale: string,
  from: string,
  reason: 'missing' | 'blank' | 'invalid',
): LocaleOrigin {
  return { locale, origin: { status: 'fallback', from, reason } }
}

export function at(locale: string, line: number, column: number, file?: string): LocaleSpan {
  return { locale, file: file ?? `locales/${locale}.json`, span: span(line, column) }
}

export function extra(locale: string, key: string): CatalogExtra {
  return { locale, key, file: `locales/${locale}.json`, span: span(9, 3) }
}

export function text(value: string): Node {
  return { kind: 'text', value }
}

export function argNode(name: string): Node {
  return { kind: 'arg', name }
}

export function pound(): Node {
  return { kind: 'pound' }
}

export interface PluralInput {
  readonly name: string
  readonly ordinal?: boolean
  readonly offset?: number
  readonly exact?: readonly ExactBranch[]
  readonly branches: readonly PluralBranch[]
}

export function plural(input: PluralInput): Node {
  return {
    kind: 'plural',
    name: input.name,
    ordinal: input.ordinal ?? false,
    offset: input.offset ?? 0,
    exact: input.exact ?? [],
    branches: input.branches,
  }
}

export function branch(keyword: string, ...bodyNodes: readonly Node[]): PluralBranch {
  return { keyword, body: bodyNodes }
}

export function exactBranch(value: number, ...bodyNodes: readonly Node[]): ExactBranch {
  return { value, body: bodyNodes }
}

export function selectNode(name: string, branches: readonly SelectBranch[]): Node {
  return { kind: 'select', name, branches }
}

export function option(name: string, ...bodyNodes: readonly Node[]): SelectBranch {
  return { option: name, body: bodyNodes }
}

export function markupNode(name: string, ...children: readonly Node[]): Node {
  return { kind: 'markup', name, children }
}

export function dateTimeNode(name: string, options: IntlOptions = { dateStyle: 'medium' }): Node {
  return {
    kind: 'dateTime',
    name,
    form: 'date',
    style: 'medium',
    format: { kind: 'dateTime', options },
  }
}

export function stringishArg(name: string): Arg {
  return { name, type: { kind: 'stringish' } }
}

export function numberArg(name: string): Arg {
  return { name, type: { kind: 'number' } }
}

export function dateArg(name: string): Arg {
  return { name, type: { kind: 'date' } }
}

export function selectArg(name: string, options: readonly string[]): Arg {
  return { name, type: { kind: 'select', options } }
}

export function markupArg(name: string): Arg {
  return { name, type: { kind: 'markup' } }
}
