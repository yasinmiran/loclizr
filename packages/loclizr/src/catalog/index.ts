import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { glob } from 'tinyglobby'
import { diag } from '../diagnostics'
import type {
  CatalogMeta,
  Config,
  Diagnostic,
  MetaEntry,
  PlaceholderNote,
  RawCatalog,
  RawEntry,
  Span,
} from '../types'
import { compareCodepoint, toPosix } from '../util'
import { flatten } from './flatten'
import { classifyFormat, findTypedArgument, foldPluralSuffixes, toIcu } from './i18next'
import { parseJsonWithSpans } from './json'
import { hasNamespace, namespaceOfFile, substituteLocale, toGlob } from './pattern'

export { flatten } from './flatten'
export { classifyFormat, foldPluralSuffixes, toIcu } from './i18next'
export { parseJsonWithSpans } from './json'

export interface CatalogReadResult {
  readonly catalogs: readonly RawCatalog[]
  readonly meta: CatalogMeta | null
  readonly diagnostics: readonly Diagnostic[]
}

interface CatalogFile {
  readonly file: string
  readonly ns: string | null
}

interface ReadOutcome {
  readonly text: string | null
  // Set when the file exists and still could not be read. A missing file leaves
  // both null, because a declared locale with no catalog is M9's LZ1005.
  readonly failure: string | null
}

const ROOT_SPAN: Span = { line: 1, column: 1, offset: 0, length: 0 }

export async function readCatalogs(config: Config): Promise<CatalogReadResult> {
  const diagnostics: Diagnostic[] = []
  const catalogs: RawCatalog[] = []
  const sourceKeys = new Set<string>()
  const sidecars = sidecarPaths(config)
  for (const locale of config.locales) {
    const definedIn = new Map<string, string>()
    const files = await filesFor(config, locale, sidecars)
    for (const found of files) {
      const catalog = await readOne(config, locale, found, diagnostics)
      if (catalog === null) continue
      for (const entry of catalog.entries) {
        const first = definedIn.get(entry.key)
        if (first === undefined) {
          definedIn.set(entry.key, catalog.file)
          continue
        }
        diagnostics.push(
          diag('duplicate-key', {
            message: `"${entry.key}" is defined by two catalog files of locale ${locale}.`,
            hint: 'one namespace file per key: rename the key in one of the two files.',
            file: catalog.file,
            locale,
            key: entry.key,
            span: entry.span,
            related: [{ file: first, locale, key: entry.key, span: null, message: 'also defined here' }],
          }),
        )
      }
      if (locale === config.sourceLocale) {
        for (const entry of catalog.entries) sourceKeys.add(entry.key)
      }
      catalogs.push(catalog)
    }
  }
  const meta = await readMeta(config, sourceKeys, diagnostics)
  return { catalogs, meta, diagnostics }
}

