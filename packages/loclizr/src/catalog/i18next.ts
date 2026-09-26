import { diag } from '../diagnostics'
import type { Diagnostic, RawEntry, Span } from '../types'
import { escapeIcuLiteral, requiredCategories } from '../util'

export interface ToIcuContext {
  readonly key: string
  readonly locale: string
  readonly file: string
  readonly span: Span
  readonly markup: 'literal' | 'tags'
}

export interface ToIcuResult {
  readonly icu: string
  readonly diagnostics: readonly Diagnostic[]
}

export interface FoldResult {
  readonly entries: readonly RawEntry[]
  readonly diagnostics: readonly Diagnostic[]
}

export interface FormatVerdict {
  readonly format: 'icu' | 'i18next'
  readonly because: string | null
}

const CLDR_CATEGORIES: readonly string[] = ['zero', 'one', 'two', 'few', 'many', 'other']
const CATEGORIES = CLDR_CATEGORIES.join('|')
const ORDINAL_SUFFIX = new RegExp(`^(.+)_ordinal_(${CATEGORIES})$`)
const PLAIN_SUFFIX = new RegExp(`^(.+)_(${CATEGORIES})$`)
const PLURAL_SUFFIX = '_plural'
const TAG_SHAPED = /<\/?[A-Za-z][^<>]*>/
const TYPED_ARGUMENT = /^\{\s*([^\s{},]+)\s*,\s*(selectordinal|plural|select|number|date|time)\b/

interface SuffixMatch {
  readonly base: string
  readonly category: string
  readonly ordinal: boolean
}

interface PluralMember {
  readonly category: string
  readonly index: number
}

interface Bucket {
  readonly base: string
  readonly ordinal: boolean
  readonly members: PluralMember[]
}

interface PluralGroup {
  readonly key: string
  readonly ordinal: boolean
  readonly members: readonly PluralMember[]
  readonly first: number
}

interface Run {
  readonly text: string
  readonly placeholder: boolean
}

export function classifyFormat(entries: readonly RawEntry[]): FormatVerdict {
  // Classification is locale free by signature, so a lone `_other` never
  // decides the format even where the locale would fold it.
  const folded = foldedIndices(pluralGroups(entries.map((entry) => entry.key), null))
  for (const [index, entry] of entries.entries()) {
    if (hasPlaceholder(entry.value)) return { format: 'i18next', because: entry.value }
    if (folded.has(index)) return { format: 'i18next', because: entry.key }
  }
  return { format: 'icu', because: null }
}

// A `{{` is an i18next placeholder unless it sits inside a typed ICU argument,
// the one place valid ICU writes one: a branch body opening straight onto an
// argument, `one {{count} Artikel}`. Everything else holding a `{{` is prose
// around a stray brace, which no ICU value can be, so `a { color: {{c}} }`
// classifies i18next and its placeholder is converted rather than lost.
function hasPlaceholder(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== '{') continue
    if (value[index + 1] === '{') return true
    if (TYPED_ARGUMENT.test(value.slice(index))) index = endOfRun(value, index)
  }
  return false
}

function endOfRun(value: string, open: number): number {
  let depth = 0
  for (let index = open; index < value.length; index += 1) {
    const char = value[index]
    if (char === '{') depth += 1
    if (char !== '}') continue
    depth -= 1
    if (depth === 0) return index
  }
  return value.length
}

