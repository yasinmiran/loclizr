import { describe, expect, test } from 'vitest'
import type { IntlOptions } from '../types'
import { compareCodepoint, hash16, requiredCategories, stableStringify, toPosix } from './index'

const HOSTILE_STRINGS: readonly string[] = [
  '',
  'a',
  'A',
  'Z',
  'z',
  '{',
  '}',
  '.',
  '-',
  '_',
  'nav',
  'nav.home',
  'nav-home',
  'nav_home',
  'Nav.home',
  'café',
  'café',
  'ÿ',
  '￿',
  '\ud800',
  '\udfff',
  '\u{10000}',
  '\u{1f600}',
  '\u{1f469}‍\u{1f4bb}',
  '日本',
  'сart',
  'cart',
]

function referenceCompare(a: string, b: string): number {
  const left = [...a].map((char) => char.codePointAt(0) ?? 0)
  const right = [...b].map((char) => char.codePointAt(0) ?? 0)
  for (let i = 0; i < Math.min(left.length, right.length); i += 1) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0)
    if (difference !== 0) return difference
  }
  return left.length - right.length
}

function sign(value: number): number {
  return value === 0 ? 0 : value > 0 ? 1 : -1
}

describe('compareCodepoint as a total order', () => {
  test('agrees with a code point by code point comparison over hostile keys', () => {
    for (const a of HOSTILE_STRINGS) {
      for (const b of HOSTILE_STRINGS) {
        expect(sign(compareCodepoint(a, b))).toBe(sign(referenceCompare(a, b)))
      }
    }
  })

  test('is antisymmetric, so a sort cannot depend on which side a pair arrives on', () => {
    for (const a of HOSTILE_STRINGS) {
      for (const b of HOSTILE_STRINGS) {
        expect(sign(compareCodepoint(a, b)) + sign(compareCodepoint(b, a))).toBe(0)
      }
    }
  })

  test('is transitive across the sorted corpus', () => {
    const sorted = [...HOSTILE_STRINGS].sort(compareCodepoint)
    for (let i = 0; i < sorted.length - 1; i += 1) {
      const left = sorted[i] ?? ''
      const right = sorted[i + 1] ?? ''
      expect(compareCodepoint(left, right)).toBeLessThanOrEqual(0)
    }
  })

  test('sorts a list and its reverse into the same order', () => {
    const forward = [...HOSTILE_STRINGS].sort(compareCodepoint)
    const backward = [...HOSTILE_STRINGS].reverse().sort(compareCodepoint)
    expect(backward).toEqual(forward)
  })

  test('ignores host collation, which would reorder case and separators', () => {
    const keys = ['Cart', 'cart', 'cart-items', 'cart.items', 'cart_items']
    expect([...keys].sort(compareCodepoint)).toEqual([
      'Cart',
      'cart',
      'cart-items',
      'cart.items',
      'cart_items',
    ])
    expect([...keys].sort((a, b) => a.localeCompare(b))).not.toEqual([...keys].sort(compareCodepoint))
  })

  test('separates a cyrillic homoglyph from its latin twin instead of collating them together', () => {
    expect(compareCodepoint('сart', 'cart')).toBeGreaterThan(0)
  })
})

describe('stableStringify as the canonical name of a format', () => {
  test('names a format by contents, whatever order the fields were written in', () => {
    const shapes: readonly IntlOptions[] = [
      { style: 'currency', currency: 'USD', currencyDisplay: 'code' },
      { currencyDisplay: 'code', currency: 'USD', style: 'currency' },
      { currency: 'USD', currencyDisplay: 'code', style: 'currency' },
    ]
    const names = new Set(shapes.map((shape) => hash16(stableStringify(shape))))
    expect(names.size).toBe(1)
  })

  test('is stable under the key order javascript itself reorders', () => {
    const ascending = stableStringify({ '2': 'a', '10': 'b', z: 'c' })
    const descending = stableStringify({ z: 'c', '10': 'b', '2': 'a' })
    expect(ascending).toBe(descending)
    expect(ascending).toBe('{"10":"b","2":"a","z":"c"}')
  })

  test('sorts nested option groups too, so a named style cannot rename itself', () => {
    expect(stableStringify({ dateTime: { weekday: 'long', day: 'numeric' }, number: {} })).toBe(
      '{"dateTime":{"day":"numeric","weekday":"long"},"number":{}}',
    )
  })

  test('keeps a string value distinct from the number that prints the same', () => {
    expect(stableStringify({ maximumFractionDigits: 2 })).not.toBe(
      stableStringify({ maximumFractionDigits: '2' }),
    )
  })

  test('keeps two nearly identical option sets apart', () => {
    const names = new Set(
      [
        {},
        { style: 'percent' },
        { style: 'percent', maximumFractionDigits: 0 },
        { maximumFractionDigits: 0 },
        { dateStyle: 'medium' },
        { dateStyle: 'medium', timeZone: 'UTC' },
        { timeStyle: 'medium' },
      ].map((options) => hash16(stableStringify(options))),
    )
    expect(names.size).toBe(7)
  })

  test('escapes a key the generated module would otherwise break on', () => {
    expect(stableStringify({ 'a"b': 1, 'c\nd': 2 })).toBe('{"a\\"b":1,"c\\nd":2}')
  })

  test('sorts keys outside the basic plane by code point', () => {
    expect(stableStringify({ '\u{1f600}': 1, '￿': 2 })).toBe(
      '{"￿":2,"\u{1f600}":1}',
    )
  })
})

