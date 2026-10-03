import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { diag } from '../diagnostics'
import type { Config } from '../types'
import { config, generatedFile, program } from './__fixtures__/program'
import { fakeStages } from './__fixtures__/stages'
import { build } from './index'
import type { PipelineOptions, Stages } from './pipeline'
import { runPipeline } from './pipeline'

const RECORD = 'locales/loclizr.context.json'

let root = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'loclizr-exit-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

function options(overrides: Partial<PipelineOptions> = {}): PipelineOptions {
  return {
    mode: 'build',
    cwd: root,
    configPath: undefined,
    emit: true,
    maxWarnings: Number.POSITIVE_INFINITY,
    failOnError: true,
    ...overrides,
  }
}

function stages(overrides: Partial<Stages> = {}, settings: Partial<Config> = {}): Stages {
  const resolved = config({ root, ...settings })
  return fakeStages({
    loadConfig: () => Promise.resolve({ config: resolved, diagnostics: [] }),
    ...overrides,
  })
}

function codes(diagnostics: readonly { readonly code: string }[]): readonly string[] {
  return diagnostics.map((diagnostic) => diagnostic.code)
}

async function seed(path: string, contents: string): Promise<void> {
  const absolute = join(root, path)
  await mkdir(dirname(absolute), { recursive: true })
  await writeFile(absolute, contents, 'utf8')
}

async function read(path: string): Promise<string | null> {
  try {
    return await readFile(join(root, path), 'utf8')
  } catch {
    return null
  }
}

async function seedTree(): Promise<void> {
  await seed('locales/en.json', `${JSON.stringify({ nav: { home: 'Home', cart: 'Cart' } })}\n`)
  await seed('locales/de.json', `${JSON.stringify({ nav: { home: 'Startseite' } })}\n`)
}

describe('a fatal verdict from the emit stage', () => {
  it('keeps exit 1 under --no-fail, because nothing was written', async () => {
    const result = await runPipeline(
      stages({
        emit: () => ({
          files: [generatedFile('messages.js', 'export {}')],
          diagnostics: [diag('nondeterministic-output', { message: 'the replay differed' })],
        }),
      }),
      options({ failOnError: false }),
    )

    expect(codes(result.diagnostics)).toEqual(['LZ4005'])
    expect(result.written).toEqual([])
    expect(result.exitCode).toBe(1)
  })
})

describe('severity against the fatality scopes', () => {
  // The rule stops being fatal, which is what the exit code follows. It does
  // not stop being `always`, and that is what says no correct artifact exists:
  // the tree a collision would write holds one function declared twice.
  it('prints a fatal rule turned down to warn as a warning, writes nothing, and still exits 1', async () => {
    const result = await runPipeline(
      stages(
        {
          analyze: (input) =>
            program({
              config: input.config,
              diagnostics: [diag('identifier-collision', { message: 'nav.home and nav_home' })],
            }),
          emit: () => ({ files: [generatedFile('messages.js', 'export {}')], diagnostics: [] }),
        },
        { severity: { 'identifier-collision': 'warn' } },
      ),
      options(),
    )

    expect(result.diagnostics[0]?.severity).toBe('warn')
    expect(result.written).toEqual([])
    expect(await read('src/loclizr/messages.js')).toBeNull()
    expect(result.exitCode).toBe(1)
  })

  // 'off' cannot unblock the tree, so it cannot silence the one reason the run
  // wrote nothing and exited 1 either.
  it('writes nothing for a fatal rule turned off and still says why, as a warning', async () => {
    const result = await runPipeline(
      stages(
        {
          analyze: (input) =>
            program({
              config: input.config,
              diagnostics: [diag('identifier-reserved', { message: 'locales' })],
            }),
          emit: () => ({ files: [generatedFile('messages.js', 'export {}')], diagnostics: [] }),
        },
        { severity: { 'identifier-reserved': 'off' } },
      ),
      options(),
    )

    expect(codes(result.diagnostics)).toEqual(['LZ4002'])
    expect(result.diagnostics[0]?.severity).toBe('warn')
    expect(result.summary.warnings).toBe(1)
    expect(result.written).toEqual([])
    expect(result.exitCode).toBe(1)
  })

  it('says why a fatal catalog rule turned off halted the run before analyze', async () => {
    const result = await runPipeline(
      stages(
        {
          readCatalogs: () =>
            Promise.resolve({
              catalogs: [],
              meta: null,
              diagnostics: [diag('catalog-json-syntax', { message: 'locales/en.json' })],
            }),
        },
        { severity: { 'catalog-json-syntax': 'off' } },
      ),
      options(),
    )

    expect(codes(result.diagnostics)).toEqual(['LZ1009'])
    expect(result.diagnostics[0]?.severity).toBe('warn')
    expect(result.exitCode).toBe(1)
  })

  it('refuses to turn output-unwritable off', async () => {
    await seed('src/loclizr', 'outDir is a file\n')

    const result = await runPipeline(
      stages(
        { emit: () => ({ files: [generatedFile('messages.js', 'export {}')], diagnostics: [] }) },
        { severity: { 'output-unwritable': 'off' } },
      ),
      options(),
    )

    expect(codes(result.diagnostics)).toEqual(['LZ5001'])
    expect(result.diagnostics[0]?.severity).toBe('error')
    expect(result.exitCode).toBe(2)
  })
})

