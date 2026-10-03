import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { diag } from '../diagnostics'
import type { Config, Diagnostic } from '../types'
import { config, generatedFile, group, message, program } from './__fixtures__/program'
import { fakeStages } from './__fixtures__/stages'
import type { PipelineOptions, Stages } from './pipeline'
import { runPipeline } from './pipeline'

let root = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'loclizr-pipeline-edge-'))
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

async function exists(path: string): Promise<boolean> {
  try {
    await readFile(join(root, path), 'utf8')
    return true
  } catch {
    return false
  }
}

async function seed(path: string, contents: string): Promise<void> {
  const absolute = join(root, path)
  await mkdir(dirname(absolute), { recursive: true })
  await writeFile(absolute, contents, 'utf8')
}

const twoWarnings = (): Stages =>
  stages({
    runChecks: () => [
      diag('extra-translation', { message: 'de has nav.old', locale: 'de', key: 'nav.old' }),
      diag('extra-translation', { message: 'de has nav.older', locale: 'de', key: 'nav.older' }),
    ],
  })

describe('--max-warnings at its boundary', () => {
  it('exits 0 when the warning count equals the cap', async () => {
    expect((await runPipeline(twoWarnings(), options({ maxWarnings: 2 }))).exitCode).toBe(0)
  })

  it('exits 1 one warning over the cap', async () => {
    expect((await runPipeline(twoWarnings(), options({ maxWarnings: 1 }))).exitCode).toBe(1)
  })

  it('leaves ok true over the cap, because ok counts errors only', async () => {
    const result = await runPipeline(twoWarnings(), options({ maxWarnings: 0 }))

    expect(result.exitCode).toBe(1)
    expect(result.ok).toBe(true)
  })

  it('counts only what survived re-levelling against the cap', async () => {
    const result = await runPipeline(
      stages(
        {
          runChecks: () => [
            diag('extra-translation', { message: 'de has nav.old' }),
            diag('select-option-missing', { message: 'de lacks other' }),
          ],
        },
        { severity: { 'extra-translation': 'off' } },
      ),
      options({ maxWarnings: 1 }),
    )

    expect(codes(result.diagnostics)).toEqual(['LZ3008'])
    expect(result.exitCode).toBe(0)
  })

  it('exits 0 with an error rule turned down to warn under the default cap', async () => {
    const result = await runPipeline(
      stages(
        { runChecks: () => [diag('missing-translation', { message: 'de is missing nav.home' })] },
        { severity: { 'missing-translation': 'warn' } },
      ),
      options(),
    )

    expect(result.exitCode).toBe(0)
    expect(result.ok).toBe(true)
    expect(result.summary).toMatchObject({ errors: 0, warnings: 1 })
  })

  it('keeps check at exit 1 over the cap whatever failOnError says', async () => {
    const result = await runPipeline(
      twoWarnings(),
      options({ mode: 'check', maxWarnings: 0, failOnError: false }),
    )

    expect(result.exitCode).toBe(1)
  })
})

describe('a run asked not to emit', () => {
  it('runs no on-disk comparison in check, so a missing record is not stale', async () => {
    const result = await runPipeline(stages(), options({ mode: 'check', emit: false }))

    expect(result.diagnostics).toEqual([])
    expect(result.exitCode).toBe(0)
    expect(result.record).not.toBeNull()
  })

  it('never reaches the write step, so --no-fail leaves an error at exit 1', async () => {
    const result = await runPipeline(
      stages({ runChecks: () => [diag('missing-translation', { message: 'de is missing nav.home' })] }),
      options({ emit: false, failOnError: false }),
    )

    expect(result.exitCode).toBe(1)
    expect(result.written).toEqual([])
  })

  it('still returns the files emit produced', async () => {
    const result = await runPipeline(
      stages({ emit: () => ({ files: [generatedFile('messages.js', 'export {}')], diagnostics: [] }) }),
      options({ emit: false }),
    )

    expect(result.files.map((file) => file.path)).toEqual(['messages.js'])
    expect(await readdir(root)).toEqual([])
  })
})

describe('a fatal verdict raised by emit itself', () => {
  const nondeterministic = (): Stages =>
    stages({
      emit: () => ({
        files: [generatedFile('messages.js', 'export {}')],
        diagnostics: [diag('nondeterministic-output', { message: 'the replay differed' })],
      }),
    })

  it('still hands back the files it produced', async () => {
    const result = await runPipeline(nondeterministic(), options())

    expect(result.files.map((file) => file.path)).toEqual(['messages.js'])
  })

  it('writes neither the files nor the record', async () => {
    const result = await runPipeline(nondeterministic(), options())

    expect(result.written).toEqual([])
    expect(await exists('src/loclizr/messages.js')).toBe(false)
    expect(await exists('locales/loclizr.context.json')).toBe(false)
  })

  it('compares nothing in check, so nothing is reported stale', async () => {
    const result = await runPipeline(nondeterministic(), options({ mode: 'check' }))

    expect(codes(result.diagnostics)).toEqual(['LZ4005'])
  })
})

