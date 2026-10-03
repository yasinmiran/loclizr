import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Config, Diagnostic } from '../types'
import { toPosix } from '../util'
import type { CatalogReadResult } from './index'
import { readCatalogs } from './index'

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function tree(files: Readonly<Record<string, string>>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'loclizr-catalog-edge-'))
  roots.push(root)
  for (const [path, contents] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), contents)
  }
  return toPosix(root)
}

function makeConfig(root: string, overrides: Partial<Config> = {}): Config {
  return {
    root,
    locales: ['en'],
    sourceLocale: 'en',
    catalogs: 'locales/{locale}.json',
    catalogFormat: 'auto',
    i18nextMarkup: 'literal',
    meta: 'locales/{sourceLocale}.meta.json',
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
  }
}

async function read(
  files: Readonly<Record<string, string>>,
  overrides: Partial<Config> = {},
): Promise<CatalogReadResult> {
  return readCatalogs(makeConfig(await tree(files), overrides))
}

function codes(diagnostics: readonly Diagnostic[]): readonly string[] {
  return diagnostics.map((one) => one.code)
}

function pairsOf(result: CatalogReadResult): readonly (readonly [string, string])[] {
  return result.catalogs.flatMap((catalog) =>
    catalog.entries.map((entry) => [entry.key, entry.value] as const),
  )
}

describe('readCatalogs on empty and blank catalogs', () => {
  it('reads an empty object as one ICU catalog with no entries', async () => {
    const result = await read({ 'locales/en.json': '{}' })
    expect(result.catalogs).toEqual([
      { locale: 'en', ns: null, file: 'locales/en.json', format: 'icu', entries: [] },
    ])
    expect(result.diagnostics).toEqual([])
  })

  it('reports a whitespace-only catalog as a syntax error, fatal on the source alone', async () => {
    const result = await read(
      { 'locales/en.json': ' \r\n\t', 'locales/de.json': '\n\n' },
      { locales: ['en', 'de'] },
    )
    expect(result.catalogs).toEqual([])
    expect(result.diagnostics.map((one) => [one.code, one.locale, one.fatal])).toEqual([
      ['LZ1009', 'en', true],
      ['LZ1009', 'de', false],
    ])
  })

  it('reads a namespace pattern that matches no file as no catalogs and no diagnostics', async () => {
    const result = await read(
      { 'README.md': '# nothing here' },
      { catalogs: 'public/locales/{locale}/{ns}.json' },
    )
    expect(result).toEqual({ catalogs: [], meta: null, diagnostics: [] })
  })
})

describe('readCatalogs on text the file spells unusually', () => {
  it('converts a CRLF i18next file and keeps each span on its own line', async () => {
    const result = await read({
      'locales/en.json': '{\r\n  "a": "Hi {{name}}",\r\n  "b": "Bye {{name}}"\r\n}\r\n',
    })
    expect(result.catalogs[0]?.format).toBe('i18next')
    expect(result.catalogs[0]?.entries.map((entry) => [entry.key, entry.value, entry.span.line])).toEqual([
      ['a', 'Hi {name}', 2],
      ['b', 'Bye {name}', 3],
    ])
  })

  it('reads unicode keys and values from disk byte for byte', async () => {
    const key = 'café.\u{1f600}.名前'
    const value = '‫שלום‬ é \u{1f468}‍\u{1f469}‍\u{1f467}'
    const result = await read({ 'locales/en.json': JSON.stringify({ [key]: value }) })
    expect(pairsOf(result)).toEqual([[key, value]])
  })

  it('keeps NFC and NFD spellings of one key apart on disk', async () => {
    const result = await read({ 'locales/en.json': '{"café": "a", "café": "b"}' })
    expect(pairsOf(result).map(([key]) => key)).toEqual(['café', 'café'])
    expect(result.diagnostics).toEqual([])
  })

  it('reads prototype-named keys as ordinary messages', async () => {
    const result = await read({
      'locales/en.json': '{"__proto__": {"toString": "a"}, "constructor": "b", "prototype": "c"}',
    })
    expect(pairsOf(result)).toEqual([
      ['__proto__.toString', 'a'],
      ['constructor', 'b'],
      ['prototype', 'c'],
    ])
  })
})

describe('readCatalogs on locale tags beyond language and region', () => {
  it('reads the file of a tag with an extension subtag and stamps the tag verbatim', async () => {
    const result = await read(
      { 'locales/en.json': '{"a": "x"}', 'locales/de-u-co-phonebk.json': '{"a": "y"}' },
      { locales: ['en', 'de-u-co-phonebk'] },
    )
    expect(result.catalogs.map((catalog) => [catalog.locale, catalog.file])).toEqual([
      ['en', 'locales/en.json'],
      ['de-u-co-phonebk', 'locales/de-u-co-phonebk.json'],
    ])
  })

  it('folds by the extension tag base locale', async () => {
    const result = await read(
      {
        'locales/en.json': '{"items_one": "{{count}} item", "items_other": "{{count}} items"}',
        'locales/ja-JP-u-ca-japanese.json': '{"items_other": "{{count}} 個"}',
      },
      { locales: ['en', 'ja-JP-u-ca-japanese'] },
    )
    expect(result.catalogs.map((catalog) => catalog.entries.map((entry) => entry.key))).toEqual([
      ['items'],
      ['items'],
    ])
  })
})