export function toIcu(value: string, context: ToIcuContext): ToIcuResult {
  const diagnostics: Diagnostic[] = []
  if (value.includes('$t(')) {
    diagnostics.push(
      diag('i18next-nesting-unsupported', {
        message: 'This value nests another key with $t(), which ICU cannot express, so the call renders as literal text.',
        hint: 'inline the nested text here, or split the sentence into two messages.',
        ...where(context),
      }),
    )
  }
  let icu = ''
  let escapedTag = false
  for (const run of runsOf(value)) {
    if (!run.placeholder) {
      if (context.markup === 'literal' && TAG_SHAPED.test(run.text)) escapedTag = true
      icu += escapeIcuLiteral(run.text, { markup: context.markup })
      continue
    }
    const inner = run.text.trim()
    const comma = inner.indexOf(',')
    if (comma < 0) {
      icu += `{${inner}}`
      continue
    }
    const name = inner.slice(0, comma).trim()
    diagnostics.push(
      diag('i18next-format-unsupported', {
        message: `The placeholder {{${inner}}} carries an i18next formatter, which has no ICU equivalent. It renders as the raw value.`,
        hint: `name the style in formats.number or formats.dateTime, convert this file to ICU, and write {${name}, number, yourStyle}.`,
        ...where(context),
      }),
    )
    icu += `{${name}}`
  }
  if (escapedTag) {
    diagnostics.push(
      diag('i18next-markup-literal', {
        message: 'Tag-shaped text in this value was escaped to literal text, which is what i18next itself rendered.',
        hint: "set i18nextMarkup: 'tags' to lower these tags to markup arguments instead.",
        ...where(context),
      }),
    )
  }
  return { icu, diagnostics }
}

export function foldPluralSuffixes(
  entries: readonly RawEntry[],
  locale: string,
  file: string,
): FoldResult {
  const diagnostics: Diagnostic[] = []
  const groups = pluralGroups(entries.map((entry) => entry.key), locale)
  const startsGroup = new Map(groups.map((group) => [group.first, group]))
  const consumed = foldedIndices(groups)
  const foldedKeys = new Set(groups.map((group) => group.key))

  const folded: RawEntry[] = []
  for (const [index, entry] of entries.entries()) {
    const group = startsGroup.get(index)
    if (group !== undefined) {
      folded.push({ key: group.key, value: branchesOf(group, entries, locale), span: entry.span })
      continue
    }
    if (consumed.has(index)) continue
    if (foldedKeys.has(entry.key)) {
      diagnostics.push(
        diag('duplicate-key', {
          message: `"${entry.key}" is written directly and is also what the plural suffixes of "${entry.key}_*" fold to. The folded plural wins.`,
          hint: 'delete the bare key, or rename it: i18next reached it only for a call with no count.',
          file,
          locale,
          key: entry.key,
          span: entry.span,
        }),
      )
      continue
    }
    folded.push(entry)
  }

  const present = new Set(folded.map((entry) => entry.key))
  for (const entry of folded) {
    if (foldedKeys.has(entry.key)) continue
    diagnostics.push(...orphanOf(entry, present, locale, file))
  }
  diagnostics.push(...contextsOf(folded, locale, file))
  return { entries: folded, diagnostics }
}

// A single-brace run shaped like a typed ICU argument, which a file read as
// i18next renders as literal text. Returns the run's head, for LZ1020.
export function findTypedArgument(value: string): string | null {
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== '{') continue
    if (value[index + 1] === '{') {
      index += 1
      continue
    }
    const found = TYPED_ARGUMENT.exec(value.slice(index))
    if (found !== null) return found[0]
  }
  return null
}

function orphanOf(
  entry: RawEntry,
  present: ReadonlySet<string>,
  locale: string,
  file: string,
): readonly Diagnostic[] {
  const base = entry.key.endsWith(PLURAL_SUFFIX)
    ? entry.key.slice(0, -PLURAL_SUFFIX.length)
    : null
  if (base !== null && present.has(base)) {
    return [
      diag('plural-suffix-orphan', {
        message: `"${entry.key}" is the i18next JSON v3 plural of "${base}". Both stay ordinary keys, each rendering one grammatical number.`,
        hint: `run i18next's JSON v3 to v4 converter over this catalog, so ${base}_one and ${base}_other fold into one plural message.`,
        file,
        locale,
        key: entry.key,
        span: entry.span,
      }),
    ]
  }
  const suffix = suffixOf(entry.key)
  // A lone `_other` is what i18next selects for every count, so nothing is lost
  // and nothing folds; every other category with no `_other` sibling is dead.
  if (suffix === null || suffix.category === 'other') return []
  const sibling = suffix.ordinal ? `${suffix.base}_ordinal_other` : `${suffix.base}_other`
  return [
    diag('plural-suffix-orphan', {
      message: `"${entry.key}" carries a plural suffix with no "${sibling}" sibling, so it stays an ordinary key that i18next would never have selected either.`,
      hint: `add ${sibling} to fold the group, or rename the key if "_${suffix.category}" was never a plural.`,
      file,
      locale,
      key: entry.key,
      span: entry.span,
    }),
  ]
}

