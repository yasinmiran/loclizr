import { mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { diag } from '../diagnostics'
import { calls, reset } from './__fixtures__/compiler'
import { buildResult, summary } from './__fixtures__/results'
import { USAGE } from './args'
import { run } from './index'
import { io } from './io'

vi.mock('../compiler', () => import('./__fixtures__/compiler'))

let out: string[] = []
let err: string[] = []
let root = ''

beforeEach(async () => {
  reset()
  out = []
  err = []
  root = await mkdtemp(join(tmpdir(), 'loclizr-cli-run-edge-'))
  vi.spyOn(io, 'out').mockImplementation((text) => {
    out.push(text)
  })
  vi.spyOn(io, 'err').mockImplementation((text) => {
    err.push(text)
  })
})

afterEach(async () => {
  vi.restoreAllMocks()
  await rm(root, { recursive: true, force: true })
})

const warning = diag('plural-suffix-orphan', {
  message: 'items_one has no items_other sibling.',
  file: 'locales/en.json',
  locale: 'en',
  key: 'items_one',
})

const error = diag('missing-translation', {
  message: 'de has no value for cart.items.',
  file: 'locales/de.json',
  locale: 'de',
  key: 'cart.items',
})

describe('exact stream contents', () => {
  it('prints the usage and one newline to stdout for --help', async () => {
    expect(await run(['-h'])).toBe(0)
    expect(out).toEqual([`${USAGE}\n`])
  })

  it('prints the message, a blank line and the usage to stderr on invalid usage', async () => {
    expect(await run(['lower'])).toBe(2)
    expect(err).toEqual([`loclizr: unknown command 'lower'\n\n${USAGE}\n`])
    expect(out).toEqual([])
  })

  it('keeps stdout empty on invalid usage even under --reporter json', async () => {
    expect(await run(['check', '--no-fail', '--reporter', 'json'])).toBe(2)
    expect(out).toEqual([])
  })

  it('keeps stdout empty when the reporter value itself is the invalid usage', async () => {
    expect(await run(['check', '--reporter', 'yaml'])).toBe(2)
    expect(out).toEqual([])
    expect(err.join('')).toContain("--reporter must be human or json, got 'yaml'")
  })

  it('writes the whole report in one call, so nothing interleaves with it', async () => {
    reset(
      buildResult({
        exitCode: 1,
        ok: false,
        diagnostics: [warning, error],
        written: ['src/loclizr/messages.js'],
        summary: summary({ errors: 1, warnings: 1, fellBack: [{ locale: 'de', count: 1 }] }),
      }),
    )

    await run(['build'])

    expect(out).toHaveLength(1)
  })

  it('prints nothing at all on a clean quiet run and exits 0', async () => {
    expect(await run(['check', '--quiet'])).toBe(0)
    expect(out).toEqual([])
    expect(err).toEqual([])
  })
})

describe('--help never reaches the compiler', () => {
  it('prints help for check --help --no-fail and runs nothing', async () => {
    expect(await run(['check', '--help', '--no-fail'])).toBe(0)
    expect(calls).toEqual([])
    expect(err).toEqual([])
  })

  it('prints help for build --help without checking --cwd', async () => {
    expect(await run(['build', '--cwd', join(root, 'absent'), '--help'])).toBe(0)
    expect(calls).toEqual([])
  })

  it('prints help for init --help and writes nothing', async () => {
    expect(await run(['init', '--cwd', root, '--help'])).toBe(0)
    await expect(readFile(join(root, 'loclizr.config.ts'), 'utf8')).rejects.toThrow()
  })
})

describe('the json reporter on a failing run', () => {
  it('prints one parseable document on stdout and nothing on stderr', async () => {
    reset(
      buildResult({
        exitCode: 1,
        ok: false,
        diagnostics: [error],
        summary: summary({ errors: 1 }),
      }),
    )

    expect(await run(['check', '--reporter', 'json'])).toBe(1)
    expect(JSON.parse(out.join(''))).toMatchObject({ schema: 1, summary: { errors: 1 } })
    expect(err).toEqual([])
  })

  it('keeps warnings in the payload under --quiet', async () => {
    reset(buildResult({ diagnostics: [warning], summary: summary({ warnings: 1 }) }))

    await run(['check', '--reporter', 'json', '--quiet'])

    expect(JSON.parse(out.join(''))).toMatchObject({ diagnostics: [{ code: 'LZ1014' }] })
  })
})

describe('the catch-all path', () => {
  it('reports a thrown string on stderr and exits 2', async () => {
    const compiler = await import('./__fixtures__/compiler')
    vi.spyOn(compiler, 'check').mockRejectedValue('disk on fire')

    expect(await run(['check'])).toBe(2)
    expect(err).toEqual(['loclizr: disk on fire\n'])
    expect(out).toEqual([])
  })

  it('reports an error carrying unicode verbatim', async () => {
    const compiler = await import('./__fixtures__/compiler')
    vi.spyOn(compiler, 'build').mockRejectedValue(new Error('ファイル «x» 🚫'))

    expect(await run(['build'])).toBe(2)
    expect(err).toEqual(['loclizr: ファイル «x» 🚫\n'])
  })
})

describe('--cwd values that name a real directory', () => {
  it('accepts a directory whose name carries spaces, unicode and emoji', async () => {
    const dir = join(root, 'my app', 'приложение 🌍')
    await mkdir(dir, { recursive: true })

    expect(await run(['build', '--cwd', dir])).toBe(0)
    expect(calls[0]?.options).toMatchObject({ cwd: dir })
  })

  it('forwards a relative --cwd as written, leaving resolution to the compiler', async () => {
    const dir = join(root, 'rel')
    await mkdir(dir)
    const written = relative(process.cwd(), dir)

    expect(await run(['check', '--cwd', written])).toBe(0)
    expect(calls[0]?.options).toMatchObject({ cwd: written })
  })

  it('accepts a trailing slash', async () => {
    expect(await run(['build', '--cwd', `${root}/`])).toBe(0)
    expect(calls[0]?.options).toMatchObject({ cwd: `${root}/` })
  })

  it('accepts a symlink to a directory', async () => {
    const real = join(root, 'real')
    const link = join(root, 'link')
    await mkdir(real)
    await symlink(real, link)

    expect(await run(['check', '--cwd', link])).toBe(0)
    expect(calls[0]?.options).toMatchObject({ cwd: link })
  })

  it('refuses a dangling symlink without running the compiler', async () => {
    const link = join(root, 'dangling')
    await symlink(join(root, 'nowhere'), link)

    expect(await run(['build', '--cwd', link])).toBe(2)
    expect(calls).toEqual([])
  })

  it('names a missing unicode directory verbatim in the refusal', async () => {
    const dir = join(root, 'нет 🌍')

    expect(await run(['check', '--cwd', dir])).toBe(2)
    expect(err.join('')).toContain(`--cwd must name a directory that exists, got '${dir}'`)
  })
})

describe('flags forwarded to the compiler', () => {
  it('forwards --config verbatim to check', async () => {
    await run(['check', '--config', 'tools/loclizr config.mts'])

    expect(calls[0]?.options).toMatchObject({ configPath: 'tools/loclizr config.mts' })
  })

  it('sends no cwd and no configPath when both are absent', async () => {
    await run(['build'])

    expect(calls[0]?.options).toEqual({
      cwd: undefined,
      configPath: undefined,
      maxWarnings: Number.POSITIVE_INFINITY,
      failOnError: true,
    })
  })

  it('sends neither the reporter nor quiet, which the compiler never sees', async () => {
    await run(['check', '--reporter', 'json', '--quiet'])

    expect(calls[0]?.options).not.toHaveProperty('reporter')
    expect(calls[0]?.options).not.toHaveProperty('quiet')
  })

  it('calls the compiler exactly once per run', async () => {
    await run(['build', '--no-fail'])

    expect(calls).toHaveLength(1)
  })
})

describe('init through run', () => {
  it('writes the config at --config resolved against --cwd', async () => {
    expect(await run(['init', '--cwd', root, '--config', 'tools/loclizr.config.ts'])).toBe(0)
    expect(await readFile(join(root, 'tools', 'loclizr.config.ts'), 'utf8')).toContain('defineConfig')
    expect(out.join('')).toContain('wrote tools/loclizr.config.ts')
  })

  it('exits 0 on a second init over its own output', async () => {
    await run(['init', '--cwd', root])
    out = []

    expect(await run(['init', '--cwd', root])).toBe(0)
    expect(out.join('')).toContain('loclizr.config.ts already exists, left unchanged')
  })

  it('creates a --cwd whose name carries unicode and spaces', async () => {
    const dir = join(root, 'новый проект')

    expect(await run(['init', '--cwd', dir])).toBe(0)
    expect(await readFile(join(dir, 'locales', 'en.json'), 'utf8')).toContain('"nav"')
  })
})
