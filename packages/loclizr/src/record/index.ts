import { diag } from '../diagnostics'
import type {
  Arg,
  ArgType,
  ContextRecord,
  Diagnostic,
  ExactBranch,
  LocaleOrigin,
  Message,
  MessageUsage,
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
const UNKNOWN_RANK = CLDR_ORDER.length
const OTHER_RANK = CLDR_ORDER.length + 1

const RECORD_ARG_TYPES: Readonly<Record<ArgType['kind'], RecordArgType>> = {
  stringish: 'text',
  number: 'number',
  date: 'date',
  select: 'select',
  markup: 'markup',
}

export function buildRecord(program: Program): ContextRecord {
  const sites = sitesById(program.usages)
  return {
    schema: 1,
    sourceLocale: program.sourceLocale,
    locales: [...program.locales].sort(compareCodepoint),
    messages: byKey(program.messages).map((message) =>
      recordMessage(message, program.sourceLocale, sites.get(message.id) ?? []),
    ),
  }
}

// JSON.stringify leaves these raw, and in a reviewed diff a bidi control from a
// file name or source string reorders the text a reviewer reads (Trojan Source).
// They can only occur inside string literals, so escaping them keeps the JSON
// equal to the record.
const DISPLAY_HOSTILE = /[\u202a-\u202e\u2066-\u2069\u2028\u2029]/g

export function serializeRecord(record: ContextRecord): string {
  const json = JSON.stringify(record, null, 2).replace(
    DISPLAY_HOSTILE,
    (char) => `\\u${char.charCodeAt(0).toString(16)}`,
  )
  return `${json}\n`
}

export function checkDescriptions(program: Program): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  for (const message of byKey(program.messages)) {
    diagnostics.push(...orphanNotes(message, program))
    if (message.description !== null && message.description.trim() !== '') continue
    if (message.args.length === 0 && message.markupTags.length === 0) continue
    diagnostics.push(missingDescription(message, program))
  }
  return diagnostics
}

function byKey(messages: readonly Message[]): readonly Message[] {
  return [...messages].sort((a, b) => compareCodepoint(a.key, b.key))
}

// Nothing promises one usage entry per message id, and every site a scan found
// has to reach the record before the file-and-scope dedup runs.
function sitesById(usages: readonly MessageUsage[]): ReadonlyMap<string, readonly UsageSite[]> {
  const collected = new Map<string, UsageSite[]>()
  for (const usage of usages) {
    const held = collected.get(usage.id)
    if (held === undefined) collected.set(usage.id, [...usage.sites])
    else held.push(...usage.sites)
  }
  return collected
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

// The sidecar is hand written, so a note can arrive NFD while every argument name
// is NFC, and two spellings can land on one argument. Which note survives may not
// depend on where the two sit in `Message.placeholders`, whose order carries no
// meaning and which the determinism replay reverses. The spelling that matches
// the argument's own NFC name wins, then the lower code point.
function noteIndex(placeholders: readonly PlaceholderNote[]): ReadonlyMap<string, string> {
  const winners = new Map<string, PlaceholderNote>()
  for (const entry of placeholders) {
    const name = entry.name.normalize('NFC')
    const held = winners.get(name)
    if (held === undefined || compareNotes(entry, held, name) < 0) winners.set(name, entry)
  }
  return new Map([...winners].map(([name, entry]) => [name, entry.note]))
}

function compareNotes(a: PlaceholderNote, b: PlaceholderNote, name: string): number {
  return (
    Number(b.name === name) - Number(a.name === name) ||
    compareCodepoint(a.name, b.name) ||
    compareCodepoint(a.note, b.note)
  )
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

// A keyword the catalog invented sits between `many` and `other`, which is where
// the canonical printed form puts it, so `matches` and `source` list one order.
function cldrRank(keyword: string): number {
  if (keyword === 'other') return OTHER_RANK
  const rank = CLDR_ORDER.indexOf(keyword)
  return rank === -1 ? UNKNOWN_RANK : rank
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
  return diag('missing-description', {
    message: `${message.key} ${shapeOf(message)} and has no description.
A translator receives the string with nothing that says what it holds or where it appears.`,
    hint: descriptionHint(message.key, program),
    key: message.key,
    file: located?.file,
    span: located?.span,
  })
}

// The record attaches a note by argument name and drops the rest, so a renamed
// argument or a typo in the sidecar would otherwise lose the note unseen.
function orphanNotes(message: Message, program: Program): readonly Diagnostic[] {
  const names = new Set(message.args.map((arg) => arg.name.normalize('NFC')))
  const meta = program.config.meta
  const file = meta === false ? undefined : meta.replaceAll('{sourceLocale}', program.sourceLocale)
  return message.placeholders
    .filter((entry) => !names.has(entry.name.normalize('NFC')))
    .map((entry) => entry.name)
    .sort(compareCodepoint)
    .map((name) =>
      diag('meta-placeholder-orphan', {
        message: `The placeholder note ${JSON.stringify(name)} on ${message.key} names no argument: ${message.key} ${message.args.length === 0 ? 'takes no arguments' : shapeOf(message)}.
The note is dropped, so a translator never sees it.`,
        hint: `rename ${JSON.stringify(name)} to the argument it describes, or delete it.`,
        key: message.key,
        file,
      }),
    )
}

// A tag name is an argument of kind markup, so a tagged message always takes one.
// The verb is what separates a tag from a value the translator has to place.
function shapeOf(message: Message): string {
  const names = message.args.map((arg) => arg.name)
  if (message.args.every((arg) => arg.type.kind === 'markup')) {
    return `carries markup ${tagSet(names).join(', ')}`
  }
  return `takes ${names.join(', ')}`
}

function descriptionHint(key: string, program: Program): string {
  const meta = program.config.meta
  if (meta === false) {
    return 'set meta in loclizr.config.ts to switch the description sidecar on.'
  }
  const path = meta.replaceAll('{sourceLocale}', program.sourceLocale)
  return `add a description in ${path}:\n       ${JSON.stringify(key)}: { "description": "..." }`
}
