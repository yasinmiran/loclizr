import { RULES, diag } from '../diagnostics'
import type { LowerContext, LowerResult } from '../icu'
import { lower, unify } from '../icu'
import type {
  Arg,
  ArgType,
  Body,
  CatalogExtra,
  CatalogMeta,
  Config,
  Diagnostic,
  FallbackReason,
  Group,
  GroupMember,
  LocaleOrigin,
  LocaleSpan,
  Message,
  MetaEntry,
  Origin,
  Program,
  RawCatalog,
  Related,
  Span,
} from '../types'
import { compareCodepoint, hash16 } from '../util'

const IDENTIFIER_START = /[\p{ID_Start}$_]/u
const IDENTIFIER_PART = /[\p{ID_Continue}$_]/u
const INTERNAL_NAMESPACE = /^\$[a-z]/

// ESM is strict mode, where `eval` and `arguments` are illegal binding names
// and the strict-mode-only words are reserved, so all of them would emit a
// module that fails to parse.
const RESERVED_WORDS: ReadonlySet<string> = new Set([
  'arguments',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'eval',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'implements',
  'import',
  'in',
  'instanceof',
  'interface',
  'let',
  'new',
  'null',
  'package',
  'private',
  'protected',
  'public',
  'return',
  'static',
  'super',
  'switch',
  'then',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield',
])

const RESERVED_IDENTIFIERS: ReadonlySet<string> = new Set([
  '__proto__',
  'constructor',
  'prototype',
  'locales',
  'sourceLocale',
  'getLocale',
  'setLocale',
  'subscribe',
])

const RESERVED_NAMESPACES: ReadonlySet<string> = new Set(['_locale', '_formats', '_root'])

const CONFUSABLE_FOLD: ReadonlyMap<string, string> = new Map([
  ['а', 'a'],
  ['е', 'e'],
  ['о', 'o'],
  ['р', 'p'],
  ['с', 'c'],
  ['у', 'y'],
  ['х', 'x'],
  ['ѕ', 's'],
  ['і', 'i'],
  ['ј', 'j'],
  ['һ', 'h'],
  ['ԁ', 'd'],
  ['ԛ', 'q'],
  ['Ѕ', 'S'],
  ['І', 'I'],
  ['Ј', 'J'],
  ['А', 'A'],
  ['В', 'B'],
  ['Е', 'E'],
  ['К', 'K'],
  ['М', 'M'],
  ['Н', 'H'],
  ['О', 'O'],
  ['Р', 'P'],
  ['С', 'C'],
  ['Т', 'T'],
  ['У', 'Y'],
  ['Х', 'X'],
  ['α', 'a'],
  ['ε', 'e'],
  ['ι', 'i'],
  ['κ', 'k'],
  ['ν', 'v'],
  ['ο', 'o'],
  ['ρ', 'p'],
  ['ϲ', 'c'],
  ['Α', 'A'],
  ['Β', 'B'],
  ['Ε', 'E'],
  ['Ζ', 'Z'],
  ['Η', 'H'],
  ['Ι', 'I'],
  ['Κ', 'K'],
  ['Μ', 'M'],
  ['Ν', 'N'],
  ['Ο', 'O'],
  ['Ρ', 'P'],
  ['Τ', 'T'],
  ['Υ', 'Y'],
  ['Χ', 'X'],
])

interface CatalogEntry {
  readonly file: string
  readonly format: 'icu' | 'i18next'
  readonly value: string
  readonly span: Span
}

type CatalogIndex = ReadonlyMap<string, ReadonlyMap<string, CatalogEntry>>

interface LoweredBody {
  readonly result: LowerResult
  readonly valid: boolean
}

interface Resolution {
  readonly bodies: readonly Body[]
  readonly origins: readonly LocaleOrigin[]
}

