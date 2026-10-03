import type { PathLike } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EmittedFile } from '../types'
import { GENERATED_HEADER, syncOutput } from './output'

// Some network and FUSE filesystems report inode 0 for every file. The flag
// turns that on for one test without touching the real filesystem.
const filesystem = vi.hoisted(() => ({ zeroInodes: false }))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    stat: async (path: PathLike) => {
      const found = await actual.stat(path)
      return filesystem.zeroInodes ? Object.assign(found, { ino: 0 }) : found
    },
  }
})

const OUT_DIR = 'src/loclizr'
const RECORD = 'locales/loclizr.context.json'

let roots: string[] = []
let root = ''

beforeEach(async () => {
  root = await fresh()
})

afterEach(async () => {
  filesystem.zeroInodes = false
  for (const directory of roots) await rm(directory, { recursive: true, force: true })
  roots = []
})

async function fresh(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'loclizr-output-mutants-'))
  roots.push(directory)
  return directory
}

async function caseInsensitive(): Promise<boolean> {
  const directory = await mkdtemp(join(tmpdir(), 'loclizr-case-probe-'))
  try {
    await writeFile(join(directory, 'probe'), '')
    await stat(join(directory, 'PROBE'))
    return true
  } catch {
    return false
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

const foldsCase = await caseInsensitive()

function generated(body: string): string {
  return `${GENERATED_HEADER}\n${body}\n`
}

function file(path: string, body: string): EmittedFile {
  return { path, contents: generated(body) }
}

async function seed(path: string, contents: string, at = root): Promise<void> {
  const absolute = join(at, path)
  await mkdir(dirname(absolute), { recursive: true })
  await writeFile(absolute, contents, 'utf8')
}

async function read(path: string, at = root): Promise<string | null> {
  try {
    return await readFile(join(at, path), 'utf8')
  } catch {
    return null
  }
}

function codes(diagnostics: readonly { readonly code: string }[]): readonly string[] {
  return diagnostics.map((diagnostic) => diagnostic.code)
}

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

function buildRecord(bytes: string): ReturnType<typeof syncOutput> {
  return syncOutput({
    mode: 'build',
    root,
    outDir: OUT_DIR,
    files: [],
    record: { path: RECORD, bytes },
  })
}

describe('an outDir linked to the directory that holds the project', () => {
  it('is outside the root, so nothing is written there', async () => {
    const project = join(root, 'project')
    await mkdir(project, { recursive: true })
    await symlink(root, join(project, 'generated'), 'dir')

    const result = await syncOutput({
      mode: 'build',
      root: project,
      outDir: 'generated',
      files: [file('messages.js', 'export {}')],
      record: null,
    })

    expect(codes(result.diagnostics)).toEqual(['LZ5001'])
    expect(result.written).toEqual([])
    expect(await read('messages.js')).toBeNull()
  })
})

describe('an outDir whose name starts with two dots', () => {
  it('is an ordinary directory inside the root and is written', async () => {
    const result = await syncOutput({
      mode: 'build',
      root,
      outDir: '..loclizr',
      files: [file('messages.js', 'export {}')],
      record: null,
    })

    expect(result.diagnostics).toEqual([])
    expect(result.written).toEqual(['..loclizr/messages.js'])
    expect(await read('..loclizr/messages.js')).toBe(generated('export {}'))
  })
})

describe.runIf(foldsCase)('an unchanged file whose name differs from emit by case alone', () => {
  it('survives the prune in build', async () => {
    await seed('src/loclizr/messages/nav.js', generated('export const nav = 1'))

    const result = await syncOutput({
      mode: 'build',
      root,
      outDir: OUT_DIR,
      files: [file('messages/Nav.js', 'export const nav = 1')],
      record: null,
    })

    expect(result.diagnostics).toEqual([])
    expect(await read('src/loclizr/messages/Nav.js')).toBe(generated('export const nav = 1'))
  })

  it('is not reported as orphaned in check', async () => {
    await seed('src/loclizr/messages/nav.js', generated('export const nav = 1'))

    const result = await syncOutput({
      mode: 'check',
      root,
      outDir: OUT_DIR,
      files: [file('messages/Nav.js', 'export const nav = 1')],
      record: null,
    })

    expect(result.diagnostics).toEqual([])
  })
})

describe('a filesystem that reports inode 0 for every file', () => {
  it('still prunes a headered orphan', async () => {
    filesystem.zeroInodes = true
    await seed('src/loclizr/messages/old.js', generated('export const old = 1'))

    const result = await syncOutput({
      mode: 'build',
      root,
      outDir: OUT_DIR,
      files: [file('messages/nav.js', 'export const nav = 1')],
      record: null,
    })

    expect(result.diagnostics).toEqual([])
    expect(await read('src/loclizr/messages/old.js')).toBeNull()
    expect(await read('src/loclizr/messages/nav.js')).toBe(generated('export const nav = 1'))
  })
})

describe('what build will write the record over', () => {
  it('replaces a committed record that starts with a byte order mark', async () => {
    await seed(RECORD, `﻿${recordBytes('Home')}`)

    const result = await buildRecord(recordBytes('Start'))

    expect(codes(result.diagnostics)).not.toContain('LZ5001')
    expect(result.written).toEqual([RECORD])
    expect(await read(RECORD)).toBe(recordBytes('Start'))
  })

  it('leaves a JSON object whose schema is not 1', async () => {
    const other = `${JSON.stringify({ schema: 2, messages: [] }, null, 2)}\n`
    await seed(RECORD, other)

    const result = await buildRecord(recordBytes('Start'))

    expect(codes(result.diagnostics)).toEqual(['LZ5001'])
    expect(result.written).toEqual([])
    expect(await read(RECORD)).toBe(other)
  })

  it('leaves a text file whose ruler line only resembles a conflict marker', async () => {
    const notes = '<<<<<<<<<<<<<<<<\nrelease notes\n'
    await seed(RECORD, notes)

    const result = await buildRecord(recordBytes('Start'))

    expect(codes(result.diagnostics)).toEqual(['LZ5001'])
    expect(result.written).toEqual([])
    expect(await read(RECORD)).toBe(notes)
  })
})
