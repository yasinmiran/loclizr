import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { diag } from '../diagnostics'
import type { Config, Diagnostic, LocaleOrigin, Message, MessageUsage, Program } from '../types'
import { config, contextRecord, generatedFile, group, message, program } from './__fixtures__/program'
import { fakeStages, traced } from './__fixtures__/stages'
import type { PipelineOptions, Stages } from './pipeline'
import { runPipeline } from './pipeline'

let root = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'loclizr-pipeline-'))
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

const usage: MessageUsage = {
  id: 'nav_home',
  sites: [{ file: 'src/Nav.tsx', line: 3, column: 5, scope: 'Nav', snippet: 'm.nav_home()' }],
}

describe('the build sequence', () => {
  it('runs the stages in the order the spec fixes', async () => {
    const calls: string[] = []
    await runPipeline(traced(stages(), calls), options({ emit: false }))

    expect(calls).toEqual([
      'icuDataComplete',
      'loadConfig',
      'readCatalogs',
      'analyze',
      'runChecks',
      'checkDescriptions',
      'scan',
      'emit',
      'buildRecord',
      'serializeRecord',
    ])
  })

  it('hands analyze the catalogs and meta that readCatalogs produced', async () => {
    const meta = { file: 'locales/en.meta.json', entries: [] }
    const catalogs = [
      { locale: 'en', ns: null, file: 'locales/en.json', format: 'icu' as const, entries: [] },
    ]
    const analyze = vi.fn(stages().analyze)

    await runPipeline(
      stages({ analyze, readCatalogs: () => Promise.resolve({ catalogs, meta, diagnostics: [] }) }),
      options({ emit: false }),
    )

    expect(analyze).toHaveBeenCalledWith({ config: config({ root }), catalogs, meta })
  })

  it('hands scan every message id and each group membership', async () => {
    const scan = vi.fn(stages().scan)
    const analyzed = program({
      config: config({ root }),
      messages: [message({ key: 'errors.forbidden' }), message({ key: 'errors.rate_limited' })],
      groups: [
        group('errors', [
          ['forbidden', 'errors.forbidden'],
          ['rate_limited', 'errors.rate_limited'],
        ]),
      ],
    })

    await runPipeline(stages({ scan, analyze: () => analyzed }), options({ emit: false }))

    expect(scan).toHaveBeenCalledWith({
      config: config({ root }),
      ids: ['errors_forbidden', 'errors_rate_limited'],
      groups: [
        {
          id: 'errors',
          memberIds: ['errors_forbidden', 'errors_rate_limited'],
          memberProps: { forbidden: 'errors_forbidden', rate_limited: 'errors_rate_limited' },
        },
      ],
    })
  })

  it('fills Program.usages from the scan before emit and buildRecord see it', async () => {
    const seen: Program[] = []

    const result = await runPipeline(
      stages({
        scan: () => Promise.resolve({ usages: [usage], diagnostics: [] }),
        emit: (input) => {
          seen.push(input)
          return { files: [], diagnostics: [] }
        },
        buildRecord: (input) => {
          seen.push(input)
          return contextRecord([])
        },
      }),
      options({ emit: false }),
    )

    expect(seen).toHaveLength(2)
    expect(seen[0]?.usages).toEqual([usage])
    expect(seen[1]).toBe(seen[0])
    expect(result.program?.usages).toEqual([usage])
  })

  it('stops at loadConfig when the config could not be resolved', async () => {
    const readCatalogs = vi.fn(stages().readCatalogs)

    const result = await runPipeline(
      stages({
        readCatalogs,
        loadConfig: () =>
          Promise.resolve({
            config: null,
            diagnostics: [diag('config-invalid', { message: 'catalogs must be a string' })],
          }),
      }),
      options(),
    )

    expect(readCatalogs).not.toHaveBeenCalled()
    expect(result.program).toBeNull()
    expect(result.exitCode).toBe(2)
    expect(codes(result.diagnostics)).toEqual(['LZ1001'])
  })

  it('exits 1, not 2, when the config is fatal but the tool could still run', async () => {
    const result = await runPipeline(
      stages({
        loadConfig: () =>
          Promise.resolve({
            config: null,
            diagnostics: [diag('no-catalogs-found', { message: 'nothing matched' })],
          }),
      }),
      options(),
    )

    expect(result.exitCode).toBe(1)
  })

  it('stops after readCatalogs when the source catalog is unreadable', async () => {
    const analyze = vi.fn(stages().analyze)

    const result = await runPipeline(
      stages({
        analyze,
        readCatalogs: () =>
          Promise.resolve({
            catalogs: [],
            meta: null,
            diagnostics: [
              diag('catalog-unreadable', { message: 'locales/en.json is unreadable', fatal: true }),
            ],
          }),
      }),
      options(),
    )

    expect(analyze).not.toHaveBeenCalled()
    expect(result.exitCode).toBe(1)
    expect(result.program).toBeNull()
  })

  it('keeps analyzing when an unreadable target catalog is not fatal', async () => {
    const analyze = vi.fn(stages().analyze)

    await runPipeline(
      stages({
        analyze,
        readCatalogs: () =>
          Promise.resolve({
            catalogs: [],
            meta: null,
            diagnostics: [
              diag('catalog-unreadable', { message: 'locales/de.json is unreadable', fatal: false }),
            ],
          }),
      }),
      options({ emit: false }),
    )

    expect(analyze).toHaveBeenCalled()
  })

  it('does not emit at all when a fatal diagnostic already survives', async () => {
    const emit = vi.fn(() => ({ files: [generatedFile('messages.js', 'export {}')], diagnostics: [] }))

    const result = await runPipeline(
      stages({
        emit,
        analyze: (input) =>
          program({
            config: input.config,
            diagnostics: [diag('identifier-collision', { message: 'nav.home and nav_home' })],
          }),
      }),
      options(),
    )

    expect(emit).not.toHaveBeenCalled()
    expect(result.files).toEqual([])
    expect(result.written).toEqual([])
    expect(await exists('src/loclizr/messages.js')).toBe(false)
    expect(result.exitCode).toBe(1)
  })

  // Emission follows the rule's fatality scope and the exit code follows its
  // severity, so turning an `always` rule down cannot produce a tree.
  it('does not emit for a fatal rule the config turned down', async () => {
    const emit = vi.fn(() => ({ files: [generatedFile('messages.js', 'export {}')], diagnostics: [] }))

    const result = await runPipeline(
      stages(
        {
          emit,
          analyze: (input) =>
            program({
              config: input.config,
              diagnostics: [diag('identifier-collision', { message: 'nav.home and nav_home' })],
            }),
        },
        { severity: { 'identifier-collision': 'warn' } },
      ),
      options(),
    )

    expect(emit).not.toHaveBeenCalled()
    expect(result.written).toEqual([])
    expect(await exists('src/loclizr/messages.js')).toBe(false)
  })

  // A config that resolved far enough to be usable still arrives beside the
  // diagnostic saying no correct artifact exists, and the build stops there.
  it('stops before readCatalogs when a config diagnostic is fatal at any severity', async () => {
    const readCatalogs = vi.fn(stages().readCatalogs)

    const result = await runPipeline(
      stages({
        readCatalogs,
        loadConfig: (input) =>
          Promise.resolve({
            config: config({ root: input.cwd, severity: { 'no-catalogs-found': 'warn' } }),
            diagnostics: [diag('no-catalogs-found', { message: 'nothing matched' })],
          }),
      }),
      options(),
    )

    expect(readCatalogs).not.toHaveBeenCalled()
    expect(codes(result.diagnostics)).toEqual(['LZ1003'])
    expect(result.diagnostics[0]?.severity).toBe('warn')
    expect(result.exitCode).toBe(0)
  })

  it('hands scan a group membership map that cannot reach Object.prototype', async () => {
    const scan = vi.fn(stages().scan)

    await runPipeline(
      stages({
        scan,
        analyze: (input) =>
          program({
            config: input.config,
            groups: [
              group('errors', [
                ['__proto__', 'errors.__proto__'],
                ['toString', 'errors.toString'],
              ]),
            ],
          }),
      }),
      options({ emit: false }),
    )

    const props = scan.mock.calls[0]?.[0].groups[0]?.memberProps
    expect(Object.getPrototypeOf(props)).toBeNull()
    expect(Object.keys(props ?? {}).toSorted()).toEqual(['__proto__', 'toString'])
    expect(props?.['__proto__']).toBe('errors___proto__')
    expect(props?.['toString']).toBe('errors_toString')
    expect(props?.['hasOwnProperty']).toBeUndefined()
  })
})