describe('a real catalog set whose identifiers collide, with the rule turned down', () => {
  it('writes no module for Node to refuse to parse', async () => {
    await seed('locales/en.json', `${JSON.stringify({ nav: { home: 'Home', cart: 'Cart' } })}\n`)
    await seed(
      'loclizr.config.mjs',
      `export default ${JSON.stringify({
        locales: ['en'],
        sourceLocale: 'en',
        identifiers: { 'nav.home': 'nav_cart' },
        severity: { 'identifier-collision': 'warn' },
      })}\n`,
    )

    const result = await build({ cwd: root })

    expect(codes(result.diagnostics)).toContain('LZ4001')
    expect(result.diagnostics.find((entry) => entry.code === 'LZ4001')?.severity).toBe('warn')
    expect(result.files).toEqual([])
    expect(await read('src/loclizr/messages/nav.js')).toBeNull()
    expect(await read(RECORD)).toBeNull()
    expect(result.exitCode).toBe(1)
  })
})

// The config stage resolves a usable config beside this one and leaves the
// verdict to the build, which is the shape the emit gate exists for.
describe('a real project whose catalogs are all missing, with the rule turned down', () => {
  it('writes no tree, because an empty one is not a correct artifact either', async () => {
    await seed(
      'loclizr.config.mjs',
      `export default ${JSON.stringify({
        locales: ['en'],
        sourceLocale: 'en',
        severity: { 'no-catalogs-found': 'warn' },
      })}\n`,
    )

    const result = await build({ cwd: root })

    // LZ1005 is the error here, and it is not the reason nothing was written:
    // a missing target catalog emits. LZ1003 is, at warn.
    expect(codes(result.diagnostics)).toEqual(['LZ1005', 'LZ1003'])
    expect(result.diagnostics[1]?.severity).toBe('warn')
    expect(result.files).toEqual([])
    expect(result.written).toEqual([])
    expect(await read('src/loclizr/messages.js')).toBeNull()
  })
})

describe('--no-fail over a real catalog set', () => {
  it('reports the same diagnostics as the gated run and still writes the tree', async () => {
    await seedTree()
    const gated = await build({ cwd: root })

    await rm(join(root, 'src/loclizr'), { recursive: true, force: true })
    await rm(join(root, RECORD), { force: true })
    const relaxed = await build({ cwd: root, failOnError: false })

    expect(gated.exitCode).toBe(1)
    expect(relaxed.exitCode).toBe(0)
    expect(relaxed.diagnostics).toEqual(gated.diagnostics)
    expect(relaxed.written).toEqual(gated.written)
    expect(await read('src/loclizr/messages/nav.js')).not.toBeNull()
  })

  it('still rewrites a stale record and still warns about it', async () => {
    await seedTree()
    await build({ cwd: root })
    await seed('locales/en.json', `${JSON.stringify({ nav: { home: 'Start', cart: 'Cart' } })}\n`)

    const relaxed = await build({ cwd: root, failOnError: false })

    expect(codes(relaxed.diagnostics)).toContain('LZ5007')
    expect(relaxed.written).toContain(RECORD)
    expect(relaxed.exitCode).toBe(0)
  })
})
