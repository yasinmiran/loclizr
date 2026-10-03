import { diag } from '../diagnostics'
import type {
  Body,
  Config,
  Diagnostic,
  EmitResult,
  EmittedFile,
  Group,
  GroupMember,
  IntlOptions,
  Message,
  Node,
  Origin,
  Program,
} from '../types'
import { compareCodepoint } from '../util'
import { localDeclarations, messageContext, pluralSelectors, renderArm } from './body'
import { argsShape, declaration, returnType } from './declare'
import {
  HEADER,
  NOCHECK,
  bindsHandlerType,
  byCodepoint,
  handlerNames,
  objectLiteral,
  pad,
  property,
  quoted,
  textOf,
} from './shared'

const ARM_INDENT = 6

export function emit(program: Program): EmitResult {
  const files = render(program)
  const replayed = render(reverseForReplay(program))
  const drift = firstDifference(files, replayed)
  if (drift === null) return { files, diagnostics: [] }
  return { files, diagnostics: [nondeterministic(program.config, drift)] }
}

export function reverseForReplay(program: Program): Program {
  return {
    ...program,
    locales: reversed(program.locales),
    messages: reversed(program.messages.map(reverseMessage)),
    extras: reversed(program.extras),
    groups: reversed(program.groups.map((group) => ({ ...group, members: reversed(group.members) }))),
    usages: reversed(program.usages.map((usage) => ({ ...usage, sites: reversed(usage.sites) }))),
  }
}

interface Namespace {
  readonly module: string
  readonly functions: string[]
  readonly declarations: string[]
  readonly formats: Set<string>
  readonly runtime: Set<string>
  emptyArgs: boolean
}

function render(program: Program): readonly EmittedFile[] {
  const locales = byCodepoint(program.locales)
  const messages = [...program.messages].sort((a, b) => compareCodepoint(a.key, b.key))
  const formats = new Map<string, IntlOptions>()
  const namespaces = new Map<string, Namespace>()
  const byKey = new Map<string, Message>()

  for (const message of messages) {
    const namespace = namespaceFor(namespaces, message.module)
    const arm = renderMessage(message, program.sourceLocale, locales)
    namespace.functions.push(arm.code)
    namespace.declarations.push(...declaration(message, program.sourceLocale))
    for (const [name, options] of arm.formats) {
      formats.set(name, options)
      namespace.formats.add(name)
    }
    for (const helper of arm.runtime) namespace.runtime.add(helper)
    namespace.emptyArgs = namespace.emptyArgs || message.args.length === 0
    byKey.set(message.key, message)
  }

  const ordered = [...namespaces.values()].sort((a, b) => compareCodepoint(a.module, b.module))
  const files: EmittedFile[] = [
    { path: '.gitignore', contents: textOf(['*', '!.gitignore']) },
    { path: 'messages/_locale.js', contents: localeModule(program) },
    { path: 'messages/_locale.d.ts', contents: localeTypes(locales, program.sourceLocale) },
    { path: 'messages/_formats.js', contents: formatsModule(formats) },
    { path: 'messages/_formats.d.ts', contents: formatsTypes(formats) },
    { path: 'messages.js', contents: barrelModule(ordered) },
    { path: 'messages.d.ts', contents: barrelTypes(ordered, locales, program.config.augmentLocale) },
  ]
  for (const namespace of ordered) {
    files.push({ path: namespace.module, contents: namespaceModule(namespace) })
    files.push({ path: typesPath(namespace.module), contents: namespaceTypes(namespace) })
  }
  if (program.groups.length > 0) {
    const groups = [...program.groups].sort((a, b) => compareCodepoint(a.id, b.id))
    files.push({ path: 'groups.js', contents: groupsModule(groups, byKey) })
    files.push({ path: 'groups.d.ts', contents: groupsTypes(groups, byKey) })
  }
  return files.sort((a, b) => compareCodepoint(a.path, b.path))
}

interface RenderedMessage {
  readonly code: string
  readonly formats: ReadonlyMap<string, IntlOptions>
  readonly runtime: ReadonlySet<string>
}

