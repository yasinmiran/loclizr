import { readFile, stat } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import { createJiti } from 'jiti'
import type { Jiti } from 'jiti'
import { glob } from 'tinyglobby'
import { diag } from '../diagnostics'
import type { Config, Diagnostic, DiscoveredCatalog, LoclizrConfig } from '../types'
import { compareCodepoint, toPosix } from '../util'
import { DEFAULT_CATALOGS } from './fields'
import {
  catalogMatcher,
  literalMatcher,
  looseCatalogMatcher,
  patternBase,
  patternToGlob,
  withNamespaceToken,
} from './pattern'
import { resolveConfig } from './resolve'
import type { LoadConfigResult } from './resolve'

export type { LoadConfigResult } from './resolve'
export { resolveConfig } from './resolve'

export const CONFIG_FILENAMES: readonly [
  'loclizr.config.ts',
  'loclizr.config.mts',
  'loclizr.config.js',
  'loclizr.config.mjs',
] = ['loclizr.config.ts', 'loclizr.config.mts', 'loclizr.config.js', 'loclizr.config.mjs']

export async function loadConfig(input: {
  readonly cwd: string
  readonly configPath?: string | undefined
}): Promise<LoadConfigResult> {
  const root = toPosix(resolve(input.cwd))
  const located = await locateConfig(root, input.configPath)
  if (located.diagnostic !== null) return { config: null, diagnostics: [located.diagnostic] }

  let user: LoclizrConfig = {}
  if (located.file !== null) {
    const loaded = await importConfig(root, located.file)
    if (loaded.diagnostic !== null) return { config: null, diagnostics: [loaded.diagnostic] }
    user = loaded.user
  }

  // A config assembled from getters, a Proxy or a class instance throws where a
  // field is read rather than where the module is evaluated, and this result
  // type promises diagnostics rather than a rejected promise.
  try {
    const pattern = catalogsPatternOf(user)
    const { spelled, unspelled } = await discover(root, pattern)
    const discovered = [...spelled, ...unspelled]
    const resolved = resolveConfig({ user, root, discovered })
    const stray =
      resolved.config === null ? [] : await strayCatalogs(root, pattern, discovered.map(fileOf))
    const diagnostics = [
      ...stampConfigFile(resolved.diagnostics, located.file),
      ...unreachableCatalogs(stray, resolved.config),
    ]
    return { config: resolved.config, diagnostics }
  } catch (error) {
    return { config: null, diagnostics: [threw(located.file, error, root)] }
  }
}

export async function discoverCatalogs(
  root: string,
  pattern: string,
): Promise<readonly DiscoveredCatalog[]> {
  return (await discover(root, pattern)).spelled
}

interface Discovery {
  readonly spelled: readonly DiscoveredCatalog[]
  // Matched by the glob, with a `{locale}` segment the token cannot spell:
  // `locales/en_US.json`, which Java, Rails and gettext exports all write.
  // `resolveConfig` reports each as LZ1006 once the meta and record paths are
  // out, rather than a locale going missing in silence.
  readonly unspelled: readonly DiscoveredCatalog[]
}

async function discover(root: string, pattern: string): Promise<Discovery> {
  const base = toPosix(resolve(root))
  const relativePattern = relativeTo(base, pattern)
  const match = catalogMatcher(relativePattern)
  const matchLoosely = looseCatalogMatcher(relativePattern)
  if (match === null || matchLoosely === null) return { spelled: [], unspelled: [] }

  const files = await jsonFiles(base, patternToGlob(relativePattern))
  if (files === null) return { spelled: [], unspelled: [] }

  const spelled: DiscoveredCatalog[] = []
  const unspelled: DiscoveredCatalog[] = []
  for (const file of files) {
    const parts = match(file)
    if (parts !== null) {
      spelled.push({ locale: parts.locale, ns: parts.ns, file })
      continue
    }
    const loose = matchLoosely(file)
    if (loose !== null) unspelled.push({ locale: loose.locale, ns: loose.ns, file })
  }
  return { spelled: byFile(spelled), unspelled: byFile(unspelled) }
}

