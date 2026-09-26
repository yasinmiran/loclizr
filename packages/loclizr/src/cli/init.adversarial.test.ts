import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isPluralElement, parse } from '@formatjs/icu-messageformat-parser'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runInit } from './init'
import { SEED_CATALOG, SEED_OUT_DIR } from './templates'

// The exact options the compiler parses every message with, so a seed the
// parser rejects here is one the first build would reject too.
const PARSER_OPTIONS = {
  shouldParseSkeletons: true,
  requiresOtherClause: true,
  captureLocation: true,
  ignoreTag: false,
}

let root = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'loclizr-cli-init-adv-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function write(relative: string, content: string): Promise<void> {
  const file = join(root, relative)
  await mkdir(join(file, '..'), { recursive: true })
  await writeFile(file, content, 'utf8')
}

function read(relative: string): Promise<string> {
  return readFile(join(root, relative), 'utf8')
}

async function exists(relative: string): Promise<boolean> {
  try {
    await stat(join(root, relative))
    return true
  } catch {
    return false
  }
}

function leafValues(tree: unknown): readonly string[] {
  if (typeof tree === 'string') return [tree]
  if (tree === null || typeof tree !== 'object') return []
  return Object.values(tree).flatMap(leafValues)
}

const seedValues: readonly string[] = leafValues(JSON.parse(SEED_CATALOG))

describe('the seed catalog survives the compiler it seeds', () => {
  it('holds only ICU the build time parser accepts', () => {
    expect(seedValues.length).toBeGreaterThan(0)
    for (const value of seedValues) {
      expect(() => parse(value, PARSER_OPTIONS)).not.toThrow()
    }
  })

  it('holds a plural whose other branch the parser demanded', () => {
    const plurals = seedValues.filter((value) =>
      parse(value, PARSER_OPTIONS).some((element) => isPluralElement(element)),
    )

    expect(plurals.length).toBeGreaterThan(0)
  })

  it('repeats no source string, so the greenfield gate costs nothing on it', () => {
    expect(new Set(seedValues).size).toBe(seedValues.length)
  })

  it('holds no blank value, which would resolve as a missing translation', () => {
    for (const value of seedValues) expect(value.trim()).not.toBe('')
  })

  it('is a JSON object with no array leaf', () => {
    const parsed: unknown = JSON.parse(SEED_CATALOG)

    expect(typeof parsed).toBe('object')
    expect(Array.isArray(parsed)).toBe(false)
    expect(hasArrayLeaf(parsed)).toBe(false)
  })
})

describe('init writes two files and nothing else', () => {
  it('leaves the tree holding exactly the config and the seed catalog', async () => {
    await runInit({ cwd: root })
    const entries = await readdir(root, { recursive: true, withFileTypes: true })
    const files = entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort()

    expect(files).toEqual(['en.json', 'loclizr.config.ts'])
  })

  it('does not create outDir', async () => {
    await runInit({ cwd: root })

    expect(await exists(SEED_OUT_DIR)).toBe(false)
  })

  it('creates no package.json when the project has none', async () => {
    await runInit({ cwd: root })

    expect(await exists('package.json')).toBe(false)
  })
})

