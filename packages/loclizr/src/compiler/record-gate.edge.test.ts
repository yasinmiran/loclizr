import { describe, expect, it } from 'vitest'
import { recordsAgree } from './record-gate'

function navHome(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    key: 'nav.home',
    id: 'nav_home',
    module: 'messages/nav.js',
    kind: 'text',
    source: 'Home',
    sourceHash: '3a78695388b38b5c',
    description: null,
    args: [],
    variants: [],
    markup: [],
    translations: [{ locale: 'de', status: 'translated', from: null, reason: null }],
    usage: [],
    ...overrides,
  }
}

function bytes(
  messages: readonly unknown[] = [navHome()],
  header: Record<string, unknown> = {},
): string {
  return `${JSON.stringify(
    { schema: 1, sourceLocale: 'en', locales: ['de', 'en'], messages, ...header },
    null,
    2,
  )}\n`
}

describe('a committed record that is not a record at all', () => {
  it('never agrees, not even with identical unparseable bytes', () => {
    expect(recordsAgree('{', '{')).toBe(false)
  })

  it('counts an empty file as differing', () => {
    expect(recordsAgree('', bytes())).toBe(false)
  })

  it('counts a whitespace only file as differing', () => {
    expect(recordsAgree(' \r\n\t\n', bytes())).toBe(false)
  })

  it('compares a bare JSON null against itself rather than throwing', () => {
    expect(recordsAgree('null', 'null')).toBe(true)
    expect(recordsAgree('null', bytes())).toBe(false)
  })

  it('tells a top level array apart from the record object', () => {
    expect(recordsAgree('[]', bytes())).toBe(false)
  })
})

describe('what the projection leaves out', () => {
  it('ignores a usage field the fresh record does not carry at all', () => {
    const withoutUsage = navHome()
    delete withoutUsage['usage']

    expect(recordsAgree(bytes([navHome()]), bytes([withoutUsage]))).toBe(true)
  })

  it('ignores translations on every message, not only the first', () => {
    const committed = bytes([navHome(), navHome({ key: 'nav.cart', id: 'nav_cart', translations: [] })])
    const fresh = bytes([
      navHome({ translations: [] }),
      navHome({
        key: 'nav.cart',
        id: 'nav_cart',
        translations: [{ locale: 'de', status: 'fallback', from: 'en', reason: 'missing' }],
      }),
    ])

    expect(recordsAgree(committed, fresh)).toBe(true)
  })

  it('keeps a top level usage field, because only message fields are projected out', () => {
    expect(recordsAgree(bytes([navHome()], { usage: [1] }), bytes([navHome()], { usage: [2] }))).toBe(
      false,
    )
  })

  it('keeps a usage field nested inside an argument', () => {
    const arg = (sites: number): Record<string, unknown> => ({ name: 'n', type: 'number', usage: sites })

    expect(recordsAgree(bytes([navHome({ args: [arg(1)] })]), bytes([navHome({ args: [arg(2)] })]))).toBe(
      false,
    )
  })

  it('treats a field differing from usage only by case as part of the contract', () => {
    expect(recordsAgree(bytes([navHome({ Usage: [1] })]), bytes([navHome({ Usage: [2] })]))).toBe(false)
  })

  it('compares message entries that are not objects as they stand', () => {
    expect(recordsAgree(bytes(['nav.home', null, 3]), bytes(['nav.home', null, 3]))).toBe(true)
    expect(recordsAgree(bytes(['nav.home']), bytes(['nav.cart']))).toBe(false)
  })

  it('keeps the order of messages, since the record lists them in key order', () => {
    const cart = navHome({ key: 'nav.cart', id: 'nav_cart' })

    expect(recordsAgree(bytes([navHome(), cart]), bytes([cart, navHome()]))).toBe(false)
  })
})

describe('text and numbers that parse to the same value', () => {
  it('agrees on 1.0 and 1', () => {
    expect(
      recordsAgree(
        '{"schema":1.0,"sourceLocale":"en","locales":[],"messages":[]}',
        '{"schema":1,"sourceLocale":"en","locales":[],"messages":[]}',
      ),
    ).toBe(true)
  })

  it('agrees on -0 and 0, which serialize the same', () => {
    expect(recordsAgree('{"schema":-0,"messages":[]}', '{"schema":0,"messages":[]}')).toBe(true)
  })

  it('agrees on 1e21 and its expanded spelling', () => {
    expect(
      recordsAgree('{"schema":1e21,"messages":[]}', '{"schema":1000000000000000000000,"messages":[]}'),
    ).toBe(true)
  })

  it('agrees on an emoji written as a surrogate pair escape and as itself', () => {
    const escaped = bytes([navHome({ source: 'Hi \u{1F44B}' })]).replace('\u{1F44B}', '\\ud83d\\udc4b')

    expect(escaped).toContain('Hi \\ud83d\\udc4b')
    expect(recordsAgree(escaped, bytes([navHome({ source: 'Hi \u{1F44B}' })]))).toBe(true)
  })

  it('tells NFC and NFD spellings of one word apart, because the catalog bytes differ', () => {
    const composed = bytes([navHome({ source: 'Caf\u00e9' })])
    const decomposed = bytes([navHome({ source: 'Cafe\u0301' })])

    expect(recordsAgree(composed, decomposed)).toBe(false)
  })

  it('agrees with a record carrying RTL marks only when the marks match', () => {
    const marked = bytes([navHome({ source: '\u200f\u05e9\u05dc\u05d5\u05dd\u200f' })])

    expect(recordsAgree(marked, marked)).toBe(true)
    expect(recordsAgree(marked, bytes([navHome({ source: '\u05e9\u05dc\u05d5\u05dd' })]))).toBe(false)
  })

  it('takes the last of two duplicate fields, as JSON.parse does', () => {
    const duplicated = bytes([navHome()]).replace('"source": "Home"', '"source": "Old",\n      "source": "Home"')

    expect(recordsAgree(duplicated, bytes([navHome()]))).toBe(true)
  })
})

describe('field names shaped like Object.prototype members', () => {
  it('compares a message field named constructor like any other field', () => {
    expect(recordsAgree(bytes([navHome({ constructor: 'a' })]), bytes([navHome({ constructor: 'b' })]))).toBe(
      false,
    )
  })

  it('compares a top level __proto__ field the parser made an own property', () => {
    const committed = '{"__proto__":{"a":1},"schema":1,"messages":[]}'

    expect(recordsAgree(committed, committed)).toBe(true)
    expect(recordsAgree(committed, '{"schema":1,"messages":[]}')).toBe(false)
  })
})