describe('exit codes', () => {
  it('exits 0 on a clean run', async () => {
    const result = await runPipeline(stages(), options())

    expect(result.exitCode).toBe(0)
    expect(result.ok).toBe(true)
  })

  it('exits 1 on an error', async () => {
    const result = await runPipeline(
      stages({ runChecks: () => [diag('missing-translation', { message: 'de is missing nav.home' })] }),
      options(),
    )

    expect(result.exitCode).toBe(1)
    expect(result.ok).toBe(false)
  })

  it('leaves warnings uncapped by default and exits 1 over --max-warnings', async () => {
    const warnings = stages({
      runChecks: () => [diag('extra-translation', { message: 'de has nav.old' })],
    })

    expect((await runPipeline(warnings, options())).exitCode).toBe(0)
    expect((await runPipeline(warnings, options({ maxWarnings: 0 }))).exitCode).toBe(1)
  })
})

describe('--no-fail', () => {
  const failing = (): Stages =>
    stages({
      runChecks: () => [diag('missing-translation', { message: 'de is missing nav.home' })],
      emit: () => ({ files: [generatedFile('messages.js', 'export {}')], diagnostics: [] }),
    })

  it('changes the exit code and nothing else once output was written', async () => {
    const gated = await runPipeline(failing(), options())
    const relaxed = await runPipeline(failing(), options({ failOnError: false }))

    expect(gated.exitCode).toBe(1)
    expect(relaxed.exitCode).toBe(0)
    expect(relaxed.diagnostics).toEqual(gated.diagnostics)
    expect(relaxed.summary).toEqual(gated.summary)
    expect(await exists('src/loclizr/messages.js')).toBe(true)
  })

  it('still reports exit 0 when the write step changed no bytes', async () => {
    await runPipeline(failing(), options())
    const second = await runPipeline(failing(), options({ failOnError: false }))

    expect(second.written).toEqual([])
    expect(second.exitCode).toBe(0)
  })

  it('never lowers exit 2', async () => {
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(join(root, 'src/loclizr'), 'outDir is a file\n', 'utf8')

    const result = await runPipeline(failing(), options({ failOnError: false }))

    expect(codes(result.diagnostics)).toContain('LZ5001')
    expect(result.exitCode).toBe(2)
  })

  it('never lowers a run that produced no output', async () => {
    const result = await runPipeline(
      stages({
        analyze: (input) =>
          program({
            config: input.config,
            diagnostics: [diag('identifier-collision', { message: 'nav.home and nav_home' })],
          }),
      }),
      options({ failOnError: false }),
    )

    expect(result.written).toEqual([])
    expect(result.exitCode).toBe(1)
  })

  // `ok` answers whether the tree is clean and the exit code answers whether
  // this invocation should stop the caller. Under --no-fail they differ.
  it('leaves ok false on a run whose errors it stopped reporting through the exit code', async () => {
    const result = await runPipeline(failing(), options({ failOnError: false }))

    expect(result.exitCode).toBe(0)
    expect(result.ok).toBe(false)
    expect(result.summary.errors).toBe(1)
  })

  it('lowers a warning count over --max-warnings as well', async () => {
    const result = await runPipeline(
      stages({
        runChecks: () => [diag('extra-translation', { message: 'de has nav.old' })],
        emit: () => ({ files: [generatedFile('messages.js', 'export {}')], diagnostics: [] }),
      }),
      options({ failOnError: false, maxWarnings: 0 }),
    )

    expect(result.exitCode).toBe(0)
  })

  it('is ignored by check', async () => {
    const result = await runPipeline(
      failing(),
      options({ mode: 'check', failOnError: false }),
    )

    expect(result.exitCode).toBe(1)
    expect(result.written).toEqual([])
  })
})

