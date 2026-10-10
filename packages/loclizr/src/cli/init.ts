import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { glob } from 'tinyglobby'
import { toPosix } from '../util'
import type { CatalogLayout } from './discover'
import { discoverLayouts } from './discover'
import {
  CI_SNIPPET,
  CONFIG_FILENAME,
  CONFIG_FILENAMES,
  DEFAULT_CATALOGS,
  DEFAULT_META,
  DEFAULT_SOURCE_LOCALE,
  GENERATED_MARKER,
  PACKAGE_SCRIPTS,
  SEED_CATALOG,
  SEED_OUT_DIR,
  catalogPath,
  configTemplate,
  installNote,
} from './templates'

export interface InitOptions {
  readonly cwd: string
  readonly configPath?: string | undefined
}

export interface InitResult {
  readonly ok: boolean
  readonly output: string
}

type FileOutcome =
  | { readonly kind: 'written'; readonly path: string }
  | { readonly kind: 'exists'; readonly path: string }
  | { readonly kind: 'failed'; readonly path: string; readonly reason: string }

type Outcome = FileOutcome | { readonly kind: 'skipped'; readonly because: string }

export async function runInit(options: InitOptions): Promise<InitResult> {
  const root = resolve(options.cwd)
  const layouts = await discoverLayouts(root)
  // Unnameable layouts rank last, so the first is one only when it is all there is.
  const layout = layouts[0] ?? null
  const discovered = layout?.pattern ?? DEFAULT_CATALOGS
  const catalogs = layout?.unnameable === true ? DEFAULT_CATALOGS : discovered
  const sourceLocale = sourceLocaleOf(layout)
  // Only the default layout has one file a seed could be. Writing
  // `locales/en.json` beside a `public/locales/{locale}/{ns}.json` tree would
  // compile the demo strings and leave every real catalog invisible.
  const seed = discovered === DEFAULT_CATALOGS ? resolve(root, catalogPath(sourceLocale)) : null

  const configFile = resolve(root, options.configPath ?? CONFIG_FILENAME)
  const shadowed = options.configPath === undefined ? await firstConfigPresent(root) : null
  const declared = catalogs === discovered ? (layout?.locales ?? null) : null
  const config: FileOutcome =
    shadowed === null
      ? await writeIfAbsent(
          root,
          configFile,
          await configFor(root, catalogs, declared, sourceLocale, seed),
        )
      : { kind: 'exists', path: shadowed }

  const catalog = await seedOutcome(root, config, seed, discovered)

  const lines = [...describeLayouts(layouts), describeOutcome(config), describeOutcome(catalog)]
  const ok = config.kind !== 'failed' && catalog.kind !== 'failed'
  const blocks = ok
    ? [lines.join('\n'), installNote(config.path), PACKAGE_SCRIPTS, CI_SNIPPET]
    : [lines.join('\n')]
  return { ok, output: `${blocks.join('\n\n')}\n` }
}

// A config already on disk owns `sourceLocale` and `catalogs`, so init cannot
// know which file a seed would belong in, or whether it would ever be read.
async function seedOutcome(
  root: string,
  config: FileOutcome,
  seed: string | null,
  catalogs: string,
): Promise<Outcome> {
  if (config.kind === 'exists') {
    return { kind: 'skipped', because: `${config.path} already owns sourceLocale and catalogs` }
  }
  if (config.kind === 'failed') {
    return { kind: 'skipped', because: `${config.path} was not written` }
  }
  if (seed === null) {
    return { kind: 'skipped', because: `${catalogs} already holds the catalogs it would seed` }
  }
  return writeIfAbsent(root, seed, SEED_CATALOG)
}

async function configFor(
  root: string,
  catalogs: string,
  discoveredLocales: readonly string[] | null,
  sourceLocale: string,
  seed: string | null,
): Promise<string> {
  // A project whose catalogs are already laid out some other way is a retrofit
  // whatever those files hold, so the hard gate goes in commented out.
  const greenfield = seed !== null && (await sourceCatalogState(seed)) !== 'populated'
  const augmentLocale = !(await hasGeneratedTree(root))
  // With `{ns}` and `locales` unset, every name in the locale position is a
  // locale, so a stray `public/locales/shared/` becomes one. Discovery only
  // takes language-tag names there, so its list is the one to pin. A flat
  // layout keeps the default, which picks up a new `fr.json` with no edit.
  const locales = catalogs.includes('{ns}') ? discoveredLocales : null
  return configTemplate({
    locales,
    catalogs,
    meta: metaBeside(catalogs),
    greenfield,
    augmentLocale,
    sourceLocale,
  })
}

// The sidecar describes the catalogs, so it belongs in their directory rather
// than in the default `locales/` beside a `public/locales/` tree.
function metaBeside(catalogs: string): string | null {
  const base = catalogs.slice(0, catalogs.indexOf('/{'))
  const meta = `${base}/{sourceLocale}.meta.json`
  return meta === DEFAULT_META ? null : meta
}

// The config's `sourceLocale` has to agree with the catalogs already on disk.
// Declaring `en` over a project whose only catalog is `locales/de.json` turns a
// working tree into a missing-translation error per key on the next build.
function sourceLocaleOf(layout: CatalogLayout | null): string {
  if (layout === null || layout.locales.includes(DEFAULT_SOURCE_LOCALE)) {
    return DEFAULT_SOURCE_LOCALE
  }
  return layout.locales[0] ?? DEFAULT_SOURCE_LOCALE
}

