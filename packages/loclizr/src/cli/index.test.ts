import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { calls, reset } from './__fixtures__/compiler'
import { buildResult, summary } from './__fixtures__/results'
import { run } from './index'
import { io } from './io'

vi.mock('../compiler', () => import('./__fixtures__/compiler'))

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

describe('run, dispatch', () => {
  it('runs build and returns the exit code the compiler decided', async () => {
    reset(buildResult({ exitCode: 1, ok: false }))

    expect(await run(['build'])).toBe(1)
    expect(calls).toEqual([{ command: 'build', options: expect.objectContaining({}) }])
  })

  it('forwards --no-fail as failOnError false', async () => {
    await run(['build', '--no-fail'])

    expect(calls[0]?.options).toMatchObject({ failOnError: false })
  })

  it('sends failOnError true on a plain build', async () => {
    await run(['build'])

    expect(calls[0]?.options).toMatchObject({ failOnError: true })
  })

  it('never lowers an exit code itself', async () => {
    reset(buildResult({ exitCode: 1, ok: false }))

    expect(await run(['build', '--no-fail'])).toBe(1)
  })

  it('forwards cwd, config and max-warnings', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'loclizr-cli-cwd-'))
    try {
      await run(['build', '--cwd', dir, '--config', 'x.ts', '--max-warnings', '3'])

      expect(calls[0]?.options).toMatchObject({ cwd: dir, configPath: 'x.ts', maxWarnings: 3 })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('refuses a --cwd that does not exist, rather than blaming the catalogs', async () => {
    expect(await run(['build', '--cwd', join(tmpdir(), 'loclizr-cli-absent')])).toBe(2)
    expect(calls).toEqual([])
    expect(err.join('')).toContain('--cwd must name a directory that exists')
  })

  it('refuses a --cwd that names a file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'loclizr-cli-cwd-file-'))
    try {
      const file = join(dir, 'loclizr.config.ts')
      await writeFile(file, '', 'utf8')

      expect(await run(['check', '--cwd', file])).toBe(2)
      expect(calls).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('sends no cap when --max-warnings is absent', async () => {
    await run(['build'])

    expect(calls[0]?.options).toMatchObject({ maxWarnings: Number.POSITIVE_INFINITY })
  })

  it('runs check without a failOnError of its own', async () => {
    reset(buildResult({ exitCode: 2, ok: false, program: null }))

    expect(await run(['check'])).toBe(2)
    expect(calls[0]?.command).toBe('check')
    expect(calls[0]?.options).not.toHaveProperty('failOnError')
  })

  it('rejects --no-fail on check without running anything', async () => {
    expect(await run(['check', '--no-fail'])).toBe(2)
    expect(calls).toEqual([])
    expect(err.join('')).toContain('--no-fail')
  })

  it('returns 2 and runs nothing on an unknown command', async () => {
    expect(await run(['lower'])).toBe(2)
    expect(calls).toEqual([])
    expect(err.join('')).toContain("unknown command 'lower'")
  })

  it('prints usage on stderr, never on stdout, when usage was invalid', async () => {
    await run([])

    expect(out).toEqual([])
    expect(err.join('')).toContain('loclizr <command> [options]')
  })

  it('prints usage on stdout and exits 0 for --help', async () => {
    expect(await run(['--help'])).toBe(0)
    expect(out.join('')).toContain('loclizr <command> [options]')
    expect(err).toEqual([])
  })

  it('returns 2 when the compiler throws', async () => {
    const compiler = await import('./__fixtures__/compiler')
    vi.spyOn(compiler, 'build').mockRejectedValue(new Error('boom'))

    expect(await run(['build'])).toBe(2)
    expect(err.join('')).toContain('boom')
  })
})

describe('run, reporting', () => {
  it('writes the human report to stdout', async () => {
    reset(buildResult({ summary: summary({ messages: 2, locales: 1 }) }))

    await run(['build'])

    expect(out.join('')).toContain('2 messages, 1 locale (source en), 0 errors, 0 warnings')
  })

  it('writes machine readable json to stdout so it can be piped', async () => {
    reset(buildResult({ summary: summary({ messages: 2, locales: 1 }) }))

    await run(['build', '--reporter', 'json'])

    expect(JSON.parse(out.join(''))).toMatchObject({ schema: 1, summary: { messages: 2 } })
  })
})

describe('run, init', () => {
  let root = ''

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'loclizr-cli-run-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('writes the tree and prints the wiring without touching the compiler', async () => {
    expect(await run(['init', '--cwd', root])).toBe(0)
    expect(calls).toEqual([])
    expect(out.join('')).toContain('"predev": "loclizr build --no-fail"')
  })

  it('creates the directory it was pointed at, which build refuses to invent', async () => {
    const fresh = join(root, 'apps', 'web')

    expect(await run(['init', '--cwd', fresh])).toBe(0)
    expect(out.join('')).toContain('wrote loclizr.config.ts')
  })

  it('names the install line the config it wrote depends on', async () => {
    await run(['init', '--cwd', root])

    expect(out.join('')).toContain('npm i loclizr')
  })

  it('reports a failed init on stderr, where a redirected stdout cannot hide it', async () => {
    await writeFile(join(root, 'locales'), '', 'utf8')

    expect(await run(['init', '--cwd', root])).toBe(2)
    expect(out).toEqual([])
    expect(err.join('')).toContain('could not write locales/en.json')
  })
})

describe('run, --version', () => {
  it('prints the package version and a newline, and exits 0', async () => {
    const { version } = JSON.parse(
      await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as { version: string }

    expect(await run(['--version'])).toBe(0)
    expect(await run(['-v'])).toBe(0)
    expect(out).toEqual([`${version}\n`, `${version}\n`])
    expect(err).toEqual([])
    expect(calls).toEqual([])
  })

  it('yields to --help when both are given', async () => {
    expect(await run(['-v', '-h'])).toBe(0)

    expect(out.join('')).toContain('-v, --version')
  })

  it('is listed in the usage text', async () => {
    await run(['--help'])

    expect(out.join('')).toContain('-v, --version')
  })
})
