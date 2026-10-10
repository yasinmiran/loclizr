import {
  TYPE,
  type DateElement,
  type Location as IcuLocation,
  type MessageFormatElement,
  type NumberElement,
  type PluralElement,
  type PluralOrSelectOption,
  type SelectElement,
  type Skeleton,
  type TimeElement,
} from '@formatjs/icu-messageformat-parser'
import type {
  Arg,
  ArgType,
  Diagnostic,
  ExactBranch,
  FormatsConfig,
  IntlOptions,
  Node,
  NumberFormatSpec,
  PluralBranch,
  RuleName,
  SelectBranch,
  Span,
} from '../types'
import { diag } from '../diagnostics'
import { compareCodepoint } from '../util'
import { categoryRank, isCldrCategory } from './categories'
import {
  asksForUnexpressibleHour,
  dividesNoUnit,
  parseIcu,
  probeSkeleton,
  rangeOf,
  skeletonOptions,
  skeletonToken,
  type ParseFailure,
  type Range,
  type SkeletonForm,
} from './parse'
import { printIcu } from './print'
import {
  BARE_DATE_OPTIONS,
  BARE_NUMBER_OPTIONS,
  BARE_TIME_OPTIONS,
  NAMED_DATE_STYLES,
  NAMED_NUMBER_STYLES,
  NAMED_TIME_STYLES,
} from './styles'
import { unify } from './unify'

const ARG_NAME = /^[\p{ID_Start}$_][\p{ID_Continue}$]*$/u

export interface LowerContext {
  readonly key: string
  readonly locale: string
  readonly file: string
  readonly span: Span
  // The format the entry's own file was read as, never re-derived here: a
  // converted value cannot carry a character position and says so.
  readonly catalogFormat: 'i18next' | 'icu'
  readonly formats: FormatsConfig
}

export interface LowerResult {
  readonly nodes: readonly Node[]
  readonly args: readonly Arg[]
  readonly markupTags: readonly string[]
  readonly kind: 'text' | 'markup'
  readonly normalized: string
  readonly diagnostics: readonly Diagnostic[]
}

export function lower(icu: string, context: LowerContext): LowerResult {
  const outcome = parseIcu(icu)
  const state: State = {
    icu,
    context,
    skeletonsResolved: outcome.ok && outcome.skeletonsResolved,
    diagnostics: [],
    args: [],
    positions: new Map(),
    named: new Set(),
    conflicted: new Set(),
    markupTags: new Set(),
  }
  for (const skeleton of outcome.rejected) {
    state.diagnostics.push(
      report(
        state,
        'icu-skeleton-invalid',
        skeleton.range,
        rejectedText(skeleton.token, skeleton.form),
      ),
    )
  }
  if (!outcome.ok) {
    return {
      nodes: [],
      args: [],
      markupTags: [],
      kind: 'text',
      normalized: '',
      diagnostics: [parseDiagnostic(state, outcome), ...state.diagnostics],
    }
  }
  const nodes = visit(state, outcome.elements, TOP_LEVEL)
  const markupTags = [...state.markupTags].sort(compareCodepoint)
  return {
    nodes,
    args: state.args,
    markupTags,
    kind: markupTags.length === 0 ? 'text' : 'markup',
    normalized: printIcu(nodes),
    diagnostics: state.diagnostics,
  }
}

interface State {
  readonly icu: string
  readonly context: LowerContext
  readonly skeletonsResolved: boolean
  readonly diagnostics: Diagnostic[]
  readonly args: Arg[]
  readonly positions: Map<string, number>
  readonly named: Set<string>
  readonly conflicted: Set<string>
  readonly markupTags: Set<string>
}

// `plural` is the nearest enclosing plural selector and stays set through a
// select, because a `#` the parser demoted to literal text is still the mistake
// LZ2008 reports. `select` says a select sits between that plural and the text,
// which is what the hint has to name.
interface Scope {
  readonly plural: string | null
  readonly select: boolean
}

const TOP_LEVEL: Scope = { plural: null, select: false }

function visit(
  state: State,
  elements: readonly MessageFormatElement[],
  scope: Scope,
): readonly Node[] {
  const nodes: Node[] = []
  for (const element of elements) append(nodes, lowerElement(state, element, scope))
  return nodes
}

