import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { EmittedFile } from '../types'
import type { OutputInput, RecordOutput } from './output'
import { GENERATED_HEADER, syncOutput } from './output'

const OUT_DIR = 'src/loclizr'
const RECORD = 'locales/loclizr.context.json'

let roots: string[] = []
let root = ''

beforeEach(async () => {
  root = await fresh()
})

afterEach(async () => {
  for (const directory of roots) await rm(directory, { recursive: true, force: true })
  roots = []
})

async function fresh(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'loclizr-output-edge-'))
  roots.push(directory)
  return directory
}

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

function sync(
  mode: 'build' | 'check',
  files: readonly EmittedFile[],
  overrides: Partial<OutputInput> = {},
): ReturnType<typeof syncOutput> {
  return syncOutput({ mode, root, outDir: OUT_DIR, files, record: null, ...overrides })
}

function record(bytes: string, path = RECORD): RecordOutput {
  return { path, bytes }
}

describe('a path emit is about to write, occupied by something that only looks generated', () => {
  it('skips a zero byte file and leaves it empty', async () => {
    await seed('src/loclizr/messages.js', '')

    const result = await sync('build', [file('messages.js', 'export {}')])

    expect(codes(result.diagnostics)).toEqual(['LZ1021'])
    expect(result.written).toEqual([])
    expect(await read('src/loclizr/messages.js')).toBe('')
  })

  it('reports a zero byte file in check as foreign, never as stale', async () => {
    await seed('src/loclizr/messages.js', '')

    const result = await sync('check', [file('messages.js', 'export {}')])

    expect(codes(result.diagnostics)).toEqual(['LZ1021'])
  })

  it('skips a file whose header sits behind a byte order mark', async () => {
    const marked = `\ufeff${generated('export const old = 1')}`
    await seed('src/loclizr/messages.js', marked)

    const result = await sync('build', [file('messages.js', 'export {}')])

    expect(codes(result.diagnostics)).toEqual(['LZ1021'])
    expect(await read('src/loclizr/messages.js')).toBe(marked)
  })

  it('skips a file whose header was indented by a single space', async () => {
    const indented = ` ${generated('export const old = 1')}`
    await seed('src/loclizr/messages.js', indented)

    const result = await sync('build', [file('messages.js', 'export {}')])

    expect(codes(result.diagnostics)).toEqual(['LZ1021'])
    expect(await read('src/loclizr/messages.js')).toBe(indented)
  })

  it('names the occupied path once, by its POSIX path relative to the root', async () => {
    await seed('src/loclizr/messages/deep/nav.js', 'hand written\n')

    const result = await sync('build', [file('messages/deep/nav.js', 'export {}')])

    expect(result.diagnostics.map((diagnostic) => diagnostic.file)).toEqual([
      'src/loclizr/messages/deep/nav.js',
    ])
  })
})

describe('line endings under a byte comparison', () => {
  it('rewrites a generated file that drifted to CRLF', async () => {
    const emitted = file('messages.js', 'export {}')
    await seed('src/loclizr/messages.js', emitted.contents.replaceAll('\n', '\r\n'))

    const result = await sync('build', [emitted])

    expect(result.written).toEqual(['src/loclizr/messages.js'])
    expect(await read('src/loclizr/messages.js')).toBe(emitted.contents)
  })

  it('reports that drift as stale in check', async () => {
    const emitted = file('messages.js', 'export {}')
    await seed('src/loclizr/messages.js', emitted.contents.replaceAll('\n', '\r\n'))

    const result = await sync('check', [emitted])

    expect(codes(result.diagnostics)).toEqual(['LZ5002'])
  })

  it('settles on emitted contents that carry a lone CR', async () => {
    const emitted = { path: 'messages.js', contents: `${GENERATED_HEADER}\nexport const s = "a\rb"\n` }

    await sync('build', [emitted])
    const second = await sync('build', [emitted])

    expect(second.written).toEqual([])
    expect(second.diagnostics).toEqual([])
  })
})