describe('the record path', () => {
  it('substitutes every {sourceLocale}, not only the first', async () => {
    const result = await runPipeline(
      stages({}, { sourceLocale: 'pt-BR', record: 'locales/{sourceLocale}/{sourceLocale}.context.json' }),
      options(),
    )

    expect(result.written).toEqual(['locales/pt-BR/pt-BR.context.json'])
  })

  it('leaves a path with no token exactly as written', async () => {
    const result = await runPipeline(stages({}, { record: 'context.json' }), options())

    expect(result.written).toEqual(['context.json'])
  })

  it('raises no record-stale in check when the record is switched off', async () => {
    const result = await runPipeline(stages({}, { record: false }), options({ mode: 'check' }))

    expect(result.diagnostics).toEqual([])
    expect(result.exitCode).toBe(0)
  })
})

describe('category claims about a locale Intl has no plural data for', () => {
  const locales = ['de', 'shared', 'en']

  it('keeps a category claim that names no locale at all', async () => {
    const result = await runPipeline(
      stages(
        { runChecks: () => [diag('plural-category-incomplete', { message: 'no locale named' })] },
        { locales },
      ),
      options({ emit: false }),
    )

    expect(codes(result.diagnostics)).toEqual(['LZ1019', 'LZ3007'])
  })

  it('keeps every other rule about that locale', async () => {
    const result = await runPipeline(
      stages(
        { runChecks: () => [diag('missing-translation', { message: 'shared lacks nav.home', locale: 'shared' })] },
        { locales },
      ),
      options({ emit: false }),
    )

    expect(codes(result.diagnostics)).toEqual(['LZ3001', 'LZ1019'])
  })

  it('leaves category claims from checkDescriptions to severity alone', async () => {
    const result = await runPipeline(
      stages(
        {
          checkDescriptions: () => [
            diag('plural-category-incomplete', { message: 'shared lacks one', locale: 'shared' }),
          ],
        },
        { locales },
      ),
      options({ emit: false }),
    )

    expect(codes(result.diagnostics)).toEqual(['LZ1019', 'LZ3007'])
  })

  it('raises one LZ1019 per guessed locale, each naming its declared tag', async () => {
    const result = await runPipeline(stages({}, { locales: ['xx', 'en', 'und'] }), options({ emit: false }))

    expect(result.diagnostics.map((diagnostic) => diagnostic.locale)).toEqual(['und', 'xx'])
  })

  it('raises nothing for a declared tag in odd casing or with an extension subtag', async () => {
    const result = await runPipeline(
      stages({}, { locales: ['EN', 'de-at', 'ar-u-nu-latn', 'en-x-private'] }),
      options({ emit: false }),
    )

    expect(result.diagnostics).toEqual([])
  })
})

describe('the order diagnostics come back in', () => {
  const produced: readonly Diagnostic[] = [
    diag('extra-translation', { message: 'b', file: 'locales/de.json', locale: 'de', key: 'b' }),
    diag('missing-translation', { message: 'a', file: 'locales/de.json', locale: 'de', key: 'a' }),
    diag('extra-translation', { message: 'a', file: 'locales/de.json', locale: 'de', key: 'a' }),
    diag('missing-translation', { message: 'z', file: 'locales/de-AT.json', locale: 'de-AT', key: 'z' }),
  ]

  it('is independent of the order the stages produced them in', async () => {
    const forward = await runPipeline(stages({ runChecks: () => produced }), options({ emit: false }))
    const reversed = await runPipeline(
      stages({ runChecks: () => produced.toReversed() }),
      options({ emit: false }),
    )

    expect(reversed.diagnostics).toEqual(forward.diagnostics)
  })

  it('is independent of which stage produced them', async () => {
    const split = await runPipeline(
      stages({
        runChecks: () => produced.slice(0, 2),
        checkDescriptions: () => produced.slice(2),
      }),
      options({ emit: false }),
    )
    const together = await runPipeline(stages({ runChecks: () => produced }), options({ emit: false }))

    expect(split.diagnostics).toEqual(together.diagnostics)
  })

  it('puts every error ahead of every warning', async () => {
    const result = await runPipeline(stages({ runChecks: () => produced }), options({ emit: false }))

    expect(result.diagnostics.map((diagnostic) => diagnostic.severity)).toEqual([
      'error',
      'error',
      'warn',
      'warn',
    ])
  })

  it('places an output diagnostic by the same sort as the rest', async () => {
    await seed('src/loclizr/keep.ts', 'export const keep = 1\n')

    const result = await runPipeline(
      stages({ runChecks: () => [diag('extra-translation', { message: 'de has nav.old' })] }),
      options(),
    )

    expect(codes(result.diagnostics)).toEqual(['LZ1021', 'LZ3003'])
  })
})