export function analyze(input: {
  readonly config: Config
  readonly catalogs: readonly RawCatalog[]
  readonly meta: CatalogMeta | null
}): Program {
  const { config } = input
  const index = indexCatalogs(input.catalogs)
  const notes = indexMeta(input.meta)
  const chains = new Map<string, readonly string[]>(
    config.locales.map((locale) => [locale, fallbackChain(locale, config)]),
  )
  const contributors = contributorOrder(config, chains, index)
  const sourceEntries = index.get(config.sourceLocale)

  const diagnostics: Diagnostic[] = []
  const messages: Message[] = []
  for (const key of sortedKeys(sourceEntries)) {
    const lowered = lowerKey(key, config, index, contributors)
    diagnostics.push(...lowered.diagnostics)
    const sourceBody = lowered.bodies.get(config.sourceLocale)
    if (sourceBody === undefined || !sourceBody.valid) continue
    messages.push(
      buildMessage({
        key,
        config,
        index,
        chains,
        lowered: lowered.bodies,
        sourceBody,
        note: notes.get(key),
      }),
    )
  }

  diagnostics.push(...checkIdentity(messages, config, sourceEntries))
  const groups = buildGroups(config, messages)
  diagnostics.push(...groups.diagnostics)

  return {
    config,
    sourceLocale: config.sourceLocale,
    locales: config.locales,
    messages,
    extras: collectExtras(config, index),
    groups: groups.groups,
    usages: [],
    diagnostics,
  }
}

export function mangle(key: string, overrides: Readonly<Record<string, string>>): string {
  return guardIdentifier(rawIdentifier(key, overrides))
}

export function namespaceOf(key: string): string {
  const dot = key.indexOf('.')
  return dot === -1 ? '_root' : key.slice(0, dot)
}

export function pascalCase(mangled: string): string {
  return mangled
    .split('_')
    .map((part) => (part === '' ? '' : part[0]?.toUpperCase() + part.slice(1)))
    .join('')
}

export function fallbackChain(locale: string, config: Config): readonly string[] {
  const middle =
    config.fallback === 'bcp47'
      ? declaredTruncations(locale, config)
      : (config.fallback[locale] ?? declaredTruncations(locale, config))
  const chain: string[] = [locale]
  for (const step of middle) {
    if (step !== config.sourceLocale && !chain.includes(step)) chain.push(step)
  }
  if (!chain.includes(config.sourceLocale)) chain.push(config.sourceLocale)
  return chain
}

export function confusableSkeleton(value: string): string {
  let skeleton = ''
  for (const char of value.normalize('NFKC')) skeleton += CONFUSABLE_FOLD.get(char) ?? char
  return skeleton
}

function rawIdentifier(key: string, overrides: Readonly<Record<string, string>>): string {
  const override = Object.hasOwn(overrides, key) ? overrides[key] : undefined
  if (override !== undefined) return override
  let identifier = ''
  for (const char of key.normalize('NFC')) {
    identifier += IDENTIFIER_PART.test(char) ? char : '_'
  }
  return identifier
}

function guardIdentifier(raw: string): string {
  const first = raw.length === 0 ? '' : String.fromCodePoint(raw.codePointAt(0) ?? 0)
  const started = IDENTIFIER_START.test(first) ? raw : `$${raw}`
  return RESERVED_WORDS.has(started) ? `$${started}` : started
}

function declaredTruncations(locale: string, config: Config): readonly string[] {
  const subtags = locale.split('-')
  const truncations: string[] = []
  for (let length = subtags.length - 1; length > 0; length -= 1) {
    const candidate = subtags.slice(0, length).join('-')
    if (config.locales.includes(candidate)) truncations.push(candidate)
  }
  return truncations
}

function indexCatalogs(catalogs: readonly RawCatalog[]): CatalogIndex {
  const index = new Map<string, Map<string, CatalogEntry>>()
  for (const catalog of catalogs) {
    let entries = index.get(catalog.locale)
    if (entries === undefined) {
      entries = new Map<string, CatalogEntry>()
      index.set(catalog.locale, entries)
    }
    for (const entry of catalog.entries) {
      if (entries.has(entry.key)) continue
      entries.set(entry.key, { file: catalog.file, format: catalog.format, value: entry.value, span: entry.span })
    }
  }
  return index
}