describe('severity, which only this module reads', () => {
  it('drops a rule the config turned off', async () => {
    const result = await runPipeline(
      stages(
        { runChecks: () => [diag('missing-translation', { message: 'de is missing nav.home' })] },
        { severity: { 'missing-translation': 'off' } },
      ),
      options(),
    )

    expect(result.diagnostics).toEqual([])
    expect(result.exitCode).toBe(0)
  })

  it('promotes a warning the config turned up, and the exit code follows', async () => {
    const result = await runPipeline(
      stages(
        { runChecks: () => [diag('extra-translation', { message: 'de has nav.old' })] },
        { severity: { 'extra-translation': 'error' } },
      ),
      options(),
    )

    expect(result.diagnostics[0]?.severity).toBe('error')
    expect(result.exitCode).toBe(1)
    expect(result.summary.errors).toBe(1)
  })

  it('keeps a default-off rule silent until the config asks for it', async () => {
    const producing = (settings: Partial<Config>): Stages =>
      stages(
        { checkDescriptions: () => [diag('missing-description', { message: 'cart.items' })] },
        settings,
      )

    expect((await runPipeline(producing({}), options())).diagnostics).toEqual([])
    expect(
      codes(
        (await runPipeline(producing({ severity: { 'missing-description': 'warn' } }), options()))
          .diagnostics,
      ),
    ).toEqual(['LZ5006'])
  })

  it('re-levels the output stage too', async () => {
    await mkdir(join(root, 'src/loclizr'), { recursive: true })
    await writeFile(join(root, 'src/loclizr/keep.ts'), 'export const keep = 1\n', 'utf8')

    const result = await runPipeline(
      stages({}, { severity: { 'outdir-foreign-file': 'error' } }),
      options(),
    )

    expect(result.diagnostics[0]?.code).toBe('LZ1021')
    expect(result.diagnostics[0]?.severity).toBe('error')
    expect(result.exitCode).toBe(1)
  })
})