async function readOne(
  config: Config,
  locale: string,
  found: CatalogFile,
  diagnostics: Diagnostic[],
): Promise<RawCatalog | null> {
  const isSource = locale === config.sourceLocale
  const outcome = await readText(join(config.root, found.file))
  if (outcome.text === null) {
    if (outcome.failure !== null) {
      diagnostics.push(
        diag('catalog-unreadable', {
          message: `The catalog could not be read: ${outcome.failure}.`,
          hint: 'check the path in `catalogs` and the file permissions.',
          file: found.file,
          locale,
          fatal: isSource,
        }),
      )
    }
    return null
  }

  const parsed = parseJsonWithSpans(outcome.text, found.file)
  if (parsed.diagnostics.length > 0) {
    // The scanner has no locale in hand, so the ifSource scope is resolved here.
    diagnostics.push(...parsed.diagnostics.map((one) => ({ ...one, fatal: isSource, locale })))
    return null
  }

  const flat = flatten({
    value: parsed.value,
    file: found.file,
    locale,
    ns: found.ns,
    spans: parsed.spans,
  })
  diagnostics.push(...flat.diagnostics)
  for (const path of parsed.duplicates) {
    const key = found.ns === null ? path : `${found.ns}.${path}`
    diagnostics.push(
      diag('duplicate-key', {
        message: `"${key}" is defined twice in this file. JSON keeps the last one, so the earlier translation is unreachable.`,
        hint: 'delete one of the two. A dotted key and a nested object flatten to the same key.',
        file: found.file,
        locale,
        key,
        span: parsed.spans.get(path),
      }),
    )
  }

  const verdict =
    config.catalogFormat === 'auto'
      ? classifyFormat(flat.entries)
      : { format: config.catalogFormat, because: null }
  if (verdict.format === 'icu') {
    return { locale, ns: found.ns, file: found.file, format: 'icu', entries: flat.entries }
  }

  const converted: RawEntry[] = []
  for (const entry of flat.entries) {
    const run = findTypedArgument(entry.value)
    if (run !== null) {
      diagnostics.push(
        diag('icu-in-i18next-file', {
          message: `"${run}" is ICU argument syntax, and this file is read as i18next, so the whole run renders as literal text.`,
          hint: whyI18next(verdict.because),
          file: found.file,
          locale,
          key: entry.key,
          span: entry.span,
        }),
      )
    }
    const result = toIcu(entry.value, {
      key: entry.key,
      locale,
      file: found.file,
      span: entry.span,
      markup: config.i18nextMarkup,
    })
    diagnostics.push(...result.diagnostics)
    converted.push({ key: entry.key, value: result.icu, span: entry.span })
  }
  const folded = foldPluralSuffixes(converted, locale, found.file)
  diagnostics.push(...folded.diagnostics)
  return { locale, ns: found.ns, file: found.file, format: 'i18next', entries: folded.entries }
}

async function readMeta(
  config: Config,
  sourceKeys: ReadonlySet<string>,
  diagnostics: Diagnostic[],
): Promise<CatalogMeta | null> {
  if (config.meta === false) return null
  const file = metaPath(config.meta, config.sourceLocale)
  const outcome = await readText(join(config.root, file))
  if (outcome.text === null) {
    if (outcome.failure !== null) {
      diagnostics.push(
        diag('catalog-unreadable', {
          message: `The description sidecar could not be read: ${outcome.failure}.`,
          hint: 'check the path in `meta`, or set meta: false to switch descriptions off.',
          file,
          fatal: false,
        }),
      )
    }
    return null
  }
  const parsed = parseJsonWithSpans(outcome.text, file)
  if (parsed.diagnostics.length > 0) {
    diagnostics.push(...parsed.diagnostics.map((one) => ({ ...one, fatal: false })))
    return null
  }
  if (!isObject(parsed.value)) {
    diagnostics.push(
      diag('catalog-shape-invalid', {
        message: 'The description sidecar root is not an object of keys.',
        hint: 'each entry is a flat key mapped to { description, placeholders }.',
        file,
        span: ROOT_SPAN,
      }),
    )
    return null
  }

  const entries: MetaEntry[] = []
  for (const key of Object.keys(parsed.value)) {
    const span = parsed.spans.get(key) ?? ROOT_SPAN
    if (!sourceKeys.has(key)) {
      diagnostics.push(
        diag('meta-orphan', {
          message: `"${key}" has no message in the source catalog.`,
          hint: 'entries are addressed by the post-fold, post-prefix key, the same one every diagnostic prints.',
          file,
          key,
          span,
        }),
      )
      continue
    }
    const value = parsed.value[key]
    if (!isObject(value)) {
      diagnostics.push(
        diag('catalog-shape-invalid', {
          message: `The description of "${key}" is not an object.`,
          hint: 'write { "description": "...", "placeholders": { "count": "..." } }.',
          file,
          key,
          span,
        }),
      )
      continue
    }
    entries.push({
      key,
      description: descriptionOf(value, key, file, parsed.spans, span, diagnostics),
      placeholders: placeholdersOf(value, key, file, parsed.spans, span, diagnostics),
      span,
    })
  }
  return { file, entries }
}