function indexMeta(meta: CatalogMeta | null): ReadonlyMap<string, MetaEntry> {
  const notes = new Map<string, MetaEntry>()
  if (meta === null) return notes
  for (const entry of meta.entries) {
    if (!notes.has(entry.key)) notes.set(entry.key, entry)
  }
  return notes
}

function sortedKeys(entries: ReadonlyMap<string, CatalogEntry> | undefined): readonly string[] {
  return entries === undefined ? [] : [...entries.keys()].sort(compareCodepoint)
}

function contributorOrder(
  config: Config,
  chains: ReadonlyMap<string, readonly string[]>,
  index: CatalogIndex,
): readonly string[] {
  const reachable = new Set<string>([config.sourceLocale])
  for (const chain of chains.values()) {
    for (const locale of chain) reachable.add(locale)
  }
  const declared = config.locales.filter((locale) => locale !== config.sourceLocale)
  const undeclared = [...reachable]
    .filter((locale) => locale !== config.sourceLocale && !config.locales.includes(locale))
    .sort(compareCodepoint)
  return [config.sourceLocale, ...declared, ...undeclared].filter(
    (locale) => reachable.has(locale) && index.has(locale),
  )
}

function lowerKey(
  key: string,
  config: Config,
  index: CatalogIndex,
  contributors: readonly string[],
): { readonly bodies: ReadonlyMap<string, LoweredBody>; readonly diagnostics: readonly Diagnostic[] } {
  const bodies = new Map<string, LoweredBody>()
  const diagnostics: Diagnostic[] = []
  for (const locale of contributors) {
    const entry = index.get(locale)?.get(key)
    if (entry === undefined) continue
    if (locale !== config.sourceLocale && isBlank(entry.value)) continue
    const context: LowerContext = {
      key,
      locale,
      file: entry.file,
      span: entry.span,
      catalogFormat: entry.format,
      formats: config.formats,
    }
    const result = lower(entry.value, context)
    diagnostics.push(...result.diagnostics)
    bodies.set(locale, { result, valid: !droppedByLowering(result.diagnostics) })
  }
  return { bodies, diagnostics }
}

function droppedByLowering(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some(
    (diagnostic) =>
      RULES[diagnostic.rule].fatal === 'message' && diagnostic.severity === 'error',
  )
}

function isBlank(value: string): boolean {
  return value.trim() === ''
}

function buildMessage(input: {
  readonly key: string
  readonly config: Config
  readonly index: CatalogIndex
  readonly chains: ReadonlyMap<string, readonly string[]>
  readonly lowered: ReadonlyMap<string, LoweredBody>
  readonly sourceBody: LoweredBody
  readonly note: MetaEntry | undefined
}): Message {
  const { key, config, index, sourceBody, note } = input
  const resolution = resolveLocales(input)
  const namespace = mangle(namespaceOf(key), config.identifiers)
  const source = sourceBody.result.normalized
  return {
    key,
    id: mangle(key, config.identifiers),
    namespace,
    module: `messages/${namespace}.js`,
    kind: sourceBody.result.kind,
    source,
    sourceHash: hash16(source),
    args: unifyArgs(sourceBody.result.args, resolution.bodies, config.sourceLocale),
    markupTags: sourceBody.result.markupTags,
    description: note?.description ?? null,
    placeholders: note?.placeholders ?? [],
    bodies: resolution.bodies,
    origins: resolution.origins,
    spans: localeSpans(key, config, index),
  }
}