describe('truncated ICU data', () => {
  it('reports LZ1019 and makes no category claim, over the user setting', async () => {
    const result = await runPipeline(
      stages(
        {
          icuDataComplete: () => false,
          runChecks: () => [
            diag('plural-category-incomplete', { message: 'ru lacks many' }),
            diag('plural-category-unreachable', { message: 'de can never select zero' }),
            diag('missing-translation', { message: 'de is missing nav.home' }),
          ],
        },
        { severity: { 'plural-category-incomplete': 'error' } },
      ),
      options({ emit: false }),
    )

    expect(codes(result.diagnostics)).toEqual(['LZ3001', 'LZ1019'])
  })
})

describe('a declared locale Intl has no plural data for', () => {
  const claims: readonly Diagnostic[] = [
    diag('plural-category-incomplete', { message: 'shared lacks one', locale: 'shared' }),
    diag('plural-category-unreachable', { message: 'shared never selects few', locale: 'shared' }),
    diag('plural-category-incomplete', { message: 'de lacks one', locale: 'de' }),
  ]

  function guessing(overrides: Partial<Config> = {}): Stages {
    return stages({ runChecks: () => claims }, { locales: ['de', 'shared', 'en'], ...overrides })
  }

  it('keeps the category claims Intl can actually answer and drops the rest', async () => {
    const result = await runPipeline(guessing(), options({ emit: false }))

    expect(codes(result.diagnostics)).toEqual(['LZ1019', 'LZ3007'])
    expect(result.diagnostics[0]?.locale).toBe('shared')
    expect(result.diagnostics[1]?.locale).toBe('de')
  })

  it('drops them over a user setting that raised them to error', async () => {
    const result = await runPipeline(
      guessing({ severity: { 'plural-category-unreachable': 'error' } }),
      options({ emit: false }),
    )

    expect(codes(result.diagnostics)).toEqual(['LZ1019', 'LZ3007'])
  })

  // Pinned to the byte, because naming the locale Intl answered with would put
  // the build machine's own tag into the text and reproduce the divergence the
  // rule exists to close. Any host data reaching either string fails this
  // everywhere rather than on somebody else's laptop.
  it('names the declared tag and never the one Intl resolved to', async () => {
    const result = await runPipeline(guessing(), options({ emit: false }))
    const reported = result.diagnostics.find((entry) => entry.code === 'LZ1019')

    expect(reported?.message).toBe(
      'Intl has no plural data for the declared locale "shared", so it answers for the build machine\'s own locale instead.',
    )
    expect(reported?.hint).toBe(
      'plural-category-incomplete and plural-category-unreachable are off for "shared", because otherwise these catalogs would produce different diagnostics on a laptop and in CI. Under a {ns} catalog pattern with `locales` unset every directory name becomes a declared locale, so declare `locales` explicitly.',
    )
  })

  it('says nothing when every declared locale is one Intl knows', async () => {
    const result = await runPipeline(
      stages({ runChecks: () => claims.slice(2) }),
      options({ emit: false }),
    )

    expect(codes(result.diagnostics)).toEqual(['LZ3007'])
  })

  // The truncated build has already taken both rules out for every locale and
  // named the one cause, so repeating it per tag adds noise and no information.
  it('stays quiet under a truncated ICU, which reports the real cause once', async () => {
    const result = await runPipeline(
      stages(
        { icuDataComplete: () => false, runChecks: () => claims },
        { locales: ['de', 'shared', 'en'] },
      ),
      options({ emit: false }),
    )

    expect(codes(result.diagnostics)).toEqual(['LZ1019'])
  })
})