function append(nodes: Node[], node: Node): void {
  const last = nodes[nodes.length - 1]
  if (node.kind === 'text' && last !== undefined && last.kind === 'text') {
    nodes[nodes.length - 1] = { kind: 'text', value: last.value + node.value }
    return
  }
  nodes.push(node)
}

function lowerElement(state: State, element: MessageFormatElement, scope: Scope): Node {
  switch (element.type) {
    case TYPE.literal: {
      if (scope.plural !== null && element.value.includes('#')) {
        state.diagnostics.push(
          report(state, 'pound-literal', rangeOf(element.location), {
            message: 'A literal "#" inside a plural body renders as the character, not the count.',
            hint: poundHint(state.context.catalogFormat, scope.plural, scope.select),
          }),
        )
      }
      return { kind: 'text', value: element.value }
    }
    case TYPE.argument:
      return { kind: 'arg', name: register(state, element.value, STRINGISH, element.location) }
    case TYPE.number: {
      const name = register(state, element.value, NUMBER, element.location)
      const style = resolveNumberStyle(state, element)
      const format: NumberFormatSpec =
        style.multiplier === undefined
          ? { kind: 'number', options: style.options }
          : { kind: 'number', options: style.options, multiplier: style.multiplier }
      return { kind: 'number', name, style: style.style, format }
    }
    case TYPE.date:
      return lowerDateTime(state, element, 'date')
    case TYPE.time:
      return lowerDateTime(state, element, 'time')
    case TYPE.select:
      return lowerSelect(state, element, scope)
    case TYPE.plural:
      return lowerPlural(state, element)
    case TYPE.pound:
      return { kind: 'pound' }
    case TYPE.tag: {
      const name = register(state, element.value, MARKUP, element.location)
      state.markupTags.add(name)
      return { kind: 'markup', name, children: visit(state, element.children, scope) }
    }
  }
}

function poundHint(format: 'i18next' | 'icu', plural: string, select: boolean): string {
  if (format === 'i18next') {
    return `In an i18next file # is always the character. If you meant the count, write {{${plural}}}.`
  }
  if (select) return `Move the # out of the nested select, or write {${plural}, number}.`
  return `Write # without the quotes, or {${plural}, number}, to print the count.`
}

function lowerDateTime(
  state: State,
  element: DateElement | TimeElement,
  form: 'date' | 'time',
): Node {
  const name = register(state, element.value, DATE, element.location)
  const style = resolveDateTimeStyle(state, element, form)
  const zone = state.context.formats.timeZone
  // The project zone goes first, so a custom named style that pins its own zone
  // keeps it and a per-message zone stays reachable.
  const options =
    zone === null ? style.options : Object.freeze({ timeZone: zone, ...style.options })
  return { kind: 'dateTime', name, form, style: style.style, format: { kind: 'dateTime', options } }
}

function lowerSelect(state: State, element: SelectElement, scope: Scope): Node {
  const ordered = orderSelect(element.options)
  const options = ordered.filter((entry) => entry.option !== 'other').map((entry) => entry.option)
  const name = register(state, element.value, { kind: 'select', options }, element.location)
  // Options stay as written because the runtime matches them verbatim; only the
  // collision is reported, as the parser reports a byte-identical repeat.
  const seen = new Set<string>()
  for (const entry of ordered) {
    const normalized = entry.option.normalize('NFC')
    if (seen.has(normalized)) {
      state.diagnostics.push(
        diag('icu-syntax', {
          message: `The select {${name}} has two options that are both "${normalized}" under NFC.`,
          hint: 'Delete one of the two branches. Their options differ only in how an accented letter is encoded.',
          file: state.context.file,
          locale: state.context.locale,
          key: state.context.key,
          span: spanFor(state, selectorRange(state.icu, entry)),
        }),
      )
    }
    seen.add(normalized)
  }
  const branches: SelectBranch[] = ordered.map((entry) => ({
    option: entry.option,
    body: visit(state, entry.body, { plural: scope.plural, select: true }),
  }))
  return { kind: 'select', name, branches }
}

