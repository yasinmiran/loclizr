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
  const root = await mkdtemp(join(tmpdir(), 'loclizr-catalog-adversarial-'))
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

function codes(diagnostics: readonly Diagnostic[]): readonly string[] {
  return diagnostics.map((one) => one.code)
}

function keysOf(result: CatalogReadResult): readonly string[] {
  return result.catalogs.flatMap((catalog) => catalog.entries.map((entry) => entry.key))
}

describe('readCatalogs paths', () => {
  it('names every file relative to the root, in POSIX, in catalogs and diagnostics alike', async () => {
    const root = await tree({
      'locales/en/common.json': JSON.stringify({ tips: ['a', 'b'], nav: { home: 'Home' } }),
      'locales/en.meta.json': JSON.stringify({ orphan: { description: 'nothing' } }),
    })
    const result = await readCatalogs(
      makeConfig(root, { catalogs: 'locales/{locale}/{ns}.json' }),
    )
    expect(result.catalogs.map((catalog) => catalog.file)).toEqual(['locales/en/common.json'])
    expect(result.meta?.file).toBe('locales/en.meta.json')
    expect(codes(result.diagnostics)).toEqual(['LZ1010', 'LZ1015'])
    for (const diagnostic of result.diagnostics) {
      expect(diagnostic.file).not.toContain('\\')
      expect(diagnostic.file?.startsWith('/')).toBe(false)
      expect(diagnostic.file?.startsWith(root)).toBe(false)
    }
  })
})

describe('readCatalogs namespace tokens', () => {
  it('matches one whole basename stem and never crosses a dot or a slash', async () => {
    const root = await tree({
      'locales/en/common.json': JSON.stringify({ nav: { home: 'Home' } }),
      'locales/en/with-dash.json': JSON.stringify({ a: 'A' }),
      'locales/en/with_underscore.json': JSON.stringify({ b: 'B' }),
      'locales/en/UPPER9.json': JSON.stringify({ c: 'C' }),
      'locales/en/a.b.json': JSON.stringify({ d: 'D' }),
      'locales/en/café.json': JSON.stringify({ e: 'E' }),
      'locales/en/deep/nested.json': JSON.stringify({ f: 'F' }),
    })
    const result = await readCatalogs(
      makeConfig(root, { catalogs: 'locales/{locale}/{ns}.json' }),
    )
    expect(result.catalogs.map((catalog) => catalog.ns)).toEqual([
      'UPPER9',
      'common',
      'with-dash',
      'with_underscore',
    ])
    expect(keysOf(result)).toEqual([
      'UPPER9.c',
      'common.nav.home',
      'with-dash.a',
      'with_underscore.b',
    ])
    expect(result.diagnostics).toEqual([])
  })

  it('reads nothing out of a directory named like a catalog, and no dotfile', async () => {
    const root = await tree({
      'locales/en/common.json': JSON.stringify({ nav: { home: 'Home' } }),
      'locales/en/pack.json/inner.json': JSON.stringify({ a: 'A' }),
      'locales/en/.hidden.json': JSON.stringify({ b: 'B' }),
    })
    const result = await readCatalogs(
      makeConfig(root, { catalogs: 'locales/{locale}/{ns}.json' }),
    )
    expect(result.catalogs.map((catalog) => catalog.file)).toEqual(['locales/en/common.json'])
    expect(result.diagnostics).toEqual([])
  })

  it('reads the namespace out of a directory segment', async () => {
    const root = await tree({
      'locales/common/en.json': JSON.stringify({ nav: { home: 'Home' } }),
      'locales/errors/en.json': JSON.stringify({ forbidden: 'No' }),
    })
    const result = await readCatalogs(
      makeConfig(root, { catalogs: 'locales/{ns}/{locale}.json' }),
    )
    expect(keysOf(result)).toEqual(['common.nav.home', 'errors.forbidden'])
  })

  it('never reads its own sidecar or record as a namespace catalog', async () => {
    const root = await tree({
      'locales/en/common.json': JSON.stringify({ nav: { home: 'Home' } }),
      'locales/en/_meta.json': JSON.stringify({ 'common.nav.home': { description: 'Top nav' } }),
      'locales/en/ctx.json': JSON.stringify({ schema: 1, messages: [] }),
    })
    const result = await readCatalogs(
      makeConfig(root, {
        catalogs: 'locales/{locale}/{ns}.json',
        meta: 'locales/{sourceLocale}/_meta.json',
        record: 'locales/en/ctx.json',
      }),
    )
    expect(result.catalogs.map((catalog) => catalog.ns)).toEqual(['common'])
    expect(result.meta?.entries.map((entry) => entry.key)).toEqual(['common.nav.home'])
    expect(result.diagnostics).toEqual([])
  })
})