const UNNAMEABLE_NOTE =
  'which `catalogs` cannot name; move the catalogs to a path without glob characters or backslashes to compile them'

// The inferred pattern is the one decision here a user cannot see in the two
// files, and on a monorepo root it is the decision most likely to be wrong.
function describeLayouts(layouts: readonly CatalogLayout[]): readonly string[] {
  const [chosen, ...rest] = layouts
  if (chosen === undefined) return []
  const count = chosen.locales.length
  const found = `found ${count} locale${count === 1 ? '' : 's'} at ${chosen.pattern}: ${chosen.locales.join(', ')}`
  const lines = [chosen.unnameable === true ? `${found}, ${UNNAMEABLE_NOTE}` : found]
  const others = rest.filter((layout) => layout.unnameable !== true)
  if (others.length > 0) {
    const patterns = others.map((layout) => layout.pattern).join(', ')
    lines.push(`also found ${patterns}; set \`catalogs\` yourself to compile one of those instead`)
  }
  const unnameable = rest.filter((layout) => layout.unnameable === true)
  if (unnameable.length > 0) {
    const patterns = unnameable.map((layout) => layout.pattern).join(', ')
    lines.push(`also found ${patterns}, ${UNNAMEABLE_NOTE}`)
  }
  return lines
}

// `wx` is the never-overwrite guarantee itself. A stat first would leave a
// window where a concurrent write loses the user's file. The mkdir gets its own
// catch because its EEXIST means the parent is a file, which is a failure,
// while the write's means the target is already there, which is not.
async function writeIfAbsent(root: string, file: string, content: string): Promise<FileOutcome> {
  const path = toPosix(relative(root, file)) || '.'
  try {
    await mkdir(dirname(file), { recursive: true })
  } catch (error) {
    return { kind: 'failed', path, reason: reasonOf(error) }
  }
  try {
    await writeFile(file, content, { encoding: 'utf8', flag: 'wx' })
    return { kind: 'written', path }
  } catch (error) {
    if (codeOf(error) !== 'EEXIST') return { kind: 'failed', path, reason: reasonOf(error) }
  }
  // `wx` answers EEXIST for a directory too, which is no config and no seed.
  if (await isDirectory(file)) return { kind: 'failed', path, reason: 'it is a directory' }
  return { kind: 'exists', path }
}

async function isDirectory(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isDirectory()
  } catch {
    return false
  }
}

function describeOutcome(outcome: Outcome): string {
  if (outcome.kind === 'written') return `wrote ${outcome.path}`
  if (outcome.kind === 'exists') return `${outcome.path} already exists, left unchanged`
  if (outcome.kind === 'skipped') return `no seed catalog written, because ${outcome.because}`
  return `could not write ${outcome.path}: ${outcome.reason}`
}

// A new loclizr.config.ts beside an existing loclizr.config.js would win
// discovery and silently replace it, which is worse than refusing to write.
async function firstConfigPresent(root: string): Promise<string | null> {
  for (const name of CONFIG_FILENAMES) {
    if (await fileExists(resolve(root, name))) return name
  }
  return null
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await stat(file)
    return true
  } catch {
    return false
  }
}

type CatalogState = 'absent' | 'empty' | 'populated'

async function sourceCatalogState(file: string): Promise<CatalogState> {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch {
    return 'absent'
  }
  if (text.trim() === '') return 'empty'
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return 'populated'
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return 'populated'
  return Object.keys(parsed).length === 0 ? 'empty' : 'populated'
}

// The tree that forces `augmentLocale: false` is a sibling package's, so the
// search starts at the workspace root rather than at the directory init was
// pointed at. A tree at the outDir this config is about to declare is this
// config's own, so it is not the second tree the flag exists for.
async function hasGeneratedTree(root: string): Promise<boolean> {
  const searchRoot = await workspaceRootOf(root)
  const ownOutDir = toPosix(join(relative(searchRoot, root), SEED_OUT_DIR))
  let barrels: readonly string[]
  try {
    barrels = await glob('**/messages.js', {
      cwd: searchRoot,
      ignore: [
        '**/node_modules/**',
        '**/dist/**',
        '**/build/**',
        '**/.git/**',
        `${ownOutDir}/**`,
      ],
      absolute: true,
    })
  } catch {
    return false
  }
  for (const barrel of barrels) {
    if (await carriesGeneratedHeader(barrel)) return true
  }
  return false
}

const WORKSPACE_MARKERS: readonly string[] = ['pnpm-workspace.yaml', '.git']

async function workspaceRootOf(start: string): Promise<string> {
  let dir = start
  for (;;) {
    if (await marksAWorkspace(dir)) return dir
    const parent = dirname(dir)
    if (parent === dir) return start
    dir = parent
  }
}

async function marksAWorkspace(dir: string): Promise<boolean> {
  for (const marker of WORKSPACE_MARKERS) {
    if (await fileExists(resolve(dir, marker))) return true
  }
  return declaresWorkspaces(resolve(dir, 'package.json'))
}

async function declaresWorkspaces(file: string): Promise<boolean> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return false
  }
  return typeof parsed === 'object' && parsed !== null && 'workspaces' in parsed
}

async function carriesGeneratedHeader(file: string): Promise<boolean> {
  try {
    const text = await readFile(file, 'utf8')
    return text.startsWith(GENERATED_MARKER)
  } catch {
    return false
  }
}

function codeOf(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null
  const code: unknown = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : null
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