// Every .json under the pattern's own base directory that neither matcher
// claimed: `locales/fr/common.json` beside a `locales/{locale}.json` pattern,
// which is every namespaced i18next tree one step into a migration.
async function strayCatalogs(
  root: string,
  pattern: string,
  claimed: readonly string[],
): Promise<readonly string[]> {
  const base = toPosix(resolve(root))
  const directory = patternBase(relativeTo(base, pattern))
  if (directory === null) return []
  const found = await jsonFiles(base, `${directory}/**/*.json`)
  if (found === null) return []
  const read = new Set(claimed)
  return found.filter((file) => !read.has(file))
}

function relativeTo(base: string, pattern: string): string {
  return toPosix(relative(base, resolve(base, toPosix(pattern))))
}

async function jsonFiles(base: string, pattern: string): Promise<readonly string[] | null> {
  try {
    const found = await glob(pattern, {
      cwd: base,
      absolute: false,
      onlyFiles: true,
      dot: false,
      expandDirectories: false,
      ignore: ['**/node_modules/**'],
    })
    return found.map(toPosix).sort(compareCodepoint)
  } catch {
    return null
  }
}

function byFile(catalogs: DiscoveredCatalog[]): readonly DiscoveredCatalog[] {
  return catalogs.sort((a, b) => compareCodepoint(a.file, b.file))
}

// The meta sidecar and the record are the compiler's own artifacts sitting in
// the same directory, so only a resolved config can tell a stray catalog from
// the two files the pattern is meant to miss.
function unreachableCatalogs(
  stray: readonly string[],
  config: Config | null,
): readonly Diagnostic[] {
  if (config === null) return []
  const reserved = [config.meta, config.record]
    .filter((path): path is string => path !== false)
    .map((path) => literalMatcher(path))
  const unreachable = stray.filter((file) => !reserved.some((matcher) => matcher.test(file)))
  const [first] = unreachable
  if (first === undefined) return []
  const rest = unreachable.length - 1
  const tail = rest === 0 ? '' : ` ${rest} more .json ${rest === 1 ? 'file' : 'files'} beside it.`
  return [
    diag('catalog-undeclared', {
      message: `${first} does not match \`${config.catalogs}\`, so no locale reads it.${tail}`,
      hint: namespaceHint(config.catalogs, first),
      file: first,
    }),
  ]
}

function namespaceHint(pattern: string, stray: string): string {
  const namespaced = withNamespaceToken(pattern)
  const match = namespaced === null ? null : catalogMatcher(namespaced)
  if (namespaced !== null && match !== null && match(stray) !== null) {
    return `the split layout is one token away: catalogs: '${namespaced}'`
  }
  return `point \`catalogs\` at the layout on disk, or move the file out of \`${patternBase(pattern) ?? '.'}\`.`
}

function fileOf(catalog: DiscoveredCatalog): string {
  return catalog.file
}

let instance: Jiti | null = null

function jiti(): Jiti {
  // Caching would hand a reload the stale module of a sibling the config
  // imports, and the filesystem cache writes into node_modules.
  instance ??= createJiti(import.meta.url, { fsCache: false, moduleCache: false })
  return instance
}

function catalogsPatternOf(user: LoclizrConfig): string {
  const pattern: unknown = user.catalogs
  return typeof pattern === 'string' && pattern !== '' ? pattern : DEFAULT_CATALOGS
}

async function locateConfig(
  root: string,
  configPath: string | undefined,
): Promise<{ readonly file: string | null; readonly diagnostic: Diagnostic | null }> {
  if (configPath !== undefined) {
    const absolute = resolve(root, toPosix(configPath))
    const file = toPosix(relative(root, absolute))
    if (await isFile(absolute)) return { file, diagnostic: null }
    return {
      file: null,
      diagnostic: diag('config-invalid', {
        message: `No config file at ${file}.`,
        hint: '--config must name a file that exists.',
        file,
      }),
    }
  }
  for (const name of CONFIG_FILENAMES) {
    if (await isFile(resolve(root, name))) return { file: name, diagnostic: null }
  }
  return { file: null, diagnostic: null }
}