function descriptionOf(
  value: Record<string, unknown>,
  key: string,
  file: string,
  spans: ReadonlyMap<string, Span>,
  fallback: Span,
  diagnostics: Diagnostic[],
): string | null {
  const description = value['description']
  if (typeof description === 'string') return description
  if (description === undefined || description === null) return null
  diagnostics.push(
    diag('catalog-shape-invalid', {
      message: `The description of "${key}" is not a string.`,
      hint: 'a description is one sentence of prose for the translator.',
      file,
      key,
      span: spans.get(`${key}.description`) ?? fallback,
    }),
  )
  return null
}

function placeholdersOf(
  value: Record<string, unknown>,
  key: string,
  file: string,
  spans: ReadonlyMap<string, Span>,
  fallback: Span,
  diagnostics: Diagnostic[],
): readonly PlaceholderNote[] {
  const placeholders = value['placeholders']
  if (placeholders === undefined || placeholders === null) return []
  const at = (path: string): Span => spans.get(path) ?? fallback
  if (!isObject(placeholders)) {
    diagnostics.push(
      diag('catalog-shape-invalid', {
        message: `The placeholders of "${key}" are not an object.`,
        hint: 'map each argument name to a note about what it holds.',
        file,
        key,
        span: at(`${key}.placeholders`),
      }),
    )
    return []
  }
  const notes: PlaceholderNote[] = []
  for (const name of Object.keys(placeholders)) {
    const note = placeholders[name]
    if (typeof note === 'string') {
      notes.push({ name, note })
      continue
    }
    diagnostics.push(
      diag('catalog-shape-invalid', {
        message: `The note for "${name}" on "${key}" is not a string.`,
        hint: 'a placeholder note is prose, for example "Number of line items, not quantity".',
        file,
        key,
        span: at(`${key}.placeholders.${name}`),
      }),
    )
  }
  return notes
}

async function filesFor(
  config: Config,
  locale: string,
  sidecars: ReadonlySet<string>,
): Promise<readonly CatalogFile[]> {
  const pattern = substituteLocale(config.catalogs, locale)
  if (!hasNamespace(pattern)) {
    return sidecars.has(pattern) ? [] : [{ file: pattern, ns: null }]
  }
  // M9's discovery options, so the engine that decides which locales exist and
  // the one that decides which files to open select one set. `expandDirectories`
  // is the one that differs by default: it appends `/**` and walks into a
  // directory somebody named `pack.json`.
  const matches = await glob(toGlob(pattern), {
    cwd: config.root,
    absolute: false,
    onlyFiles: true,
    dot: false,
    expandDirectories: false,
  })
  const files: CatalogFile[] = []
  for (const match of matches) {
    const file = toPosix(match)
    if (sidecars.has(file)) continue
    const ns = namespaceOfFile(pattern, file)
    if (ns === null) continue
    files.push({ file, ns })
  }
  return files.sort((a, b) => compareCodepoint(a.file, b.file))
}

async function readText(absolute: string): Promise<ReadOutcome> {
  try {
    return { text: await readFile(absolute, 'utf8'), failure: null }
  } catch (failure) {
    const code = (failure as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return { text: null, failure: null }
    return { text: null, failure: code ?? String(failure) }
  }
}

function sidecarPaths(config: Config): ReadonlySet<string> {
  const paths = new Set<string>()
  if (config.meta !== false) paths.add(metaPath(config.meta, config.sourceLocale))
  if (config.record !== false) paths.add(config.record)
  return paths
}

function metaPath(pattern: string, sourceLocale: string): string {
  return pattern.replaceAll('{sourceLocale}', sourceLocale)
}

function whyI18next(because: string | null): string {
  if (because === null) {
    return "catalogFormat is 'i18next', so every file is read that way. Set it to 'auto' or write this file as ICU."
  }
  return `this file classified as i18next on ${JSON.stringify(because)}. Convert the file to ICU, or pin catalogFormat if the literal text is what you meant.`
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
