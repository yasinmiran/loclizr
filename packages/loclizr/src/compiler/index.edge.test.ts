import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { BuildResult } from '../types'
import { build, check } from './index'

const RECORD = 'locales/loclizr.context.json'

let roots: string[] = []

beforeEach(() => {
  roots = []
})

afterEach(async () => {
  for (const directory of roots) await rm(directory, { recursive: true, force: true })
})

async function project(en: unknown, de: unknown): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'loclizr-index-edge-'))
  roots.push(root)
  await write(root, 'locales/en.json', `${JSON.stringify(en)}\n`)
  await write(root, 'locales/de.json', `${JSON.stringify(de)}\n`)
  return root
}

async function write(root: string, path: string, contents: string): Promise<void> {
  const absolute = join(root, path)
  await mkdir(dirname(absolute), { recursive: true })
  await writeFile(absolute, contents, 'utf8')
}

async function read(root: string, path: string): Promise<string | null> {
  try {
    return await readFile(join(root, path), 'utf8')
  } catch {
    return null
  }
}

function codes(result: BuildResult): readonly string[] {
  return result.diagnostics.map((diagnostic) => diagnostic.code)
}

function outcome(result: BuildResult): unknown {
  return {
    ok: result.ok,
    exitCode: result.exitCode,
    diagnostics: result.diagnostics,
    files: result.files,
    record: result.record,
    written: result.written,
    summary: result.summary,
  }
}

const EN = { nav: { home: 'Home', cart: 'Cart' } }
const DE_WITH_EXTRA = { nav: { home: 'Startseite', cart: 'Warenkorb', old: 'Alt' } }

describe('options left absent and options explicitly undefined', () => {
  it('build the same result', async () => {
    const absent = await build({ cwd: await project(EN, DE_WITH_EXTRA) })
    const undefinedOptions = await build({
      cwd: await project(EN, DE_WITH_EXTRA),
      configPath: undefined,
      emit: undefined,
      maxWarnings: undefined,
      failOnError: undefined,
    })

    expect(outcome(undefinedOptions)).toEqual(outcome(absent))
  })

  it('write the tree under emit undefined, as the default promises', async () => {
    const root = await project(EN, DE_WITH_EXTRA)

    const result = await build({ cwd: root, emit: undefined })

    expect(result.written).toContain(RECORD)
    expect(await read(root, RECORD)).not.toBeNull()
  })

  it('leave warnings uncapped under maxWarnings undefined', async () => {
    const result = await build({ cwd: await project(EN, DE_WITH_EXTRA), maxWarnings: undefined })

    expect(codes(result)).toContain('LZ3003')
    expect(result.exitCode).toBe(0)
  })
})

describe('--max-warnings over real catalogs', () => {
  it('exits 1 at a cap of zero with one extra key', async () => {
    const result = await build({ cwd: await project(EN, DE_WITH_EXTRA), maxWarnings: 0 })

    expect(result.exitCode).toBe(1)
    expect(result.ok).toBe(true)
  })

  it('still writes the tree when only the cap failed the run', async () => {
    const root = await project(EN, DE_WITH_EXTRA)

    const result = await build({ cwd: root, maxWarnings: 0 })

    expect(result.written).toContain(RECORD)
  })
})

describe('check after build over keys no editor would type', () => {
  const awkward = {
    toString: 'To string',
    class: 'Class',
    nav: {
      constructor: 'Constructor',
      '\u00e9t\u00e9': '\u00c9t\u00e9 \u{1F31E}',
      rtl: '\u200f\u05e9\u05dc\u05d5\u05dd\u200f',
    },
  }

  it('builds with no diagnostic that blocks the tree', async () => {
    const root = await project(awkward, awkward)

    const result = await build({ cwd: root })

    expect(result.written.length).toBeGreaterThan(0)
    expect(result.diagnostics.every((diagnostic) => !diagnostic.fatal)).toBe(true)
  })

  it('passes check on the tree that build wrote', async () => {
    const root = await project(awkward, awkward)
    const built = await build({ cwd: root })

    const checked = await check({ cwd: root })

    expect(checked.exitCode).toBe(built.exitCode)
    expect(codes(checked)).toEqual(codes(built))
  })

  it('writes the same bytes from two separate projects', async () => {
    const first = await build({ cwd: await project(awkward, awkward) })
    const second = await build({ cwd: await project(awkward, awkward) })

    expect(second.files).toEqual(first.files)
    expect(second.written).toEqual(first.written)
  })
})

describe('check with emit false', () => {
  it('reports no stale output or record for a project never built', async () => {
    const result = await check({ cwd: await project(EN, EN), emit: false })

    expect(codes(result)).not.toContain('LZ5002')
    expect(codes(result)).not.toContain('LZ5003')
    expect(result.exitCode).toBe(0)
  })

  it('reports the missing record once emit is left on', async () => {
    const result = await check({ cwd: await project(EN, EN) })

    expect(codes(result)).toEqual(['LZ5003'])
  })
})
