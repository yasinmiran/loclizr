import {
  isDateTimeSkeleton,
  parse,
  type Location as IcuLocation,
  type MessageFormatElement,
  type Skeleton,
} from '@formatjs/icu-messageformat-parser'
import type { IntlOptions } from '../types'
import { compareCodepoint } from '../util'

const PARSE_OPTIONS = {
  shouldParseSkeletons: true,
  requiresOtherClause: true,
  captureLocation: true,
  ignoreTag: false,
} as const

const MISSING_OTHER = 'MISSING_OTHER_CLAUSE'

// Thrown by the skeleton tokenizer, which runs whether or not the resolver does,
// so turning skeleton resolution off does not get a message past one of these.
const SKELETON_FAILURES: ReadonlySet<string> = new Set([
  'INVALID_NUMBER_SKELETON',
  'INVALID_DATE_TIME_SKELETON',
  'EXPECT_NUMBER_SKELETON',
  'EXPECT_DATE_TIME_SKELETON',
])

export type SkeletonForm = 'number' | 'date' | 'time'

export interface Range {
  readonly start: number
  readonly end: number
}

// A `::` run the tokenizer refused, blanked out of the text so the rest of the
// message survives. LZ2003 is raised once per run and the argument keeps its
// bare format.
export interface RejectedSkeleton {
  readonly token: string
  readonly form: SkeletonForm
  readonly range: Range
}

export interface ParseSuccess {
  readonly ok: true
  readonly elements: readonly MessageFormatElement[]
  // False when a `::` style was rejected by the resolver and the message had to be
  // re-parsed with skeleton resolution off, so each skeleton needs its own probe.
  readonly skeletonsResolved: boolean
  readonly rejected: readonly RejectedSkeleton[]
}

export interface ParseFailure {
  readonly ok: false
  readonly rule: 'icu-syntax' | 'plural-other-missing' | 'select-other-missing'
  // The parser's own ErrorKind name, or the message of whatever it threw.
  readonly detail: string
  readonly selector: string | null
  readonly range: Range | null
  readonly rejected: readonly RejectedSkeleton[]
}

export type ParseOutcome = ParseSuccess | ParseFailure

export function parseIcu(icu: string): ParseOutcome {
  return recover(icu, [])
}

// Each pass blanks one rejected `::` run out of the text, so the recursion is
// bounded by how many runs the value holds.
function recover(text: string, rejected: readonly RejectedSkeleton[]): ParseOutcome {
  const full = attempt(text, {})
  if (full.ok) return { ok: true, elements: full.elements, skeletonsResolved: true, rejected }
  if (full.detail === MISSING_OTHER) return missingOther(text, full, rejected)
  if (full.location !== null && !SKELETON_FAILURES.has(full.detail)) {
    return syntaxFailure(full, rejected)
  }
  const degraded = attempt(text, { shouldParseSkeletons: false })
  if (degraded.ok) {
    return { ok: true, elements: degraded.elements, skeletonsResolved: false, rejected }
  }
  const blanked =
    blankSkeleton(text, degraded) ?? (full.location === null ? blankUnresolved(text) : null)
  if (blanked !== null) return recover(blanked.text, [...rejected, blanked.rejected])
  if (degraded.detail === MISSING_OTHER) return missingOther(text, degraded, rejected)
  return syntaxFailure(degraded, rejected)
}

export function probeSkeleton(form: SkeletonForm, token: string): IntlOptions | null {
  const probed = attempt(`{x, ${form}, ${token}}`, {})
  if (!probed.ok) return null
  const element = probed.elements[0]
  if (element === undefined || !('style' in element)) return null
  const style = element.style
  if (style === null || style === undefined || typeof style === 'string') return null
  return skeletonOptions(style)
}

// The parser reads `unit/` like `measure-unit/` and drops everything up to the
// first hyphen as a type prefix, but `unit/` takes a bare core unit id, so
// `unit/kilometer-per-hour` would otherwise reach Intl as `per-hour`.
export function skeletonOptions(skeleton: Skeleton): IntlOptions {
  const options = sanitizeOptions(skeleton.parsedOptions)
  if (isDateTimeSkeleton(skeleton)) return options
  const last = skeleton.tokens.findLast(
    (token) => token.stem === 'unit' || token.stem === 'measure-unit',
  )
  const unit = last?.stem === 'unit' ? last.options[0] : undefined
  return unit === undefined ? options : sanitizeOptions({ ...options, unit })
}

export function skeletonToken(icu: string, skeleton: Skeleton): string {
  const location = skeleton.location
  if (location !== undefined) {
    const text = icu.slice(location.start.offset, location.end.offset).trim()
    if (text.startsWith('::')) return text
  }
  if (isDateTimeSkeleton(skeleton)) return `::${skeleton.pattern}`
  return `::${skeleton.tokens.map((token) => [token.stem, ...token.options].join('/')).join(' ')}`
}

export function sanitizeOptions(options: object): IntlOptions {
  const kept: Record<string, string | number | boolean> = {}
  const entries: [string, unknown][] = Object.entries(options)
  for (const [key, value] of entries.sort(([a], [b]) => compareCodepoint(a, b))) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      kept[key] = value
    }
  }
  return Object.freeze(kept)
}