describe('readCatalogs descriptions against the post-fold key set', () => {
  it('addresses a folded plural by its base key and reports the suffixed form', async () => {
    const root = await tree({
      'locales/en/common.json': JSON.stringify({
        greeting: 'Hi {{name}}',
        items_one: '{{count}} item',
        items_other: '{{count}} items',
      }),
      'locales/en.meta.json': JSON.stringify({
        'common.items': { description: 'Badge under the cart icon' },
        'common.items_one': { description: 'The singular' },
        items: { description: 'Unprefixed' },
      }),
    })
    const result = await readCatalogs(
      makeConfig(root, { catalogs: 'locales/{locale}/{ns}.json' }),
    )
    expect(keysOf(result)).toEqual(['common.greeting', 'common.items'])
    expect(result.meta?.entries.map((entry) => entry.key)).toEqual(['common.items'])
    expect(codes(result.diagnostics)).toEqual(['LZ1015', 'LZ1015'])
    expect(result.diagnostics.map((one) => one.key)).toEqual(['common.items_one', 'items'])
  })
})

describe('readCatalogs duplicate keys', () => {
  it('reports a repeated JSON key by its prefixed name and keeps only the last one', async () => {
    const root = await tree({
      'locales/en/common.json': '{"a": {"b": "first"}, "a": {"c": "second"}}',
    })
    const result = await readCatalogs(
      makeConfig(root, { catalogs: 'locales/{locale}/{ns}.json' }),
    )
    expect(codes(result.diagnostics)).toEqual(['LZ1011'])
    expect(result.diagnostics[0]?.key).toBe('common.a')
    expect(keysOf(result)).toEqual(['common.a.c'])
  })

  it('leaves a dotted key beside a deeper nested one alone, because neither shadows the other', async () => {
    const root = await tree({
      'locales/en.json': '{"a.b": "leaf", "a": {"b": {"c": "deeper"}}}',
    })
    const result = await readCatalogs(makeConfig(root))
    expect(keysOf(result)).toEqual(['a.b', 'a.b.c'])
    expect(codes(result.diagnostics)).toEqual([])
  })
})

describe('readCatalogs keeps what the fallback chain has to tell apart', () => {
  it('keeps an empty and a whitespace-only value and drops only the null leaf', async () => {
    const root = await tree({
      'locales/en.json': JSON.stringify({
        greeting: 'Hi {{name}}',
        empty: '',
        blank: '   ',
        untranslated: null,
      }),
    })
    const result = await readCatalogs(makeConfig(root))
    expect(result.catalogs[0]?.format).toBe('i18next')
    expect(result.catalogs[0]?.entries.map((entry) => [entry.key, entry.value])).toEqual([
      ['greeting', 'Hi {name}'],
      ['empty', ''],
      ['blank', '   '],
    ])
    // Only a null leaf in the source has no fallback to reach.
    expect(result.diagnostics.map((one) => [one.code, one.key])).toEqual([['LZ1010', 'untranslated']])
  })
})

describe('readCatalogs reports ICU syntax in an i18next file once per entry', () => {
  it('names every entry that will render as literal text', async () => {
    const root = await tree({
      'locales/en.json': JSON.stringify({
        greeting: 'Hi {{name}}',
        counted: '{count, plural, one {a} other {b}}',
        chosen: '{g, select, other {b}}',
        plain: 'Nothing typed here {maybe}',
      }),
    })
    const result = await readCatalogs(makeConfig(root))
    expect(codes(result.diagnostics)).toEqual(['LZ1020', 'LZ1020'])
    expect(result.diagnostics.map((one) => one.key)).toEqual(['counted', 'chosen'])
    expect(result.diagnostics[0]?.hint).toContain('Hi {{name}}')
  })
})

