const LOCALE_CLASS = '[A-Za-z0-9-]+'
const NS_CLASS = '[A-Za-z0-9_-]+'
// One whole segment, whatever it spells: what the author meant as a locale.
const ANY_SEGMENT_CLASS = '[^/]+'

const TOKEN_SPLIT = /(\{locale\}|\{sourceLocale\}|\{ns\})/g
const TOKEN = /\{locale\}|\{sourceLocale\}|\{ns\}/

const TOKEN_CLASSES: Readonly<Record<string, string>> = {
  '{locale}': LOCALE_CLASS,
  '{sourceLocale}': LOCALE_CLASS,
  '{ns}': NS_CLASS,
}

const GLOB_METACHARACTERS: readonly string[] = ['*', '?', '[', ']', '(', ')', '{', '}', '!']

export interface CatalogMatch {
  readonly locale: string
  readonly ns: string | null
}

export function countToken(pattern: string, token: string): number {
  return pattern.split(token).length - 1
}

// A catalogs pattern is a path plus tokens, never a glob: `patternToGlob` leaves
// a metacharacter in place while the matcher escapes it, so the two disagree and
// nothing the glob finds can ever match.
export function globMetacharacterIn(pattern: string): string | null {
  for (const part of pattern.split(TOKEN_SPLIT)) {
    if (TOKEN_CLASSES[part] !== undefined) continue
    for (const character of GLOB_METACHARACTERS) {
      if (part.includes(character)) return character
    }
  }
  return null
}

export function patternToGlob(pattern: string): string {
  return pattern.replaceAll(TOKEN_SPLIT, '*')
}

// Both tokens match one whole segment or one whole basename stem, never across
// `/` or `.`, so `en.meta.json` can never be read as the locale `en.meta`.
export function literalMatcher(pattern: string): RegExp {
  let source = '^'
  for (const part of pattern.split(TOKEN_SPLIT)) {
    const characters = TOKEN_CLASSES[part]
    source += characters === undefined ? escapeRegExp(part) : `(?:${characters})`
  }
  return new RegExp(`${source}$`)
}

export function catalogMatcher(pattern: string): ((file: string) => CatalogMatch | null) | null {
  return buildCatalogMatcher(pattern, LOCALE_CLASS)
}

// The same matcher with `{locale}` widened to any one segment, so a basename the
// locale token cannot spell still yields the text that stands where a tag
// belongs. `{ns}` stays strict: a dotted namespace file is not a locale story.
export function looseCatalogMatcher(
  pattern: string,
): ((file: string) => CatalogMatch | null) | null {
  return buildCatalogMatcher(pattern, ANY_SEGMENT_CLASS)
}

function buildCatalogMatcher(
  pattern: string,
  localeClass: string,
): ((file: string) => CatalogMatch | null) | null {
  if (countToken(pattern, '{locale}') !== 1) return null
  if (countToken(pattern, '{sourceLocale}') !== 0) return null
  if (countToken(pattern, '{ns}') > 1) return null
  let source = '^'
  for (const part of pattern.split(TOKEN_SPLIT)) {
    if (part === '{locale}') {
      source += `(?<locale>${localeClass})`
      continue
    }
    if (part === '{ns}') {
      source += `(?<ns>${NS_CLASS})`
      continue
    }
    source += escapeRegExp(part)
  }
  const expression = new RegExp(`${source}$`)
  return (file: string): CatalogMatch | null => {
    const found = expression.exec(file)
    const locale = found?.groups?.['locale']
    if (locale === undefined) return null
    return { locale, ns: found?.groups?.['ns'] ?? null }
  }
}

export function substituteLocale(pattern: string, locale: string): string {
  return pattern.replaceAll('{locale}', locale).replaceAll('{sourceLocale}', locale)
}

// The literal directory prefix a catalog can live under. A pattern whose first
// segment already carries a token has none, and walking the whole project from
// there would reach node_modules and every build output in it.
export function patternBase(pattern: string): string | null {
  const segments = pattern.split('/')
  const tokenAt = segments.findIndex((segment) => TOKEN.test(segment))
  const base = segments.slice(0, tokenAt === -1 ? segments.length - 1 : tokenAt).join('/')
  return base === '' || base === '.' ? null : base
}

// The same layout split by namespace, which is what a pattern is missing when a
// catalog sits one directory below where it looks. Null where the pattern
// already names a namespace or the rewrite would not be a catalog path.
export function withNamespaceToken(pattern: string): string | null {
  if (countToken(pattern, '{ns}') !== 0) return null
  const segments = pattern.split('/')
  const last = segments.at(-1)
  if (last === undefined || !last.endsWith('.json')) return null
  if (last === '{locale}.json') return [...segments.slice(0, -1), '{locale}', '{ns}.json'].join('/')
  if (TOKEN.test(last) || !segments.slice(0, -1).includes('{locale}')) return null
  return [...segments.slice(0, -1), '{ns}.json'].join('/')
}

function escapeRegExp(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