function resolveLocales(input: {
  readonly key: string
  readonly config: Config
  readonly index: CatalogIndex
  readonly chains: ReadonlyMap<string, readonly string[]>
  readonly lowered: ReadonlyMap<string, LoweredBody>
  readonly sourceBody: LoweredBody
}): Resolution {
  const { key, config, index, chains, lowered, sourceBody } = input
  const bodies: Body[] = []
  const origins: LocaleOrigin[] = []
  for (const locale of config.locales) {
    const chain = chains.get(locale) ?? [locale, config.sourceLocale]
    let from = config.sourceLocale
    let body = sourceBody
    for (const candidate of chain) {
      if (candidate === config.sourceLocale) break
      const own = lowered.get(candidate)
      if (own !== undefined && own.valid) {
        from = candidate
        body = own
        break
      }
    }
    bodies.push({
      locale,
      nodes: body.result.nodes,
      args: body.result.args,
      markupTags: body.result.markupTags,
    })
    origins.push({ locale, origin: originFor(locale, from, key, config, index) })
  }
  return { bodies, origins }
}

function originFor(
  locale: string,
  from: string,
  key: string,
  config: Config,
  index: CatalogIndex,
): Origin {
  if (from === locale) return { status: 'translated' }
  if (from !== config.sourceLocale) return { status: 'inherited', from }
  return { status: 'fallback', from, reason: fallbackReason(locale, key, index) }
}

function fallbackReason(locale: string, key: string, index: CatalogIndex): FallbackReason {
  const entry = index.get(locale)?.get(key)
  if (entry === undefined) return 'missing'
  return isBlank(entry.value) ? 'blank' : 'invalid'
}

function localeSpans(key: string, config: Config, index: CatalogIndex): readonly LocaleSpan[] {
  const spans: LocaleSpan[] = []
  for (const locale of config.locales) {
    const entry = index.get(locale)?.get(key)
    if (entry === undefined) continue
    spans.push({ locale, file: entry.file, span: entry.span })
  }
  return spans
}

function unifyArgs(
  sourceArgs: readonly Arg[],
  bodies: readonly Body[],
  sourceLocale: string,
): readonly Arg[] {
  return sourceArgs.map((sourceArg) => ({
    name: sourceArg.name,
    type: unifyAcrossLocales(sourceArg, bodies, sourceLocale),
  }))
}

function unifyAcrossLocales(
  sourceArg: Arg,
  bodies: readonly Body[],
  sourceLocale: string,
): ArgType {
  let type = sourceArg.type
  for (const body of bodies) {
    if (body.locale === sourceLocale) continue
    const other = body.args.find((arg) => arg.name === sourceArg.name)
    if (other === undefined) continue
    const unified = unify(type, other.type)
    if (unified === null) return sourceArg.type
    type = unified
  }
  return type
}

function collectExtras(config: Config, index: CatalogIndex): readonly CatalogExtra[] {
  const sourceEntries = index.get(config.sourceLocale)
  const extras: CatalogExtra[] = []
  for (const locale of config.locales) {
    if (locale === config.sourceLocale) continue
    const entries = index.get(locale)
    if (entries === undefined) continue
    for (const [key, entry] of entries) {
      if (sourceEntries?.has(key) === true) continue
      extras.push({ locale, key, file: entry.file, span: entry.span })
    }
  }
  return extras
}

function checkIdentity(
  messages: readonly Message[],
  config: Config,
  sourceEntries: ReadonlyMap<string, CatalogEntry> | undefined,
): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [
    ...checkIdentifierCollisions(messages, sourceEntries),
    ...checkReservedIdentifiers(messages, config, sourceEntries),
    ...checkConfusableKeys(messages, sourceEntries),
  ]
  return diagnostics
}

function checkIdentifierCollisions(
  messages: readonly Message[],
  sourceEntries: ReadonlyMap<string, CatalogEntry> | undefined,
): readonly Diagnostic[] {
  const byIdentifier = new Map<string, Message[]>()
  for (const message of messages) {
    const bucket = byIdentifier.get(message.id)
    if (bucket === undefined) byIdentifier.set(message.id, [message])
    else bucket.push(message)
  }
  const diagnostics: Diagnostic[] = []
  for (const [identifier, bucket] of byIdentifier) {
    if (bucket.length < 2) continue
    const [first, ...rest] = bucket
    if (first === undefined) continue
    diagnostics.push(
      diag('identifier-collision', {
        message: `${bucket.length} keys mangle to the identifier "${identifier}".`,
        hint: `Rename one of the keys, or map it in loclizr.config.ts: identifiers: { '${rest[0]?.key ?? first.key}': '${identifier}2' }`,
        key: first.key,
        ...locationOf(first.key, sourceEntries),
        related: rest.map((message) =>
          relatedKey(message.key, sourceEntries, `also mangles to "${identifier}"`),
        ),
      }),
    )
  }
  return diagnostics
}