describe('readCatalogs holds the i18next rules to i18next files', () => {
  it('raises none of them on a file it read as ICU', async () => {
    const values = {
      nesting: 'See $t(nav.home) first',
      items_one: 'one item',
      friend: 'A friend',
      friend_male: 'A boyfriend',
      terms: 'Read <a href="/t">terms</a>',
      counted: '{count, plural, one {# item} other {# items}}',
    }
    const root = await tree({ 'locales/en.json': JSON.stringify(values) })
    const result = await readCatalogs(makeConfig(root))
    expect(result.catalogs[0]?.format).toBe('icu')
    expect(result.diagnostics).toEqual([])
    expect(result.catalogs[0]?.entries.map((entry) => entry.value)).toEqual(Object.values(values))
  })
})

describe('readCatalogs across locales that disagree about their format', () => {
  it('lands one key on both sides when only one file is i18next', async () => {
    const root = await tree({
      'locales/en.json': JSON.stringify({
        cart: { items: '{count, plural, one {# item} other {# items}}' },
      }),
      'locales/de.json': JSON.stringify({
        cart: { items_one: '{{count}} Artikel', items_other: '{{count}} Artikel' },
      }),
    })
    const result = await readCatalogs(makeConfig(root, { locales: ['en', 'de'] }))
    expect(result.catalogs.map((catalog) => [catalog.locale, catalog.format])).toEqual([
      ['en', 'icu'],
      ['de', 'i18next'],
    ])
    expect(keysOf(result)).toEqual(['cart.items', 'cart.items'])
    expect(result.catalogs[1]?.entries[0]?.value).toBe(
      '{count, plural, one {{count} Artikel} other {{count} Artikel}}',
    )
  })
})

describe('readCatalogs on a file it cannot read', () => {
  it('reports a catalog path that is a directory and blocks only on the source locale', async () => {
    const root = await tree({ 'locales/de.json/keep': '{}' })
    await mkdir(join(root, 'locales/en.json'), { recursive: true })
    const result = await readCatalogs(makeConfig(root, { locales: ['en', 'de'] }))
    expect(codes(result.diagnostics)).toEqual(['LZ1008', 'LZ1008'])
    expect(result.diagnostics.map((one) => one.fatal)).toEqual([true, false])
    expect(result.catalogs).toEqual([])
  })

  it('reports an empty file as a syntax error, fatal on the source locale alone', async () => {
    const root = await tree({ 'locales/en.json': '', 'locales/de.json': '' })
    const result = await readCatalogs(makeConfig(root, { locales: ['en', 'de'] }))
    expect(codes(result.diagnostics)).toEqual(['LZ1009', 'LZ1009'])
    expect(result.diagnostics.map((one) => one.fatal)).toEqual([true, false])
    expect(result.diagnostics.map((one) => one.locale)).toEqual(['en', 'de'])
  })

  it('reports a null root as a shape error rather than a missing translation', async () => {
    const root = await tree({ 'locales/en.json': 'null' })
    const result = await readCatalogs(makeConfig(root))
    expect(codes(result.diagnostics)).toEqual(['LZ1010'])
    expect(result.catalogs[0]?.entries).toEqual([])
  })
})

describe('readCatalogs ordering', () => {
  it('orders namespace files the same however the directory lists them', async () => {
    const names = ['zeta', 'Alpha', 'beta', 'A9', '_x', 'a-1']
    const root = await tree(
      Object.fromEntries(
        names.map((name) => [`locales/en/${name}.json`, JSON.stringify({ k: name })]),
      ),
    )
    const config = makeConfig(root, { catalogs: 'locales/{locale}/{ns}.json' })
    const first = await readCatalogs(config)
    const second = await readCatalogs(config)
    expect(first.catalogs.map((catalog) => catalog.file)).toEqual(
      second.catalogs.map((catalog) => catalog.file),
    )
    expect(first.catalogs.map((catalog) => catalog.ns)).toEqual([
      'A9',
      'Alpha',
      '_x',
      'a-1',
      'beta',
      'zeta',
    ])
  })
})
