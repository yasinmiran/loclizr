import { createHash } from 'node:crypto'

const pluralCategoryCache = new Map<string, readonly string[]>()
// Under the `u` flag a paired surrogate is one astral code point, so only an
// unpaired half matches.
const LONE_SURROGATE = /\p{Cs}/gu

// UTF-8 writes every lone surrogate as the bytes of U+FFFD, so two different
// sources would share a hash. Each one gets its own three bytes instead (WTF-8),
// a sequence no well-formed string encodes to, so every other input hashes
// exactly as plain UTF-8 and no committed name moves.
export function hash16(input: string): string {
  const hash = createHash('sha256')
  let start = 0
  for (const lone of input.matchAll(LONE_SURROGATE)) {
    const unit = lone[0].charCodeAt(0)
    hash.update(input.slice(start, lone.index), 'utf8')
    hash.update(Uint8Array.of(0xe0 | (unit >> 12), 0x80 | ((unit >> 6) & 0x3f), 0x80 | (unit & 0x3f)))
    start = lone.index + 1
  }
  return hash.update(input.slice(start), 'utf8').digest('hex').slice(0, 16)
}

export function stableStringify(value: unknown): string {
  return encode(value, '') ?? 'null'
}

export function compareCodepoint(a: string, b: string): number {
  if (a === b) return 0
  const left = Array.from(a, (char) => char.codePointAt(0) ?? 0)
  const right = Array.from(b, (char) => char.codePointAt(0) ?? 0)
  const shared = Math.min(left.length, right.length)
  for (let i = 0; i < shared; i += 1) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0)
    if (difference !== 0) return difference
  }
  return left.length - right.length
}

export function toPosix(path: string): string {
  return path.replaceAll('\\', '/')
}

// One quoted run per maximal stretch of special and apostrophe characters that
// holds at least one special, with every apostrophe doubled. Both halves are
// load bearing. A closing quote followed by an apostrophe reads as still inside
// the quote, so "{'}" has to print as one run, `'{''}'`, and never as `'{'` then
// `''` then `'}'`, which comes back with an apostrophe too many. And an
// undoubled apostrophe at the end of the text would open a quote that swallows
// the enclosing plural branch's closing brace.
export function escapeIcuLiteral(
  text: string,
  options?: {
    // `#` is the count only directly inside a plural or selectordinal body.
    // Anywhere else the parser leaves the apostrophes in the text, so quoting a
    // pound there rewrites the copy and the closing quote swallows whatever
    // argument follows: `Order '#'{id}` is one literal and `id` is gone.
    readonly inPlural?: boolean | undefined
    // 'tags' leaves `<` alone, so tag-shaped text lowers to real markup.
    readonly markup?: 'literal' | 'tags' | undefined
  },
): string {
  const inPlural = options?.inPlural === true
  const tags = options?.markup === 'tags'
  let out = ''
  let run = ''
  let quoted = false
  for (const char of text) {
    if (isIcuSpecial(char, inPlural, tags)) {
      run += char
      quoted = true
      continue
    }
    if (char === "'") {
      run += char
      continue
    }
    out += emitRun(run, quoted)
    run = ''
    quoted = false
    out += char
  }
  return out + emitRun(run, quoted)
}

export function requiredCategories(locale: string, ordinal: boolean): readonly string[] {
  const type = ordinal ? 'ordinal' : 'cardinal'
  const cacheKey = `${locale}\u0000${type}`
  const cached = pluralCategoryCache.get(cacheKey)
  if (cached !== undefined) return cached
  // Intl answers a locale it has no data for with the build machine's default
  // locale, which would make the fold and the checks a function of $LANG.
  // Empty means unknown: `_zero` stays `=0`.
  const categories = Object.freeze(
    Intl.PluralRules.supportedLocalesOf(locale).length === 0
      ? []
      : new Intl.PluralRules(locale, { type }).resolvedOptions().pluralCategories.slice(),
  )
  pluralCategoryCache.set(cacheKey, categories)
  return categories
}

function isIcuSpecial(char: string, inPlural: boolean, tags: boolean): boolean {
  if (char === '{' || char === '}') return true
  if (char === '<') return !tags
  return char === '#' && inPlural
}

function emitRun(run: string, quoted: boolean): string {
  if (run === '') return ''
  const doubled = run.replaceAll("'", "''")
  return quoted ? `'${doubled}'` : doubled
}

function encode(raw: unknown, property: string): string | undefined {
  const value: unknown =
    typeof raw === 'object' && raw !== null && 'toJSON' in raw && typeof raw.toJSON === 'function'
      ? raw.toJSON(property)
      : raw
  if (value === null) return 'null'
  if (Array.isArray(value)) {
    // Array.from visits holes, which map skips, and JSON.stringify prints null.
    return `[${Array.from(value, (item: unknown, index) => encode(item, String(index)) ?? 'null').join(',')}]`
  }
  // The coercions JSON.stringify applies to a boxed primitive: ToNumber,
  // ToString, then the wrapped value itself.
  if (value instanceof Number) return JSON.stringify(Number(value))
  if (value instanceof String) return JSON.stringify(String(value))
  if (value instanceof Boolean || value instanceof BigInt) return JSON.stringify(value.valueOf())
  if (typeof value === 'object') {
    const entries = value as Record<string, unknown>
    const fields: string[] = []
    for (const key of Object.keys(entries).sort(compareCodepoint)) {
      const encoded = encode(entries[key], key)
      if (encoded !== undefined) fields.push(`${JSON.stringify(key)}:${encoded}`)
    }
    return `{${fields.join(',')}}`
  }
  return JSON.stringify(value)
}