describe('readCatalogs namespace paths with glob-shaped directories', () => {
  it('reads a namespace tree under a bracketed directory', async () => {
    const result = await read(
      { 'app/[lang]/en/common.json': '{"a": "x"}' },
      { catalogs: 'app/[lang]/{locale}/{ns}.json' },
    )
    expect(result.catalogs.map((catalog) => [catalog.file, catalog.ns])).toEqual([
      ['app/[lang]/en/common.json', 'common'],
    ])
  })

  it('reads a single catalog under a parenthesised directory with no namespace token', async () => {
    const result = await read(
      { 'app/(site)/en.json': '{"a": "x"}' },
      { catalogs: 'app/(site)/{locale}.json' },
    )
    expect(pairsOf(result)).toEqual([['a', 'x']])
  })
})

describe('readCatalogs under a forced format', () => {
  it("leaves i18next syntax verbatim under catalogFormat 'icu' and raises no i18next rule", async () => {
    const result = await read(
      { 'locales/en.json': '{"a": "Hi {{name}}", "b_one": "x", "b_other": "y", "c": "$t(a)"}' },
      { catalogFormat: 'icu' },
    )
    expect(result.catalogs[0]?.format).toBe('icu')
    expect(pairsOf(result)).toEqual([
      ['a', 'Hi {{name}}'],
      ['b_one', 'x'],
      ['b_other', 'y'],
      ['c', '$t(a)'],
    ])
    expect(result.diagnostics).toEqual([])
  })

  it("reports every ICU typed run under catalogFormat 'i18next' with the configured hint", async () => {
    const result = await read(
      {
        'locales/en.json':
          '{"a": "{n, plural, one {x} other {y}}", "b": "{d, date, short}", "c": "plain"}',
      },
      { catalogFormat: 'i18next' },
    )
    expect(result.diagnostics.map((one) => [one.code, one.key])).toEqual([
      ['LZ1020', 'a'],
      ['LZ1020', 'b'],
    ])
    for (const one of result.diagnostics) expect(one.hint).toContain("catalogFormat is 'i18next'")
  })
})

describe('readCatalogs i18next rules on a namespaced file', () => {
  it('names a context suffix by its prefixed key', async () => {
    const result = await read(
      { 'locales/en/people.json': '{"friend": "{{name}}", "friend_male": "{{name}} (he)"}' },
      { catalogs: 'locales/{locale}/{ns}.json' },
    )
    const context = result.diagnostics.find((one) => one.code === 'LZ1017')
    expect(context?.key).toBe('people.friend')
    expect(context?.related.map((one) => one.key)).toEqual(['people.friend_male'])
  })
})

