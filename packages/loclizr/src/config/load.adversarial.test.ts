import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Config, Diagnostic } from '../types'
import { toPosix } from '../util'
import { CONFIG_FILENAMES, loadConfig } from './index'
import type { LoadConfigResult } from './index'

let root = ''

beforeEach(async () => {
  root = toPosix(await realpath(await mkdtemp(join(tmpdir(), 'loclizr-config-hostile-'))))
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

function byCode(diagnostics: readonly Diagnostic[], code: string): Diagnostic | undefined {
  return diagnostics.find((diagnostic) => diagnostic.code === code)
}

describe('a config module that misbehaves', () => {
  it('reports a field that throws when it is read', async () => {
    await catalogs('locales/en.json')
    await write(
      'loclizr.config.ts',
      [
        'export default {',
        '  get cookie(): string {',
        "    throw new Error('boom')",
        '  },',
        '}',
      ].join('\n'),
    )
    const result = await loadConfig({ cwd: root })
    expect(result.config).toBeNull()
    expect(codes(result.diagnostics)).toEqual(['LZ1001'])
    expect(result.diagnostics[0]?.message).toContain('boom')
  })

  it.each([
    ["export default Promise.resolve({ cookie: 'lang', outDir: 'app/gen' })"],
    ["export default new Map([['cookie', 'lang']])"],
    ["export default new Date('2026-01-01')"],
  ])('refuses a default export that is an object but not a configuration: %s', async (body) => {
    await catalogs('locales/en.json')
    await write('loclizr.config.ts', body)
    const result = await loadConfig({ cwd: root })
    expect(codes(result.diagnostics)).toEqual(['LZ1001'])
    expect(result.config).toBeNull()
  })

  it('reports a --config path that names a directory', async () => {
    await catalogs('locales/en.json')
    await mkdir(join(root, 'tools/alt.config.ts'), { recursive: true })
    const result = await loadConfig({ cwd: root, configPath: 'tools/alt.config.ts' })
    expect(result.config).toBeNull()
    expect(codes(result.diagnostics)).toEqual(['LZ1001'])
    expect(result.diagnostics[0]?.file).toBe('tools/alt.config.ts')
  })
})

describe('a config read twice in one process', () => {
  it.each(CONFIG_FILENAMES)(
    'sees the edit to %s, so a dev server rerunning build never serves a stale config',
    async (name) => {
      await catalogs('locales/en.json')
      await write('package.json', '{ "name": "app", "type": "module" }')
      await write(name, "export default { cookie: 'first' }")
      expect(config(await loadConfig({ cwd: root, configPath: name })).cookie).toBe('first')

      await write(name, "export default { cookie: 'second' }")
      expect(config(await loadConfig({ cwd: root, configPath: name })).cookie).toBe('second')
    },
  )

  it('keeps two roots loaded at the same time apart', async () => {
    const other = toPosix(await realpath(await mkdtemp(join(tmpdir(), 'loclizr-config-other-'))))
    try {
      await catalogs('locales/en.json')
      await write('loclizr.config.ts', "export default { cookie: 'from-root', outDir: 'a/gen' }")
      await writeFile(join(other, 'en.json'), '{"nav":{"home":"Home"}}', 'utf8')
      await writeFile(
        join(other, 'loclizr.config.mjs'),
        "export default { catalogs: '{locale}.json', cookie: 'from-other', outDir: 'b/gen' }",
        'utf8',
      )

      const [here, there] = await Promise.all([
        loadConfig({ cwd: root }),
        loadConfig({ cwd: other }),
      ])
      expect(config(here).cookie).toBe('from-root')
      expect(config(here).root).toBe(root)
      expect(config(here).outDir).toBe('a/gen')
      expect(config(there).cookie).toBe('from-other')
      expect(config(there).root).toBe(other)
      expect(config(there).outDir).toBe('b/gen')
    } finally {
      await rm(other, { recursive: true, force: true })
    }
  })
})

describe('a config outside the root', () => {
  it('loads it and keeps every reported path relative to the root', async () => {
    const shared = toPosix(await realpath(await mkdtemp(join(tmpdir(), 'loclizr-config-shared-'))))
    try {
      await catalogs('locales/en.json', 'locales/de-AT.json')
      await writeFile(
        join(shared, 'loclizr.config.ts'),
        "export default { locales: ['en', 'de-AT'], cookie: 'shared' }",
        'utf8',
      )
      const configPath = `../${basename(shared)}/loclizr.config.ts`

      const result = await loadConfig({ cwd: root, configPath })
      const resolved = config(result)
      expect(resolved.cookie).toBe('shared')
      expect(resolved.root).toBe(root)
      expect(byCode(result.diagnostics, 'LZ1018')?.file).toBe(configPath)
    } finally {
      await rm(shared, { recursive: true, force: true })
    }
  })
})
