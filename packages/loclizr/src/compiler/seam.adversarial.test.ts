import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { BuildResult, Diagnostic, RecordMessage, RecordTranslation } from '../types'
import { build, check } from './index'
import { GENERATED_HEADER } from './output'

const RECORD = 'locales/loclizr.context.json'
const SEAM_MODULE = 'messages/seam.js'

let root = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'loclizr-seam-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
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

function caller(scope: string): string {
  return [
    "import * as m from './loclizr/messages'",
    '',
    `export function ${scope}(): string {`,
    '  return m.seam_a()',
    '}',
    '',
  ].join('\n')
}

async function seedTree(): Promise<void> {
  await seed(
    'locales/en.json',
    json({ seam: { a: 'Alpha', b: 'Bravo', c: 'Hi {name}', d: 'Delta' } }),
  )
  await seed(
    'locales/de.json',
    json({
      seam: {
        a: 'Alpha auf Deutsch',
        b: '   ',
        c: 'Hallo {name} {nmae}',
        d: 'Delta auf Deutsch',
      },
    }),
  )
  await seed('locales/de-AT.json', json({ seam: { d: 'Delta aus Wien' } }))
  await seed('src/App.ts', caller('Cart'))
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

function at(diagnostics: readonly Diagnostic[], code: string): readonly string[] {
  return diagnostics
    .filter((diagnostic) => diagnostic.code === code)
    .map((diagnostic) => `${diagnostic.locale ?? '-'}/${diagnostic.key ?? '-'}`)
    .toSorted()
}

function emitted(result: BuildResult, path: string): string {
  const file = result.files.find((candidate) => candidate.path === path)
  if (file === undefined) throw new Error(`emit produced no ${path}`)
  return file.contents
}

function recorded(result: BuildResult, key: string): RecordMessage {
  const entry = result.record?.messages.find((candidate) => candidate.key === key)
  if (entry === undefined) throw new Error(`the record holds no ${key}`)
  return entry
}

function translation(entry: RecordMessage, locale: string): RecordTranslation {
  const found = entry.translations.find((candidate) => candidate.locale === locale)
  if (found === undefined) throw new Error(`${entry.key} records no ${locale}`)
  return found
}

describe('the fallback seam over real catalogs', () => {
  it('shares one arm between a locale and the ancestor it inherits, with no diagnostic', async () => {
    await seedTree()

    const result = await build({ cwd: root })
    const text = emitted(result, SEAM_MODULE)
    const entry = recorded(result, 'seam.a')

    expect(translation(entry, 'de')).toEqual({
      locale: 'de',
      status: 'translated',
      from: null,
      reason: null,
    })
    expect(translation(entry, 'de-AT')).toEqual({
      locale: 'de-AT',
      status: 'inherited',
      from: 'de',
      reason: null,
    })
    expect(occurrences(text, 'Alpha auf Deutsch')).toBe(1)
    expect(text).toMatch(/case 'de':\s+case 'de-AT':/)
    expect(at(result.diagnostics, 'LZ3001')).not.toContain('de/seam.a')
  })

  it('renders the source body for a blank translation and reports it once', async () => {
    await seedTree()

    const result = await build({ cwd: root })
    const entry = recorded(result, 'seam.b')

    expect(at(result.diagnostics, 'LZ3002')).toEqual(['de/seam.b'])
    expect(translation(entry, 'de')).toEqual({
      locale: 'de',
      status: 'fallback',
      from: 'en',
      reason: 'blank',
    })
    expect(translation(entry, 'de-AT')).toEqual({
      locale: 'de-AT',
      status: 'fallback',
      from: 'en',
      reason: 'missing',
    })
    expect(occurrences(emitted(result, SEAM_MODULE), 'Bravo')).toBe(1)
  })

  it('never emits an argument the source does not declare', async () => {
    await seedTree()

    const result = await build({ cwd: root })
    const entry = recorded(result, 'seam.c')
    const tree = result.files.map((file) => file.contents).join('\n')

    expect(at(result.diagnostics, 'LZ3005')).toEqual(['de/seam.c'])
    expect(at(result.diagnostics, 'LZ3004')).toEqual([])
    expect(tree).not.toContain('nmae')
    expect(tree).not.toContain('Hallo')
    expect(translation(entry, 'de')).toEqual({
      locale: 'de',
      status: 'fallback',
      from: 'en',
      reason: 'invalid',
    })
    expect(translation(entry, 'de-AT')).toEqual({
      locale: 'de-AT',
      status: 'fallback',
      from: 'en',
      reason: 'missing',
    })
  })

  it('reports a locale missing a key only where nothing in its chain has one', async () => {
    await seedTree()

    const result = await build({ cwd: root })

    expect(at(result.diagnostics, 'LZ3001')).toEqual(['de-AT/seam.b', 'de-AT/seam.c'])
  })

  it('counts one fallback per locale per message', async () => {
    await seedTree()

    const result = await build({ cwd: root })

    expect(result.summary.fellBack).toEqual([
      { locale: 'de', count: 2 },
      { locale: 'de-AT', count: 2 },
    ])
  })

  it('reports every diagnostic exactly once across the whole run', async () => {
    await seedTree()

    const result = await build({ cwd: root })
    const seen = result.diagnostics.map(
      (diagnostic) =>
        `${diagnostic.code}|${diagnostic.locale ?? '-'}|${diagnostic.key ?? '-'}|${diagnostic.file ?? '-'}`,
    )

    expect(seen).toEqual([...new Set(seen)])
  })

  it('names a file emit produced for every record message', async () => {
    await seedTree()

    const result = await build({ cwd: root })
    const paths = new Set(result.files.map((file) => file.path))

    expect(result.record?.messages.length).toBe(4)
    for (const entry of result.record?.messages ?? []) expect(paths.has(entry.module)).toBe(true)
  })

  it('writes the generated header as line one of every file but the .gitignore', async () => {
    await seedTree()

    const result = await build({ cwd: root })

    for (const file of result.files) {
      const disk = await read(`src/loclizr/${file.path}`)
      expect(disk).toBe(file.contents)
      if (file.path === '.gitignore') continue
      expect(file.contents.split('\n')[0]).toBe(GENERATED_HEADER)
    }
    expect(await read('src/loclizr/.gitignore')).toBe('*\n!.gitignore\n')
  })
})

describe('a second build over the tree the first one wrote', () => {
  it('writes nothing and reports exactly what the first run reported', async () => {
    await seedTree()

    const first = await build({ cwd: root })
    const second = await build({ cwd: root })

    expect(second.written).toEqual([])
    expect(second.diagnostics).toEqual(first.diagnostics)
    expect(second.exitCode).toBe(first.exitCode)
  })

  it('never takes the record it wrote for a catalog', async () => {
    await seedTree()

    await build({ cwd: root })
    const second = await build({ cwd: root })

    expect(second.record?.locales).toEqual(['de', 'de-AT', 'en'])
    expect(at(second.diagnostics, 'LZ1002')).toEqual([])
    expect(at(second.diagnostics, 'LZ1006')).toEqual([])
  })

  it('passes check on the tree build just wrote', async () => {
    await seedTree()

    await build({ cwd: root })
    const checked = await check({ cwd: root })

    expect(at(checked.diagnostics, 'LZ5002')).toEqual([])
    expect(at(checked.diagnostics, 'LZ5003')).toEqual([])
  })
})

describe('the record gate under the projection the gate compares', () => {
  it('keeps check green when a translator edited only a target catalog', async () => {
    await seedTree()
    await build({ cwd: root })
    await seed(
      'locales/de.json',
      json({
        seam: {
          a: 'Alpha, jetzt poliert',
          b: '   ',
          c: 'Hallo {name} {nmae}',
          d: 'Delta auf Deutsch',
        },
      }),
    )

    const checked = await check({ cwd: root })

    expect(at(checked.diagnostics, 'LZ5003')).toEqual([])
    expect(checked.diagnostics.filter((entry) => entry.code === 'LZ5002')).not.toEqual([])
  })

  it('rewrites the record with no warning when only a usage site moved', async () => {
    await seedTree()
    await build({ cwd: root })
    await seed('src/App.ts', caller('Checkout'))

    const second = await build({ cwd: root })

    expect(second.written).toContain(RECORD)
    expect(await read(RECORD)).toContain('Checkout')
    expect(at(second.diagnostics, 'LZ5007')).toEqual([])
  })

  it('fails check on edited source copy, naming the output and the record', async () => {
    await seedTree()
    await build({ cwd: root })
    await seed(
      'locales/en.json',
      json({ seam: { a: 'Alpha, reworded', b: 'Bravo', c: 'Hi {name}', d: 'Delta' } }),
    )

    const checked = await check({ cwd: root })
    const codes = new Set(checked.diagnostics.map((diagnostic) => diagnostic.code))

    expect(codes.has('LZ5002')).toBe(true)
    expect(codes.has('LZ5003')).toBe(true)
    expect(checked.written).toEqual([])
  })

  it('warns once when a build rewrites a record whose contract moved', async () => {
    await seedTree()
    await build({ cwd: root })
    await seed(
      'locales/en.json',
      json({ seam: { a: 'Alpha, reworded', b: 'Bravo', c: 'Hi {name}', d: 'Delta' } }),
    )

    const second = await build({ cwd: root })

    expect(at(second.diagnostics, 'LZ5007')).toHaveLength(1)
    expect(second.written).toContain(RECORD)
  })
})

describe('a build asked not to emit', () => {
  it('produces the files and the record without touching the filesystem', async () => {
    await seedTree()

    const result = await build({ cwd: root, emit: false })

    expect(result.files.length).toBeGreaterThan(0)
    expect(result.record).not.toBeNull()
    expect(result.written).toEqual([])
    expect(await read(`src/loclizr/${SEAM_MODULE}`)).toBeNull()
    expect(await read(RECORD)).toBeNull()
  })
})

describe('a top level key shaped like a path', () => {
  it('writes nothing outside outDir', async () => {
    await seed('locales/en.json', json({ '../escape': { x: 'Boom' }, nav: { home: 'Home' } }))

    const result = await build({ cwd: root })

    for (const file of result.files) expect(file.path.split('/')).not.toContain('..')
    for (const path of result.written) {
      expect(path === RECORD || path.startsWith('src/loclizr/')).toBe(true)
    }
    expect(await read('src/escape.js')).toBeNull()
    expect(await read('escape.js')).toBeNull()
  })
})
