import { stat } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createJiti } from 'jiti'
import type { Jiti } from 'jiti'
import { glob } from 'tinyglobby'
import { diag } from '../diagnostics'
import type { Diagnostic, DiscoveredCatalog, LoclizrConfig } from '../types'
import { compareCodepoint, toPosix } from '../util'
import { DEFAULT_CATALOGS } from './fields'
import { catalogMatcher, patternToGlob } from './pattern'
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

  const discovered = await discoverCatalogs(root, catalogsPatternOf(user))
  const resolved = resolveConfig({ user, root, discovered })
  return {
    config: resolved.config,
    diagnostics: stampConfigFile(resolved.diagnostics, located.file),
  }
}

export async function discoverCatalogs(
  root: string,
  pattern: string,
): Promise<readonly DiscoveredCatalog[]> {
  const base = toPosix(resolve(root))
  const relativePattern = toPosix(relative(base, resolve(base, toPosix(pattern))))
  const match = catalogMatcher(relativePattern)
  if (match === null) return []

  let files: readonly string[]
  try {
    files = await glob(patternToGlob(relativePattern), {
      cwd: base,
      absolute: false,
      onlyFiles: true,
      dot: false,
      expandDirectories: false,
    })
  } catch {
    return []
  }

  const found: DiscoveredCatalog[] = []
  for (const file of files) {
    const posix = toPosix(file)
    const parts = match(posix)
    if (parts === null) continue
    found.push({ locale: parts.locale, ns: parts.ns, file: posix })
  }
  return found.sort((a, b) => compareCodepoint(a.file, b.file))
}

let instance: Jiti | null = null

function jiti(): Jiti {
  // Caching would hand a second load of an edited config the stale module, and
  // the filesystem cache writes into node_modules.
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
    const loaded = await jiti().import<Record<string, unknown>>(pathToFileURL(absolute).href)
    exported = loaded['default']
  } catch (error) {
    return {
      user: {},
      diagnostic: diag('config-invalid', {
        message: `${file} threw while loading: ${describe(error)}`,
        file,
      }),
    }
  }
  if (typeof exported !== 'object' || exported === null || Array.isArray(exported)) {
    return {
      user: {},
      diagnostic: diag('config-invalid', {
        message: `${file} must export its configuration as the default export.`,
        hint: 'export default defineConfig({ /* ... */ })',
        file,
      }),
    }
  }
  return { user: exported as LoclizrConfig, diagnostic: null }
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

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