function contextsOf(
  entries: readonly RawEntry[],
  locale: string,
  file: string,
): readonly Diagnostic[] {
  const byKey = new Map(entries.map((entry) => [entry.key, entry]))
  const bases = new Map<string, RawEntry[]>()
  for (const entry of entries) {
    const cut = entry.key.lastIndexOf('_')
    if (cut <= 0) continue
    const base = entry.key.slice(0, cut)
    const suffix = entry.key.slice(cut + 1)
    // `_ordinal` is i18next's own infix on a folded key, never a context, and
    // `_plural` and the CLDR categories are the two plural shapes above.
    if (suffix === '' || suffix === 'plural' || suffix === 'ordinal') continue
    if (CLDR_CATEGORIES.includes(suffix)) continue
    if (!byKey.has(base)) continue
    const found = bases.get(base)
    if (found === undefined) bases.set(base, [entry])
    else found.push(entry)
  }
  const diagnostics: Diagnostic[] = []
  for (const [base, members] of bases) {
    const suffixes = members.map((member) => member.key.slice(base.length + 1))
    const rewrite = suffixes.map((suffix) => `${suffix} {...}`).join(' ')
    diagnostics.push(
      diag('i18next-context-detected', {
        message: `"${base}" carries ${members.length === 1 ? 'a context suffix' : `${members.length} context suffixes`}. i18next selected these with t('${base}', { context }), and after import nothing selects them.`,
        hint: `convert this file to ICU first, then replace them with one message:\n  "${base}": "{context, select, ${rewrite} other {...}}"`,
        file,
        locale,
        key: base,
        span: byKey.get(base)?.span,
        related: members.map((member) => ({
          file,
          locale,
          key: member.key,
          span: member.span,
          message: 'selected by nothing after import',
        })),
      }),
    )
  }
  return diagnostics
}

// `locale` decides whether a lone `X_other` is a group; a caller with no locale
// in hand passes null and never folds one.
function pluralGroups(keys: readonly string[], locale: string | null): readonly PluralGroup[] {
  const buckets = new Map<string, Bucket>()
  for (const [index, key] of keys.entries()) {
    const suffix = suffixOf(key)
    if (suffix === null) continue
    const id = `${suffix.ordinal ? 'o' : 'c'}\u0000${suffix.base}`
    const bucket = buckets.get(id) ?? { base: suffix.base, ordinal: suffix.ordinal, members: [] }
    bucket.members.push({ category: suffix.category, index })
    buckets.set(id, bucket)
  }
  const complete = [...buckets.values()].filter((bucket) => isGroup(bucket, locale))
  const cardinalBases = new Set(
    complete.filter((bucket) => !bucket.ordinal).map((bucket) => bucket.base),
  )
  return complete.map((bucket) => ({
    // i18next picks between an ordinal and a cardinal group with a call-site
    // option the compiler does not have, so both keys survive where both exist.
    key: bucket.ordinal && cardinalBases.has(bucket.base) ? `${bucket.base}_ordinal` : bucket.base,
    ordinal: bucket.ordinal,
    members: bucket.members,
    first: Math.min(...bucket.members.map((member) => member.index)),
  }))
}

// `X_other` plus one CLDR sibling is a group. Where the locale has a single
// category, `X_other` can never have a sibling and is already the whole plural,
// so it folds alone: ja, zh and ko cardinal, and most of Europe's ordinals.
// Leaving it unfolded would make the key of a fully translated locale disagree
// with the source key and report the message missing and extra at once.
function isGroup(bucket: Bucket, locale: string | null): boolean {
  if (!bucket.members.some((member) => member.category === 'other')) return false
  if (bucket.members.length > 1) return true
  return locale !== null && requiredCategories(locale, bucket.ordinal).length === 1
}

function foldedIndices(groups: readonly PluralGroup[]): ReadonlySet<number> {
  const indices = new Set<number>()
  for (const group of groups) {
    for (const member of group.members) indices.add(member.index)
  }
  return indices
}