function renderMessage(
  message: Message,
  sourceLocale: string,
  locales: readonly string[],
): RenderedMessage {
  const bodies = new Map<string, Body>(message.bodies.map((body) => [body.locale, body]))
  const origins = new Map<string, Origin>(message.origins.map((entry) => [entry.locale, entry.origin]))
  const bodyLocale = (locale: string): string => {
    const origin = origins.get(locale)
    return origin === undefined || origin.status === 'translated' ? locale : origin.from
  }
  const nodesFor = (locale: string): readonly Node[] => bodies.get(bodyLocale(locale))?.nodes ?? []

  const context = messageContext(
    message.kind,
    pluralSelectors([...locales, sourceLocale].map(nodesFor)),
    handlerNames(message.args),
  )
  const armFor = (locale: string): string =>
    renderArm(nodesFor(locale), context, ARM_INDENT, bodyLocale(locale))
  const arms = locales.map((locale) => ({ locale, code: armFor(locale) }))
  const fallthrough = arms.find((arm) => arm.locale === sourceLocale)?.code ?? armFor(sourceLocale)

  const cases: { readonly code: string; readonly locales: string[] }[] = []
  for (const arm of arms) {
    if (arm.locale === sourceLocale || arm.code === fallthrough) continue
    const existing = cases.find((entry) => entry.code === arm.code)
    if (existing === undefined) cases.push({ code: arm.code, locales: [arm.locale] })
    else existing.locales.push(arm.locale)
  }

  const lines: string[] = [`export function ${message.id}(args, opts) {`]
  if (context.runtime.size > 0) lines.push(`${pad(2)}const l = $l(opts)`)
  lines.push(...localDeclarations(context, 2))
  lines.push(`${pad(2)}switch (${context.runtime.size > 0 ? 'l' : '$l(opts)'}) {`)
  for (const entry of cases) {
    for (const locale of entry.locales) lines.push(`${pad(4)}case ${quoted(locale)}:`)
    lines.push(entry.code)
  }
  lines.push(`${pad(4)}default:`)
  lines.push(fallthrough)
  lines.push(`${pad(2)}}`, '}')
  return { code: lines.join('\n'), formats: context.formats, runtime: context.runtime }
}

function namespaceFor(namespaces: Map<string, Namespace>, module: string): Namespace {
  const existing = namespaces.get(module)
  if (existing !== undefined) return existing
  const created: Namespace = {
    module,
    functions: [],
    declarations: [],
    formats: new Set<string>(),
    runtime: new Set<string>(),
    emptyArgs: false,
  }
  namespaces.set(module, created)
  return created
}

function namespaceModule(namespace: Namespace): string {
  const lines: string[] = [HEADER, NOCHECK]
  if (namespace.runtime.size > 0) {
    lines.push(`import { ${byCodepoint([...namespace.runtime]).join(', ')} } from 'loclizr'`)
  }
  if (namespace.formats.size > 0) {
    lines.push(`import { ${byCodepoint([...namespace.formats]).join(', ')} } from './_formats.js'`)
  }
  lines.push("import { $l } from './_locale.js'", '')
  return textOf([...lines, namespace.functions.join('\n\n')])
}

function namespaceTypes(namespace: Namespace): string {
  const imported = namespace.emptyArgs ? ['EmptyArgs', 'MessageOptions'] : ['MessageOptions']
  return textOf([HEADER, `import type { ${imported.join(', ')} } from 'loclizr'`, ...namespace.declarations])
}

function localeModule(program: Program): string {
  const locales = byCodepoint(program.locales).map(quoted).join(', ')
  return textOf([
    HEADER,
    NOCHECK,
    "import { $configure1 } from 'loclizr'",
    '',
    `export const locales = /*#__PURE__*/ Object.freeze([${locales}])`,
    `export const sourceLocale = ${quoted(program.sourceLocale)}`,
    `export const $l = $configure1({ locales, sourceLocale, cookie: ${quoted(program.config.cookie)} })`,
  ])
}

function localeTypes(locales: readonly string[], sourceLocale: string): string {
  return textOf([
    HEADER,
    "import type { LocaleResolver } from 'loclizr'",
    `export declare const locales: readonly [${locales.map(quoted).join(', ')}]`,
    `export declare const sourceLocale: ${quoted(sourceLocale)}`,
    'export declare const $l: LocaleResolver',
  ])
}