describe('init never overwrites', () => {
  it('leaves a zero byte source catalog untouched while still calling it greenfield', async () => {
    await write('locales/en.json', '')

    const result = await runInit({ cwd: root })

    expect(await read('locales/en.json')).toBe('')
    expect(result.output).toContain('locales/en.json already exists, left unchanged')
    expect(await read('loclizr.config.ts')).toContain("severity: { 'ambiguous-source': 'error' },")
  })

  it('does not write through a symlink standing in for the seed catalog', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'loclizr-cli-init-outside-'))
    try {
      const target = join(outside, 'en.json')
      await writeFile(target, '{"nav":{"home":"Startseite"}}', 'utf8')
      await mkdir(join(root, 'locales'), { recursive: true })
      await symlink(target, join(root, 'locales', 'en.json'))

      const result = await runInit({ cwd: root })

      expect(await readFile(target, 'utf8')).toBe('{"nav":{"home":"Startseite"}}')
      expect(result.output).toContain('locales/en.json already exists, left unchanged')
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })

  it('creates nothing outside the project through a dangling symlink', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'loclizr-cli-init-dangling-'))
    try {
      const target = join(outside, 'en.json')
      await mkdir(join(root, 'locales'), { recursive: true })
      await symlink(target, join(root, 'locales', 'en.json'))

      await runInit({ cwd: root })

      await expect(readFile(target, 'utf8')).rejects.toThrow()
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })

  it('leaves a directory standing where the seed catalog goes', async () => {
    await mkdir(join(root, 'locales', 'en.json'), { recursive: true })

    const result = await runInit({ cwd: root })

    expect((await stat(join(root, 'locales', 'en.json'))).isDirectory()).toBe(true)
    expect(await readdir(join(root, 'locales', 'en.json'))).toEqual([])
    expect(result.output).not.toContain('wrote locales/en.json')
  })

  it('names the config that actually exists when it refuses to shadow one', async () => {
    await write('loclizr.config.js', 'export default {}\n')

    const result = await runInit({ cwd: root })

    expect(await exists('loclizr.config.ts')).toBe(false)
    expect(result.output).not.toContain('loclizr.config.ts already exists')
    expect(result.output).toContain('loclizr.config.js')
  })

  it('gives one writer each file when two inits race on one directory', async () => {
    const [first, second] = await Promise.all([runInit({ cwd: root }), runInit({ cwd: root })])
    const combined = `${first.output}${second.output}`

    expect(occurrences(combined, 'wrote loclizr.config.ts')).toBe(1)
    expect(occurrences(combined, 'wrote locales/en.json')).toBe(1)
    expect(await read('locales/en.json')).toBe(SEED_CATALOG)
  })
})