function checkReservedIdentifiers(
  messages: readonly Message[],
  config: Config,
  sourceEntries: ReadonlyMap<string, CatalogEntry> | undefined,
): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  const reportedNamespaces = new Set<string>()
  for (const message of messages) {
    const raw = rawIdentifier(message.key, config.identifiers)
    if (INTERNAL_NAMESPACE.test(raw)) {
      diagnostics.push(
        diag('identifier-reserved', {
          message: `The key "${message.key}" produces the identifier "${message.id}", which is reserved for loclizr internals.`,
          hint: `Rename the key, or map it in loclizr.config.ts: identifiers: { '${message.key}': 'message' }`,
          key: message.key,
          ...locationOf(message.key, sourceEntries),
        }),
      )
    } else if (RESERVED_IDENTIFIERS.has(message.id)) {
      diagnostics.push(
        diag('identifier-reserved', {
          message: `The key "${message.key}" produces the reserved identifier "${message.id}".`,
          hint: `The generated barrel already exports that name, and a star export loses to it silently. Map the key in loclizr.config.ts: identifiers: { '${message.key}': '${message.id}Message' }`,
          key: message.key,
          ...locationOf(message.key, sourceEntries),
        }),
      )
    }
    if (
      namespaceOf(message.key) !== '_root' &&
      RESERVED_NAMESPACES.has(message.namespace) &&
      !reportedNamespaces.has(message.namespace)
    ) {
      reportedNamespaces.add(message.namespace)
      diagnostics.push(
        diag('identifier-reserved', {
          message: `The top-level key segment "${namespaceOf(message.key)}" names the module "messages/${message.namespace}.js", which loclizr generates itself.`,
          hint: `Rename the segment, or map it in loclizr.config.ts: identifiers: { '${namespaceOf(message.key)}': 'app${pascalCase(message.namespace)}' }`,
          key: message.key,
          ...locationOf(message.key, sourceEntries),
        }),
      )
    }
  }
  return diagnostics
}

function checkConfusableKeys(
  messages: readonly Message[],
  sourceEntries: ReadonlyMap<string, CatalogEntry> | undefined,
): readonly Diagnostic[] {
  const bySkeleton = new Map<string, Message[]>()
  for (const message of messages) {
    const skeleton = confusableSkeleton(message.key)
    const bucket = bySkeleton.get(skeleton)
    if (bucket === undefined) bySkeleton.set(skeleton, [message])
    else bucket.push(message)
  }
  const diagnostics: Diagnostic[] = []
  for (const [skeleton, bucket] of bySkeleton) {
    if (bucket.length < 2) continue
    const [first, ...rest] = bucket
    if (first === undefined) continue
    diagnostics.push(
      diag('confusable-key', {
        message: `${bucket.length} keys are indistinguishable after confusable folding: "${skeleton}".`,
        hint: 'One of them carries a Cyrillic or Greek homoglyph. Retype the key in Latin.',
        key: first.key,
        ...locationOf(first.key, sourceEntries),
        related: rest.map((message) =>
          relatedKey(message.key, sourceEntries, `folds to the same skeleton as "${first.key}"`),
        ),
      }),
    )
  }
  return diagnostics
}