function formatsModule(formats: ReadonlyMap<string, IntlOptions>): string {
  const lines = byCodepoint([...formats.keys()]).map(
    (name) => `export const ${name} = /*#__PURE__*/ Object.freeze(${objectLiteral(formats.get(name) ?? {})})`,
  )
  return textOf([HEADER, NOCHECK, ...lines])
}

function formatsTypes(formats: ReadonlyMap<string, IntlOptions>): string {
  if (formats.size === 0) return textOf([HEADER])
  const lines = byCodepoint([...formats.keys()]).map((name) => `export declare const ${name}: IntlOptions`)
  return textOf([HEADER, "import type { IntlOptions } from 'loclizr'", ...lines])
}

function groupsModule(groups: readonly Group[], byKey: ReadonlyMap<string, Message>): string {
  const imports = new Map<string, Set<string>>()
  const blocks: string[] = []
  for (const group of groups) {
    const members = resolvedMembers(group, byKey)
    for (const entry of members) {
      const names = imports.get(entry.message.module) ?? new Set<string>()
      names.add(entry.member.id)
      imports.set(entry.message.module, names)
    }
    const fields = members.map((entry) => `${pad(2)}${recordKey(entry.member.member)}: ${entry.member.id},`)
    blocks.push(
      [
        `export const ${group.id} = /*#__PURE__*/ Object.freeze({`,
        `${pad(2)}__proto__: null,`,
        ...fields,
        '})',
      ].join('\n'),
    )
  }
  const lines = byCodepoint([...imports.keys()]).map(
    (module) => `import { ${byCodepoint([...(imports.get(module) ?? [])]).join(', ')} } from './${module}'`,
  )
  return textOf([HEADER, NOCHECK, ...lines, '', blocks.join('\n\n')])
}

function groupsTypes(groups: readonly Group[], byKey: ReadonlyMap<string, Message>): string {
  const tiers = groups.map((group) => ({ group, members: resolvedMembers(group, byKey) }))
  const emptyArgs = tiers.some((tier) => tier.members.some((entry) => entry.message.args.length === 0))
  const imported = emptyArgs ? ['EmptyArgs', 'MessageOptions'] : ['MessageOptions']
  const locals = new Set(groups.flatMap((group) => ['Key', 'Args', 'Return'].map((suffix) => group.typeBase + suffix)))
  const emptyArgsName = unshadowed('EmptyArgs', locals)
  const bindings = imported.map((name) =>
    name === 'EmptyArgs' && emptyArgsName !== name ? `${name} as ${emptyArgsName}` : name,
  )
  const blocks = tiers.map((tier) => groupTier(tier.group, tier.members, emptyArgsName))
  return textOf([HEADER, `import type { ${bindings.join(', ')} } from 'loclizr'`, '', blocks.join('\n\n')])
}

// A group's type base is user-derived, so `Empty` prints `EmptyArgs` and would
// collide with the imported type; the import then binds under a `$` name no
// local type takes. `MessageOptions` needs no such care: no local name ends in it.
function unshadowed(name: string, locals: ReadonlySet<string>): string {
  return locals.has(name) ? unshadowed(`$${name}`, locals) : name
}

// A markup member returns parts rather than a string and its handler names a
// type parameter, so a tier holding one carries both through the lookup maps.
function groupTier(group: Group, members: readonly ResolvedMember[], emptyArgs: string): string {
  const parts = members.some((entry) => bindsHandlerType(entry.message))
  const keys =
    members.length === 0 ? 'never' : members.map((entry) => quoted(entry.member.member)).join(' | ')
  const field = (entry: ResolvedMember, type: string): string =>
    `${pad(2)}${property(entry.member.member)}: ${type}`
  const signature = parts
    ? `<T>(args: ${group.typeBase}Args<T>[K], opts?: MessageOptions) => ${group.typeBase}Return<T>[K]`
    : `(args: ${group.typeBase}Args[K], opts?: MessageOptions) => string`
  return [
    `export type ${group.typeBase}Key = ${keys}`,
    `export interface ${group.typeBase}Args${parts ? '<T>' : ''} {`,
    ...members.map((entry) => field(entry, argsShape(entry.message.args, emptyArgs))),
    '}',
    ...(parts
      ? [
          `export interface ${group.typeBase}Return<T> {`,
          ...members.map((entry) => field(entry, returnType(entry.message.kind))),
          '}',
        ]
      : []),
    `export declare const ${group.id}: Readonly<{`,
    `${pad(2)}[K in ${group.typeBase}Key]: ${signature}`,
    '}>',
  ].join('\n')
}

