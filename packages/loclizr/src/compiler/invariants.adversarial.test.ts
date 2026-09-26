import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { BuildResult } from '../types'
import { build, check } from './index'

const RECORD = 'locales/loclizr.context.json'

const CALLER = [
  "import * as m from './loclizr/messages'",
  '',
  'export function Cart(): string {',
  '  return `${m.nav_home()} ${m.cart_total({ amount: 1 })}`',
  '}',
  '',
].join('\n')

let roots: string[] = []

beforeEach(() => {
  roots = []
})

afterEach(async () => {
  for (const directory of roots) await rm(directory, { recursive: true, force: true })
})

async function tree(en: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'loclizr-invariant-'))
  roots.push(root)
  await write(root, 'locales/en.json', en)
  await write(root, 'locales/de.json', `${JSON.stringify({ nav: { home: 'Startseite' } })}\n`)
  await write(root, 'src/App.ts', CALLER)
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

function bytes(result: BuildResult): readonly string[] {
  return result.files.map((file) => `${file.path}\n${file.contents}`)
}

function codes(result: BuildResult): readonly string[] {
  return result.diagnostics.map((diagnostic) => diagnostic.code)
}

const FORWARD = `${JSON.stringify({
  nav: { home: 'Home' },
  cart: { total: 'Total: {amount, number}' },
})}\n`

const REVERSED = `${JSON.stringify({
  cart: { total: 'Total: {amount, number}' },
  nav: { home: 'Home' },
})}\n`

describe('output as a deterministic function of its inputs', () => {
  it('writes the same bytes from two different absolute roots', async () => {
    const first = await tree(FORWARD)
    const second = await tree(FORWARD)

    const left = await build({ cwd: first })
    const right = await build({ cwd: second })

    expect(bytes(right)).toEqual(bytes(left))
    expect(right.written).toEqual(left.written)
    expect(await read(second, RECORD)).toBe(await read(first, RECORD))
  })

  it('leaks no absolute path into the generated tree or the record', async () => {
    const root = await tree(FORWARD)

    const result = await build({ cwd: root })
    const emitted = result.files.map((file) => file.contents).join('\n')

    expect(emitted).not.toContain(root)
    expect(await read(root, RECORD)).not.toContain(root)
    expect(await read(root, RECORD)).toContain('"file": "src/App.ts"')
  })

  it('ignores the order the catalog happened to list its keys in', async () => {
    const forward = await tree(FORWARD)
    const reversed = await tree(REVERSED)

    const left = await build({ cwd: forward })
    const right = await build({ cwd: reversed })

    expect(bytes(right)).toEqual(bytes(left))
    expect(await read(reversed, RECORD)).toBe(await read(forward, RECORD))
  })
})

describe('check as a read only pass', () => {
  it('creates neither the generated tree nor the record it is missing', async () => {
    const root = await tree(FORWARD)

    const result = await check({ cwd: root })

    expect(result.written).toEqual([])
    expect(await read(root, 'src/loclizr/messages.js')).toBeNull()
    expect(await read(root, 'src/loclizr/.gitignore')).toBeNull()
    expect(await read(root, RECORD)).toBeNull()
    expect(codes(result)).toContain('LZ5003')
  })
})

describe('a catalog carrying text no editor would type', () => {
  const hostile = `${JSON.stringify({
    odd: { control: 'a\u0001b', quote: 'He said "*/" and `x${y}`' },
  })}\n`

  it('writes a record that survives the round trip through the filesystem', async () => {
    const root = await tree(hostile)

    const first = await build({ cwd: root })
    const second = await build({ cwd: root })

    expect(codes(first)).not.toContain('LZ5001')
    expect(JSON.parse((await read(root, RECORD)) ?? 'null')).not.toBeNull()
    expect(codes(second)).not.toContain('LZ5007')
  })

  it('writes a generated tree the next build leaves alone', async () => {
    const root = await tree(hostile)

    await build({ cwd: root })
    const second = await build({ cwd: root })

    expect(second.written).toEqual([])
  })

  it('writes a generated tree that passes check', async () => {
    const root = await tree(hostile)

    await build({ cwd: root })
    const checked = await check({ cwd: root })

    expect(codes(checked)).not.toContain('LZ5002')
  })

  it('never lets catalog text close the doc comment it is printed in', async () => {
    const root = await tree(hostile)

    const result = await build({ cwd: root })
    const declaration = result.files.find((file) => file.path === 'messages/odd.d.ts')

    expect(declaration?.contents).toContain('*\\/')
    expect(declaration?.contents).not.toContain('"*/"')
  })
})

// A half emoji is what a TMS export leaves behind. It cannot be encoded as
// UTF-8, so the text that comes back off disk is not the string emit produced,
// and a build that compared the two would never settle.
describe('a catalog carrying an unpaired surrogate', () => {
  const half = `${JSON.stringify({ odd: { pair: 'half a surrogate: \uD800' } })}\n`

  it('writes the module emit produced, as the encoder can carry it', async () => {
    const root = await tree(half)

    const result = await build({ cwd: root })
    const module = result.files.find((file) => file.path === 'messages/odd.js')
    const landed = Buffer.from(module?.contents ?? '', 'utf8').toString('utf8')

    expect(await read(root, 'src/loclizr/messages/odd.js')).toBe(landed)
  })

  it('writes a generated tree the next build leaves alone', async () => {
    const root = await tree(half)

    await build({ cwd: root })
    const second = await build({ cwd: root })

    expect(second.written).toEqual([])
  })

  it('writes a generated tree that passes check', async () => {
    const root = await tree(half)

    await build({ cwd: root })
    const checked = await check({ cwd: root })

    expect(codes(checked)).not.toContain('LZ5002')
  })
})

describe('an identifier collision across two namespaces', () => {
  it('writes no tree and no record at all', async () => {
    const root = await tree(
      `${JSON.stringify({ 'nav-home': 'Home', nav: { home: 'Home page' } })}\n`,
    )

    const result = await build({ cwd: root })

    expect(codes(result)).toContain('LZ4001')
    expect(result.written).toEqual([])
    expect(await read(root, 'src/loclizr/messages.js')).toBeNull()
    expect(await read(root, RECORD)).toBeNull()
    expect(result.exitCode).toBe(1)
  })
})