function buildGroups(
  config: Config,
  messages: readonly Message[],
): { readonly groups: readonly Group[]; readonly diagnostics: readonly Diagnostic[] } {
  const groups: Group[] = []
  const diagnostics: Diagnostic[] = []
  for (const name of Object.keys(config.groups)) {
    const prefix = config.groups[name]
    if (prefix === undefined) continue
    const members = collectMembers(prefix, messages)
    const id = mangle(name, config.identifiers)
    groups.push({ name, id, typeBase: pascalCase(id), prefix, members })
    if (members.length === 0) {
      diagnostics.push(
        diag('group-empty', {
          message: `The group "${name}" matched no keys under the prefix "${prefix}".`,
          hint: `A prefix matches on a dot boundary, so "${prefix}" captures "${prefix}.forbidden" and never "${prefix}forbidden". Check the prefix.`,
        }),
      )
      continue
    }
    const heterogeneous = checkGroupArgs(name, members, messages)
    if (heterogeneous !== null) diagnostics.push(heterogeneous)
  }
  groups.sort((a, b) => compareCodepoint(a.id, b.id))
  diagnostics.push(...checkGroupCollisions(groups))
  return { groups, diagnostics }
}

function collectMembers(prefix: string, messages: readonly Message[]): readonly GroupMember[] {
  const members: GroupMember[] = []
  for (const message of messages) {
    if (!message.key.startsWith(`${prefix}.`)) continue
    members.push({
      key: message.key,
      id: message.id,
      member: mangle(message.key.slice(prefix.length + 1), {}),
    })
  }
  return members.sort((a, b) => compareCodepoint(a.member, b.member))
}

function checkGroupArgs(
  name: string,
  members: readonly GroupMember[],
  messages: readonly Message[],
): Diagnostic | null {
  const byKey = new Map(messages.map((message) => [message.key, message]))
  const signatures = new Set<string>()
  const union = new Set<string>()
  const related: Related[] = []
  for (const member of members) {
    const message = byKey.get(member.key)
    if (message === undefined) continue
    for (const arg of message.args) union.add(arg.name)
    signatures.add(argSignature(message.args))
    related.push({
      file: null,
      locale: null,
      key: member.key,
      span: null,
      message:
        message.args.length === 0
          ? 'takes no arguments'
          : `takes ${message.args.map((arg) => arg.name).join(', ')}`,
    })
  }
  if (signatures.size < 2) return null
  const forced = [...union].sort(compareCodepoint).join(', ')
  return diag('group-args-heterogeneous', {
    message: `The group "${name}" has members with different argument sets, so every dynamic call site must pass the union: ${forced}.`,
    hint: 'Split the group by argument shape, or give the odd members bare {x} arguments.',
    related,
  })
}

function argSignature(args: readonly Arg[]): string {
  return [...args]
    .map((arg) => `${arg.name}:${arg.type.kind}`)
    .sort(compareCodepoint)
    .join('\u0000')
}

function checkGroupCollisions(groups: readonly Group[]): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  for (const [label, pick] of [
    ['export identifier', (group: Group): string => group.id],
    ['type base', (group: Group): string => group.typeBase],
  ] as const) {
    const byValue = new Map<string, Group[]>()
    for (const group of groups) {
      const value = pick(group)
      const bucket = byValue.get(value)
      if (bucket === undefined) byValue.set(value, [group])
      else bucket.push(group)
    }
    for (const [value, bucket] of byValue) {
      if (bucket.length < 2) continue
      diagnostics.push(
        diag('identifier-collision', {
          message: `The groups ${bucket.map((group) => `"${group.name}"`).join(' and ')} share the ${label} "${value}".`,
          hint: 'Rename one of the groups in loclizr.config.ts.',
        }),
      )
    }
  }
  return diagnostics
}

function locationOf(
  key: string,
  sourceEntries: ReadonlyMap<string, CatalogEntry> | undefined,
): { readonly file?: string; readonly span?: Span } {
  const entry = sourceEntries?.get(key)
  return entry === undefined ? {} : { file: entry.file, span: entry.span }
}

function relatedKey(
  key: string,
  sourceEntries: ReadonlyMap<string, CatalogEntry> | undefined,
  message: string,
): Related {
  const entry = sourceEntries?.get(key)
  return {
    file: entry?.file ?? null,
    locale: null,
    key,
    span: entry?.span ?? null,
    message,
  }
}