// Branches are ordered before their bodies are visited, so a name first seen in
// a later branch lands in `args` where the canonical form puts it. Otherwise the
// printed source and the argument order disagree for the same message.
function lowerPlural(state: State, element: PluralElement): Node {
  const name = register(state, element.value, NUMBER, element.location)
  const scope: Scope = { plural: name, select: false }
  const exact: Pending[] = []
  const keywords: Pending[] = []
  for (const [selector, option] of Object.entries(element.options)) {
    const pending: Pending = {
      selector,
      body: option.value,
      at: option.location?.start.offset ?? 0,
      location: option.location ?? element.location,
    }
    if (selector.startsWith('=')) exact.push(pending)
    else keywords.push(pending)
  }
  exact.sort((a, b) => exactValue(a.selector) - exactValue(b.selector) || a.at - b.at)
  keywords.sort((a, b) => categoryRank(a.selector) - categoryRank(b.selector) || a.at - b.at)

  // `=0` and `=00` differ as text and agree as numbers, so they are one branch at
  // run time. Printing both would emit the same selector twice, which no ICU
  // implementation parses, so the later one is dropped.
  const seen = new Set<number>()
  const exactBranches: ExactBranch[] = []
  for (const pending of exact) {
    const value = exactValue(pending.selector)
    if (seen.has(value)) continue
    seen.add(value)
    exactBranches.push({ value, body: visit(state, pending.body, scope) })
  }

  const keywordBranches: PluralBranch[] = keywords.map((pending) => {
    if (!isCldrCategory(pending.selector)) {
      state.diagnostics.push(
        report(state, 'plural-category-unknown', rangeOf(pending.location), {
          message: `"${pending.selector}" is not a CLDR plural category.`,
          hint: 'Use zero, one, two, few, many or other, or an exact branch such as =0.',
        }),
      )
    }
    return { keyword: pending.selector, body: visit(state, pending.body, scope) }
  })
  return {
    kind: 'plural',
    name,
    ordinal: element.pluralType === 'ordinal',
    offset: element.offset || 0,
    exact: exactBranches,
    branches: keywordBranches,
  }
}

function exactValue(selector: string): number {
  return Number.parseInt(selector.slice(1), 10) || 0
}

interface Pending {
  readonly selector: string
  readonly body: readonly MessageFormatElement[]
  readonly at: number
  readonly location: IcuLocation | undefined
}

interface OrderedOption {
  readonly option: string
  readonly body: readonly MessageFormatElement[]
  readonly location: IcuLocation | undefined
}

// The parser hands back a plain object, so a catalog written `1 {..} 0 {..}`
// arrives with its integer-like keys reordered. The recorded positions are the
// only surviving trace of the author's order.
function orderSelect(
  options: Readonly<Record<string, PluralOrSelectOption>>,
): readonly OrderedOption[] {
  return Object.entries(options)
    .map(([option, value]) => ({
      option,
      body: value.value,
      at: value.location?.start.offset ?? 0,
      location: value.location,
    }))
    .sort((a, b) => Number(a.option === 'other') - Number(b.option === 'other') || a.at - b.at)
    .map((entry) => ({ option: entry.option, body: entry.body, location: entry.location }))
}

// The parser records where a branch body starts but not its selector, which is
// the option text just before that body's `{` and any whitespace.
function selectorRange(icu: string, entry: OrderedOption): Range | null {
  if (entry.location === undefined) return null
  let end = entry.location.start.offset
  while (end > 0 && /\s/u.test(icu[end - 1] ?? '')) end -= 1
  return { start: end - entry.option.length, end }
}

const STRINGISH: ArgType = { kind: 'stringish' }
const NUMBER: ArgType = { kind: 'number' }
const DATE: ArgType = { kind: 'date' }
const MARKUP: ArgType = { kind: 'markup' }