function branchesOf(group: PluralGroup, entries: readonly RawEntry[], locale: string): string {
  const bodyOf = new Map(
    group.members.map((member) => [member.category, quotePounds(entries[member.index]?.value ?? '')]),
  )
  // A `zero` branch German can never select would silently stop rendering,
  // while `=0` in Latvian would drop 10, 20 and 11 through 19 into `other`. The
  // group's own kind decides it, because Latvian ordinal has no `zero` either
  // and a keyword branch nothing can select is dead whichever kind it is on.
  const keywordZero = requiredCategories(locale, group.ordinal).includes('zero')
  const zero = bodyOf.get('zero')
  const branches: string[] = []
  if (zero !== undefined && !keywordZero) branches.push(`=0 {${zero}}`)
  for (const category of CLDR_CATEGORIES) {
    if (category === 'zero' && !keywordZero) continue
    const body = bodyOf.get(category)
    if (body !== undefined) branches.push(`${category} {${body}}`)
  }
  return `{count, ${group.ordinal ? 'selectordinal' : 'plural'}, ${branches.join(' ')}}`
}

function suffixOf(key: string): SuffixMatch | null {
  const ordinal = ORDINAL_SUFFIX.exec(key)
  if (ordinal !== null) {
    const [, base = '', category = ''] = ordinal
    return { base, category, ordinal: true }
  }
  const plain = PLAIN_SUFFIX.exec(key)
  if (plain === null) return null
  const [, base = '', category = ''] = plain
  return { base, category, ordinal: false }
}

function runsOf(value: string): readonly Run[] {
  const runs: Run[] = []
  let literalStart = 0
  let cursor = 0
  for (;;) {
    const open = value.indexOf('{{', cursor)
    if (open < 0) break
    const close = value.indexOf('}}', open + 2)
    if (close < 0) break
    const inner = value.slice(open + 2, close)
    // i18next interpolates a named run only, so `{{}}` and `{{{name}}` are text
    // it rendered as written. They stay inside the literal run around them, and
    // the run is not cut here: one escape over the whole stretch, rather than a
    // quote closed and reopened between two braces.
    if (!isPlaceholderName(inner)) {
      cursor = close + 2
      continue
    }
    if (open > literalStart) {
      runs.push({ text: value.slice(literalStart, open), placeholder: false })
    }
    runs.push({ text: inner, placeholder: true })
    literalStart = close + 2
    cursor = literalStart
  }
  if (literalStart < value.length) {
    runs.push({ text: value.slice(literalStart), placeholder: false })
  }
  return runs
}

function isPlaceholderName(inner: string): boolean {
  return inner.trim() !== '' && !inner.includes('{') && !inner.includes('}')
}

// Re-quotes every `#` that a plural body would otherwise read as the count,
// merging with the quoted runs already around it so no two quotes collide. A
// bare `#` is literal outside a plural body, so toIcu leaves it alone and this
// is the only place it lands inside one.
function quotePounds(body: string): string {
  const chars: { readonly char: string; readonly quoted: boolean }[] = []
  let inQuote = false
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index] ?? ''
    const next = body[index + 1]
    // A literal apostrophe joins the quoted run before it. Closing and
    // reopening around it emits four apostrophes, which the parser reads as two
    // escaped ones inside one run, so the branch renders an apostrophe the
    // value never had.
    const joins = chars[chars.length - 1]?.quoted === true
    if (char === "'" && next === "'") {
      chars.push({ char, quoted: inQuote || joins })
      index += 1
      continue
    }
    if (char === "'" && inQuote) {
      inQuote = false
      continue
    }
    if (char === "'" && (next === '{' || next === '}' || next === '<')) {
      inQuote = true
      continue
    }
    chars.push({ char, quoted: inQuote || char === '#' || (char === "'" && joins) })
  }
  let out = ''
  let open = false
  for (const { char, quoted } of chars) {
    if (quoted !== open) {
      out += "'"
      open = quoted
    }
    out += char === "'" ? "''" : char
  }
  return open ? `${out}'` : out
}

function where(context: ToIcuContext): {
  readonly file: string
  readonly locale: string
  readonly key: string
  readonly span: Span
} {
  return { file: context.file, locale: context.locale, key: context.key, span: context.span }
}
