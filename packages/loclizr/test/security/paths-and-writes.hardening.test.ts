import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { runInit } from '../../src/cli/init'
import { build } from '../../src/compiler'
import { GENERATED_HEADER, syncOutput } from '../../src/compiler/output'
import type { OutputInput } from '../../src/compiler/output'
import type { EmittedFile } from '../../src/types'

const LOCALE_MODULE = `${GENERATED_HEADER}\nexport const locales = ['en']\n`

const FILES: readonly EmittedFile[] = [
  { path: '.gitignore', contents: '*\n!.gitignore\n' },
  { path: 'messages/_locale.js', contents: LOCALE_MODULE },
]

const OUTSIDE_GENERATED = `${GENERATED_HEADER}\n// a file the user owns, outside the project\n`
const OUTSIDE_RECORD = '{\n  "schema": 1,\n  "messages": []\n}\n'
const OUTSIDE_TEXT = 'a file the user owns, outside the project\n'
const RECORD_BYTES = '{\n  "schema": 1,\n  "sourceLocale": "en",\n  "messages": []\n}\n'

let base = ''
let project = ''
let outside = ''

beforeEach(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'loclizr-paths-')))
  project = join(base, 'project')
  outside = join(base, 'outside')
  await mkdir(join(project, 'src'), { recursive: true })
  await mkdir(outside, { recursive: true })
})

afterEach(async () => {
  await rm(base, { recursive: true, force: true })
})

function input(overrides: Partial<OutputInput> = {}): OutputInput {
  return { mode: 'build', root: project, outDir: 'src/loclizr', files: FILES, record: null, ...overrides }
}

async function listTree(dir: string): Promise<readonly string[]> {
  const entries = await readdir(dir, { recursive: true })
  return entries.map(String).sort()
}

async function caseInsensitive(): Promise<boolean> {
  const probe = await realpath(await mkdtemp(join(tmpdir(), 'loclizr-case-')))
  await writeFile(join(probe, 'a'), '', 'utf8')
  const folds = existsSync(join(probe, 'A'))
  await rm(probe, { recursive: true, force: true })
  return folds
}

const FOLDS_CASE = await caseInsensitive()

describe('outDir containment through links', () => {
  test('a link one level below outDir stops the write and leaves its target empty', async () => {
    await mkdir(join(project, 'src', 'loclizr'), { recursive: true })
    await symlink(outside, join(project, 'src', 'loclizr', 'messages'), 'dir')
    const result = await syncOutput(input())
    expect(result.written).toEqual([])
    expect(result.diagnostics.some((one) => one.rule === 'output-unwritable')).toBe(true)
    expect(await listTree(outside)).toEqual([])
  })

  test('a link at an intermediate directory of outDir is refused before anything is written', async () => {
    await rm(join(project, 'src'), { recursive: true, force: true })
    await symlink(outside, join(project, 'src'), 'dir')
    const result = await syncOutput(input())
    expect(result.written).toEqual([])
    expect(result.diagnostics.some((one) => one.rule === 'output-unwritable')).toBe(true)
    expect(await listTree(outside)).toEqual([])
  })

  test('a dangling link as outDir is refused and materialises nothing at its target', async () => {
    const target = join(outside, 'not-yet')
    await symlink(target, join(project, 'src', 'loclizr'), 'dir')
    const result = await syncOutput(input())
    expect(result.written).toEqual([])
    expect(result.diagnostics.some((one) => one.severity === 'error')).toBe(true)
    expect(existsSync(target)).toBe(false)
    expect(await listTree(outside)).toEqual([])
  })

  test('a link under outDir is neither pruned nor followed to its headered target', async () => {
    const outDir = join(project, 'src', 'loclizr')
    await mkdir(join(outDir, 'messages'), { recursive: true })
    await writeFile(join(outside, 'victim.js'), OUTSIDE_GENERATED, 'utf8')
    await symlink(join(outside, 'victim.js'), join(outDir, 'messages', 'orphan.js'), 'file')
    await syncOutput(input())
    expect(await readFile(join(outside, 'victim.js'), 'utf8')).toBe(OUTSIDE_GENERATED)
    expect((await listTree(outDir)).includes(join('messages', 'orphan.js'))).toBe(true)
  })
})