function register(
  state: State,
  raw: string,
  type: ArgType,
  location: IcuLocation | undefined,
): string {
  const name = raw.normalize('NFC')
  if (!state.named.has(name)) {
    state.named.add(name)
    if (!ARG_NAME.test(name) || name === '__proto__') {
      state.diagnostics.push(
        report(state, 'arg-name-invalid', rangeOf(location), {
          message: `"${name}" cannot be used as an argument name.`,
          hint: 'An argument name must be a JavaScript identifier and must not be __proto__.',
        }),
      )
    }
  }
  const position = state.positions.get(name)
  if (position === undefined) {
    state.positions.set(name, state.args.length)
    state.args.push({ name, type })
    return name
  }
  const existing = state.args[position]
  if (existing === undefined) return name
  const unified = unify(existing.type, type)
  if (unified === null) {
    if (!state.conflicted.has(name)) {
      state.conflicted.add(name)
      state.diagnostics.push(
        report(state, 'arg-type-conflict-local', rangeOf(location), {
          message: `"${name}" is used as ${kindLabel(existing.type)} and as ${kindLabel(type)} in one value.`,
          hint: 'Use one type for the argument, or split it into two arguments.',
        }),
      )
    }
    return name
  }
  state.args[position] = { name, type: unified }
  return name
}

// `stringish` is the compiler's word for it; the record and every user facing
// surface call that type text.
function kindLabel(type: ArgType): string {
  return type.kind === 'stringish' ? 'text' : type.kind
}

interface ResolvedStyle {
  readonly style: string | null
  readonly options: IntlOptions
  readonly multiplier?: number | undefined
}

function resolveNumberStyle(state: State, element: NumberElement): ResolvedStyle {
  const style = element.style
  if (style === null || style === undefined) return { style: null, options: BARE_NUMBER_OPTIONS }
  if (typeof style !== 'string') {
    return liftScale(resolveSkeleton(state, style, 'number', BARE_NUMBER_OPTIONS))
  }
  const named = lookupStyle(NAMED_NUMBER_STYLES, state.context.formats.number, style)
  if (named !== undefined) return { style, options: named }
  state.diagnostics.push(unknownStyle(state, rangeOf(element.location), style, 'number'))
  return { style, options: BARE_NUMBER_OPTIONS }
}

// ICU multiplies by a skeleton's scale before formatting and Intl has no such
// option, so it would be dropped silently. Intl's percent style already
// multiplies by 100, which ICU's percent unit does not, so `::percent
// scale/100` keeps rendering 0.25 as 25% with no multiplier at all.
function liftScale(resolved: ResolvedStyle): ResolvedStyle {
  const { scale, ...options } = resolved.options
  if (typeof scale !== 'number') return resolved
  const multiplier = options['style'] === 'percent' ? scale / 100 : scale
  const kept = Object.freeze(options)
  if (multiplier === 1) return { style: resolved.style, options: kept }
  return { style: resolved.style, options: kept, multiplier }
}

function resolveDateTimeStyle(
  state: State,
  element: DateElement | TimeElement,
  form: 'date' | 'time',
): ResolvedStyle {
  const bare = form === 'date' ? BARE_DATE_OPTIONS : BARE_TIME_OPTIONS
  const style = element.style
  if (style === null || style === undefined) return { style: null, options: bare }
  if (typeof style !== 'string') return resolveSkeleton(state, style, form, bare)
  const table = form === 'date' ? NAMED_DATE_STYLES : NAMED_TIME_STYLES
  const named = lookupStyle(table, state.context.formats.dateTime, style)
  if (named !== undefined) return { style, options: named }
  state.diagnostics.push(unknownStyle(state, rangeOf(element.location), style, 'dateTime'))
  return { style, options: bare }
}

// Both records are indexed with a token a translator typed, so a name that only
// exists on Object.prototype must miss rather than answer with a function.
function lookupStyle(
  builtIn: Readonly<Record<string, IntlOptions>>,
  configured: Readonly<Record<string, IntlOptions>>,
  style: string,
): IntlOptions | undefined {
  if (Object.hasOwn(builtIn, style)) return builtIn[style]
  if (Object.hasOwn(configured, style)) return configured[style]
  return undefined
}

