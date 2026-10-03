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

const PROTOTYPE_NAMES: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype'])

const RESERVED_NAMESPACES: ReadonlySet<string> = new Set(['_locale', '_formats', '_root'])

// The groups module freezes each group through this bare global, so a group
// exported or a member imported under the same name shadows it and the module
// throws on load.
const GROUPS_GLOBAL = 'Object'

const PROTOTYPE_PROPERTY = '__proto__'

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
  const groups = buildGroups(config, messages, sourceEntries)
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
    .map((part) => {
      const first = part === '' ? '' : String.fromCodePoint(part.codePointAt(0) ?? 0)
      return first.toUpperCase() + part.slice(first.length)
    })
    .join('')
}

export function fallbackChain(locale: string, config: Config): readonly string[] {
  if (locale === config.sourceLocale) return [locale]
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
  return identifierChars(override ?? key.normalize('NFC'))
}

function identifierChars(value: string): string {
  let identifier = ''
  for (const char of value) identifier += IDENTIFIER_PART.test(char) ? char : '_'
  return identifier
}

// A namespace is a filename, so an `identifiers` entry may move a module off a
// reserved name but may never carry a separator out of `outDir`.
function namespaceIdentifier(key: string, overrides: Readonly<Record<string, string>>): string {
  return identifierChars(mangle(namespaceOf(key), overrides))
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
  const { key, config, index, chains, lowered, sourceBody, note } = input
  const bodies = ownBodies(lowered)
  const namespace = namespaceIdentifier(key, config.identifiers)
  const source = sourceBody.result.normalized
  return {
    key,
    id: mangle(key, config.identifiers),
    namespace,
    module: `messages/${namespace}.js`,
    kind: sourceBody.result.kind,
    source,
    sourceHash: hash16(source),
    args: unifyArgs(sourceBody.result.args, bodies, config.sourceLocale),
    markupTags: sourceBody.result.markupTags,
    description: note?.description ?? null,
    placeholders: note?.placeholders ?? [],
    bodies,
    origins: resolveOrigins({
      key,
      config,
      index,
      chains,
      renderable: renderableLocales(bodies, sourceBody.result.args),
    }),
    spans: localeSpans(key, config, index),
  }
}

function ownBodies(lowered: ReadonlyMap<string, LoweredBody>): readonly Body[] {
  const bodies: Body[] = []
  for (const [locale, entry] of lowered) {
    if (!entry.valid) continue
    bodies.push({
      locale,
      nodes: entry.result.nodes,
      args: entry.result.args,
      markupTags: entry.result.markupTags,
    })
  }
  return bodies
}

// A body naming an argument the source does not have would render `undefined`
// into the UI, so nothing may print it even though it lowered cleanly.
function renderableLocales(
  bodies: readonly Body[],
  sourceArgs: readonly Arg[],
): ReadonlySet<string> {
  const known = new Set(sourceArgs.map((arg) => arg.name))
  const renderable = new Set<string>()
  for (const body of bodies) {
    if (body.args.every((arg) => known.has(arg.name))) renderable.add(body.locale)
  }
  return renderable
}

function resolveOrigins(input: {
  readonly key: string
  readonly config: Config
  readonly index: CatalogIndex
  readonly chains: ReadonlyMap<string, readonly string[]>
  readonly renderable: ReadonlySet<string>
}): readonly LocaleOrigin[] {
  const { key, config, index, chains, renderable } = input
  const origins: LocaleOrigin[] = []
  for (const locale of config.locales) {
    if (renderable.has(locale)) {
      origins.push({ locale, origin: { status: 'translated' } })
      continue
    }
    const own = index.get(locale)?.get(key)
    // A locale that wrote a value of its own resolves to the source rather than
    // to an ancestor, so the record never claims a translation nobody wrote.
    if (own !== undefined) {
      origins.push({
        locale,
        origin: {
          status: 'fallback',
          from: config.sourceLocale,
          reason: isBlank(own.value) ? 'blank' : 'invalid',
        },
      })
      continue
    }
    const chain = chains.get(locale) ?? fallbackChain(locale, config)
    origins.push({
      locale,
      origin: inheritedAncestor(chain, config.sourceLocale, renderable) ?? {
        status: 'fallback',
        from: config.sourceLocale,
        reason: 'missing',
      },
    })
  }
  return origins
}