describe('readCatalogs description sidecar shapes', () => {
  const EN = '{"a": "x", "b": "y", "c": "z"}'

  it('reads an empty sidecar object as a sidecar with no entries', async () => {
    const result = await read({ 'locales/en.json': EN, 'locales/en.meta.json': '{}' })
    expect(result.meta).toEqual({ file: 'locales/en.meta.json', entries: [] })
    expect(result.diagnostics).toEqual([])
  })

  it('reports a whitespace-only sidecar as a non-fatal syntax error', async () => {
    const result = await read({ 'locales/en.json': EN, 'locales/en.meta.json': '   \n' })
    expect(result.meta).toBeNull()
    expect(result.diagnostics.map((one) => [one.code, one.fatal, one.file])).toEqual([
      ['LZ1009', false, 'locales/en.meta.json'],
    ])
  })

  it.each(['[]', '"text"', 'null', '1'])('reports a %s root as a shape error', async (root) => {
    const result = await read({ 'locales/en.json': EN, 'locales/en.meta.json': root })
    expect(result.meta).toBeNull()
    expect(codes(result.diagnostics)).toEqual(['LZ1010'])
    expect(result.diagnostics[0]?.fatal).toBe(false)
  })

  it('reports an entry, a placeholders map and a description of the wrong shape', async () => {
    const result = await read({
      'locales/en.json': EN,
      'locales/en.meta.json': JSON.stringify({
        a: 'just a string',
        b: { placeholders: ['count'] },
        c: { description: ['two', 'lines'] },
      }),
    })
    expect(result.diagnostics.map((one) => [one.code, one.key])).toEqual([
      ['LZ1010', 'a'],
      ['LZ1010', 'b'],
      ['LZ1010', 'c'],
    ])
    expect(result.meta?.entries.map((entry) => [entry.key, entry.description, entry.placeholders])).toEqual([
      ['b', null, []],
      ['c', null, []],
    ])
  })

  it('reads a null description and a null placeholders map as absent', async () => {
    const result = await read({
      'locales/en.json': EN,
      'locales/en.meta.json': '{"a": {"description": null, "placeholders": null}}',
    })
    expect(result.meta?.entries[0]).toMatchObject({ key: 'a', description: null, placeholders: [] })
    expect(result.diagnostics).toEqual([])
  })

  it('keeps an empty description as the empty string, not as absent', async () => {
    const result = await read({
      'locales/en.json': EN,
      'locales/en.meta.json': '{"a": {"description": ""}}',
    })
    expect(result.meta?.entries[0]?.description).toBe('')
  })

  it('keeps placeholder notes named after the prototype', async () => {
    const result = await read({
      'locales/en.json': EN,
      'locales/en.meta.json':
        '{"a": {"placeholders": {"__proto__": "p", "constructor": "c", "toString": "t"}}}',
    })
    expect(result.meta?.entries[0]?.placeholders).toEqual([
      { name: '__proto__', note: 'p' },
      { name: 'constructor', note: 'c' },
      { name: 'toString', note: 't' },
    ])
  })

  it('keeps NFC and NFD note names apart for the record to break the tie', async () => {
    const result = await read({
      'locales/en.json': EN,
      'locales/en.meta.json': '{"a": {"placeholders": {"café": "nfc", "café": "nfd"}}}',
    })
    expect(result.meta?.entries[0]?.placeholders.map((one) => one.name)).toEqual([
      'café',
      'café',
    ])
  })

  it('reports a null note as a shape error and keeps the other notes', async () => {
    const result = await read({
      'locales/en.json': EN,
      'locales/en.meta.json': '{"a": {"placeholders": {"n": null, "m": "kept"}}}',
    })
    expect(result.diagnostics.map((one) => [one.code, one.key])).toEqual([['LZ1010', 'a']])
    expect(result.meta?.entries[0]?.placeholders).toEqual([{ name: 'm', note: 'kept' }])
  })

  it('points a bad note at its own value in the sidecar', async () => {
    const text = '{\n  "a": {\n    "placeholders": {\n      "n": 7\n    }\n  }\n}'
    const result = await read({ 'locales/en.json': EN, 'locales/en.meta.json': text })
    expect(result.diagnostics[0]?.span).toMatchObject({ line: 4, column: 12, length: 1 })
  })

  it('keeps sidecar entries in the order the file wrote them', async () => {
    const result = await read({
      'locales/en.json': EN,
      'locales/en.meta.json': '{"c": {}, "a": {}, "b": {}}',
    })
    expect(result.meta?.entries.map((entry) => entry.key)).toEqual(['c', 'a', 'b'])
  })

  it('reports a sidecar entry that only a target locale defines', async () => {
    const result = await read(
      {
        'locales/en.json': '{"a": "x"}',
        'locales/de.json': '{"a": "x", "only_de": "y"}',
        'locales/en.meta.json': '{"only_de": {"description": "d"}}',
      },
      { locales: ['en', 'de'] },
    )
    expect(result.diagnostics.map((one) => [one.code, one.key])).toEqual([['LZ1015', 'only_de']])
    expect(result.meta?.entries).toEqual([])
  })

  it('addresses a namespaced message by its prefixed key and orphans the bare one', async () => {
    const result = await read(
      {
        'locales/en/common.json': '{"nav": {"home": "Home"}}',
        'locales/en.meta.json': '{"common.nav.home": {"description": "d"}, "nav.home": {"description": "e"}}',
      },
      { catalogs: 'locales/{locale}/{ns}.json' },
    )
    expect(result.meta?.entries.map((entry) => entry.key)).toEqual(['common.nav.home'])
    expect(result.diagnostics.map((one) => [one.code, one.key])).toEqual([['LZ1015', 'nav.home']])
  })
})

describe('readCatalogs determinism', () => {
  it('returns deep-equal results on two reads of one tree', async () => {
    const root = await tree({
      'locales/en/b.json': '{"x_one": "{{count}} x", "x_other": "{{count}} xs", "x": "dup"}',
      'locales/en/a.json': '{"y": "{n, plural, one {a} other {b}}", "y": "again"}',
      'locales/de/a.json': '{"y": "{n, plural, one {a} other {b}}"}',
      'locales/en.meta.json': '{"a.y": {"description": "d"}, "gone": {}}',
    })
    const config = makeConfig(root, {
      locales: ['en', 'de'],
      catalogs: 'locales/{locale}/{ns}.json',
    })
    const first = await readCatalogs(config)
    const second = await readCatalogs(config)
    expect(second).toEqual(first)
    expect(first.catalogs.map((catalog) => catalog.file)).toEqual([
      'locales/en/a.json',
      'locales/en/b.json',
      'locales/de/a.json',
    ])
  })

  it('carries no absolute path in any catalog or diagnostic', async () => {
    const root = await tree({
      'locales/en.json': '{"a": "{{x, f}}", "a": 1}',
      'locales/en.meta.json': '{"gone": {}}',
    })
    const result = await readCatalogs(makeConfig(root))
    expect(JSON.stringify(result)).not.toContain(root)
  })
})