async function importConfig(
  root: string,
  file: string,
): Promise<{ readonly user: LoclizrConfig; readonly diagnostic: Diagnostic | null }> {
  const absolute = resolve(root, file)
  let exported: unknown
  try {
    const source = await readFile(absolute, 'utf8')
    // Node serves a second `import()` of one URL out of its own module cache,
    // which neither jiti option reaches, so a long-lived dev server would keep
    // compiling against the config the process started with. Transpiling every
    // extension keeps the load out of that cache entirely.
    const loaded = (await jiti().evalModule(source, {
      filename: absolute,
      async: true,
      forceTranspile: true,
    })) as Readonly<Record<string, unknown>> | null | undefined
    exported = defaultExport(loaded)
  } catch (error) {
    if (!isNullDefault(error)) return { user: {}, diagnostic: threw(file, error, root) }
  }
  if (Object.prototype.toString.call(exported) !== '[object Object]') {
    return {
      user: {},
      diagnostic: diag('config-invalid', {
        message: `${file} must export its configuration as the default export.`,
        hint: 'export default defineConfig({ /* ... */ }), resolved before the export rather than as a promise.',
        file,
      }),
    }
  }
  return { user: exported as LoclizrConfig, diagnostic: null }
}

function defaultExport(loaded: Readonly<Record<string, unknown>> | null | undefined): unknown {
  if (loaded === null || loaded === undefined) return undefined
  // `__esModule` is the marker the transform leaves on a real ES module. A
  // CommonJS config carries none and declares no `default` binding either,
  // because its whole `module.exports` is the configuration.
  if (Object.hasOwn(loaded, '__esModule')) {
    if (!Object.hasOwn(loaded, 'default')) return undefined
    const value = loaded['default']
    // Where the real default is undefined, jiti hands back the module namespace
    // in its place, and every named export would then read as a config field.
    return isNamespaceWithoutDefault(value) ? undefined : value
  }
  return loaded['default']
}

function isNamespaceWithoutDefault(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.hasOwn(value, '__esModule') &&
    (value as Readonly<Record<string, unknown>>)['default'] === undefined
  )
}

// jiti's interop Proxy reads `then` off a null default while the async load
// settles, so `export default null` rejects inside jiti before any shape check.
// The frame test keeps a config whose own code reads `then` off null a throw.
function isNullDefault(error: unknown): boolean {
  if (!(error instanceof TypeError)) return false
  if (error.message !== "Cannot read properties of null (reading 'then')") return false
  const [, frame = ''] = (error.stack ?? '').split('\n')
  return /[\\/]jiti[\\/]/.test(frame)
}

function threw(file: string | null, error: unknown, root: string): Diagnostic {
  return diag('config-invalid', {
    message: `${file ?? 'The configuration'} threw while loading: ${describe(error, root)}`,
    file: file ?? undefined,
  })
}

function stampConfigFile(
  diagnostics: readonly Diagnostic[],
  file: string | null,
): readonly Diagnostic[] {
  if (file === null) return diagnostics
  return diagnostics.map((diagnostic) =>
    diagnostic.file === null ? { ...diagnostic, file } : diagnostic,
  )
}

async function isFile(absolute: string): Promise<boolean> {
  try {
    return (await stat(absolute)).isFile()
  } catch {
    return false
  }
}

function describe(error: unknown, root: string): string {
  const message = error instanceof Error ? error.message : String(error)
  // A loader error carries the absolute path it was handed, and a diagnostic
  // that changes with the checkout location makes the JSON reporter unstable
  // across machines.
  return message.replaceAll(`${root}/`, '').replaceAll(`${root.replaceAll('/', sep)}${sep}`, '')
}
