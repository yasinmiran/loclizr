import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Config, Diagnostic } from '../types'
import { toPosix } from '../util'
import { loadConfig, resolveConfig } from './index'
import type { LoadConfigResult } from './index'

let root = ''

beforeEach(async () => {
  root = toPosix(await realpath(await mkdtemp(join(tmpdir(), 'loclizr-record-leftover-'))))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function write(relative: string, contents: string): Promise<void> {
  const absolute = join(root, relative)
  await mkdir(dirname(absolute), { recursive: true })
  await writeFile(absolute, contents, 'utf8')
}

const RECORD = `${JSON.stringify(
  { schema: 1, sourceLocale: 'en', locales: ['de', 'en'], messages: [] },
  null,
  2,
)}\n`

async function project(): Promise<void> {
  await write('locales/en.json', '{"nav":{"home":"Home"}}')
  await write('locales/de.json', '{"nav":{"home":"Start"}}')
}

function config(result: LoadConfigResult): Config {
  expect(result.diagnostics.filter((diagnostic) => diagnostic.fatal)).toEqual([])
  expect(result.config).not.toBeNull()
  return result.config as Config
}

function about(diagnostics: readonly Diagnostic[], file: string): readonly Diagnostic[] {
  return diagnostics.filter((diagnostic) => diagnostic.file === file)
}

describe('a context record left under the catalog pattern', () => {
  it('is reported as a leftover record, never discovered as a locale', async () => {
    await project()
    await write('locales/context.json', RECORD)
    const result = await loadConfig({ cwd: root })
    expect(config(result).locales).toEqual(['de', 'en'])
    const reported = about(result.diagnostics, 'locales/context.json')
    expect(reported.map((diagnostic) => diagnostic.code)).toEqual(['LZ1006'])
    expect(reported[0]?.message).toContain('context record')
    expect(reported[0]?.hint).toContain('locales/loclizr.context.json')
    expect(reported[0]?.hint).toContain('delete')
  })

  it('is named as a record rather than an undeclared locale when locales is declared', async () => {
    await project()
    await write('locales/context.json', RECORD)
    await write('loclizr.config.mjs', "export default { locales: ['en', 'de'] }")
    const result = await loadConfig({ cwd: root })
    expect(config(result).locales).toEqual(['en', 'de'])
    const reported = about(result.diagnostics, 'locales/context.json')
    expect(reported.map((diagnostic) => diagnostic.code)).toEqual(['LZ1006'])
    expect(reported[0]?.message).toContain('context record')
  })

  it('names no record path to move to when record is false', async () => {
    await project()
    await write('locales/context.json', RECORD)
    await write('loclizr.config.mjs', 'export default { record: false }')
    const result = await loadConfig({ cwd: root })
    expect(config(result).locales).toEqual(['de', 'en'])
    const [reported] = about(result.diagnostics, 'locales/context.json')
    expect(reported?.hint).toContain('record is false')
  })

  it('leaves the record at the configured path alone', async () => {
    await project()
    await write('locales/loclizr.context.json', RECORD)
    const result = await loadConfig({ cwd: root })
    expect(config(result).locales).toEqual(['de', 'en'])
    expect(about(result.diagnostics, 'locales/loclizr.context.json')).toEqual([])
  })

  it('still reads a catalog whose schema key holds a translation', async () => {
    await project()
    await write('locales/fr.json', '{"schema":"Schéma"}')
    const result = await loadConfig({ cwd: root })
    expect(config(result).locales).toEqual(['de', 'en', 'fr'])
    expect(about(result.diagnostics, 'locales/fr.json')).toEqual([])
  })
})

describe('LZ1001 for a record path the catalogs pattern matches', () => {
  it('says to deal with a record a build already wrote there', () => {
    const result = resolveConfig({
      user: { record: 'locales/context.json' },
      root,
      discovered: [{ locale: 'en', ns: null, file: 'locales/en.json' }],
    })
    expect(result.config).toBeNull()
    const [invalid] = result.diagnostics
    expect(invalid?.code).toBe('LZ1001')
    expect(invalid?.hint).toContain('locales/context.json')
    expect(invalid?.hint).toContain('delete')
  })
})
