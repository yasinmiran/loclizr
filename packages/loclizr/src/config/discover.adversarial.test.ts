import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Config, Diagnostic, DiscoveredCatalog } from '../types'
import { toPosix } from '../util'
import { discoverCatalogs, loadConfig } from './index'
import type { LoadConfigResult } from './index'

let root = ''

beforeEach(async () => {
  root = toPosix(await realpath(await mkdtemp(join(tmpdir(), 'loclizr-discover-'))))
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

describe('basenames that are hostile rather than merely wrong', () => {
  it('reads the locale token as the whole stem, so a prototype name is never a locale', async () => {
    await catalogs(
      'locales/en.json',
      'locales/toString.json',
      'locales/constructor.json',
      'locales/__proto__.json',
      'locales/en-.json',
      'locales/en.json.json',
    )
    expect(files(await discoverCatalogs(root, 'locales/{locale}.json'))).toEqual([
      'locales/constructor.json',
      'locales/en-.json',
      'locales/en.json',
      'locales/toString.json',
    ])
  })

  it('keeps the tag Intl accepts and skips the two it rejects, without failing the build', async () => {
    await catalogs(
      'locales/en.json',
      'locales/toString.json',
      'locales/constructor.json',
      'locales/en-.json',
    )
    const result = await loadConfig({ cwd: root })
    expect(config(result).locales).toEqual(['en', 'toString'])
    expect(codes(result.diagnostics)).toEqual(['LZ1006', 'LZ1006', 'LZ1006'])
    expect(result.diagnostics.map((diagnostic) => diagnostic.file)).toEqual([
      'locales/constructor.json',
      'locales/en-.json',
      'locales/toString.json',
    ])
  })

  it('never reads a directory as a catalog', async () => {
    await catalogs('locales/en.json')
    await mkdir(join(root, 'locales/de.json'), { recursive: true })
    expect(files(await discoverCatalogs(root, 'locales/{locale}.json'))).toEqual([
      'locales/en.json',
    ])
  })
})

describe('the split layout', () => {
  it('holds both tokens to one segment each', async () => {
    await catalogs(
      'locales/en/common.json',
      'locales/en/__proto__.json',
      'locales/en/a.b.json',
      'locales/en/nested/deep.json',
      'locales/loclizr.context.json',
    )
    expect(await discoverCatalogs(root, 'locales/{locale}/{ns}.json')).toEqual([
      { locale: 'en', ns: '__proto__', file: 'locales/en/__proto__.json' },
      { locale: 'en', ns: 'common', file: 'locales/en/common.json' },
    ])
  })

  it('takes the directory name as the locale and names both the tag Intl rejects and the one no language uses', async () => {
    await catalogs('locales/en/common.json', 'locales/shared/common.json', 'locales/123/common.json')
    await write('loclizr.config.ts', "export default { catalogs: 'locales/{locale}/{ns}.json' }")
    const result = await loadConfig({ cwd: root })
    expect(config(result).locales).toEqual(['en', 'shared'])
    expect(codes(result.diagnostics)).toEqual(['LZ1006', 'LZ1006'])
    expect(result.diagnostics.map((diagnostic) => diagnostic.file)).toEqual([
      'locales/123/common.json',
      'locales/shared/common.json',
    ])
    expect(result.diagnostics[1]?.hint).toContain('declare `locales` explicitly')
  })
})

describe('a catalog the locale token cannot spell', () => {
  it('names the file it skipped instead of losing a locale in silence', async () => {
    await catalogs('locales/en.json', 'locales/en_US.json', 'locales/pt_BR.json')
    const result = await loadConfig({ cwd: root })
    expect(config(result).locales).toEqual(['en'])
    expect(codes(result.diagnostics)).toEqual(['LZ1006', 'LZ1006'])
    expect(result.diagnostics.map((diagnostic) => diagnostic.file)).toEqual([
      'locales/en_US.json',
      'locales/pt_BR.json',
    ])
  })

  it('says which file it skipped when those are the only catalogs on disk', async () => {
    await catalogs('locales/en_US.json')
    const result = await loadConfig({ cwd: root })
    expect(result.config).toBeNull()
    expect(codes(result.diagnostics)).toContain('LZ1006')
  })
})

describe('the artifacts a previous build left beside the catalogs', () => {
  it('never reads the meta sidecar or the record as a locale on the second build', async () => {
    await catalogs('locales/en.json', 'locales/de.json')
    await write('locales/en.meta.json', '{}')
    await write('locales/loclizr.context.json', '{"schema":1}')
    const result = await loadConfig({ cwd: root })
    expect(result.diagnostics).toEqual([])
    expect(config(result).locales).toEqual(['de', 'en'])
  })

  it('rejects a configured meta and record path whose basename is a valid tag', async () => {
    await catalogs('locales/en.json', 'locales/zz.json', 'locales/xx.json')
    await write(
      'loclizr.config.ts',
      "export default { record: 'locales/zz.json', meta: 'locales/xx.json' }",
    )
    const result = await loadConfig({ cwd: root })
    expect(result.config).toBeNull()
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['LZ1001', 'LZ1001'])
  })
})
