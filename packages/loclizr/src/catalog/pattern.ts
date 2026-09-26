const NS_TOKEN = '{ns}'
const NS_CLASS = '[A-Za-z0-9_-]+'

export function substituteLocale(pattern: string, locale: string): string {
  return pattern.replaceAll('{locale}', locale)
}

export function hasNamespace(pattern: string): boolean {
  return pattern.includes(NS_TOKEN)
}

export function toGlob(pattern: string): string {
  return pattern.replaceAll(NS_TOKEN, '*')
}

// `{ns}` matches one whole segment or one whole basename stem and never crosses
// `/` or `.`, so `*.json` picking up `en.meta.json` yields no namespace here.
export function namespaceOfFile(pattern: string, file: string): string | null {
  const source = pattern
    .split(NS_TOKEN)
    .map(escapeRegExp)
    .join(`(${NS_CLASS})`)
  const found = new RegExp(`^${source}$`).exec(file)
  return found?.[1] ?? null
}

function escapeRegExp(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
