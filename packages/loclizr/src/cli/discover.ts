import { glob } from 'tinyglobby'
import { compareCodepoint, toPosix } from '../util'
import { DEFAULT_CATALOGS } from './templates'

export interface CatalogLayout {
  readonly pattern: string
  readonly locales: readonly string[]
}

// A catalog directory has to be named like one. Globbing every `*.json` and
// asking whether its stem is a locale finds `package.json`, because
// `Intl.getCanonicalLocales('package')` answers `['package']`.
const CATALOG_DIRS: readonly string[] = [
  'locales',
  'locale',
  'i18n',
  'lang',
  'messages',
  'translations',
]

const IGNORED: readonly string[] = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/.git/**',
]

// `{locale}` and `{ns}` as M9 expands them: one whole segment or basename stem.
const LOCALE_SEGMENT = /^[A-Za-z0-9-]+$/
const NS_SEGMENT = /^[A-Za-z0-9_-]+$/

// Tight enough to tell a locale directory from a namespace directory, which the
// loose test cannot: `common`, `shared` and `checkout` all canonicalize.
const LANGUAGE_TAG = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/

interface Candidate {
  readonly pattern: string
  readonly locale: string
}

// The layouts a project already has, best first. Empty for a greenfield tree,
// which is the only case where seeding `locales/{locale}.json` is right.
export async function discoverLayouts(root: string): Promise<readonly CatalogLayout[]> {
  let files: readonly string[]
  try {
    files = await glob(`**/{${CATALOG_DIRS.join(',')}}/**/*.json`, {
      cwd: root,
      ignore: [...IGNORED],
    })
  } catch {
    return []
  }

  const byPattern = new Map<string, Set<string>>()
  for (const file of [...files].map(toPosix).sort(compareCodepoint)) {
    const candidate = candidateFor(file)
    if (candidate === null) continue
    const locales = byPattern.get(candidate.pattern) ?? new Set<string>()
    locales.add(candidate.locale)
    byPattern.set(candidate.pattern, locales)
  }

  return [...byPattern]
    .map(([pattern, locales]) => ({ pattern, locales: [...locales].sort(compareCodepoint) }))
    .sort(byPreference)
}

function isCatalogLocale(stem: string): boolean {
  if (!LOCALE_SEGMENT.test(stem)) return false
  try {
    Intl.getCanonicalLocales(stem)
    return true
  } catch {
    return false
  }
}

function isLanguageTag(segment: string): boolean {
  return LANGUAGE_TAG.test(segment) && isCatalogLocale(segment)
}

function candidateFor(file: string): Candidate | null {
  const segments = file.split('/')
  const basename = segments.at(-1) ?? ''
  const stem = basename.slice(0, -'.json'.length)
  const directories = segments.slice(0, -1)
  const anchor = lastCatalogDir(directories)
  if (anchor === -1) return null

  const base = directories.slice(0, anchor + 1).join('/')
  const between = directories.slice(anchor + 1)
  if (between.length === 0) {
    return isCatalogLocale(stem) ? { pattern: `${base}/{locale}.json`, locale: stem } : null
  }
  if (between.length !== 1) return null

  const directory = between[0] ?? ''
  const localeFirst = isLanguageTag(directory) && NS_SEGMENT.test(stem)
  const namespaceFirst = isLanguageTag(stem) && NS_SEGMENT.test(directory)
  if (localeFirst) return { pattern: `${base}/{locale}/{ns}.json`, locale: directory }
  if (namespaceFirst) return { pattern: `${base}/{ns}/{locale}.json`, locale: stem }
  return null
}

function lastCatalogDir(directories: readonly string[]): number {
  for (let index = directories.length - 1; index >= 0; index -= 1) {
    const segment = directories[index]
    if (segment !== undefined && CATALOG_DIRS.includes(segment)) return index
  }
  return -1
}

function byPreference(a: CatalogLayout, b: CatalogLayout): number {
  if (a.pattern === DEFAULT_CATALOGS) return -1
  if (b.pattern === DEFAULT_CATALOGS) return 1
  if (a.locales.length !== b.locales.length) return b.locales.length - a.locales.length
  return compareCodepoint(a.pattern, b.pattern)
}