function resolveSkeleton(
  state: State,
  skeleton: Skeleton,
  form: SkeletonForm,
  bare: IntlOptions,
): ResolvedStyle {
  const token = skeletonToken(state.icu, skeleton)
  const range = rangeOf(skeleton.location)
  const resolved = state.skeletonsResolved
    ? skeletonOptions(skeleton)
    : probeSkeleton(form, token)
  if (resolved === null) {
    state.diagnostics.push(report(state, 'icu-skeleton-invalid', range, rejectedText(token, form)))
    return { style: token, options: bare }
  }
  const problem = unusable(token, form, resolved)
  if (problem === null) return { style: token, options: resolved }
  state.diagnostics.push(report(state, 'icu-skeleton-invalid', range, problem))
  return { style: token, options: bare }
}

interface DiagnosticText {
  readonly message: string
  readonly hint: string
}

function rejectedText(token: string, form: SkeletonForm): DiagnosticText {
  if (form !== 'number' && asksForUnexpressibleHour(token)) {
    return {
      message: `The skeleton "${token}" asks for an hour Intl.DateTimeFormat has no option for.`,
      hint: `Write ::jm for the locale's hour with its day period, or ::Hm for a 24-hour clock. Falling back to the bare ${form} format.`,
    }
  }
  if (form === 'number' && dividesNoUnit(token)) {
    return {
      message: `The skeleton "${token}" has a per-measure-unit/ with no unit to divide.`,
      hint: 'Pair it with a unit, such as ::measure-unit/length-meter per-measure-unit/duration-second. Falling back to the bare number format.',
    }
  }
  return {
    message: `The parser rejected the skeleton "${token}".`,
    hint: `Falling back to the bare ${form} format. Fix the skeleton, or use a named style from formats.`,
  }
}

// A skeleton the tokenizer accepted can still be a stem nobody defined, which
// formats nothing, a currency with no code, which throws in the browser the
// first time the message renders, or a scale that is not a finite number,
// which would render every value as NaN or infinity.
function unusable(token: string, form: SkeletonForm, options: IntlOptions): DiagnosticText | null {
  if (options['style'] === 'currency' && options['currency'] === undefined) {
    return {
      message: `The skeleton "${token}" asks for a currency format with no currency code.`,
      hint: 'Write ::currency/USD, or define formats.number.currency in loclizr.config.ts.',
    }
  }
  const scale = options['scale']
  if (typeof scale === 'number' && !Number.isFinite(scale)) {
    return {
      message: `The skeleton "${token}" has a scale that is not a number.`,
      hint: 'Write the scale as a number, such as scale/1000.',
    }
  }
  if (Object.keys(options).length === 0) {
    return {
      message: `The skeleton "${token}" resolves to no format options.`,
      hint: `Check the stem spelling. Falling back to the bare ${form} format.`,
    }
  }
  return rejectedByIntl(token, form, options)
}

// The parser passes a unit or currency code through unchecked, and Intl throws a
// RangeError on every call for one it does not know. Validity does not depend on
// the locale, so the host default stands in for every catalog locale, and the
// engine's own error text stays out of the diagnostic so the output is the same
// on every Node version.
function rejectedByIntl(
  token: string,
  form: SkeletonForm,
  options: IntlOptions,
): DiagnosticText | null {
  try {
    if (form === 'number') new Intl.NumberFormat(undefined, options)
    else new Intl.DateTimeFormat(undefined, options)
    return null
  } catch {
    const constructor = form === 'number' ? 'Intl.NumberFormat' : 'Intl.DateTimeFormat'
    const fix =
      form === 'number'
        ? 'Use a unit or currency code Intl supports, such as ::unit/kilometer or ::currency/USD.'
        : 'Fix the skeleton, or use a named style from formats.'
    return {
      message: `${constructor} rejects the options the skeleton "${token}" resolves to.`,
      hint: `${fix} Falling back to the bare ${form} format.`,
    }
  }
}

function unknownStyle(
  state: State,
  range: Range | null,
  style: string,
  bucket: 'number' | 'dateTime',
): Diagnostic {
  const hint =
    style === 'currency'
      ? 'ICU carries no currency code. Define formats.number.currency, or write ::currency/USD.'
      : `Define formats.${bucket}.${style} in loclizr.config.ts, or use an ICU skeleton.`
  return report(state, 'icu-style-unknown', range, {
    message: `"${style}" is not a known ${bucket === 'number' ? 'number' : 'date or time'} style.`,
    hint,
  })
}

