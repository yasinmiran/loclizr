import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { parse } from '@formatjs/icu-messageformat-parser'
import { afterEach, describe, expect, it } from 'vitest'
import type { Config } from '../types'
import { toPosix } from '../util'
import type { CatalogReadResult } from './index'
import { parseJsonWithSpans, readCatalogs } from './index'

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function read(
  files: Readonly<Record<string, string>>,
  overrides: Partial<Config> = {},
): Promise<CatalogReadResult> {
  const root = await mkdtemp(join(tmpdir(), 'loclizr-catalog-regression-'))
  roots.push(root)
  for (const [path, contents] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), contents)
  }
  return readCatalogs({
    root: toPosix(root),
    locales: ['en'],
    sourceLocale: 'en',
    catalogs: 'locales/{locale}.json',
    catalogFormat: 'auto',
    i18nextMarkup: 'literal',
    meta: false,
    outDir: 'src/loclizr',
    record: 'locales/loclizr.context.json',
    cookie: 'locale',
    augmentLocale: true,
    groups: {},
    identifiers: {},
    fallback: 'bcp47',
    formats: { timeZone: null, number: {}, dateTime: {} },
    scan: { include: [], exclude: [] },
    severity: {},
    ...overrides,
  })
}

function entriesOf(result: CatalogReadResult): readonly (readonly [string, string, number])[] {
  return result.catalogs.flatMap((catalog) =>
    catalog.entries.map((entry) => [entry.key, entry.value, entry.span.offset] as const),
  )
}

describe('flatten walks keys in file order', () => {
  it('keeps the last route of a collision through an integer-like segment, with its own span', async () => {
    const text = '{"1.a": "dotted", "1": {"a": "nested"}}'
    const result = await read({ 'locales/en.json': text })
    expect(entriesOf(result)).toEqual([['1.a', 'nested', text.indexOf('nested')]])
    expect(result.diagnostics.map((one) => [one.code, one.key])).toEqual([['LZ1011', '1.a']])
  })

  it('takes the value and the span of a repeated key from its last spelling', async () => {
    const text = '{"x": {"y": "n1"}, "x.y": "dotted", "x": {"y": "n2"}}'
    const result = await read({ 'locales/en.json': text })
    expect(entriesOf(result)).toEqual([['x.y', 'n2', text.indexOf('n2')]])
  })

  it('emits integer-like keys where the file writes them', async () => {
    const result = await read({ 'locales/en.json': '{"b": "x", "10": "y", "2": "z"}' })
    expect(entriesOf(result).map(([key]) => key)).toEqual(['b', '10', '2'])
  })
})

describe('flatten joins an empty segment like any other', () => {
  it('keeps a leading empty segment, so it does not collide with a real key', async () => {
    const result = await read({ 'locales/en.json': '{"": {"a": "x"}, "a": "y"}' })
    expect(entriesOf(result).map(([key, value]) => [key, value])).toEqual([
      ['.a', 'x'],
      ['a', 'y'],
    ])
    expect(result.diagnostics).toEqual([])
  })

  it('collides the nested and dotted spellings of a path that starts empty', async () => {
    const result = await read({ 'locales/en.json': '{"": {"a": "x"}, ".a": "y"}' })
    expect(entriesOf(result).map(([key, value]) => [key, value])).toEqual([['.a', 'y']])
    expect(result.diagnostics.map((one) => [one.code, one.key])).toEqual([['LZ1011', '.a']])
  })
})

describe('parseJsonWithSpans on line endings and a byte order mark', () => {
  it('counts a lone CR as a line break', () => {
    const parsed = parseJsonWithSpans('{"a": "x",\r"b": "y"}', 'f.json')
    expect(parsed.spans.get('b')).toEqual({ line: 2, column: 7, offset: 17, length: 1 })
  })

  it('names a leading byte order mark in words and says how to drop it', () => {
    const parsed = parseJsonWithSpans('\ufeff{"a": "x"}', 'f.json')
    expect(parsed.value).toBeUndefined()
    const [only] = parsed.diagnostics
    expect(only?.code).toBe('LZ1009')
    expect(only?.message).not.toContain('\ufeff')
    expect(only?.message).toContain('byte order mark')
    expect(only?.hint).toContain('UTF-8 without a byte order mark')
  })
})

