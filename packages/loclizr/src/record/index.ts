import { diag } from '../diagnostics'
import type {
  Arg,
  ArgType,
  ContextRecord,
  Diagnostic,
  ExactBranch,
  LocaleOrigin,
  Message,
  Node,
  PlaceholderNote,
  PluralBranch,
  Program,
  RecordArg,
  RecordArgType,
  RecordMessage,
  RecordTranslation,
  RecordUsage,
  RecordVariant,
  SelectBranch,
  UsageSite,
} from '../types'
import { compareCodepoint } from '../util'

const CLDR_ORDER: readonly string[] = ['zero', 'one', 'two', 'few', 'many', 'other']

const RECORD_ARG_TYPES: Readonly<Record<ArgType['kind'], RecordArgType>> = {
  stringish: 'text',
  number: 'number',
  date: 'date',
  select: 'select',
  markup: 'markup',
}

export function buildRecord(program: Program): ContextRecord {
  const sites = new Map(program.usages.map((usage) => [usage.id, usage.sites]))
  return {
    schema: 1,
    sourceLocale: program.sourceLocale,
    locales: [...program.locales].sort(compareCodepoint),
    messages: byKey(program.messages).map((message) =>
      recordMessage(message, program.sourceLocale, sites.get(message.id) ?? []),
    ),
  }
}

export function serializeRecord(record: ContextRecord): string {
  return `${JSON.stringify(record, null, 2)}\n`
}

export function checkDescriptions(program: Program): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  for (const message of byKey(program.messages)) {
    if (message.description !== null) continue
    if (message.args.length === 0 && message.markupTags.length === 0) continue
    diagnostics.push(missingDescription(message, program))
  }
  return diagnostics
}

function byKey(messages: readonly Message[]): readonly Message[] {
  return [...messages].sort((a, b) => compareCodepoint(a.key, b.key))
}

function recordMessage(
  message: Message,
  sourceLocale: string,
  sites: readonly UsageSite[],
): RecordMessage {
  const source = message.bodies.find((body) => body.locale === sourceLocale)
  const notes = noteIndex(message.placeholders)
  return {
    key: message.key,
    id: message.id,
    module: message.module,
    kind: message.kind,
    source: message.source,
    sourceHash: message.sourceHash,
    description: message.description,
    args: message.args.map((arg) => recordArg(arg, notes)),
    variants: variantsOf(source?.nodes ?? []),
    markup: tagSet(message.markupTags),
    translations: translationsOf(message.origins),
    usage: usageOf(sites),
  }
}

function noteIndex(placeholders: readonly PlaceholderNote[]): ReadonlyMap<string, string> {
  // The sidecar is hand written, so a note can arrive NFD while every argument name is NFC.
  return new Map(placeholders.map((entry) => [entry.name.normalize('NFC'), entry.note]))
}

function recordArg(arg: Arg, notes: ReadonlyMap<string, string>): RecordArg {
  return {
    name: arg.name,
    type: RECORD_ARG_TYPES[arg.type.kind],
    options: arg.type.kind === 'select' ? arg.type.options : null,
    note: notes.get(arg.name.normalize('NFC')) ?? null,
  }
}

function variantsOf(nodes: readonly Node[]): readonly RecordVariant[] {
  const variants: RecordVariant[] = []
  collectVariants(nodes, variants)
  return variants
}

function collectVariants(nodes: readonly Node[], out: RecordVariant[]): void {
  for (const node of nodes) {
    if (node.kind === 'plural') {
      const exact = orderedExact(node.exact)
      const keywords = orderedKeywords(node.branches)
      out.push({
        arg: node.name,
        kind: node.ordinal ? 'selectordinal' : 'plural',
        matches: [
          ...exact.map((branch) => `=${branch.value}`),
          ...keywords.map((branch) => branch.keyword),
        ],
      })
      for (const branch of exact) collectVariants(branch.body, out)
      for (const branch of keywords) collectVariants(branch.body, out)
    } else if (node.kind === 'select') {
      const options = orderedOptions(node.branches)
      out.push({
        arg: node.name,
        kind: 'select',
        matches: options.map((branch) => branch.option),
      })
      for (const branch of options) collectVariants(branch.body, out)
    } else if (node.kind === 'markup') {
      collectVariants(node.children, out)
    }
  }
}

function orderedExact(branches: readonly ExactBranch[]): readonly ExactBranch[] {
  return [...branches].sort((a, b) => a.value - b.value)
}

function orderedKeywords(branches: readonly PluralBranch[]): readonly PluralBranch[] {
  return [...branches].sort((a, b) => cldrRank(a.keyword) - cldrRank(b.keyword))
}

function cldrRank(keyword: string): number {
  const rank = CLDR_ORDER.indexOf(keyword)
  return rank === -1 ? CLDR_ORDER.length : rank
}

function orderedOptions(branches: readonly SelectBranch[]): readonly SelectBranch[] {
  return [
    ...branches.filter((branch) => branch.option !== 'other'),
    ...branches.filter((branch) => branch.option === 'other'),
  ]
}

function tagSet(tags: readonly string[]): readonly string[] {
  return [...new Set(tags)].sort(compareCodepoint)
}

function translationsOf(origins: readonly LocaleOrigin[]): readonly RecordTranslation[] {
  return [...origins]
    .sort((a, b) => compareCodepoint(a.locale, b.locale))
    .map(({ locale, origin }) => ({
      locale,
      status: origin.status,
      from: origin.status === 'translated' ? null : origin.from,
      reason: origin.status === 'fallback' ? origin.reason : null,
    }))
}

function usageOf(sites: readonly UsageSite[]): readonly RecordUsage[] {
  const unique = new Map<string, RecordUsage>()
  for (const site of sites) {
    unique.set(JSON.stringify([site.file, site.scope]), { file: site.file, scope: site.scope })
  }
  return [...unique.values()].sort(
    (a, b) => compareCodepoint(a.file, b.file) || compareScope(a.scope, b.scope),
  )
}

function compareScope(a: string | null, b: string | null): number {
  if (a === b) return 0
  if (a === null) return -1
  if (b === null) return 1
  return compareCodepoint(a, b)
}

function missingDescription(message: Message, program: Program): Diagnostic {
  const located = message.spans.find((entry) => entry.locale === program.sourceLocale)
  const shape =
    message.args.length > 0
      ? `takes ${message.args.map((arg) => arg.name).join(', ')}`
      : 'carries markup'
  return diag('missing-description', {
    message: `${message.key} ${shape} and has no description.
A translator receives the string with nothing that says what it holds or where it appears.`,
    hint: descriptionHint(message.key, program),
    key: message.key,
    file: located?.file,
    span: located?.span,
  })
}

function descriptionHint(key: string, program: Program): string {
  const meta = program.config.meta
  if (meta === false) {
    return 'set meta in loclizr.config.ts to switch the description sidecar on.'
  }
  const path = meta.replaceAll('{sourceLocale}', program.sourceLocale)
  return `add a description in ${path}:\n       ${JSON.stringify(key)}: { "description": "..." }`
}