// Null where the chain reaches the source locale, which is a fallback rather
// than an inheritance and carries a reason of its own.
function inheritedAncestor(
  chain: readonly string[],
  sourceLocale: string,
  renderable: ReadonlySet<string>,
): Origin | null {
  for (const candidate of chain) {
    if (candidate === sourceLocale) break
    if (renderable.has(candidate)) return { status: 'inherited', from: candidate }
  }
  return null
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
    // An option union is the source locale's alone. Adopting a target's would
    // let a translator's branch name become a required literal at every call
    // site, which is the breakage a bare {x} exists to avoid.
    if (other.type.kind === 'select' && sourceArg.type.kind !== 'select') continue
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
    ...checkNamespaceCollisions(messages, sourceEntries),
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

// APFS and NTFS keep one file for two module names that differ only in case, so
// the second write wins there while both survive on Linux, and the two machines
// then disagree about which messages exist.
function checkNamespaceCollisions(
  messages: readonly Message[],
  sourceEntries: ReadonlyMap<string, CatalogEntry> | undefined,
): readonly Diagnostic[] {
  const byFoldedFilename = new Map<string, Map<string, string>>()
  for (const message of messages) {
    const folded = message.namespace.toLowerCase()
    // A fold onto a module the compiler writes itself is LZ4002's, and one
    // segment earns one diagnostic.
    if (RESERVED_NAMESPACES.has(folded)) continue
    let namespaces = byFoldedFilename.get(folded)
    if (namespaces === undefined) {
      namespaces = new Map<string, string>()
      byFoldedFilename.set(folded, namespaces)
    }
    if (!namespaces.has(message.namespace)) namespaces.set(message.namespace, message.key)
  }
  const diagnostics: Diagnostic[] = []
  for (const namespaces of byFoldedFilename.values()) {
    if (namespaces.size < 2) continue
    const [first, ...rest] = [...namespaces]
    const last = rest[rest.length - 1]
    if (first === undefined || last === undefined) continue
    const [, anchorKey] = first
    const [lastNamespace, lastKey] = last
    const modules = [...namespaces.keys()]
      .map((namespace) => `"messages/${namespace}.js"`)
      .join(' and ')
    diagnostics.push(
      diag('identifier-collision', {
        message: `${namespaces.size} top-level key segments name modules a case-insensitive filesystem cannot tell apart: ${modules}.`,
        hint: `One of them disappears on macOS and Windows while both survive on Linux. Rename a segment, or map it in loclizr.config.ts: identifiers: { '${namespaceOf(lastKey)}': '${lastNamespace}2' }`,
        key: anchorKey,
        ...locationOf(anchorKey, sourceEntries),
        related: rest.map(([namespace, key]) =>
          relatedKey(key, sourceEntries, `also names "messages/${namespace}.js"`),
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
    // The test runs before the guard, so only a `$` the key or an override
    // carried is reserved. The guard's own reserved-word prefix produces names
    // like `$then` deliberately, and the generated internals are all fixed.
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
      const reason = PROTOTYPE_NAMES.has(message.id)
        ? 'That name is a built-in property of JavaScript objects, so loclizr never exports a message under it.'
        : 'The generated barrel already exports that name, and a star export loses to it silently.'
      diagnostics.push(
        diag('identifier-reserved', {
          message: `The key "${message.key}" produces the reserved identifier "${message.id}".`,
          hint: `${reason} Map the key in loclizr.config.ts: identifiers: { '${message.key}': '${message.id}Message' }`,
          key: message.key,
          ...locationOf(message.key, sourceEntries),
        }),
      )
    } else if (
      message.id === GROUPS_GLOBAL &&
      Object.values(config.groups).some((prefix) => message.key.startsWith(`${prefix}.`))
    ) {
      diagnostics.push(
        diag('identifier-reserved', {
          message: `The key "${message.key}" produces the identifier "${message.id}", which the generated groups module imports and also calls to freeze each group.`,
          hint: `Map the key in loclizr.config.ts: identifiers: { '${message.key}': '${message.id}Message' }`,
          key: message.key,
          ...locationOf(message.key, sourceEntries),
        }),
      )
    }
    const generated = message.namespace.toLowerCase()
    if (
      message.key.includes('.') &&
      RESERVED_NAMESPACES.has(generated) &&
      !reportedNamespaces.has(message.namespace)
    ) {
      reportedNamespaces.add(message.namespace)
      diagnostics.push(
        diag('identifier-reserved', {
          message:
            generated === message.namespace
              ? `The top-level key segment "${namespaceOf(message.key)}" names the module "messages/${message.namespace}.js", which loclizr generates itself.`
              : `The top-level key segment "${namespaceOf(message.key)}" names the module "messages/${message.namespace}.js", which a case-insensitive filesystem cannot tell apart from the generated "messages/${generated}.js".`,
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
  sourceEntries: ReadonlyMap<string, CatalogEntry> | undefined,
): { readonly groups: readonly Group[]; readonly diagnostics: readonly Diagnostic[] } {
  const groups: Group[] = []
  const diagnostics: Diagnostic[] = []
  for (const name of Object.keys(config.groups)) {
    const prefix = config.groups[name]
    if (prefix === undefined) continue
    const members = collectMembers(prefix, messages)
    const id = mangle(name, config.identifiers)
    groups.push({ name, id, typeBase: pascalCase(id), prefix, members })
    if (id === GROUPS_GLOBAL) {
      diagnostics.push(
        diag('identifier-reserved', {
          message: `The group "${name}" produces the identifier "${id}", which the generated groups module calls to freeze each group.`,
          hint: 'Rename the group in loclizr.config.ts.',
        }),
      )
    }
    if (members.length === 0) {
      diagnostics.push(
        diag('group-empty', {
          message: `The group "${name}" matched no keys under the prefix "${prefix}".`,
          hint: `A prefix matches on a dot boundary, so "${prefix}" captures "${prefix}.forbidden" and never "${prefix}forbidden". Check the prefix.`,
        }),
      )
      continue
    }
    diagnostics.push(...checkMemberProperties(name, members, sourceEntries))
    const heterogeneous = checkGroupArgs(name, members, messages)
    if (heterogeneous !== null) diagnostics.push(heterogeneous)
  }
  groups.sort((a, b) => compareCodepoint(a.id, b.id))
  diagnostics.push(...checkGroupCollisions(groups))
  diagnostics.push(...checkGroupMemberIds(groups, sourceEntries))
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

// Two members typing one name as disjoint option unions intersect to `never`,
// so the option list is part of the shape a dynamic call site has to satisfy.
function argSignature(args: readonly Arg[]): string {
  return [...args]
    .map((arg) => `${arg.name}:${arg.type.kind}:${argOptions(arg.type)}`)
    .sort(compareCodepoint)
    .join('\u0000')
}

function argOptions(type: ArgType): string {
  return type.kind === 'select' ? type.options.join('|') : ''
}

// A colliding id always collides again as a type base, so one set of groups
// earns one diagnostic naming the first of the two that clashed.
function checkGroupCollisions(groups: readonly Group[]): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  const reported = new Set<string>()
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
      const involved = bucket.map((group) => group.name).join('\u0000')
      if (reported.has(involved)) continue
      reported.add(involved)
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

// The groups module imports every member id of every group into the scope that
// declares the groups, so a group id equal to any of them is declared twice and
// the module does not parse.
function checkGroupMemberIds(
  groups: readonly Group[],
  sourceEntries: ReadonlyMap<string, CatalogEntry> | undefined,
): readonly Diagnostic[] {
  const firstKeyById = new Map<string, string>()
  for (const group of groups) {
    for (const member of group.members) {
      if (!firstKeyById.has(member.id)) firstKeyById.set(member.id, member.key)
    }
  }
  const diagnostics: Diagnostic[] = []
  for (const group of groups) {
    const key = firstKeyById.get(group.id)
    if (key === undefined) continue
    diagnostics.push(
      diag('identifier-collision', {
        message: `The group "${group.name}" and the key "${key}" both produce the identifier "${group.id}" in the generated groups module.`,
        hint: `Rename the group, or map the key in loclizr.config.ts: identifiers: { '${key}': '${group.id}Message' }`,
        key,
        ...locationOf(key, sourceEntries),
      }),
    )
  }
  return diagnostics
}

// The member property is mangled from the key suffix alone, so an `identifiers`
// entry cannot reach it and renaming the key is the only fix.
function checkMemberProperties(
  name: string,
  members: readonly GroupMember[],
  sourceEntries: ReadonlyMap<string, CatalogEntry> | undefined,
): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  const byProperty = new Map<string, GroupMember[]>()
  for (const member of members) {
    const bucket = byProperty.get(member.member)
    if (bucket === undefined) byProperty.set(member.member, [member])
    else bucket.push(member)
  }
  for (const [property, bucket] of byProperty) {
    const [first, ...rest] = bucket
    if (first === undefined) continue
    if (property === PROTOTYPE_PROPERTY) {
      diagnostics.push(
        diag('identifier-reserved', {
          message: `The key "${first.key}" becomes the member "${property}" of the group "${name}", which the group literal already defines as null.`,
          hint: 'Rename the key. The group literal uses __proto__ to give each group a null prototype, so no member can take that name.',
          key: first.key,
          ...locationOf(first.key, sourceEntries),
        }),
      )
      continue
    }
    // Members sharing an id are one key collision that LZ4001 already names.
    if (new Set(bucket.map((member) => member.id)).size < 2) continue
    diagnostics.push(
      diag('identifier-collision', {
        message: `${bucket.length} keys become the member "${property}" of the group "${name}".`,
        hint: 'Rename one of the keys. A member property is mangled from the key suffix, so an identifiers entry cannot separate them.',
        key: first.key,
        ...locationOf(first.key, sourceEntries),
        related: rest.map((member) =>
          relatedKey(member.key, sourceEntries, `also becomes the member "${property}"`),
        ),
      }),
    )
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