describe('file names no ASCII tool would produce', () => {
  const names = ['messages/\u{1F600}.js', 'messages/caf\u00e9.js', 'messages/\u05e9\u05dc\u05d5\u05dd.js', 'messages/with space.js']

  it('writes each one and reports it verbatim', async () => {
    const result = await sync(
      'build',
      names.map((name) => file(name, `export const n = ${JSON.stringify(name)}`)),
    )

    expect(result.diagnostics).toEqual([])
    expect(result.written).toEqual(names.map((name) => `${OUT_DIR}/${name}`))
  })

  it('leaves them alone on the next build', async () => {
    const files = names.map((name) => file(name, 'export {}'))
    await sync('build', files)

    const second = await sync('build', files)

    expect(second.written).toEqual([])
    expect(second.diagnostics).toEqual([])
  })

  // APFS treats the two spellings as one name and ext4 as two. Either way the
  // file this emit produced must survive the sweep that follows it.
  it('keeps the file a namespace renamed from NFC to NFD spelling just wrote', async () => {
    await sync('build', [file('messages/caf\u00e9.js', 'export const v = 1')])

    const second = await sync('build', [file('messages/cafe\u0301.js', 'export const v = 2')])

    expect(second.diagnostics).toEqual([])
    expect(await read('src/loclizr/messages/cafe\u0301.js')).toBe(generated('export const v = 2'))
  })
})

describe('the sweep over an outDir emit produced nothing for', () => {
  it('creates no outDir and reports nothing when none exists', async () => {
    const result = await sync('build', [])

    expect(result).toEqual({ written: [], diagnostics: [] })
    expect(await read(OUT_DIR)).toBeNull()
    expect(await readdir(root)).toEqual([])
  })

  it('prunes a headered orphan thirty directories down', async () => {
    const deep = `${Array.from({ length: 30 }, (_, index) => `d${index}`).join('/')}/orphan.js`
    await seed(`${OUT_DIR}/${deep}`, generated('export {}'))

    const result = await sync('build', [])

    expect(result.diagnostics).toEqual([])
    expect(await read(`${OUT_DIR}/${deep}`)).toBeNull()
  })

  it('prunes a file holding the header and nothing else', async () => {
    await seed(`${OUT_DIR}/bare.js`, GENERATED_HEADER)

    await sync('build', [])

    expect(await read(`${OUT_DIR}/bare.js`)).toBeNull()
  })

  it('prunes a headered file inside a directory named like a temporary', async () => {
    await seed(`${OUT_DIR}/nav.js.loclizr1a.tmp/inner.js`, generated('export {}'))

    await sync('build', [])

    expect(await read(`${OUT_DIR}/nav.js.loclizr1a.tmp/inner.js`)).toBeNull()
  })

  it('prunes a headered .tmp file that is not one of the build temporaries', async () => {
    await seed(`${OUT_DIR}/leftover.tmp`, generated('export {}'))

    await sync('build', [])

    expect(await read(`${OUT_DIR}/leftover.tmp`)).toBeNull()
  })

  it('reports foreign files in code point order, whatever readdir returned', async () => {
    for (const name of ['z.ts', '\u00e9.ts', 'B.ts', 'a.ts']) await seed(`${OUT_DIR}/${name}`, 'mine\n')

    const result = await sync('build', [])

    expect(result.diagnostics.map((diagnostic) => diagnostic.file)).toEqual([
      `${OUT_DIR}/B.ts`,
      `${OUT_DIR}/a.ts`,
      `${OUT_DIR}/z.ts`,
      `${OUT_DIR}/\u00e9.ts`,
    ])
  })
})