describe('layout inference reads only what is there', () => {
  it('infers nothing from a directory whose name merely canonicalizes', async () => {
    await write('locales/shared/common.json', '{"nav":{"home":"Home"}}')

    const result = await runInit({ cwd: root })

    expect(await read('loclizr.config.ts')).toContain("catalogs: 'locales/{locale}.json',")
    expect(result.output).not.toContain('found')
    expect(result.output).toContain('wrote locales/en.json')
  })

  it('infers nothing from json outside a catalog directory', async () => {
    await write('package.json', '{"name":"app"}')
    await write('tsconfig.json', '{}')
    await write('src/config/settings.json', '{}')

    const result = await runInit({ cwd: root })

    expect(await read('loclizr.config.ts')).toContain("catalogs: 'locales/{locale}.json',")
    expect(result.output).toContain('wrote locales/en.json')
  })

  it('infers nothing from a catalog tree inside node_modules', async () => {
    await write('node_modules/other/locales/fr/common.json', '{"nav":{"home":"Accueil"}}')

    await runInit({ cwd: root })

    expect(await read('loclizr.config.ts')).toContain("sourceLocale: 'en',")
    expect(await exists('locales/en.json')).toBe(true)
  })

  it('reads neither the meta sidecar nor the context record as a layout', async () => {
    await write('locales/en.meta.json', '{}')
    await write('locales/loclizr.context.json', '{}')

    const result = await runInit({ cwd: root })

    expect(result.output).toContain('wrote locales/en.json')
    expect(result.output).not.toContain('found')
  })

  it('infers nothing from a tree nested below locale and namespace', async () => {
    await write('locales/en/pages/checkout.json', '{"pay":"Pay"}')

    const result = await runInit({ cwd: root })

    expect(await read('loclizr.config.ts')).toContain("catalogs: 'locales/{locale}.json',")
    expect(result.output).toContain('wrote locales/en.json')
  })

  it('writes one file and touches no catalog when it found a split layout', async () => {
    await write('public/locales/en/common.json', '{"nav":{"home":"Home"}}')
    await write('public/locales/de/common.json', '{"nav":{"home":"Startseite"}}')

    await runInit({ cwd: root })
    const files = (await readdir(root, { recursive: true, withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort()

    expect(files).toEqual(['common.json', 'common.json', 'loclizr.config.ts'])
    expect(await read('public/locales/en/common.json')).toBe('{"nav":{"home":"Home"}}')
  })

  it('writes the same config into two copies of one split layout', async () => {
    const other = await mkdtemp(join(tmpdir(), 'loclizr-cli-init-split-'))
    try {
      for (const base of [root, other]) {
        for (const locale of ['en', 'de', 'fr']) {
          const file = join(base, 'public/locales', locale, 'common.json')
          await mkdir(join(file, '..'), { recursive: true })
          await writeFile(file, '{"nav":{"home":"Home"}}', 'utf8')
        }
      }

      await runInit({ cwd: root })
      await runInit({ cwd: other })

      expect(await readFile(join(other, 'loclizr.config.ts'), 'utf8')).toBe(
        await read('loclizr.config.ts'),
      )
    } finally {
      await rm(other, { recursive: true, force: true })
    }
  })
})

describe('init refuses a cwd it cannot write into', () => {
  it('reports failure rather than success when the cwd is a file', async () => {
    await write('package.json', '{"name":"app"}')

    const result = await runInit({ cwd: join(root, 'package.json') })

    expect(result.ok).toBe(false)
    expect(result.output).not.toContain('"predev"')
    expect(await read('package.json')).toBe('{"name":"app"}')
  })
})

describe('init is a deterministic function of what it found', () => {
  it('writes the same bytes into two empty directories', async () => {
    const other = await mkdtemp(join(tmpdir(), 'loclizr-cli-init-twin-'))
    try {
      await runInit({ cwd: root })
      await runInit({ cwd: other })

      expect(await readFile(join(other, 'loclizr.config.ts'), 'utf8')).toBe(
        await read('loclizr.config.ts'),
      )
      expect(await readFile(join(other, 'locales', 'en.json'), 'utf8')).toBe(
        await read('locales/en.json'),
      )
    } finally {
      await rm(other, { recursive: true, force: true })
    }
  })

  it('leaves both files byte identical on a second run', async () => {
    await runInit({ cwd: root })
    const config = await read('loclizr.config.ts')
    const catalog = await read('locales/en.json')

    const second = await runInit({ cwd: root })

    expect(second.ok).toBe(true)
    expect(await read('loclizr.config.ts')).toBe(config)
    expect(await read('locales/en.json')).toBe(catalog)
  })
})

describe('the printed wiring', () => {
  it('lists the four scripts in the order the spec prints them', async () => {
    const { output } = await runInit({ cwd: root })
    const order = ['prepare', 'predev', 'prebuild', 'pretypecheck'].map((name) =>
      output.indexOf(`"${name}":`),
    )

    expect(order.every((index) => index >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it('keeps --no-fail out of the CI step entirely', async () => {
    const { output } = await runInit({ cwd: root })
    const snippet = output.slice(output.indexOf('Add this step to CI'))

    expect(snippet).not.toContain('--no-fail')
    expect(snippet).toContain('loclizr check')
  })
})

describe('the retrofit config', () => {
  it('carries ambiguous-source on no uncommented line', async () => {
    await write('locales/en.json', JSON.stringify({ nav: { home: 'Home' } }))

    await runInit({ cwd: root })
    const live = (await read('loclizr.config.ts'))
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('//'))

    expect(live.some((line) => line.includes('ambiguous-source'))).toBe(false)
  })

  it('names no catalogFormat in either shape', async () => {
    await write('locales/en.json', JSON.stringify({ nav: { home: 'Home' } }))

    await runInit({ cwd: root })

    expect(await read('loclizr.config.ts')).not.toContain('catalogFormat')
  })
})

describe('--config', () => {
  it('prints a POSIX path for a nested target', async () => {
    const result = await runInit({ cwd: root, configPath: 'tools/config/loclizr.config.ts' })

    expect(result.output).toContain('wrote tools/config/loclizr.config.ts')
  })
})

function hasArrayLeaf(tree: unknown): boolean {
  if (Array.isArray(tree)) return true
  if (tree === null || typeof tree !== 'object') return false
  return Object.values(tree).some(hasArrayLeaf)
}

function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1
}