interface ResolvedMember {
  readonly member: GroupMember
  readonly message: Message
}

function resolvedMembers(group: Group, byKey: ReadonlyMap<string, Message>): readonly ResolvedMember[] {
  const resolved: ResolvedMember[] = []
  for (const member of [...group.members].sort((a, b) => compareCodepoint(a.member, b.member))) {
    const message = byKey.get(member.key)
    if (message !== undefined) resolved.push({ member, message })
  }
  return resolved
}

// `__proto__: null` above it makes a second `__proto__` field an early
// SyntaxError, and a computed key is the only form that defines the property.
function recordKey(member: string): string {
  return member === '__proto__' ? `[${quoted(member)}]` : property(member)
}

function barrelModule(namespaces: readonly Namespace[]): string {
  return textOf([
    HEADER,
    NOCHECK,
    "export { getLocale, setLocale, subscribe } from 'loclizr'",
    "export { locales, sourceLocale } from './messages/_locale.js'",
    ...namespaces.map((namespace) => `export * from './${namespace.module}'`),
  ])
}

function barrelTypes(
  namespaces: readonly Namespace[],
  locales: readonly string[],
  augmentLocale: boolean,
): string {
  const lines: string[] = [
    HEADER,
    "import type { SetLocaleOptions } from 'loclizr'",
    '',
    `export type AppLocale = ${locales.map(quoted).join(' | ')}`,
    '',
  ]
  if (augmentLocale) {
    lines.push(
      "declare module 'loclizr' {",
      `${pad(2)}interface LocaleRegistry {`,
      `${pad(4)}locale: AppLocale`,
      `${pad(2)}}`,
      '}',
      '',
    )
  }
  lines.push(
    'export declare function getLocale(): AppLocale',
    'export declare function setLocale(locale: AppLocale, options?: SetLocaleOptions): void',
    'export declare function subscribe(listener: () => void): () => void',
    "export { locales, sourceLocale } from './messages/_locale.js'",
    ...namespaces.map((namespace) => `export * from './${namespace.module}'`),
  )
  return textOf(lines)
}

function typesPath(module: string): string {
  return `${module.slice(0, -'.js'.length)}.d.ts`
}

function firstDifference(left: readonly EmittedFile[], right: readonly EmittedFile[]): string | null {
  const count = Math.max(left.length, right.length)
  for (let index = 0; index < count; index += 1) {
    const a = left[index]
    const b = right[index]
    if (a === undefined) return b?.path ?? ''
    if (b === undefined || a.path !== b.path) return a.path
    if (a.contents !== b.contents) return a.path
  }
  return null
}

function nondeterministic(config: Config, path: string): Diagnostic {
  return diag('nondeterministic-output', {
    message: `Emitting twice from one program produced different bytes for ${path}.`,
    hint: 'Report this to loclizr with the path above and the catalogs that produced it. Nothing in the project can be changed to clear it: it is a bug in the compiler, not in the catalogs or the config.',
    file: outputPath(config, path),
  })
}

function outputPath(config: Config, path: string): string {
  const base = config.outDir.replace(/\/+$/u, '')
  return base === '' ? path : `${base}/${path}`
}

function reverseMessage(message: Message): Message {
  return {
    ...message,
    bodies: reversed(message.bodies),
    origins: reversed(message.origins),
    spans: reversed(message.spans),
    placeholders: reversed(message.placeholders),
  }
}

function reversed<T>(values: readonly T[]): readonly T[] {
  return [...values].reverse()
}