describe('the summary of a run that halted', () => {
  it('counts the declared locales when the source catalog stopped it', async () => {
    const result = await runPipeline(
      stages(
        {
          readCatalogs: () =>
            Promise.resolve({
              catalogs: [],
              meta: null,
              diagnostics: [diag('catalog-json-syntax', { message: 'locales/en.json', fatal: true })],
            }),
        },
        { locales: ['de', 'en', 'fr', 'it'] },
      ),
      options(),
    )

    expect(result.program).toBeNull()
    expect(result.summary).toEqual({ errors: 1, warnings: 0, messages: 0, locales: 4, fellBack: [] })
  })

  it('counts no locales when the config never resolved', async () => {
    const result = await runPipeline(
      stages({
        loadConfig: () =>
          Promise.resolve({ config: null, diagnostics: [diag('config-invalid', { message: 'bad' })] }),
      }),
      options(),
    )

    expect(result.summary.locales).toBe(0)
  })

  it('keeps a truncated ICU warning beside a config that never resolved', async () => {
    const result = await runPipeline(
      stages({
        icuDataComplete: () => false,
        loadConfig: () =>
          Promise.resolve({ config: null, diagnostics: [diag('config-invalid', { message: 'bad' })] }),
      }),
      options(),
    )

    expect(codes(result.diagnostics)).toEqual(['LZ1001', 'LZ1019'])
    expect(result.exitCode).toBe(2)
  })

  it('reads no catalogs when the config carried a fatal diagnostic beside a usable config', async () => {
    const readCatalogs = vi.fn(stages().readCatalogs)

    const result = await runPipeline(
      stages({
        readCatalogs,
        loadConfig: () =>
          Promise.resolve({
            config: config({ root }),
            diagnostics: [diag('locale-tag-invalid', { message: 'en_US is not a tag' })],
          }),
      }),
      options(),
    )

    expect(readCatalogs).not.toHaveBeenCalled()
    expect(result.summary.locales).toBe(3)
    expect(result.exitCode).toBe(1)
  })
})

describe('group membership handed to scan', () => {
  it('hands an empty group an empty member map that still cannot reach Object.prototype', async () => {
    const scan = vi.fn(stages().scan)

    await runPipeline(
      stages({
        scan,
        analyze: (input) => program({ config: input.config, groups: [group('empty', [])] }),
      }),
      options({ emit: false }),
    )

    const handed = scan.mock.calls[0]?.[0].groups[0]
    expect(handed?.memberIds).toEqual([])
    expect(Object.keys(handed?.memberProps ?? { stray: '' })).toEqual([])
    expect(handed?.memberProps['constructor']).toBeUndefined()
  })

  it('maps members named after prototype methods to their own ids', async () => {
    const scan = vi.fn(stages().scan)

    await runPipeline(
      stages({
        scan,
        analyze: (input) =>
          program({
            config: input.config,
            groups: [
              group('errors', [
                ['constructor', 'errors.constructor'],
                ['hasOwnProperty', 'errors.hasOwnProperty'],
                ['valueOf', 'errors.valueOf'],
              ]),
            ],
          }),
      }),
      options({ emit: false }),
    )

    const props = scan.mock.calls[0]?.[0].groups[0]?.memberProps
    expect(props?.['constructor']).toBe('errors_constructor')
    expect(props?.['hasOwnProperty']).toBe('errors_hasOwnProperty')
    expect(props?.['valueOf']).toBe('errors_valueOf')
  })

  it('hands scan the message ids in the order analyze produced them', async () => {
    const scan = vi.fn(stages().scan)
    const keys = ['z.last', '\u00e9.accent', 'A.upper', 'a.lower']

    await runPipeline(
      stages({
        scan,
        analyze: (input) =>
          program({ config: input.config, messages: keys.map((key) => message({ key })) }),
      }),
      options({ emit: false }),
    )

    expect(scan.mock.calls[0]?.[0].ids).toEqual(['z_last', '\u00e9_accent', 'A_upper', 'a_lower'])
  })
})