describe('the record', () => {
  it('builds nothing when the record is switched off', async () => {
    const buildRecord = vi.fn(stages().buildRecord)

    const result = await runPipeline(stages({ buildRecord }, { record: false }), options())

    expect(buildRecord).not.toHaveBeenCalled()
    expect(result.record).toBeNull()
    expect(result.written).toEqual([])
  })

  it('substitutes {sourceLocale} in the record path', async () => {
    const result = await runPipeline(
      stages({}, { record: 'locales/{sourceLocale}.context.json' }),
      options(),
    )

    expect(result.written).toEqual(['locales/en.context.json'])
    expect(await exists('locales/en.context.json')).toBe(true)
  })

  // The file list is fixed rather than derived from the messages, so the
  // containment below is a comparison of two independently produced sets.
  const TREE: readonly string[] = [
    'messages.js',
    'messages/_locale.js',
    'messages/cart.js',
    'messages/nav.js',
  ]

  it('names a module for every record message that emit produced', async () => {
    const messages = [message({ key: 'cart.items' }), message({ key: 'nav.home' })]
    const result = await runPipeline(
      stages({
        analyze: (input) => program({ config: input.config, messages }),
        emit: () => ({
          files: TREE.map((path) => generatedFile(path, 'export {}')),
          diagnostics: [],
        }),
        buildRecord: (input) => contextRecord(input.messages),
      }),
      options(),
    )

    const emitted = new Set(result.files.map((file) => file.path))
    expect(result.record?.messages.map((entry) => entry.module)).toEqual([
      'messages/cart.js',
      'messages/nav.js',
    ])
    for (const entry of result.record?.messages ?? []) expect(emitted.has(entry.module)).toBe(true)
  })

})

describe('prune-keeps-foreign', () => {
  it('keeps a hand-written file under outDir and does not move the exit code', async () => {
    await mkdir(join(root, 'src/loclizr'), { recursive: true })
    await writeFile(join(root, 'src/loclizr/keep.ts'), 'export const keep = 1\n', 'utf8')

    const result = await runPipeline(
      stages({ emit: () => ({ files: [generatedFile('messages.js', 'export {}')], diagnostics: [] }) }),
      options(),
    )

    expect(codes(result.diagnostics)).toEqual(['LZ1021'])
    expect(result.exitCode).toBe(0)
    expect(await readFile(join(root, 'src/loclizr/keep.ts'), 'utf8')).toBe('export const keep = 1\n')
  })
})