describe('a symlink inside outDir', () => {
  it('is neither pruned nor reported when it points at a headered file inside the root', async () => {
    await seed('src/elsewhere.js', generated('export {}'))
    await mkdir(join(root, OUT_DIR), { recursive: true })
    await symlink(join(root, 'src/elsewhere.js'), join(root, OUT_DIR, 'linked.js'), 'file')

    const result = await sync('build', [])

    expect(result.diagnostics).toEqual([])
    expect(await readdir(join(root, OUT_DIR))).toEqual(['linked.js'])
    expect(await read('src/elsewhere.js')).toBe(generated('export {}'))
  })

  it('is not reported by check either', async () => {
    await seed('src/elsewhere.js', generated('export {}'))
    await mkdir(join(root, OUT_DIR), { recursive: true })
    await symlink(join(root, 'src/elsewhere.js'), join(root, OUT_DIR, 'linked.js'), 'file')

    const result = await sync('check', [])

    expect(result.diagnostics).toEqual([])
  })

  it('is silent when it dangles', async () => {
    await mkdir(join(root, OUT_DIR), { recursive: true })
    await symlink(join(root, 'nowhere.js'), join(root, OUT_DIR, 'dangling.js'), 'file')

    const result = await sync('build', [])

    expect(result.diagnostics).toEqual([])
    expect(await readdir(join(root, OUT_DIR))).toEqual(['dangling.js'])
  })
})

describe('the record path', () => {
  it('reports output-unwritable in build when a directory occupies it', async () => {
    await mkdir(join(root, RECORD), { recursive: true })

    const result = await sync('build', [], { record: record('{}\n') })

    expect(codes(result.diagnostics)).toEqual(['LZ5001'])
    expect(result.written).toEqual([])
  })

  it('reports record-stale in check when a directory occupies it', async () => {
    await mkdir(join(root, RECORD), { recursive: true })

    const result = await sync('check', [], { record: record('{}\n') })

    expect(codes(result.diagnostics)).toEqual(['LZ5003'])
  })

  it('writes a record under a path holding spaces and non ASCII letters, reported verbatim', async () => {
    const path = 'locales/kontext \u00fc\u00df.json'

    const result = await sync('build', [], { record: record('{}\n', path) })

    expect(result.written).toEqual([path])
    expect(await read(path)).toBe('{}\n')
  })

  it('lists the generated files first and the record last', async () => {
    const result = await sync('build', [file('z.js', 'export {}'), file('a.js', 'export {}')], {
      record: record('{}\n'),
    })

    expect(result.written).toEqual([`${OUT_DIR}/z.js`, `${OUT_DIR}/a.js`, RECORD])
  })

  it('leaves the record out of written when only a generated file changed', async () => {
    await sync('build', [file('a.js', 'export const v = 1')], { record: record('{}\n') })

    const second = await sync('build', [file('a.js', 'export const v = 2')], { record: record('{}\n') })

    expect(second.written).toEqual([`${OUT_DIR}/a.js`])
  })

  it('writes nothing in check even when every byte differs', async () => {
    await seed(RECORD, '{"schema":0}\n')
    await seed(`${OUT_DIR}/a.js`, generated('export const v = 1'))

    const result = await sync('check', [file('a.js', 'export const v = 2')], {
      record: record('{"schema":1}\n'),
    })

    expect(result.written).toEqual([])
    expect(await read(RECORD)).toBe('{"schema":0}\n')
    expect(codes(result.diagnostics)).toEqual(['LZ5002', 'LZ5003'])
  })
})

describe('determinism across two projects', () => {
  it('reports the same written paths and diagnostics from two different roots', async () => {
    const other = await fresh()
    const files = [file('messages.js', 'export {}'), file('messages/nav.js', 'export {}')]
    for (const at of [root, other]) await seed(`${OUT_DIR}/stray.ts`, 'mine\n', at)

    const first = await sync('build', files, { record: record('{}\n') })
    const second = await syncOutput({ mode: 'build', root: other, outDir: OUT_DIR, files, record: record('{}\n') })

    expect(second).toEqual(first)
  })

  it('settles a megabyte of generated text in one build', async () => {
    const big = file('messages/big.js', `export const s = ${JSON.stringify('x'.repeat(1_000_000))}`)

    await sync('build', [big])
    const second = await sync('build', [big])

    expect(second.written).toEqual([])
    expect(await read(`${OUT_DIR}/messages/big.js`)).toBe(big.contents)
  })
})
