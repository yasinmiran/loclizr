import type {
  Arg,
  Config,
  ContextRecord,
  Diagnostic,
  EmittedFile,
  Group,
  LocaleOrigin,
  Message,
  Program,
} from '../../types'
import { hash16 } from '../../util'
import { GENERATED_HEADER } from '../output'

export function config(overrides: Partial<Config> = {}): Config {
  return {
    root: '/repo',
    locales: ['de', 'de-AT', 'en'],
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
    ...overrides,
  }
}

export interface MessageInput {
  readonly key: string
  readonly source?: string
  readonly args?: readonly Arg[]
  readonly origins?: readonly LocaleOrigin[]
}

export function message(input: MessageInput): Message {
  const source = input.source ?? input.key
  const namespace = input.key.includes('.') ? (input.key.split('.')[0] ?? '_root') : '_root'
  return {
    key: input.key,
    id: input.key.replaceAll('.', '_'),
    namespace,
    module: `messages/${namespace}.js`,
    kind: 'text',
    source,
    sourceHash: hash16(source),
    args: input.args ?? [],
    markupTags: [],
    description: null,
    placeholders: [],
    bodies: [],
    origins: input.origins ?? [{ locale: 'en', origin: { status: 'translated' } }],
    spans: [],
  }
}

export interface ProgramInput {
  readonly config?: Config
  readonly messages?: readonly Message[]
  readonly groups?: readonly Group[]
  readonly diagnostics?: readonly Diagnostic[]
}

export function program(input: ProgramInput = {}): Program {
  const resolved = input.config ?? config()
  return {
    config: resolved,
    sourceLocale: resolved.sourceLocale,
    locales: resolved.locales,
    messages: input.messages ?? [],
    extras: [],
    groups: input.groups ?? [],
    usages: [],
    diagnostics: input.diagnostics ?? [],
  }
}

export function group(name: string, members: readonly (readonly [string, string])[]): Group {
  return {
    name,
    id: name,
    prefix: name,
    typeBase: name.charAt(0).toUpperCase() + name.slice(1),
    members: members.map(([member, key]) => ({ key, id: key.replaceAll('.', '_'), member })),
  }
}

export function generatedFile(path: string, body: string): EmittedFile {
  return { path, contents: `${GENERATED_HEADER}\n${body}\n` }
}

export function contextRecord(messages: readonly Message[]): ContextRecord {
  return {
    schema: 1,
    sourceLocale: 'en',
    locales: ['de', 'de-AT', 'en'],
    messages: messages.map((entry) => ({
      key: entry.key,
      id: entry.id,
      module: entry.module,
      kind: entry.kind,
      source: entry.source,
      sourceHash: entry.sourceHash,
      description: null,
      args: [],
      variants: [],
      markup: [],
      translations: [],
      usage: [],
    })),
  }
}
