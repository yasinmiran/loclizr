import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Config, Diagnostic } from '../types'
import { toPosix } from '../util'
import { discoverCatalogs, loadConfig } from './index'
import type { LoadConfigResult } from './index'

let root = ''

beforeEach(async () => {
  root = toPosix(await realpath(await mkdtemp(join(tmpdir(), 'loclizr-config-edge-'))))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function write(relative: string, contents: string): Promise<void> {
  const absolute = join(root, relative)
  await mkdir(dirname(absolute), { recursive: true })
  await writeFile(absolute, contents, 'utf8')
}

async function catalogs(...relatives: readonly string[]): Promise<void> {
  for (const relative of relatives) await write(relative, '{"nav":{"home":"Home"}}')
}

function codes(diagnostics: readonly Diagnostic[]): readonly string[] {
  return diagnostics.map((diagnostic) => diagnostic.code)
}

function config(result: LoadConfigResult): Config {
  expect(result.diagnostics.filter((diagnostic) => diagnostic.fatal)).toEqual([])
  expect(result.config).not.toBeNull()
  return result.config as Config
}

async function rejectedConfig(body: string, file = 'loclizr.config.ts'): Promise<Diagnostic> {
  await catalogs('locales/en.json')
  await write(file, body)
  const result = await loadConfig({ cwd: root })
  expect(result.config).toBeNull()
  expect(codes(result.diagnostics)).toEqual(['LZ1001'])
  const [diagnostic] = result.diagnostics
  expect(diagnostic?.file).toBe(file)
  return diagnostic as Diagnostic
}

describe('config source text', () => {
  it('loads a config that starts with a byte order mark', async () => {
    await catalogs('locales/en.json')
    await write('loclizr.config.ts', "﻿export default { cookie: 'bom' }\n")
    expect(config(await loadConfig({ cwd: root })).cookie).toBe('bom')
  })

  it('loads a config written with CRLF line endings', async () => {
    await catalogs('locales/en.json')
    await write('loclizr.config.ts', "const name: string = 'crlf'\r\nexport default {\r\n  cookie: name,\r\n}\r\n")
    expect(config(await loadConfig({ cwd: root })).cookie).toBe('crlf')
  })

  it('loads a config written with lone CR line endings', async () => {
    await catalogs('locales/en.json')
    await write('loclizr.config.ts', "const name: string = 'cr'\rexport default {\r  cookie: name,\r}\r")
    expect(config(await loadConfig({ cwd: root })).cookie).toBe('cr')
  })

  it('keeps non-ASCII text in a config value intact', async () => {
    await catalogs('locales/en.json')
    await write('loclizr.config.ts', "export default { outDir: 'src/ロケ' }")
    expect(config(await loadConfig({ cwd: root })).outDir).toBe('src/ロケ')
  })

  it('loads an .mjs config that awaits at the top level', async () => {
    await catalogs('locales/en.json')
    await write('loclizr.config.mjs', "const name = await Promise.resolve('later')\nexport default { cookie: name }")
    expect(config(await loadConfig({ cwd: root })).cookie).toBe('later')
  })

  it('loads a class instance whose own fields carry the configuration', async () => {
    await catalogs('locales/en.json')
    await write('loclizr.config.ts', "class Settings { cookie = 'cls' }\nexport default new Settings()")
    expect(config(await loadConfig({ cwd: root })).cookie).toBe('cls')
  })
})

describe('a config file that says nothing', () => {
  it('resolves the defaults from an empty file without a diagnostic', async () => {
    await catalogs('locales/en.json')
    await write('loclizr.config.ts', '')
    const result = await loadConfig({ cwd: root })
    expect(result.diagnostics).toEqual([])
    expect(config(result)).toEqual(config(await loadConfig({ cwd: root, configPath: 'loclizr.config.ts' })))
  })

  it('resolves the defaults from a whitespace-only file', async () => {
    await catalogs('locales/en.json')
    await write('loclizr.config.ts', ' \r\n\t\n')
    expect(config(await loadConfig({ cwd: root })).sourceLocale).toBe('en')
  })

  it('resolves the defaults from an empty object', async () => {
    await catalogs('locales/en.json')
    await write('loclizr.config.ts', 'export default {}')
    const withFile = await loadConfig({ cwd: root })
    expect(withFile.diagnostics).toEqual([])
    expect(config(withFile).outDir).toBe('src/loclizr')
  })
})

describe('a default export that is not a configuration object', () => {
  it.each([
    ['a promise', 'export default Promise.resolve({})'],
    ['a function', 'export default () => ({})'],
    ['false', 'export default false'],
    ['a string', "export default 'en'"],
    ['a Map', 'export default new Map()'],
  ])('rejects %s, naming the config file', async (_label, body) => {
    const diagnostic = await rejectedConfig(body)
    expect(diagnostic.message).toContain('default export')
  })

  it('rejects a config that throws a value that is not an Error', async () => {
    const diagnostic = await rejectedConfig("throw 'boom'\nexport default {}")
    expect(diagnostic.message).toContain('boom')
  })

  it('rejects a config that throws undefined', async () => {
    const diagnostic = await rejectedConfig('throw undefined\nexport default {}')
    expect(diagnostic.message).toContain('threw while loading')
  })

  it.each([
    ['undefined', 'export default undefined'],
    ['undefined beside a named export', "export const outDir = 'gen'\nexport default undefined"],
    ['null', 'export default null'],
  ])('rejects %s as a missing default export', async (_label, body) => {
    const diagnostic = await rejectedConfig(body)
    expect(diagnostic.message).toBe('loclizr.config.ts must export its configuration as the default export.')
  })

  it.each([
    ['null', 'module.exports = null'],
    ['undefined', 'module.exports = undefined'],
  ])('rejects a CommonJS export of %s as a missing configuration', async (_label, body) => {
    const diagnostic = await rejectedConfig(body, 'loclizr.config.js')
    expect(diagnostic.message).toBe('loclizr.config.js must export its configuration as the default export.')
  })

  it('still reports a config whose own code reads then off null as having thrown', async () => {
    const diagnostic = await rejectedConfig('const value = null\nvalue.then\nexport default {}')
    expect(diagnostic.message).toContain('threw while loading')
  })

  it('accepts a namespace import handed over as the configuration', async () => {
    await catalogs('locales/en.json')
    await write('base.ts', "export const cookie = 'base'")
    await write('loclizr.config.ts', "import * as base from './base'\nexport default base")
    expect(config(await loadConfig({ cwd: root })).cookie).toBe('base')
  })
})

describe('locating the config', () => {
  it('ignores a .cjs config, which is not on the discovery list', async () => {
    await catalogs('locales/en.json')
    await write('loclizr.config.cjs', "module.exports = { cookie: 'cjs' }")
    expect(config(await loadConfig({ cwd: root })).cookie).toBe('locale')
  })

  it('skips a directory carrying a config filename and takes the next file', async () => {
    await catalogs('locales/en.json')
    await write('loclizr.config.ts/placeholder', '')
    await write('loclizr.config.mjs', "export default { cookie: 'mjs' }")
    expect(config(await loadConfig({ cwd: root })).cookie).toBe('mjs')
  })

  it('reads a configPath spelled with backslashes', async () => {
    await catalogs('locales/en.json')
    await write('cfg/my.config.ts', "export default { cookie: 'bs' }")
    expect(config(await loadConfig({ cwd: root, configPath: 'cfg\\my.config.ts' })).cookie).toBe('bs')
  })

  it('reads an absolute configPath and reports it relative to the root', async () => {
    await catalogs('locales/en.json')
    await write('cfg/broken.config.ts', "export default { cookie: 'a b' }")
    const result = await loadConfig({ cwd: root, configPath: `${root}/cfg/broken.config.ts` })
    expect(result.config).toBeNull()
    expect(result.diagnostics[0]?.file).toBe('cfg/broken.config.ts')
  })

  it('resolves the same root from a cwd spelled with a trailing slash', async () => {
    await catalogs('locales/en.json')
    expect(config(await loadConfig({ cwd: `${root}/` })).root).toBe(root)
  })
})

describe('discovery against hostile names on disk', () => {
  it.each([
    ['a non-ASCII stem', 'locales/日本.json'],
    ['a right-to-left mark', 'locales/de‏.json'],
    ['an emoji', 'locales/\u{1F1E9}\u{1F1EA}.json'],
    ['a stem of one dash', 'locales/-.json'],
  ])('skips %s with one warning naming the file', async (_label, file) => {
    await catalogs('locales/en.json', file)
    const result = await loadConfig({ cwd: root })
    expect(config(result).locales).toEqual(['en'])
    expect(codes(result.diagnostics)).toEqual(['LZ1006'])
    expect(result.diagnostics[0]?.file).toBe(file)
    expect(result.diagnostics[0]?.severity).toBe('warn')
  })

  it('reads a catalog with an extension subtag as its own locale', async () => {
    await catalogs('locales/en.json', 'locales/en-u-ca-buddhist.json')
    const result = await loadConfig({ cwd: root })
    expect(result.diagnostics).toEqual([])
    expect(config(result).locales).toEqual(['en', 'en-u-ca-buddhist'])
  })

  it('never reads a hidden file as a catalog', async () => {
    await catalogs('locales/en.json', 'locales/.de.json')
    const result = await loadConfig({ cwd: root })
    expect(result.diagnostics).toEqual([])
    expect(config(result).locales).toEqual(['en'])
  })

  it('never reads a catalog under node_modules inside the catalog directory', async () => {
    await catalogs('locales/en.json', 'locales/node_modules/de.json')
    const result = await loadConfig({ cwd: root })
    expect(result.diagnostics).toEqual([])
    expect(config(result).locales).toEqual(['en'])
  })

  it('does not read the contents of a catalog to discover it', async () => {
    await write('locales/en.json', '﻿{ not json')
    expect(config(await loadConfig({ cwd: root })).locales).toEqual(['en'])
  })
})

describe('a catalogs pattern outside the usual shapes', () => {
  it('discovers catalogs in a sibling of the root through a parent segment', async () => {
    await write('app/loclizr.config.ts', "export default { catalogs: '../shared/{locale}.json' }")
    await write('shared/en.json', '{}')
    await write('shared/de.json', '{}')
    const result = await loadConfig({ cwd: join(root, 'app') })
    expect(config(result).locales).toEqual(['de', 'en'])
  })

  it('names a stray file beside a parent-relative pattern relative to the root', async () => {
    await write('app/loclizr.config.ts', "export default { catalogs: '../shared/{locale}.json' }")
    await write('shared/en.json', '{}')
    await write('shared/fr/common.json', '{}')
    const result = await loadConfig({ cwd: join(root, 'app') })
    expect(codes(result.diagnostics)).toEqual(['LZ1006'])
    expect(result.diagnostics[0]?.file).toBe('../shared/fr/common.json')
  })

  it('discovers a namespace directory that comes before the locale', async () => {
    await write('loclizr.config.ts', "export default { catalogs: 'locales/{ns}/{locale}.json' }")
    await catalogs('locales/common/en.json', 'locales/common/de.json', 'locales/errors/en.json')
    const found = await discoverCatalogs(root, 'locales/{ns}/{locale}.json')
    expect(found).toEqual([
      { locale: 'de', ns: 'common', file: 'locales/common/de.json' },
      { locale: 'en', ns: 'common', file: 'locales/common/en.json' },
      { locale: 'en', ns: 'errors', file: 'locales/errors/en.json' },
    ])
    expect(config(await loadConfig({ cwd: root })).locales).toEqual(['de', 'en'])
  })

  it('reads an absolute pattern under the root as relative', async () => {
    await catalogs('locales/en.json', 'locales/de.json')
    const found = await discoverCatalogs(root, `${root}/locales/{locale}.json`)
    expect(found.map((catalog) => catalog.file)).toEqual(['locales/de.json', 'locales/en.json'])
  })

  it('falls back to the default pattern for discovery when catalogs is not a string, then rejects it', async () => {
    await catalogs('locales/en.json')
    await write('loclizr.config.ts', 'export default { catalogs: 42 }')
    const result = await loadConfig({ cwd: root })
    expect(result.config).toBeNull()
    expect(codes(result.diagnostics)).toEqual(['LZ1001'])
    expect(result.diagnostics[0]?.message).toContain('catalogs')
  })
})

describe('determinism across two loads', () => {
  it('returns an equal result for the same tree twice', async () => {
    await catalogs(
      'locales/en.json',
      'locales/de.json',
      'locales/de-AT.json',
      'locales/en_US.json',
      'locales/fr/common.json',
      'locales/fr/errors.json',
    )
    await write('loclizr.config.ts', "export default { locales: ['en', 'de', 'de-AT'] }")
    const first = await loadConfig({ cwd: root })
    const second = await loadConfig({ cwd: root })
    expect(second).toEqual(first)
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
  })

  it('carries no absolute path in any diagnostic', async () => {
    await catalogs('locales/en.json', 'locales/xx_YY.json', 'locales/fr/common.json')
    await write('loclizr.config.ts', "export default { locales: ['en', 'de'] }")
    const result = await loadConfig({ cwd: root })
    expect(result.diagnostics.length).toBeGreaterThan(0)
    expect(JSON.stringify(result.diagnostics)).not.toContain(root)
  })
})
