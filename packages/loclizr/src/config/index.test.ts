import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Config, Diagnostic, DiscoveredCatalog } from '../types'
import { toPosix } from '../util'
import { CONFIG_FILENAMES, discoverCatalogs, loadConfig } from './index'
import type { LoadConfigResult } from './index'

let root = ''

beforeEach(async () => {
  root = toPosix(await realpath(await mkdtemp(join(tmpdir(), 'loclizr-config-'))))
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

function files(discovered: readonly DiscoveredCatalog[]): readonly string[] {
  return discovered.map((catalog) => catalog.file)
}

function codes(diagnostics: readonly Diagnostic[]): readonly string[] {
  return diagnostics.map((diagnostic) => diagnostic.code)
}

function config(result: LoadConfigResult): Config {
  expect(result.diagnostics.filter((diagnostic) => diagnostic.fatal)).toEqual([])
  expect(result.config).not.toBeNull()
  return result.config as Config
}

describe('CONFIG_FILENAMES', () => {
  it('is the fixed discovery order', () => {
    expect(CONFIG_FILENAMES).toEqual([
      'loclizr.config.ts',
      'loclizr.config.mts',
      'loclizr.config.js',
      'loclizr.config.mjs',
    ])
  })
})

describe('discoverCatalogs', () => {
  it('returns one entry per matched file, sorted, relative and POSIX', async () => {
    await catalogs('locales/en.json', 'locales/de.json', 'locales/de-AT.json')
    const found = await discoverCatalogs(root, 'locales/{locale}.json')
    expect(found).toEqual([
      { locale: 'de-AT', ns: null, file: 'locales/de-AT.json' },
      { locale: 'de', ns: null, file: 'locales/de.json' },
      { locale: 'en', ns: null, file: 'locales/en.json' },
    ])
  })

  it('never swallows the meta sidecar or the record beside the catalogs', async () => {
    await catalogs('locales/en.json', 'locales/en.meta.json', 'locales/loclizr.context.json')
    expect(files(await discoverCatalogs(root, 'locales/{locale}.json'))).toEqual([
      'locales/en.json',
    ])
  })

  it('never crosses a directory boundary', async () => {
    await catalogs('locales/en.json', 'locales/nested/fr.json')
    expect(files(await discoverCatalogs(root, 'locales/{locale}.json'))).toEqual([
      'locales/en.json',
    ])
  })

  it('skips a basename the locale token cannot spell', async () => {
    await catalogs('locales/en.json', 'locales/en_US.json')
    expect(files(await discoverCatalogs(root, 'locales/{locale}.json'))).toEqual([
      'locales/en.json',
    ])
  })

  it('reads the namespace out of a split layout', async () => {
    await catalogs(
      'public/locales/en/common.json',
      'public/locales/en/errors.json',
      'public/locales/de/common.json',
    )
    const found = await discoverCatalogs(root, 'public/locales/{locale}/{ns}.json')
    expect(found).toEqual([
      { locale: 'de', ns: 'common', file: 'public/locales/de/common.json' },
      { locale: 'en', ns: 'common', file: 'public/locales/en/common.json' },
      { locale: 'en', ns: 'errors', file: 'public/locales/en/errors.json' },
    ])
  })

  it('returns nothing for a pattern with no single locale token', async () => {
    await catalogs('locales/en.json')
    expect(await discoverCatalogs(root, 'locales/all.json')).toEqual([])
    expect(await discoverCatalogs(root, '{locale}/{locale}.json')).toEqual([])
  })

  it('returns nothing when the pattern matches no file', async () => {
    expect(await discoverCatalogs(root, 'locales/{locale}.json')).toEqual([])
  })

  it('returns nothing when the root does not exist', async () => {
    expect(await discoverCatalogs(join(root, 'absent'), 'locales/{locale}.json')).toEqual([])
  })
})

describe('loadConfig with no config file', () => {
  it('resolves the documented quickstart', async () => {
    await catalogs('locales/en.json', 'locales/de.json')
    const resolved = config(await loadConfig({ cwd: root }))
    expect(resolved.root).toBe(root)
    expect(resolved.locales).toEqual(['de', 'en'])
    expect(resolved.sourceLocale).toBe('en')
    expect(resolved.outDir).toBe('src/loclizr')
    expect(resolved.catalogFormat).toBe('auto')
  })

  it('reports LZ1003 against an empty tree', async () => {
    const result = await loadConfig({ cwd: root })
    expect(result.config).toBeNull()
    expect(codes(result.diagnostics)).toEqual(['LZ1003'])
  })
})

describe('loadConfig with a config file', () => {
  it('loads a TypeScript config through jiti', async () => {
    await catalogs('locales/en.json', 'locales/de.json')
    await write(
      'loclizr.config.ts',
      [
        'interface Shape {',
        '  locales: string[]',
        '  sourceLocale: string',
        '  groups: Record<string, string>',
        '}',
        "const value: Shape = { locales: ['en', 'de'], sourceLocale: 'en', groups: { errors: 'errors' } }",
        'export default value',
      ].join('\n'),
    )
    const resolved = config(await loadConfig({ cwd: root }))
    expect(resolved.locales).toEqual(['en', 'de'])
    expect(resolved.groups).toEqual({ errors: 'errors' })
  })

  it('loads an .mjs config', async () => {
    await catalogs('locales/en.json')
    await write('loclizr.config.mjs', "export default { cookie: 'lang' }")
    expect(config(await loadConfig({ cwd: root })).cookie).toBe('lang')
  })

  it('loads an .mts config', async () => {
    await catalogs('locales/en.json')
    await write('loclizr.config.mts', "const cookie: string = 'from-mts'\nexport default { cookie }")
    expect(config(await loadConfig({ cwd: root })).cookie).toBe('from-mts')
  })

  it('loads a CommonJS config', async () => {
    await catalogs('locales/en.json')
    await write('loclizr.config.js', "module.exports = { cookie: 'from-cjs' }")
    expect(config(await loadConfig({ cwd: root })).cookie).toBe('from-cjs')
  })

  it('takes the first name in discovery order', async () => {
    await catalogs('locales/en.json')
    await write('loclizr.config.ts', "export default { cookie: 'from-ts' }")
    await write('loclizr.config.js', "export default { cookie: 'from-js' }")
    expect(config(await loadConfig({ cwd: root })).cookie).toBe('from-ts')
  })

  it('takes an explicit configPath over discovery', async () => {
    await catalogs('locales/en.json')
    await write('loclizr.config.ts', "export default { cookie: 'from-ts' }")
    await write('tools/alt.config.ts', "export default { cookie: 'from-alt' }")
    expect(config(await loadConfig({ cwd: root, configPath: 'tools/alt.config.ts' })).cookie).toBe(
      'from-alt',
    )
  })

  it('drives discovery from the configured catalogs pattern', async () => {
    await catalogs('i18n/en/strings.json', 'i18n/de/strings.json', 'locales/fr.json')
    await write('loclizr.config.ts', "export default { catalogs: 'i18n/{locale}/strings.json' }")
    const resolved = config(await loadConfig({ cwd: root }))
    expect(resolved.locales).toEqual(['de', 'en'])
    expect(resolved.catalogs).toBe('i18n/{locale}/strings.json')
  })

  it('stamps the config file onto diagnostics that name no file of their own', async () => {
    await catalogs('locales/en.json', 'locales/de-AT.json')
    await write('loclizr.config.ts', "export default { locales: ['en', 'de-AT', 'fr'] }")
    const result = await loadConfig({ cwd: root })
    const byCode = new Map(result.diagnostics.map((diagnostic) => [diagnostic.code, diagnostic]))
    expect(byCode.get('LZ1018')?.file).toBe('loclizr.config.ts')
    expect(byCode.get('LZ1005')?.file).toBe('locales/fr.json')
  })
})

describe('a basename the locale token cannot spell', () => {
  it('names the directory of a split layout rather than losing the locale', async () => {
    await catalogs('locales/en/common.json', 'locales/en_US/common.json')
    await write('loclizr.config.ts', "export default { catalogs: 'locales/{locale}/{ns}.json' }")
    const result = await loadConfig({ cwd: root })
    expect(codes(result.diagnostics)).toEqual(['LZ1006'])
    expect(result.diagnostics[0]?.file).toBe('locales/en_US/common.json')
    expect(config(result).locales).toEqual(['en'])
  })

  it('reports a dotted namespace file as unread rather than claiming a locale for it', async () => {
    await catalogs('locales/en/common.json', 'locales/en/a.b.json')
    await write('loclizr.config.ts', "export default { catalogs: 'locales/{locale}/{ns}.json' }")
    const result = await loadConfig({ cwd: root })
    expect(codes(result.diagnostics)).toEqual(['LZ1006'])
    expect(result.diagnostics[0]?.file).toBe('locales/en/a.b.json')
    expect(result.diagnostics[0]?.locale).toBeNull()
    expect(config(result).locales).toEqual(['en'])
  })

  it('reports the meta sidecar once the project has switched meta off', async () => {
    await catalogs('locales/en.json')
    await write('locales/en.meta.json', '{}')
    await write('loclizr.config.ts', 'export default { meta: false }')
    const result = await loadConfig({ cwd: root })
    expect(codes(result.diagnostics)).toEqual(['LZ1006'])
    expect(result.diagnostics[0]?.file).toBe('locales/en.meta.json')
  })
})

describe('a catalog the pattern never reaches', () => {
  it('names the file and the one token that would pick it up', async () => {
    await catalogs('locales/en.json', 'locales/de.json', 'locales/fr/common.json')
    const result = await loadConfig({ cwd: root })
    expect(config(result).locales).toEqual(['de', 'en'])
    expect(codes(result.diagnostics)).toEqual(['LZ1006'])
    const diagnostic = result.diagnostics[0]
    expect(diagnostic?.file).toBe('locales/fr/common.json')
    expect(diagnostic?.message).toContain('locales/{locale}.json')
    expect(diagnostic?.hint).toContain("catalogs: 'locales/{locale}/{ns}.json'")
  })

  it('reports the first file once and counts the rest', async () => {
    await catalogs(
      'locales/en.json',
      'locales/fr/common.json',
      'locales/fr/errors.json',
      'locales/nb/common.json',
    )
    const result = await loadConfig({ cwd: root })
    expect(codes(result.diagnostics)).toEqual(['LZ1006'])
    expect(result.diagnostics[0]?.file).toBe('locales/fr/common.json')
    expect(result.diagnostics[0]?.message).toContain('2 more')
  })

  it('never counts the meta sidecar or the record, which the pattern is meant to miss', async () => {
    await catalogs('locales/en/common.json')
    await write('locales/en.meta.json', '{}')
    await write('locales/loclizr.context.json', '{"schema":1}')
    await write('loclizr.config.ts', "export default { catalogs: 'locales/{locale}/{ns}.json' }")
    const result = await loadConfig({ cwd: root })
    expect(result.diagnostics).toEqual([])
    expect(config(result).locales).toEqual(['en'])
  })

  it('never walks the whole project for a pattern with no directory of its own', async () => {
    await catalogs('en.json', 'src/fixtures/payload.json')
    await write('loclizr.config.ts', "export default { catalogs: '{locale}.json' }")
    const result = await loadConfig({ cwd: root })
    expect(result.diagnostics).toEqual([])
    expect(config(result).locales).toEqual(['en'])
  })

  it('never reads a dependency of the project it is compiling', async () => {
    await catalogs('locales/en.json', 'locales/node_modules/pkg/en/common.json')
    const result = await loadConfig({ cwd: root })
    expect(result.diagnostics).toEqual([])
  })

  it('stays quiet where the config could not be resolved at all', async () => {
    await catalogs('locales/fr/common.json')
    const result = await loadConfig({ cwd: root })
    expect(result.config).toBeNull()
    expect(codes(result.diagnostics)).toEqual(['LZ1003'])
  })
})

describe('loadConfig rejects a config it cannot use', () => {
  it('reports a missing configPath', async () => {
    await catalogs('locales/en.json')
    const result = await loadConfig({ cwd: root, configPath: 'tools/absent.config.ts' })
    expect(result.config).toBeNull()
    expect(codes(result.diagnostics)).toEqual(['LZ1001'])
    expect(result.diagnostics[0]?.file).toBe('tools/absent.config.ts')
  })

  it('reports a config that threw while loading', async () => {
    await catalogs('locales/en.json')
    await write('loclizr.config.ts', "throw new Error('boom')\nexport default {}")
    const result = await loadConfig({ cwd: root })
    expect(result.config).toBeNull()
    expect(codes(result.diagnostics)).toEqual(['LZ1001'])
    expect(result.diagnostics[0]?.message).toContain('boom')
    expect(result.diagnostics[0]?.fatal).toBe(true)
  })

  it('reports a default export that is not a configuration object', async () => {
    await catalogs('locales/en.json')
    for (const body of ['export default 7', 'export default [1]', 'export const x = 1']) {
      await write('loclizr.config.ts', body)
      const result = await loadConfig({ cwd: root })
      expect(result.config).toBeNull()
      expect(codes(result.diagnostics)).toEqual(['LZ1001'])
    }
  })

  it('keeps the loader error text free of the absolute path it was handed', async () => {
    await catalogs('locales/en.json')
    await write('loclizr.config.ts', 'export default { locales: [')
    const result = await loadConfig({ cwd: root })
    expect(codes(result.diagnostics)).toEqual(['LZ1001'])
    expect(result.diagnostics[0]?.message).toContain('loclizr.config.ts')
    expect(result.diagnostics[0]?.message).not.toContain(root)
  })

  it('takes a default export that has no prototype', async () => {
    await catalogs('locales/en.json')
    await write(
      'loclizr.config.ts',
      "export default Object.assign(Object.create(null), { cookie: 'bare' })",
    )
    expect(config(await loadConfig({ cwd: root })).cookie).toBe('bare')
  })

  it('reports a field the config got wrong, against the config file', async () => {
    await catalogs('locales/en.json')
    await write('loclizr.config.ts', "export default { outDir: '../outside' }")
    const result = await loadConfig({ cwd: root })
    expect(result.config).toBeNull()
    expect(codes(result.diagnostics)).toEqual(['LZ1007'])
    expect(result.diagnostics[0]?.file).toBe('loclizr.config.ts')
  })
})
