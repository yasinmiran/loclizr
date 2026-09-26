import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { parse, TYPE } from '@formatjs/icu-messageformat-parser'
import { afterEach, describe, expect, it } from 'vitest'
import type { Config, Diagnostic, RawEntry } from '../types'
import { toPosix } from '../util'
import type { CatalogReadResult } from './index'
import { readCatalogs } from './index'

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function tree(files: Readonly<Record<string, string>>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'loclizr-catalog-'))
  roots.push(root)
  for (const [path, contents] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), contents)
  }
  return toPosix(root)
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function ast(icu: string): ReturnType<typeof parse> {
  return parse(icu, {
    shouldParseSkeletons: true,
    requiresOtherClause: true,
    captureLocation: false,
    ignoreTag: false,
  })
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

function entryOf(result: CatalogReadResult, locale: string, key: string): RawEntry | undefined {
  return result.catalogs
    .filter((catalog) => catalog.locale === locale)
    .flatMap((catalog) => catalog.entries)
    .find((entry) => entry.key === key)
}

function formatsOf(result: CatalogReadResult): Record<string, string> {
  return Object.fromEntries(result.catalogs.map((catalog) => [catalog.locale, catalog.format]))
}

const EN = {
  nav: { home: 'Home', cart: 'Cart' },
  cart: {
    greeting: 'Hi {name}, your cart is ready',
    items:
      '{count, plural, =0 {Your cart is empty} one {# item in your cart} other {# items in your cart}}',
    total: 'Total: {amount, number, ::currency/USD}',
    updated: 'Updated {at, date, medium}',
  },
  order: { status: '{state, select, shipped {On its way} delivered {Delivered} other {Processing}}' },
  terms: { accept: 'Read our <link>terms</link> before you continue.' },
}

const DE = {
  nav: { home: 'Startseite', cart: 'Warenkorb' },
  cart: {
    greeting: 'Hallo {name}, dein Warenkorb ist fertig',
    items:
      '{count, plural, =0 {Dein Warenkorb ist leer} one {{count} Artikel in deinem Warenkorb} other {{count} Artikel in deinem Warenkorb}}',
    total: 'Summe: {amount, number, ::currency/USD}',
    updated: 'Aktualisiert {at, date, medium}',
  },
  order: { status: '{state, select, shipped {Unterwegs} delivered {Zugestellt} other {In Bearbeitung}}' },
  terms: { accept: 'Lies unsere <link>AGB</link>, bevor du fortfährst.' },
}

describe('readCatalogs on the worked example', () => {
  it('decides the format per file and converts only the i18next one', async () => {
    const root = await tree({
      'locales/en.json': json(EN),
      'locales/de.json': json(DE),
      'locales/de-AT.json': json({ cart: { greeting: 'Servus {{name}}, dein Warenkorb ist fertig' } }),
      'locales/en.meta.json': json({
        'cart.items': {
          description: 'Badge under the cart icon on every page',
          placeholders: { count: 'Number of line items, not total quantity' },
        },
        'order.status': { description: 'Chip in the order list. Past tense.' },
      }),
    })
    const result = await readCatalogs(makeConfig(root, { locales: ['en', 'de', 'de-AT'] }))

    expect(result.diagnostics).toEqual([])
    expect(formatsOf(result)).toEqual({ en: 'icu', de: 'icu', 'de-AT': 'i18next' })
    expect(entryOf(result, 'de-AT', 'cart.greeting')?.value).toBe(
      'Servus {name}, dein Warenkorb ist fertig',
    )
    expect(entryOf(result, 'de', 'cart.items')?.value).toBe(DE.cart.items)
    expect(entryOf(result, 'en', 'terms.accept')?.value).toBe(EN.terms.accept)
  })

  it('reads the description sidecar against the source key set', async () => {
    const root = await tree({
      'locales/en.json': json(EN),
      'locales/en.meta.json': json({
        'cart.items': {
          description: 'Badge under the cart icon on every page',
          placeholders: { count: 'Number of line items, not total quantity' },
        },
        'order.status': { description: 'Chip in the order list. Past tense.' },
      }),
    })
    const { meta, diagnostics } = await readCatalogs(makeConfig(root))

    expect(diagnostics).toEqual([])
    expect(meta?.file).toBe('locales/en.meta.json')
    expect(meta?.entries).toEqual([
      {
        key: 'cart.items',
        description: 'Badge under the cart icon on every page',
        placeholders: [{ name: 'count', note: 'Number of line items, not total quantity' }],
        span: expect.objectContaining({ line: 2 }),
      },
      {
        key: 'order.status',
        description: 'Chip in the order list. Past tense.',
        placeholders: [],
        span: expect.objectContaining({ line: 8 }),
      },
    ])
  })
})

describe('readCatalogs format decisions', () => {
  it('converts a whole i18next file and reports every i18next rule it meets', async () => {
    const root = await tree({
      'locales/en.json': json({
        greeting: 'Hi {{name}}',
        terms: 'Read <b>this</b>',
        nested: 'See $t(greeting)',
        formatted: 'At {{when, datetime}}',
        items_one: '{{count}} item',
        items_other: '{{count}} items',
        orphan_few: 'a few',
        friend: 'A friend',
        friend_male: 'A boyfriend',
      }),
      'locales/en.meta.json': json({}),
    })
    const result = await readCatalogs(makeConfig(root))
    const catalog = result.catalogs[0]

    expect(catalog?.format).toBe('i18next')
    expect(entryOf(result, 'en', 'greeting')?.value).toBe('Hi {name}')
    expect(ast(entryOf(result, 'en', 'terms')?.value ?? '')).toEqual([
      { type: TYPE.literal, value: 'Read <b>this</b>' },
    ])
    expect(entryOf(result, 'en', 'items')?.value).toBe(
      '{count, plural, one {{count} item} other {{count} items}}',
    )
    expect(new Set(codes(result.diagnostics))).toEqual(
      new Set(['LZ1012', 'LZ1013', 'LZ1014', 'LZ1016', 'LZ1017']),
    )
  })

  it('reports ICU argument syntax inside an i18next file and names what classified it', async () => {
    const root = await tree({
      'locales/en.json': json({
        greeting: 'Hi {{name}}',
        items: '{count, plural, one {one} other {many}}',
      }),
    })
    const { diagnostics } = await readCatalogs(makeConfig(root, { meta: false }))
    const reported = diagnostics.find((one) => one.code === 'LZ1020')

    expect(reported?.key).toBe('items')
    expect(reported?.message).toContain('{count, plural')
    expect(reported?.hint).toContain('Hi {{name}}')
  })

  it('does not report ICU syntax in a file it reads as ICU', async () => {
    const root = await tree({
      'locales/en.json': json({ items: '{count, plural, one {one} other {many}}' }),
    })
    const { catalogs, diagnostics } = await readCatalogs(makeConfig(root, { meta: false }))

    expect(catalogs[0]?.format).toBe('icu')
    expect(diagnostics).toEqual([])
  })

  it('forces the configured format over classification', async () => {
    const root = await tree({ 'locales/en.json': json({ greeting: 'Hi {{name}}' }) })
    const forced = await readCatalogs(
      makeConfig(root, { meta: false, catalogFormat: 'icu' }),
    )

    expect(forced.catalogs[0]?.format).toBe('icu')
    expect(entryOf(forced, 'en', 'greeting')?.value).toBe('Hi {{name}}')
    expect(forced.diagnostics).toEqual([])
  })

  it('names the configured format in the hint when nothing classified the file', async () => {
    const root = await tree({
      'locales/en.json': json({ items: '{count, plural, one {one} other {many}}' }),
    })
    const { diagnostics } = await readCatalogs(
      makeConfig(root, { meta: false, catalogFormat: 'i18next' }),
    )

    expect(codes(diagnostics)).toEqual(['LZ1020'])
    expect(diagnostics[0]?.hint).toContain("catalogFormat is 'i18next'")
  })

  it('folds a single category locale onto the key its source locale folded to', async () => {
    const root = await tree({
      'locales/en.json': json({ items_one: '{{count}} item', items_other: '{{count}} items' }),
      'locales/ja.json': json({ items_other: '{{count}}個のアイテム' }),
    })
    const result = await readCatalogs(
      makeConfig(root, { locales: ['en', 'ja'], meta: false }),
    )

    expect(entryOf(result, 'en', 'items')?.value).toBe(
      '{count, plural, one {{count} item} other {{count} items}}',
    )
    expect(entryOf(result, 'ja', 'items')?.value).toBe(
      '{count, plural, other {{count}個のアイテム}}',
    )
    expect(result.diagnostics).toEqual([])
  })

  it('lowers tags to markup under i18nextMarkup tags', async () => {
    const root = await tree({ 'locales/en.json': json({ terms: 'Read <b>{{what}}</b>' }) })
    const result = await readCatalogs(
      makeConfig(root, { meta: false, i18nextMarkup: 'tags' }),
    )

    expect(entryOf(result, 'en', 'terms')?.value).toBe('Read <b>{what}</b>')
    expect(result.diagnostics).toEqual([])
  })
})

describe('readCatalogs failures', () => {
  it('stamps a source catalog syntax error fatal and a target one not', async () => {
    const root = await tree({
      'locales/en.json': '{"a": "x",}',
      'locales/de.json': '{"a": "x",}',
    })
    const { catalogs, diagnostics } = await readCatalogs(
      makeConfig(root, { locales: ['en', 'de'], meta: false }),
    )

    expect(catalogs).toEqual([])
    expect(diagnostics.map((one) => [one.code, one.locale, one.fatal])).toEqual([
      ['LZ1009', 'en', true],
      ['LZ1009', 'de', false],
    ])
  })

  it('reports a catalog that exists and cannot be read', async () => {
    const root = await tree({ 'locales/en.json/keep': 'not a catalog' })
    const { diagnostics } = await readCatalogs(makeConfig(root, { meta: false }))

    expect(codes(diagnostics)).toEqual(['LZ1008'])
    expect(diagnostics[0]).toMatchObject({ file: 'locales/en.json', locale: 'en', fatal: true })
  })

  it('leaves a declared locale with no catalog file to M9', async () => {
    const root = await tree({ 'locales/en.json': json({ a: 'x' }) })
    const { catalogs, diagnostics } = await readCatalogs(
      makeConfig(root, { locales: ['en', 'de'], meta: false }),
    )

    expect(catalogs.map((catalog) => catalog.locale)).toEqual(['en'])
    expect(diagnostics).toEqual([])
  })

  it('reports a key defined twice in one file', async () => {
    const root = await tree({ 'locales/en.json': '{"nav.home": "one", "nav": {"home": "two"}}' })
    const { diagnostics } = await readCatalogs(makeConfig(root, { meta: false }))

    expect(codes(diagnostics)).toEqual(['LZ1011'])
    expect(diagnostics[0]?.key).toBe('nav.home')
  })

  it('reports a repeated JSON key, which flattening alone cannot see', async () => {
    const root = await tree({ 'locales/en.json': '{"nav": {"home": "one", "home": "two"}}' })
    const result = await readCatalogs(makeConfig(root, { meta: false }))

    expect(codes(result.diagnostics)).toEqual(['LZ1011'])
    expect(result.diagnostics[0]?.key).toBe('nav.home')
    expect(entryOf(result, 'en', 'nav.home')?.value).toBe('two')
  })

  it('reports a shape error and keeps the rest of the file', async () => {
    const root = await tree({ 'locales/en.json': json({ tips: ['a'], nav: { home: 'Home' } }) })
    const result = await readCatalogs(makeConfig(root, { meta: false }))

    expect(codes(result.diagnostics)).toEqual(['LZ1010'])
    expect(entryOf(result, 'en', 'nav.home')?.value).toBe('Home')
  })
})

describe('readCatalogs split catalogs', () => {
  it('prefixes every key with its namespace and yields one catalog per file', async () => {
    const root = await tree({
      'locales/en/common.json': json({ nav: { home: 'Home' } }),
      'locales/en/errors.json': json({ forbidden: 'No' }),
      'locales/en/en.meta.json': json({ 'common.nav.home': { description: 'x' } }),
      'locales/en/context.json': json({ schema: 1 }),
      'locales/de/common.json': json({ nav: { home: 'Startseite' } }),
    })
    const result = await readCatalogs(
      makeConfig(root, {
        locales: ['en', 'de'],
        catalogs: 'locales/{locale}/{ns}.json',
        meta: false,
        record: 'locales/en/context.json',
      }),
    )

    expect(result.catalogs.map((catalog) => [catalog.locale, catalog.ns, catalog.file])).toEqual([
      ['en', 'common', 'locales/en/common.json'],
      ['en', 'errors', 'locales/en/errors.json'],
      ['de', 'common', 'locales/de/common.json'],
    ])
    expect(entryOf(result, 'en', 'common.nav.home')?.value).toBe('Home')
    expect(entryOf(result, 'en', 'errors.forbidden')?.value).toBe('No')
    expect(result.diagnostics).toEqual([])
  })

  it('keeps one key per file apart by its namespace prefix', async () => {
    const root = await tree({
      'locales/en/a.json': json({ nav: 'one' }),
      'locales/en/b.json': json({ nav: 'two' }),
    })
    const result = await readCatalogs(
      makeConfig(root, { catalogs: 'locales/{locale}/{ns}.json', meta: false }),
    )

    expect(entryOf(result, 'en', 'a.nav')?.value).toBe('one')
    expect(entryOf(result, 'en', 'b.nav')?.value).toBe('two')
    expect(result.diagnostics).toEqual([])
  })
})

describe('readCatalogs descriptions', () => {
  it('reports a meta entry with no message', async () => {
    const root = await tree({
      'locales/en.json': json({ nav: { home: 'Home' } }),
      'locales/en.meta.json': json({ 'nav.hoem': { description: 'typo' } }),
    })
    const { meta, diagnostics } = await readCatalogs(makeConfig(root))

    expect(codes(diagnostics)).toEqual(['LZ1015'])
    expect(diagnostics[0]?.key).toBe('nav.hoem')
    expect(meta?.entries).toEqual([])
  })

  it('reports a malformed description and keeps the entry', async () => {
    const root = await tree({
      'locales/en.json': json({ a: 'x', b: 'y' }),
      'locales/en.meta.json': json({ a: { description: 7 }, b: { placeholders: { n: 1 } } }),
    })
    const { meta, diagnostics } = await readCatalogs(makeConfig(root))

    expect(codes(diagnostics)).toEqual(['LZ1010', 'LZ1010'])
    expect(meta?.entries).toEqual([
      { key: 'a', description: null, placeholders: [], span: expect.anything() },
      { key: 'b', description: null, placeholders: [], span: expect.anything() },
    ])
  })

  it('reads no sidecar when meta is false or the file is absent', async () => {
    const root = await tree({ 'locales/en.json': json({ a: 'x' }) })

    expect((await readCatalogs(makeConfig(root, { meta: false }))).meta).toBeNull()
    expect((await readCatalogs(makeConfig(root))).meta).toBeNull()
  })

  it('never reads the sidecar as a catalog', async () => {
    const root = await tree({
      'locales/en.json': json({ a: 'x' }),
      'locales/en.meta.json': json({ a: { description: 'note' } }),
    })
    const { catalogs } = await readCatalogs(makeConfig(root))

    expect(catalogs.map((catalog) => catalog.file)).toEqual(['locales/en.json'])
  })
})