describe('the generated .gitignore', () => {
  test('a .gitignore already in outDir is left byte for byte and not reported as written', async () => {
    const outDir = join(project, 'src', 'loclizr')
    await mkdir(outDir, { recursive: true })
    const owned = '# the team commits this tree\n'
    await writeFile(join(outDir, '.gitignore'), owned, 'utf8')
    const result = await syncOutput(input())
    expect(await readFile(join(outDir, '.gitignore'), 'utf8')).toBe(owned)
    expect(result.written).not.toContain('src/loclizr/.gitignore')
    expect(result.written).toContain('src/loclizr/messages/_locale.js')
  })

  test('is written into an outDir the build creates', async () => {
    const result = await syncOutput(input())
    expect(result.written).toContain('src/loclizr/.gitignore')
  })
})

describe('a file this build did not create', () => {
  test('a headerless file at an emitted path is never overwritten', async () => {
    const outDir = join(project, 'src', 'loclizr')
    await mkdir(join(outDir, 'messages'), { recursive: true })
    await writeFile(join(outDir, 'messages', '_locale.js'), OUTSIDE_TEXT, 'utf8')
    const result = await syncOutput(input())
    expect(await readFile(join(outDir, 'messages', '_locale.js'), 'utf8')).toBe(OUTSIDE_TEXT)
    expect(result.diagnostics.some((one) => one.rule === 'outdir-foreign-file')).toBe(true)
  })

  test('a non-record file at the record path is never overwritten', async () => {
    await mkdir(join(project, 'locales'), { recursive: true })
    const catalog = '{ "nav": { "home": "Home" } }\n'
    await writeFile(join(project, 'locales', 'en.json'), catalog, 'utf8')
    const result = await syncOutput(input({ record: { path: 'locales/en.json', bytes: RECORD_BYTES } }))
    expect(await readFile(join(project, 'locales', 'en.json'), 'utf8')).toBe(catalog)
    expect(result.written).not.toContain('locales/en.json')
    expect(result.diagnostics.some((one) => one.rule === 'output-unwritable')).toBe(true)
  })
})

describe('the record path as a link pointing outside the project', () => {
  beforeEach(async () => {
    await mkdir(join(project, 'locales'), { recursive: true })
  })

  test('a link to an outside record is replaced, its target left untouched', async () => {
    await writeFile(join(outside, 'record.json'), OUTSIDE_RECORD, 'utf8')
    await symlink(join(outside, 'record.json'), join(project, 'locales', 'loclizr.context.json'), 'file')
    await syncOutput(input({ record: { path: 'locales/loclizr.context.json', bytes: RECORD_BYTES } }))
    expect(await readFile(join(outside, 'record.json'), 'utf8')).toBe(OUTSIDE_RECORD)
  })

  test('a link to an outside non-record is refused and its target left untouched', async () => {
    await writeFile(join(outside, 'notes.txt'), OUTSIDE_TEXT, 'utf8')
    await symlink(join(outside, 'notes.txt'), join(project, 'locales', 'loclizr.context.json'), 'file')
    const result = await syncOutput(
      input({ record: { path: 'locales/loclizr.context.json', bytes: RECORD_BYTES } }),
    )
    expect(await readFile(join(outside, 'notes.txt'), 'utf8')).toBe(OUTSIDE_TEXT)
    expect(result.written).not.toContain('locales/loclizr.context.json')
    expect(result.diagnostics.some((one) => one.rule === 'output-unwritable')).toBe(true)
  })
})

describe('check mode', () => {
  test('creates neither outDir nor the record', async () => {
    const result = await syncOutput(
      input({ mode: 'check', record: { path: 'locales/loclizr.context.json', bytes: RECORD_BYTES } }),
    )
    expect(result.written).toEqual([])
    expect(existsSync(join(project, 'src', 'loclizr'))).toBe(false)
    expect(existsSync(join(project, 'locales'))).toBe(false)
  })
})

describe('case-insensitive file systems', () => {
  test.skipIf(!FOLDS_CASE)(
    'a renamed module folding onto the old name keeps the file this build wrote',
    async () => {
      const outDir = join(project, 'src', 'loclizr')
      await mkdir(join(outDir, 'messages'), { recursive: true })
      await writeFile(join(outDir, 'messages', 'Nav.js'), `${GENERATED_HEADER}\n// old\n`, 'utf8')
      const fresh = `${GENERATED_HEADER}\nexport const nav = 1\n`
      await syncOutput(input({ files: [...FILES, { path: 'messages/nav.js', contents: fresh }] }))
      const modules = (await readdir(join(outDir, 'messages'))).filter((name) => name.toLowerCase() === 'nav.js')
      expect(modules).toHaveLength(1)
      expect(await readFile(join(outDir, 'messages', 'nav.js'), 'utf8')).toBe(fresh)
    },
  )
})