describe('LZ1017 on a nested key under an underscored segment', () => {
  it('does not read a dotted remainder as a context suffix', async () => {
    const result = await read({
      'locales/en.json': '{"user": "User", "user_settings": {"title": "Settings"}, "x": "{{y}}"}',
    })
    expect(result.diagnostics.filter((one) => one.code === 'LZ1017')).toEqual([])
  })

  it('still prints a rewrite that parses for a real context beside a nested key', async () => {
    const result = await read({
      'locales/en.json':
        '{"user": "User", "user_male": "Him", "user_settings": {"title": "Settings"}, "x": "{{y}}"}',
    })
    const found = result.diagnostics.filter((one) => one.code === 'LZ1017')
    expect(found.map((one) => one.related.map((related) => related.key))).toEqual([['user_male']])
    const rewrite = /"user": "(.*)"$/.exec(found[0]?.hint ?? '')?.[1] ?? ''
    expect(() => parse(rewrite.replaceAll('...', 'x'))).not.toThrow()
  })
})

describe('LZ1020 hints name a fix that clears the warning', () => {
  const catalog = { 'locales/en.json': '{"a": "Hi {{name}}", "b": "{n, plural, one {# x} other {# y}}"}' }

  it('offers the severity override for literal text when the file classified as i18next', async () => {
    const result = await read(catalog)
    const hint = result.diagnostics.find((one) => one.code === 'LZ1020')?.hint ?? ''
    expect(hint).toContain('Hi {{name}}')
    expect(hint).not.toContain('pin catalogFormat')
    expect(hint).toContain("severity: { 'icu-in-i18next-file': 'off' }")
  })

  it('does not send a pinned catalogFormat back to auto on its own', async () => {
    const result = await read(catalog, { catalogFormat: 'i18next' })
    const hint = result.diagnostics.find((one) => one.code === 'LZ1020')?.hint ?? ''
    expect(hint).toContain("catalogFormat is 'i18next'")
    expect(hint).not.toContain("Set it to 'auto' or")
    expect(hint).toContain("severity: { 'icu-in-i18next-file': 'off' }")
  })
})

describe('a null leaf in the source catalog', () => {
  it.each([
    ['dotted first', '{"a.b": "text", "a": {"b": null}}'],
    ['null first', '{"a": {"b": null}, "a.b": "text"}'],
  ])('raises nothing when another route to the key holds text, %s', async (_, text) => {
    const result = await read({ 'locales/en.json': text })
    expect(entriesOf(result).map(([key, value]) => [key, value])).toEqual([['a.b', 'text']])
    expect(result.diagnostics.filter((one) => one.code === 'LZ1010')).toEqual([])
  })

  it('is reported once when two routes to the key are both null', async () => {
    const result = await read({ 'locales/en.json': '{"a": {"b": null}, "a.b": null}' })
    expect(result.diagnostics.map((one) => [one.code, one.key])).toEqual([['LZ1010', 'a.b']])
  })

  it('is LZ1010 on the source, naming the key, and still produces no entry', async () => {
    const result = await read(
      {
        'locales/en.json': '{ "cart": { "greeting": null, "title": "Cart" } }',
        'locales/de.json': '{ "cart": { "greeting": "Hallo", "title": null } }',
      },
      { locales: ['en', 'de'] },
    )
    expect(entriesOf(result).map(([key]) => key)).toEqual(['cart.title', 'cart.greeting'])
    expect(result.diagnostics.map((one) => [one.code, one.locale, one.key, one.span?.line])).toEqual([
      ['LZ1010', 'en', 'cart.greeting', 1],
    ])
  })
})