// The rules a lowered body can still carry, all of which leave the body usable.
type BodyRule = Extract<
  RuleName,
  | 'icu-style-unknown'
  | 'icu-skeleton-invalid'
  | 'plural-category-unknown'
  | 'arg-name-invalid'
  | 'pound-literal'
  | 'arg-type-conflict-local'
>

function report(
  state: State,
  rule: BodyRule,
  range: Range | null,
  fields: DiagnosticText,
): Diagnostic {
  return diag(rule, {
    message: fields.message,
    hint: fields.hint,
    file: state.context.file,
    locale: state.context.locale,
    key: state.context.key,
    span: spanFor(state, range),
  })
}

// The parser's whole message is an ErrorKind name: searchable, and useless to the
// person holding the catalog. LZ2001 keeps the name and carries the fix beside it.
const SYNTAX_FIXES: ReadonlyMap<string, string> = new Map([
  [
    'EXPECT_ARGUMENT_CLOSING_BRACE',
    'An argument was opened with { and never closed. Add the matching }.',
  ],
  [
    'MALFORMED_ARGUMENT',
    'An argument name takes letters, digits and _. Write {name} rather than {{name}}, and rename an argument carrying a dot, a dash or a $.',
  ],
  [
    'UNCLOSED_TAG',
    "Tag-shaped text lowers to markup here. Close the tag to make it a markup argument, or quote it as '<br>' to keep it literal text.",
  ],
  [
    'UNMATCHED_CLOSING_TAG',
    "A closing tag must name the tag it closes. Match the two names, or quote both runs as '<b>' to keep them literal text.",
  ],
  [
    'INVALID_TAG',
    'A markup tag takes no attributes and its name starts with a letter. Write <link>terms</link> and pass link at the call site, or wrap the run in apostrophes to keep it literal text.',
  ],
])

// What to look for rather than where to look: a span shifted by a JSON escape
// names the whole entry, so the hint cannot promise a character position.
const GENERIC_SYNTAX_FIX =
  "Look for an unbalanced { or }, an unclosed ' quote, or a < the parser read as the start of a tag."

function parseDiagnostic(state: State, failure: ParseFailure): Diagnostic {
  const context = state.context
  const span = spanFor(state, failure.range)
  if (failure.rule !== 'icu-syntax') {
    const form = failure.rule === 'plural-other-missing' ? 'plural' : 'select'
    const subject = failure.selector === null ? `A ${form}` : `The ${form} "${failure.selector}"`
    return diag(failure.rule, {
      message: `${subject} has no other branch.`,
      hint: `Every ${form} needs an other branch. Add other {...} as its last branch.`,
      file: context.file,
      locale: context.locale,
      key: context.key,
      span,
    })
  }
  return diag('icu-syntax', {
    message: `ICU syntax error: ${failure.detail}.`,
    hint:
      context.catalogFormat === 'i18next'
        ? `This value was rewritten from i18next before parsing, so the position names the catalog entry rather than the character. Parser error: ${failure.detail}.`
        : (SYNTAX_FIXES.get(failure.detail) ?? GENERIC_SYNTAX_FIX),
    file: context.file,
    locale: context.locale,
    key: context.key,
    span,
  })
}

// A converted i18next value no longer lines up with its file, and neither does an
// ICU value whose JSON source needed an escape before the error: the escape is
// more bytes on disk than the character it decodes to. Both report the entry's
// own span rather than a position that names the wrong line.
function spanFor(state: State, range: Range | null): Span {
  const context = state.context
  if (context.catalogFormat === 'i18next' || range === null) return context.span
  if (!jsonVerbatim(state.icu.slice(0, range.start))) return context.span
  return {
    line: context.span.line,
    column: context.span.column + range.start,
    offset: context.span.offset + range.start,
    length: Math.max(1, range.end - range.start),
  }
}

// True when a JSON string can hold this text as written, which is what makes a
// character offset into the value an offset into the file.
function jsonVerbatim(text: string): boolean {
  for (const char of text) {
    if (char === '"' || char === '\\') return false
    if ((char.codePointAt(0) ?? 0) < 0x20) return false
  }
  return true
}