describe('hash16 as the name of a hoisted format', () => {
  test('is sixteen lowercase hex characters for every input it can meet', () => {
    for (const input of ['', '{}', '\u0000', 'a\ud800b', '\u{1f600}', 'x'.repeat(100000)]) {
      expect(hash16(input)).toMatch(/^[0-9a-f]{16}$/)
    }
  })

  test('answers the same for the same input every time it is asked', () => {
    expect(hash16('{"dateStyle":"medium"}')).toBe(hash16('{"dateStyle":"medium"}'))
  })

  test('separates inputs that differ only in whitespace or field order', () => {
    const names = new Set([
      hash16('{"currency":"USD","style":"currency"}'),
      hash16('{"style":"currency","currency":"USD"}'),
      hash16('{"currency":"USD", "style":"currency"}'),
    ])
    expect(names.size).toBe(3)
  })
})

describe('toPosix on paths that reach a diagnostic', () => {
  test('rewrites every separator, not only the first', () => {
    expect(toPosix('src\\loclizr\\messages\\cart.js')).toBe('src/loclizr/messages/cart.js')
  })

  test('is idempotent, so a path that passed through twice is unchanged', () => {
    const once = toPosix('locales\\de-AT.json')
    expect(toPosix(once)).toBe(once)
  })

  test('leaves a mixed separator path fully posix', () => {
    expect(toPosix('src/loclizr\\messages/nav.js')).toBe('src/loclizr/messages/nav.js')
  })
})

describe('requiredCategories against the locales the checks depend on', () => {
  function asSet(locale: string, ordinal: boolean): readonly string[] {
    return [...requiredCategories(locale, ordinal)].sort()
  }

  test('reads the full category set for a locale with all six', () => {
    expect(asSet('ar', false)).toEqual(['few', 'many', 'one', 'other', 'two', 'zero'])
  })

  test('keeps zero for the locales that select it and withholds it from the ones that do not', () => {
    expect(asSet('lv', false)).toContain('zero')
    expect(asSet('ar', false)).toContain('zero')
    expect(asSet('de', false)).not.toContain('zero')
    expect(asSet('en', false)).not.toContain('zero')
    expect(asSet('ru', false)).not.toContain('zero')
  })

  test('answers differently for cardinal and ordinal on the same locale', () => {
    expect(asSet('en', true)).toEqual(['few', 'one', 'other', 'two'])
    expect(asSet('ru', true)).toEqual(['other'])
    expect(asSet('ru', false)).toEqual(['few', 'many', 'one', 'other'])
  })

  test('answers for a region subtag through its base language', () => {
    expect(asSet('de-AT', false)).toEqual(asSet('de', false))
    expect(asSet('en-GB', false)).toEqual(asSet('en', false))
  })

  test('never hands out the same array for two different questions', () => {
    expect(requiredCategories('en', false)).not.toBe(requiredCategories('en', true))
    expect(requiredCategories('de', false)).not.toBe(requiredCategories('de-AT', false))
  })

  test('hands out a snapshot a caller cannot corrupt for every later caller', () => {
    const first = requiredCategories('en', false)
    expect(() => {
      ;(first as string[]).push('zero')
    }).toThrow(TypeError)
    expect(requiredCategories('en', false)).toEqual(['one', 'other'])
  })
})
