import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { EmittedFile } from '../types'
import { GENERATED_HEADER, syncOutput } from './output'

const OUT_DIR = 'src/loclizr'
const RECORD = 'locales/loclizr.context.json'

const canRestrictDirectories = process.platform !== 'win32' && process.getuid?.() !== 0

let root = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'loclizr-prune-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

function generated(body: string, newline = '\n'): string {
  return `${GENERATED_HEADER}${newline}${body}${newline}`
}

function file(path: string, body: string): EmittedFile {
  return { path, contents: generated(body) }
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

function codes(diagnostics: readonly { readonly code: string }[]): readonly string[] {
  return diagnostics.map((diagnostic) => diagnostic.code)
}

function sync(
  mode: 'build' | 'check',
  files: readonly EmittedFile[],
): ReturnType<typeof syncOutput> {
  return syncOutput({ mode, root, outDir: OUT_DIR, files, record: null })
}

describe('what the header does and does not prove', () => {
  it('keeps a file whose header is pushed off line one by a byte order mark', async () => {
    await seed('src/loclizr/messages/old.js', `﻿${generated('export const old = 1')}`)

    const result = await sync('build', [file('messages/nav.js', 'export const nav = 1')])

    expect(codes(result.diagnostics)).toEqual(['LZ1021'])
    expect(result.diagnostics[0]?.file).toBe('src/loclizr/messages/old.js')
    expect(await read('src/loclizr/messages/old.js')).not.toBeNull()
  })

  it('prunes an orphan whose header line was checked out with CRLF', async () => {
    await seed('src/loclizr/messages/old.js', generated('export const old = 1', '\r\n'))

    const result = await sync('build', [file('messages/nav.js', 'export const nav = 1')])

    expect(result.diagnostics).toEqual([])
    expect(await read('src/loclizr/messages/old.js')).toBeNull()
  })

  it('reports a CRLF orphan as stale in check, never as foreign', async () => {
    await seed('src/loclizr/messages/old.js', generated('export const old = 1', '\r\n'))

    const result = await sync('check', [])

    expect(codes(result.diagnostics)).toEqual(['LZ5002'])
  })

  it('reports a foreign file in a nested directory by its POSIX path', async () => {
    await seed('src/loclizr/messages/notes/todo.md', '# hand written\n')

    const result = await sync('build', [])

    expect(codes(result.diagnostics)).toEqual(['LZ1021'])
    expect(result.diagnostics[0]?.file).toBe('src/loclizr/messages/notes/todo.md')
    expect(await read('src/loclizr/messages/notes/todo.md')).toBe('# hand written\n')
  })

  it('protects only the .gitignore at the top of outDir', async () => {
    await seed('src/loclizr/messages/.gitignore', 'node_modules\n')

    const result = await sync('build', [])

    expect(codes(result.diagnostics)).toEqual(['LZ1021'])
    expect(await read('src/loclizr/messages/.gitignore')).toBe('node_modules\n')
  })
})

describe('output-stale as a check only rule', () => {
  it('is never raised by build, which overwrites the file instead', async () => {
    await seed('src/loclizr/messages.js', generated('export const stale = 1'))

    const result = await sync('build', [file('messages.js', 'export const fresh = 1')])

    expect(result.diagnostics).toEqual([])
    expect(result.written).toEqual(['src/loclizr/messages.js'])
    expect(await read('src/loclizr/messages.js')).toBe(generated('export const fresh = 1'))
  })
})

describe('a namespace renamed by case alone', () => {
  it('leaves the file this emit wrote on disk', async () => {
    await sync('build', [file('messages/nav.js', 'export const nav = 1')])

    const second = await sync('build', [file('messages/Nav.js', 'export const Nav = 1')])

    expect(second.written).toEqual(['src/loclizr/messages/Nav.js'])
    expect(await read('src/loclizr/messages/Nav.js')).toBe(generated('export const Nav = 1'))
  })
})

function recordBytes(source: string): string {
  const body = {
    schema: 1,
    sourceLocale: 'en',
    locales: ['en'],
    messages: [
      {
        key: 'nav.home',
        id: 'nav_home',
        module: 'messages/nav.js',
        kind: 'text',
        source,
        sourceHash: '3a78695388b38b5c',
        description: null,
        args: [],
        variants: [],
        markup: [],
        translations: [],
        usage: [],
      },
    ],
  }
  return `${JSON.stringify(body, null, 2)}\n`
}

describe('an orphan the prune cannot delete', () => {
  it.runIf(canRestrictDirectories)(
    'leaves it and still compares and writes the record',
    async () => {
      await seed('src/loclizr/locked/old.js', generated('export const old = 1'))
      await seed(RECORD, recordBytes('Home'))
      const locked = join(root, OUT_DIR, 'locked')
      await chmod(locked, 0o500)

      try {
        const result = await syncOutput({
          mode: 'build',
          root,
          outDir: OUT_DIR,
          files: [file('messages/nav.js', 'export const nav = 1')],
          record: { path: RECORD, bytes: recordBytes('Start') },
        })

        expect(codes(result.diagnostics).toSorted()).toEqual(['LZ1021', 'LZ5007'])
        expect(result.diagnostics.every((entry) => !entry.fatal)).toBe(true)
        expect(await read('src/loclizr/locked/old.js')).not.toBeNull()
        expect(result.written).toEqual(['src/loclizr/messages/nav.js', RECORD])
        expect(await read(RECORD)).toBe(recordBytes('Start'))
      } finally {
        await chmod(locked, 0o700)
      }
    },
  )
})

describe('two builds of one project overlapping', () => {
  const inFlight = 'src/loclizr/messages/nav.js.loclizrabc1.tmp'

  it('never prunes the temporary file the other one is about to rename', async () => {
    await seed(inFlight, generated('export const nav = 1'))

    const result = await sync('build', [file('messages.js', 'export {}')])

    expect(result.diagnostics).toEqual([])
    expect(await read(inFlight)).not.toBeNull()
  })

  it('never reports that temporary file as stale or as foreign in check', async () => {
    await seed(inFlight, generated('export const nav = 1'))

    expect((await sync('check', [])).diagnostics).toEqual([])
  })
})

describe('a path occupied by something that is not a file', () => {
  it('reports output-unwritable rather than throwing', async () => {
    await mkdir(join(root, OUT_DIR, 'messages.js'), { recursive: true })

    const result = await sync('build', [file('messages.js', 'export {}')])

    expect(codes(result.diagnostics)).toEqual(['LZ5001'])
    expect(result.diagnostics[0]?.fatal).toBe(true)
    expect(result.written).toEqual([])
  })
})
