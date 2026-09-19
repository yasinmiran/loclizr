const LOCALE_CLASS = '[A-Za-z0-9-]+'
const NS_CLASS = '[A-Za-z0-9_-]+'

const TOKEN_SPLIT = /(\{locale\}|\{sourceLocale\}|\{ns\})/g

const TOKEN_CLASSES: Readonly<Record<string, string>> = {
  '{locale}': LOCALE_CLASS,
  '{sourceLocale}': LOCALE_CLASS,
  '{ns}': NS_CLASS,
}

export interface CatalogMatch {
  readonly locale: string
  readonly ns: string | null
}

export function countToken(pattern: string, token: string): number {
  return pattern.split(token).length - 1
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
  if (countToken(pattern, '{locale}') !== 1) return null
  if (countToken(pattern, '{sourceLocale}') !== 0) return null
  if (countToken(pattern, '{ns}') > 1) return null
  let source = '^'
  for (const part of pattern.split(TOKEN_SPLIT)) {
    if (part === '{locale}') {
      source += `(?<locale>${LOCALE_CLASS})`
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

function escapeRegExp(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
