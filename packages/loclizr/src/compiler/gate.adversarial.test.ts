import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { syncOutput } from './output'
import { recordsAgree } from './record-gate'

const OUT_DIR = 'src/loclizr'
const RECORD = 'locales/loclizr.context.json'

let root = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'loclizr-gate-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

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

function message(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    key: 'cart.greeting',
    id: 'cart_greeting',
    module: 'messages/cart.js',
    kind: 'text',
    source: 'Home',
    sourceHash: '3a78695388b38b5c',
    description: null,
    args: [{ name: 'name', type: 'text', options: null, note: null }],
    variants: [],
    markup: [],
    translations: [{ locale: 'de', status: 'translated', from: null, reason: null }],
    usage: [{ file: 'src/Cart.tsx', scope: 'Cart' }],
    ...overrides,
  }
}

function record(messages: readonly Record<string, unknown>[] = [message()]): string {
  return `${JSON.stringify({ schema: 1, sourceLocale: 'en', locales: ['de', 'en'], messages }, null, 2)}\n`
}

async function gate(mode: 'build' | 'check', committed: string | null): Promise<readonly string[]> {
  if (committed !== null) await seed(RECORD, committed)
  const result = await syncOutput({
    mode,
    root,
    outDir: OUT_DIR,
    files: [],
    record: { path: RECORD, bytes: record() },
  })
  return codes(result.diagnostics)
}

describe('the projection against a hostile committed record', () => {
  it('agrees with a record that escapes the same text differently', () => {
    const escaped = record([message({ source: '\\u0048ome' })]).replace('"\\\\u0048ome"', '"\\u0048ome"')

    expect(JSON.parse(escaped).messages[0].source).toBe('Home')
    expect(recordsAgree(escaped, record())).toBe(true)
  })

  it('agrees with a record whose nested objects carry another key order', () => {
    const reordered = record([
      message({ args: [{ note: null, options: null, type: 'text', name: 'name' }] }),
    ])

    expect(recordsAgree(reordered, record())).toBe(true)
  })

  it('disagrees when a message carries a field the contract does not', () => {
    expect(recordsAgree(record([message({ fuzzy: true })]), record())).toBe(false)
  })

  it('counts a committed record with a byte order mark as differing', async () => {
    expect(await gate('check', `﻿${record()}`)).toEqual(['LZ5003'])
  })

  it('reports a deeply nested committed record as stale rather than throwing', async () => {
    const nested = `{"schema":1,"messages":${'['.repeat(20000)}${']'.repeat(20000)}}`

    await expect(gate('check', nested)).resolves.toEqual(['LZ5003'])
    await expect(gate('build', nested)).resolves.toEqual(['LZ5007'])
  })
})

describe('a committed record checked out with CRLF endings', () => {
  it('passes check, because the gate compares the contract and not the bytes', async () => {
    const committed = record().replaceAll('\n', '\r\n')

    expect(await gate('check', committed)).toEqual([])
  })

  it('is rewritten by build with no record-rewritten warning', async () => {
    const committed = record().replaceAll('\n', '\r\n')
    await seed(RECORD, committed)

    const result = await syncOutput({
      mode: 'build',
      root,
      outDir: OUT_DIR,
      files: [],
      record: { path: RECORD, bytes: record() },
    })

    expect(result.diagnostics).toEqual([])
    expect(result.written).toEqual([RECORD])
    expect(await read(RECORD)).toBe(record())
  })
})
