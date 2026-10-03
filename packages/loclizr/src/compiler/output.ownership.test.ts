import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { EmittedFile } from '../types'
import type { OutputInput } from './output'
import { GENERATED_HEADER, syncOutput } from './output'

const OUT_DIR = 'src/loclizr'
const RECORD = 'locales/loclizr.context.json'
const RECORD_BYTES = '{\n  "schema": 1,\n  "messages": {}\n}\n'

let roots: string[] = []
let root = ''
let outside = ''

beforeEach(async () => {
  root = await fresh()
  outside = await fresh()
})

afterEach(async () => {
  for (const directory of roots) await rm(directory, { recursive: true, force: true })
  roots = []
})

async function fresh(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'loclizr-output-ownership-'))
  roots.push(directory)
  return directory
}

function generated(body: string): string {
  return `${GENERATED_HEADER}\n${body}\n`
}

async function seed(absolute: string, contents: string): Promise<void> {
  await mkdir(dirname(absolute), { recursive: true })
  await writeFile(absolute, contents, 'utf8')
}

async function isLink(absolute: string): Promise<boolean> {
  return (await lstat(absolute)).isSymbolicLink()
}

function codes(diagnostics: readonly { readonly code: string }[]): readonly string[] {
  return diagnostics.map((diagnostic) => diagnostic.code)
}

function sync(
  mode: 'build' | 'check',
  files: readonly EmittedFile[],
  overrides: Partial<OutputInput> = {},
): ReturnType<typeof syncOutput> {
  return syncOutput({ mode, root, outDir: OUT_DIR, files, record: null, ...overrides })
}

// The temporary's sequence is a module counter, so every name the next writes
// could take is planted rather than guessing which one this test reaches.
async function plantTemporaries(absolute: string, target: string): Promise<readonly string[]> {
  const planted: string[] = []
  for (let sequence = 1; sequence <= 64; sequence += 1) {
    const name = `${absolute}.loclizr${process.pid.toString(36)}${sequence.toString(36)}.tmp`
    await symlink(target, name, 'file')
    planted.push(name)
  }
  return planted
}

describe('a symlink planted at the temporary name', () => {
  it('is not written through, not deleted, and the write fails as LZ5001', async () => {
    const target = join(outside, 'victim.txt')
    await seed(target, 'keep\n')
    await mkdir(join(root, 'locales'), { recursive: true })
    const planted = await plantTemporaries(join(root, RECORD), target)

    const result = await sync('build', [], { record: { path: RECORD, bytes: RECORD_BYTES } })

    expect(codes(result.diagnostics)).toEqual(['LZ5001'])
    expect(result.written).toEqual([])
    expect(await readFile(target, 'utf8')).toBe('keep\n')
    for (const name of planted) expect(await isLink(name)).toBe(true)
  })
})

describe('a file at the record path carrying conflict markers', () => {
  it('is not written over when it does not name schema 1', async () => {
    const source = '<<<<<<< HEAD\nexport const a = 1\n=======\nexport const a = 2\n>>>>>>> topic\n'
    await seed(join(root, RECORD), source)

    const result = await sync('build', [], { record: { path: RECORD, bytes: RECORD_BYTES } })

    expect(codes(result.diagnostics)).toEqual(['LZ5001'])
    expect(result.written).toEqual([])
    expect(await readFile(join(root, RECORD), 'utf8')).toBe(source)
  })

  it('is healed when it still names schema 1', async () => {
    const conflicted = `<<<<<<< HEAD\n{\n  "schema": 1,\n  "messages": { "a": {} }\n=======\n${RECORD_BYTES}>>>>>>> topic\n`
    await seed(join(root, RECORD), conflicted)

    const result = await sync('build', [], { record: { path: RECORD, bytes: RECORD_BYTES } })

    expect(result.written).toEqual([RECORD])
    expect(await readFile(join(root, RECORD), 'utf8')).toBe(RECORD_BYTES)
  })

  // The match is textual, since conflicted text does not parse, so it is held
  // to a line that is only the schema key, as the record prints it.
  it.each([
    ['a nested schema key', '{"compilerOptions": {"schema": 1}}'],
    ['a string literal naming it', 'export const sample = \'"schema": 1\''],
    ['a schema that only starts with 1', '{\n  "schema": 1.5\n}'],
  ])('is not written over when only %s names schema 1', async (_, body) => {
    const source = `<<<<<<< HEAD\n${body}\n=======\n${body} \n>>>>>>> topic\n`
    await seed(join(root, RECORD), source)

    const result = await sync('build', [], { record: { path: RECORD, bytes: RECORD_BYTES } })

    expect(codes(result.diagnostics)).toEqual(['LZ5001'])
    expect(result.written).toEqual([])
    expect(await readFile(join(root, RECORD), 'utf8')).toBe(source)
  })
})

describe('a symlink at an emitted path', () => {
  async function linkEmittedPath(): Promise<string> {
    const target = join(outside, 'messages.js')
    await seed(target, generated('export const old = 1'))
    await mkdir(join(root, OUT_DIR), { recursive: true })
    await symlink(target, join(root, OUT_DIR, 'messages.js'), 'file')
    return target
  }

  it('is foreign in build: neither followed nor replaced', async () => {
    const target = await linkEmittedPath()

    const result = await sync('build', [
      { path: 'messages.js', contents: generated('export const fresh = 1') },
    ])

    expect(codes(result.diagnostics)).toEqual(['LZ1021'])
    expect(result.diagnostics[0]?.message).toContain('is a symbolic link')
    expect(result.diagnostics[0]?.message).not.toContain('generated header')
    expect(result.written).toEqual([])
    expect(await isLink(join(root, OUT_DIR, 'messages.js'))).toBe(true)
    expect(await readFile(target, 'utf8')).toBe(generated('export const old = 1'))
  })

  it('is foreign in check, so the target outside the root decides nothing', async () => {
    await linkEmittedPath()

    const result = await sync('check', [
      { path: 'messages.js', contents: generated('export const fresh = 1') },
    ])

    expect(codes(result.diagnostics)).toEqual(['LZ1021'])
  })
})

describe('a symlinked directory between outDir and an emitted path', () => {
  async function linkMessagesDirectory(contents: string): Promise<string> {
    const target = join(outside, 'x.js')
    await seed(target, contents)
    await mkdir(join(root, OUT_DIR), { recursive: true })
    await symlink(outside, join(root, OUT_DIR, 'messages'), 'dir')
    return target
  }

  it('in check, stops the comparison instead of letting the outside file decide LZ5002', async () => {
    await linkMessagesDirectory(generated('export const old = 1'))

    const result = await sync('check', [
      { path: 'messages/x.js', contents: generated('export const fresh = 1') },
    ])

    expect(codes(result.diagnostics)).toEqual(['LZ5001'])
    expect(result.diagnostics[0]?.message).toContain('resolves outside the project root')
  })

  it('in build, fails as LZ5001 even when the outside file already matches', async () => {
    const contents = generated('export const same = 1')
    const target = await linkMessagesDirectory(contents)

    const result = await sync('build', [{ path: 'messages/x.js', contents }])

    expect(codes(result.diagnostics)).toEqual(['LZ5001'])
    expect(result.written).toEqual([])
    expect(await readFile(target, 'utf8')).toBe(contents)
  })
})
