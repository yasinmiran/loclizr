import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { diag } from '../diagnostics'
import type { BuildResult, Diagnostic } from '../types'
import { calls, reset } from './__fixtures__/compiler'
import { buildResult, summary } from './__fixtures__/results'
import { run } from './index'
import { io } from './io'

vi.mock('../compiler', () => import('./__fixtures__/compiler'))

const missing: Diagnostic = diag('missing-translation', {
  message: 'de has no value for cart.items.',
  hint: 'add cart.items to locales/de.json.',
  file: 'locales/de.json',
  locale: 'de',
  key: 'cart.items',
  span: { line: 12, column: 5, offset: 140, length: 9 },
})

const orphan: Diagnostic = diag('plural-suffix-orphan', {
  message: 'items_one has no items_other sibling.',
  file: 'locales/en.json',
  locale: 'en',
  key: 'items_one',
})

function noisy(exitCode: 0 | 1 | 2): BuildResult {
  return buildResult({
    ok: exitCode === 0,
    exitCode,
    diagnostics: [orphan, missing],
    summary: summary({
      errors: 1,
      warnings: 1,
      messages: 12,
      locales: 3,
      fellBack: [
        { locale: 'de', count: 2 },
        { locale: 'de-AT', count: 2 },
      ],
    }),
  })
}

let out: string[] = []
let err: string[] = []

beforeEach(() => {
  reset()
  out = []
  err = []
  vi.spyOn(io, 'out').mockImplementation((text) => {
    out.push(text)
  })
  vi.spyOn(io, 'err').mockImplementation((text) => {
    err.push(text)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function stdoutOf(argv: readonly string[], result: BuildResult): Promise<string> {
  reset(result)
  out = []
  await run(argv)
  return out.join('')
}

describe('--no-fail moves the exit code and nothing else', () => {
  it('prints byte identical human output with and without the flag', async () => {
    const strict = await stdoutOf(['build'], noisy(1))
    const relaxed = await stdoutOf(['build', '--no-fail'], noisy(0))

    expect(relaxed).toBe(strict)
    expect(strict).toContain('LZ3001')
    expect(strict).toContain('LZ1014')
  })

  it('prints byte identical json with and without the flag', async () => {
    const strict = await stdoutOf(['build', '--reporter', 'json'], noisy(1))
    const relaxed = await stdoutOf(['build', '--reporter', 'json', '--no-fail'], noisy(0))

    expect(relaxed).toBe(strict)
  })

  it('prints byte identical output under --quiet', async () => {
    const strict = await stdoutOf(['build', '--quiet'], noisy(1))
    const relaxed = await stdoutOf(['build', '--quiet', '--no-fail'], noisy(0))

    expect(relaxed).toBe(strict)
  })

  it('keeps every severity and every count while the run is about to exit 0', async () => {
    const text = await stdoutOf(['build', '--no-fail'], noisy(0))

    expect(text).toContain('error')
    expect(text).toContain('warn')
    expect(text).toContain('12 messages, 3 locales (source en), 1 error, 1 warning')
    expect(text).toContain('fell back to source text: de 2, de-AT 2')
  })

  it('writes nothing to stderr on a build that reported errors', async () => {
    await stdoutOf(['build', '--no-fail'], noisy(0))

    expect(err).toEqual([])
  })
})

describe('the exit code belongs to the compiler', () => {
  it('returns 0, 1 and 2 unchanged under --no-fail', async () => {
    for (const code of [0, 1, 2] as const) {
      reset(noisy(code))
      expect(await run(['build', '--no-fail'])).toBe(code)
    }
  })

  it('never lowers a 1 of its own accord', async () => {
    reset(noisy(1))

    expect(await run(['build', '--no-fail'])).toBe(1)
  })

  it('returns 0 for a result carrying errors, because it re-derives no code', async () => {
    reset(buildResult({ exitCode: 0, diagnostics: [missing], summary: summary({ errors: 1 }) }))

    expect(await run(['build'])).toBe(0)
  })

  it('returns 1 for a result carrying no diagnostics at all', async () => {
    reset(buildResult({ exitCode: 1, ok: false, diagnostics: [], summary: summary() }))

    expect(await run(['build'])).toBe(1)
  })
})

describe('flags reach the compiler as the spec fixes them', () => {
  it('sends a --max-warnings of 0 as 0, never as no cap', async () => {
    await run(['build', '--max-warnings', '0'])

    expect(calls[0]?.options).toMatchObject({ maxWarnings: 0 })
  })

  it('sends --max-warnings=-1 as no cap', async () => {
    await run(['build', '--max-warnings=-1'])

    expect(calls[0]?.options).toMatchObject({ maxWarnings: Number.POSITIVE_INFINITY })
  })

  it('leaves --max-warnings alone when --no-fail is present', async () => {
    await run(['build', '--no-fail', '--max-warnings', '3'])

    expect(calls[0]?.options).toMatchObject({ maxWarnings: 3, failOnError: false })
  })

  it('never sends failOnError to check, which ignores it', async () => {
    await run(['check', '--max-warnings', '0'])

    expect(calls[0]?.command).toBe('check')
    expect(calls[0]?.options).not.toHaveProperty('failOnError')
  })
})

describe('the json reporter stays a machine contract', () => {
  it('emits one parseable document when the tool could not run', async () => {
    const text = await stdoutOf(
      ['check', '--reporter', 'json'],
      buildResult({
        ok: false,
        exitCode: 2,
        program: null,
        diagnostics: [diag('config-invalid', { message: 'loclizr.config.ts threw.' })],
        summary: summary({ errors: 1 }),
      }),
    )

    expect(JSON.parse(text)).toMatchObject({ schema: 1, summary: { errors: 1 } })
  })

  it('survives diagnostic text carrying quotes, newlines and a lone surrogate', async () => {
    const hostile = diag('icu-syntax', {
      message: 'bad "quote" \\ and a line\nbreak plus   and \uD800',
      hint: 'try </script> instead',
      file: 'locales/en.json',
      key: 'a"b',
    })
    const text = await stdoutOf(
      ['build', '--reporter', 'json'],
      buildResult({ diagnostics: [hostile], summary: summary({ errors: 1 }) }),
    )
    const parsed: unknown = JSON.parse(text)

    expect(parsed).toMatchObject({
      diagnostics: [{ message: hostile.message, hint: hostile.hint, key: 'a"b' }],
    })
  })
})

describe('-- terminates flags rather than smuggling them', () => {
  it('refuses build -- --no-fail without running the compiler', async () => {
    expect(await run(['build', '--', '--no-fail'])).toBe(2)
    expect(calls).toEqual([])
  })

  it('refuses check -- --no-fail without running the compiler', async () => {
    expect(await run(['check', '--', '--no-fail'])).toBe(2)
    expect(calls).toEqual([])
  })

  it('refuses -- --help rather than printing help and exiting 0', async () => {
    expect(await run(['--', '--help'])).toBe(2)
    expect(out).toEqual([])
  })
})