export function rangeOf(location: IcuLocation | null | undefined): Range | null {
  if (location === null || location === undefined) return null
  return { start: location.start.offset, end: location.end.offset }
}

type Attempt =
  | { readonly ok: true; readonly elements: readonly MessageFormatElement[] }
  | { readonly ok: false; readonly detail: string; readonly location: IcuLocation | null }

type AttemptFailure = Extract<Attempt, { readonly ok: false }>

function attempt(
  icu: string,
  overrides: { readonly shouldParseSkeletons?: boolean; readonly requiresOtherClause?: boolean },
): Attempt {
  try {
    return { ok: true, elements: parse(icu, { ...PARSE_OPTIONS, ...overrides }) }
  } catch (error) {
    return { ok: false, detail: detailOf(error), location: locationOf(error) }
  }
}

interface Blanked {
  readonly text: string
  readonly rejected: RejectedSkeleton
}

function blankSkeleton(text: string, failure: AttemptFailure): Blanked | null {
  const location = failure.location
  if (location === null || !SKELETON_FAILURES.has(failure.detail)) return null
  const marker = text.indexOf('::', location.start.offset)
  if (marker === -1 || marker >= location.end.offset) return null
  return blankRun(text, marker)
}

// The resolver throws with no location, so the run it refused is found by
// probing each one.
function blankUnresolved(text: string): Blanked | null {
  for (let marker = text.indexOf('::'); marker !== -1; marker = text.indexOf('::', marker + 2)) {
    const blanked = blankRun(text, marker)
    if (blanked !== null && probeSkeleton(blanked.rejected.form, blanked.rejected.token) === null) {
      return blanked
    }
  }
  return null
}

// The separating comma goes with the style run, or the copy still fails to parse,
// and spaces replace both so every other offset in the value stays where it was.
function blankRun(text: string, marker: number): Blanked | null {
  let comma = marker
  while (comma > 0 && isSpace(text.charAt(comma - 1))) comma -= 1
  if (text.charAt(comma - 1) !== ',') return null
  comma -= 1
  const close = text.indexOf('}', marker)
  if (close === -1) return null
  const form = formBefore(text, comma)
  if (form === null) return null
  return {
    text: text.slice(0, comma) + ' '.repeat(close - comma) + text.slice(close),
    rejected: {
      token: text.slice(marker, close).trimEnd(),
      form,
      range: { start: marker, end: close },
    },
  }
}

function formBefore(text: string, comma: number): SkeletonForm | null {
  let end = comma
  while (end > 0 && isSpace(text.charAt(end - 1))) end -= 1
  let start = end
  while (start > 0 && isLetter(text.charAt(start - 1))) start -= 1
  const word = text.slice(start, end)
  if (word === 'number' || word === 'date' || word === 'time') return word
  return null
}

function isSpace(char: string): boolean {
  return char !== '' && char.trim() === ''
}

function isLetter(char: string): boolean {
  return char >= 'a' && char <= 'z'
}

function syntaxFailure(
  failure: AttemptFailure,
  rejected: readonly RejectedSkeleton[],
): ParseFailure {
  return {
    ok: false,
    rule: 'icu-syntax',
    detail: failure.detail,
    selector: null,
    range: rangeOf(failure.location),
    rejected,
  }
}

function missingOther(
  icu: string,
  failure: AttemptFailure,
  rejected: readonly RejectedSkeleton[],
): ParseFailure {
  const relaxed = attempt(icu, { shouldParseSkeletons: false, requiresOtherClause: false })
  const found = relaxed.ok ? findOtherless(relaxed.elements) : null
  const range = rangeOf(failure.location)
  if (found === null) {
    return {
      ok: false,
      rule: 'plural-other-missing',
      detail: failure.detail,
      selector: null,
      range,
      rejected,
    }
  }
  return {
    ok: false,
    rule: found.plural ? 'plural-other-missing' : 'select-other-missing',
    detail: failure.detail,
    selector: found.selector,
    range: rangeOf(found.location) ?? range,
    rejected,
  }
}

interface Otherless {
  readonly plural: boolean
  readonly selector: string
  readonly location: IcuLocation | null
}

function findOtherless(elements: readonly MessageFormatElement[]): Otherless | null {
  for (const element of elements) {
    if ('children' in element) {
      const nested = findOtherless(element.children)
      if (nested !== null) return nested
      continue
    }
    if (!('options' in element)) continue
    if (!Object.hasOwn(element.options, 'other')) {
      return {
        plural: 'pluralType' in element,
        selector: element.value,
        location: element.location ?? null,
      }
    }
    for (const option of Object.values(element.options)) {
      const nested = findOtherless(option.value)
      if (nested !== null) return nested
    }
  }
  return null
}

function detailOf(error: unknown): string {
  if (error instanceof Error && error.message !== '') return error.message
  return String(error)
}

function locationOf(error: unknown): IcuLocation | null {
  if (typeof error !== 'object' || error === null || !('location' in error)) return null
  const location = (error as { location: unknown }).location
  if (typeof location !== 'object' || location === null) return null
  const candidate = location as { start?: { offset?: unknown }; end?: { offset?: unknown } }
  if (typeof candidate.start?.offset !== 'number' || typeof candidate.end?.offset !== 'number') {
    return null
  }
  return location as IcuLocation
}
