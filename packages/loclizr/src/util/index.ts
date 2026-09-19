import { createHash } from 'node:crypto'

const ICU_SPECIAL: ReadonlySet<string> = new Set(['{', '}', '#', '<'])

const pluralCategoryCache = new Map<string, readonly string[]>()

export function hash16(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex').slice(0, 16)
}

export function stableStringify(value: unknown): string {
  return encode(value) ?? 'null'
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

export function escapeIcuLiteral(text: string): string {
  let out = ''
  let special = ''
  for (const char of text.replaceAll("'", "''")) {
    if (ICU_SPECIAL.has(char)) {
      special += char
      continue
    }
    if (special !== '') {
      out += `'${special}'`
      special = ''
    }
    out += char
  }
  return special === '' ? out : `${out}'${special}'`
}

export function requiredCategories(locale: string, ordinal: boolean): readonly string[] {
  const type = ordinal ? 'ordinal' : 'cardinal'
  const cacheKey = `${locale}\u0000${type}`
  const cached = pluralCategoryCache.get(cacheKey)
  if (cached !== undefined) return cached
  const categories = Object.freeze(
    new Intl.PluralRules(locale, { type }).resolvedOptions().pluralCategories.slice(),
  )
  pluralCategoryCache.set(cacheKey, categories)
  return categories
}

function encode(value: unknown): string | undefined {
  if (value === null) return 'null'
  if (Array.isArray(value)) {
    return `[${value.map((item: unknown) => encode(item) ?? 'null').join(',')}]`
  }
  if (typeof value === 'object') {
    const entries = value as Record<string, unknown>
    const fields: string[] = []
    for (const key of Object.keys(entries).sort(compareCodepoint)) {
      const encoded = encode(entries[key])
      if (encoded !== undefined) fields.push(`${JSON.stringify(key)}:${encoded}`)
    }
    return `{${fields.join(',')}}`
  }
  return JSON.stringify(value)
}