describe('build and check agree', () => {
  const tree = (source: string): Stages =>
    stages({
      analyze: (input) =>
        program({ config: input.config, messages: [message({ key: 'nav.home', source })] }),
      emit: (input) => ({
        files: input.messages.map((entry) => generatedFile(entry.module, `export {} // ${entry.source}`)),
        diagnostics: [],
      }),
      buildRecord: (input) => contextRecord(input.messages),
    })

  it('passes check on the tree build just wrote', async () => {
    await runPipeline(tree('Home'), options())
    const checked = await runPipeline(tree('Home'), options({ mode: 'check' }))

    expect(checked.diagnostics).toEqual([])
    expect(checked.exitCode).toBe(0)
  })

  it('fails check on an edited string, naming the stale output and the stale record', async () => {
    await runPipeline(tree('Home'), options())
    const checked = await runPipeline(tree('Start'), options({ mode: 'check' }))

    expect(codes(checked.diagnostics).toSorted()).toEqual(['LZ5002', 'LZ5003'])
    expect(checked.written).toEqual([])
  })
})

describe('the summary', () => {
  it('counts errors, warnings, messages and locales', async () => {
    const result = await runPipeline(
      stages({
        analyze: (input) => program({ config: input.config, messages: [message({ key: 'nav.home' })] }),
        runChecks: () => [
          diag('missing-translation', { message: 'de is missing nav.home' }),
          diag('extra-translation', { message: 'de has nav.old' }),
        ],
      }),
      options({ emit: false }),
    )

    expect(result.summary).toEqual({
      errors: 1,
      warnings: 1,
      messages: 1,
      locales: 3,
      fellBack: [],
    })
  })

  // The seam itself is driven through the real stages in
  // seam.adversarial.test.ts. What is left here is the counting.
  it('counts a fallback per locale per message and ignores an inherited origin', async () => {
    const result = await runPipeline(
      stages({ analyze: (input) => program({ config: input.config, messages: fallbackSeam() }) }),
      options({ emit: false }),
    )

    expect(result.summary.fellBack).toEqual([
      { locale: 'de', count: 2 },
      { locale: 'de-AT', count: 2 },
    ])
  })

  it('collects every stage that produces diagnostics, each exactly once', async () => {
    await mkdir(join(root, 'src/loclizr'), { recursive: true })
    await writeFile(join(root, 'src/loclizr/keep.ts'), 'export const keep = 1\n', 'utf8')
    const one = (message: string): Diagnostic => diag('extra-translation', { message })

    const result = await runPipeline(
      stages({
        loadConfig: () =>
          Promise.resolve({ config: config({ root }), diagnostics: [one('from loadConfig')] }),
        readCatalogs: () =>
          Promise.resolve({ catalogs: [], meta: null, diagnostics: [one('from readCatalogs')] }),
        analyze: (input) =>
          program({ config: input.config, diagnostics: [one('from analyze')] }),
        runChecks: () => [one('from runChecks')],
        checkDescriptions: () => [one('from checkDescriptions')],
        scan: () => Promise.resolve({ usages: [], diagnostics: [one('from scan')] }),
        emit: () => ({ files: [], diagnostics: [one('from emit')] }),
      }),
      options(),
    )

    expect(result.diagnostics.map((entry) => entry.message)).toEqual([
      '`src/loclizr/keep.ts` does not carry the generated header, so it was neither overwritten nor pruned.',
      'from loadConfig',
      'from readCatalogs',
      'from analyze',
      'from runChecks',
      'from checkDescriptions',
      'from scan',
      'from emit',
    ])
  })
})

function fallbackSeam(): readonly Message[] {
  const inherited: readonly LocaleOrigin[] = [
    { locale: 'de', origin: { status: 'translated' } },
    { locale: 'de-AT', origin: { status: 'inherited', from: 'de' } },
    { locale: 'en', origin: { status: 'translated' } },
  ]
  const fellThrough = (reason: 'blank' | 'invalid'): readonly LocaleOrigin[] => [
    { locale: 'de', origin: { status: 'fallback', from: 'en', reason } },
    { locale: 'de-AT', origin: { status: 'fallback', from: 'en', reason: 'missing' } },
    { locale: 'en', origin: { status: 'translated' } },
  ]
  return [
    message({ key: 'cart.one', origins: inherited }),
    message({ key: 'cart.two', origins: fellThrough('blank') }),
    message({ key: 'cart.three', origins: fellThrough('invalid') }),
  ]
}