describe('init never overwrites', () => {
  test('an existing config and seed catalog keep their bytes', async () => {
    const config = 'export default { sourceLocale: "en" }\n'
    const catalog = '{ "hello": "Hello" }\n'
    await writeFile(join(project, 'loclizr.config.ts'), config, 'utf8')
    await mkdir(join(project, 'locales'), { recursive: true })
    await writeFile(join(project, 'locales', 'en.json'), catalog, 'utf8')
    await runInit({ cwd: project })
    expect(await readFile(join(project, 'loclizr.config.ts'), 'utf8')).toBe(config)
    expect(await readFile(join(project, 'locales', 'en.json'), 'utf8')).toBe(catalog)
  })

  test('a config path that is a link to an outside file is not written through', async () => {
    await writeFile(join(outside, 'victim.ts'), OUTSIDE_TEXT, 'utf8')
    await symlink(join(outside, 'victim.ts'), join(project, 'loclizr.config.ts'), 'file')
    const result = await runInit({ cwd: project, configPath: 'loclizr.config.ts' })
    expect(await readFile(join(outside, 'victim.ts'), 'utf8')).toBe(OUTSIDE_TEXT)
    expect(result.output).toContain('loclizr.config.ts already exists, left unchanged')
  })

  test('a dangling config link is not followed to create its target', async () => {
    const target = join(outside, 'created.ts')
    await symlink(target, join(project, 'loclizr.config.ts'), 'file')
    const result = await runInit({ cwd: project, configPath: 'loclizr.config.ts' })
    expect(existsSync(target)).toBe(false)
    expect(result.output).not.toContain('wrote loclizr.config.ts')
  })

  test('a seed catalog path that is a link to an outside file is not written through', async () => {
    await writeFile(join(outside, 'en.json'), '{}\n', 'utf8')
    await mkdir(join(project, 'locales'), { recursive: true })
    await symlink(join(outside, 'en.json'), join(project, 'locales', 'en.json'), 'file')
    await runInit({ cwd: project })
    expect(await readFile(join(outside, 'en.json'), 'utf8')).toBe('{}\n')
  })

  test('a dangling seed catalog link is not followed to create its target', async () => {
    const target = join(outside, 'seed.json')
    await mkdir(join(project, 'locales'), { recursive: true })
    await symlink(target, join(project, 'locales', 'en.json'), 'file')
    const result = await runInit({ cwd: project })
    expect(existsSync(target)).toBe(false)
    expect(result.output).not.toContain('wrote locales/en.json')
  })
})

describe('a build pointed at a project with a config somewhere else', () => {
  test('writes only under the project and never touches the config, catalog or meta', async () => {
    const elsewhere = join(base, 'elsewhere')
    const config = "export default { sourceLocale: 'en' }\n"
    const catalog = '{ "nav": { "home": "Home" } }\n'
    const meta = '{ "nav.home": { "description": "the home link" } }\n'
    await mkdir(elsewhere, { recursive: true })
    await mkdir(join(project, 'locales'), { recursive: true })
    await writeFile(join(elsewhere, 'loclizr.config.ts'), config, 'utf8')
    await writeFile(join(project, 'locales', 'en.json'), catalog, 'utf8')
    await writeFile(join(project, 'locales', 'en.meta.json'), meta, 'utf8')

    const result = await build({ cwd: project, configPath: '../elsewhere/loclizr.config.ts' })

    expect(result.written).toContain('locales/loclizr.context.json')
    expect(result.written.every((path) => path.startsWith('src/loclizr/') || path === 'locales/loclizr.context.json')).toBe(true)
    expect(await listTree(elsewhere)).toEqual(['loclizr.config.ts'])
    expect(await listTree(outside)).toEqual([])
    expect(await readFile(join(elsewhere, 'loclizr.config.ts'), 'utf8')).toBe(config)
    expect(await readFile(join(project, 'locales', 'en.json'), 'utf8')).toBe(catalog)
    expect(await readFile(join(project, 'locales', 'en.meta.json'), 'utf8')).toBe(meta)
  })
})
