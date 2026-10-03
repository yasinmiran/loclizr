import { describe, expect, test } from 'vitest'
import { compareCodepoint, escapeIcuLiteral, hash16, requiredCategories, stableStringify, toPosix } from './index'

describe('hash16 at the edges', () => {
  test('hashes the empty string to the head of the well-known empty sha256', () => {
    expect(hash16('')).toBe('e3b0c44298fc1c14')
  })

  test('separates a composed and a decomposed form, which are different source text', () => {
    expect(hash16('caf\u00e9')).not.toBe(hash16('cafe\u0301'))
  })

  test('separates CRLF from LF, since a line ending change is a source change', () => {
    expect(hash16('a\r\nb')).not.toBe(hash16('a\nb'))
  })

  test('separates text with and without a leading byte order mark', () => {
    expect(hash16('\ufeffHome')).not.toBe(hash16('Home'))
  })

  test('hashes a long input to sixteen hex characters like any other', () => {
    expect(hash16('x'.repeat(1_000_000))).toMatch(/^[0-9a-f]{16}$/)
  })
})

describe('stableStringify at the limits of a number', () => {
  test('prints the same text JSON.stringify prints for each limit', () => {
    for (const value of [0, -0, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1e21, 1e-7]) {
      expect(stableStringify({ value })).toBe(JSON.stringify({ value }))
    }
  })

  test('prints the largest safe integer exactly', () => {
    expect(stableStringify({ maximumFractionDigits: Number.MAX_SAFE_INTEGER })).toBe(
      '{"maximumFractionDigits":9007199254740991}',
    )
  })

  test('names a format with -0 and one with 0 the same, as their printed text already is', () => {
    expect(stableStringify({ minimumFractionDigits: -0 })).toBe(stableStringify({ minimumFractionDigits: 0 }))
  })
})

describe('stableStringify on values outside an options object', () => {
  test('prints null for a top-level undefined rather than nothing', () => {
    expect(stableStringify(undefined)).toBe('null')
  })

  test('prints scalars the way JSON.stringify prints them', () => {
    for (const value of [null, true, false, 'text', 42]) expect(stableStringify(value)).toBe(JSON.stringify(value))
  })

  test('prints null for an undefined inside an array, keeping its slot', () => {
    expect(stableStringify([1, undefined, 2])).toBe('[1,null,2]')
  })

  test('drops a function-valued field the way JSON.stringify does', () => {
    expect(stableStringify({ a: 1, b: () => 1 })).toBe('{"a":1}')
  })

  test('ignores a symbol-keyed field', () => {
    expect(stableStringify({ a: 1, [Symbol('hidden')]: 2 })).toBe('{"a":1}')
  })

  test('prints empty containers with no whitespace', () => {
    expect(stableStringify({ a: [], b: {} })).toBe('{"a":[],"b":{}}')
  })
})

describe('stableStringify on keys that collide with javascript', () => {
  test('keeps an own __proto__ key as data rather than as the prototype', () => {
    expect(stableStringify(JSON.parse('{"z":1,"__proto__":2}'))).toBe('{"__proto__":2,"z":1}')
  })

  test('keeps constructor, prototype and toString keys as ordinary fields', () => {
    expect(stableStringify({ toString: 'a', prototype: 'b', constructor: 'c' })).toBe(
      '{"constructor":"c","prototype":"b","toString":"a"}',
    )
  })

  test('reads an object with no prototype', () => {
    const bare = Object.assign(Object.create(null) as Record<string, unknown>, { b: 1, a: 2 })
    expect(stableStringify(bare)).toBe('{"a":2,"b":1}')
  })

  test('orders an empty key before every other key', () => {
    expect(stableStringify({ a: 1, '': 2 })).toBe('{"":2,"a":1}')
  })

  test('escapes a lone surrogate key and value as JSON.stringify does', () => {
    expect(stableStringify({ '\ud800': '\udfff' })).toBe('{"\\ud800":"\\udfff"}')
  })

  test('escapes a quote, a backslash and a line separator inside a value', () => {
    const value = { a: 'say "hi"\\ \u2028' }
    expect(stableStringify(value)).toBe(JSON.stringify(value))
  })
})

describe('stableStringify on nesting', () => {
  test('sorts keys at every depth of a deeply nested value', () => {
    let nested: unknown = { b: 1, a: 2 }
    let expected = '{"a":2,"b":1}'
    for (let depth = 0; depth < 200; depth += 1) {
      nested = { z: nested, y: depth }
      expected = `{"y":${depth},"z":${expected}}`
    }
    expect(stableStringify(nested)).toBe(expected)
  })

  test('sorts the keys of objects inside an array without reordering the array', () => {
    expect(stableStringify([{ b: 1, a: 2 }, { d: 3, c: 4 }])).toBe('[{"a":2,"b":1},{"c":4,"d":3}]')
  })

  test('prints the same text on two runs over equal inputs built in opposite orders', () => {
    const forward: Record<string, number> = {}
    const backward: Record<string, number> = {}
    const keys = Array.from({ length: 100 }, (_unused, index) => `k${index}`)
    for (const key of keys) forward[key] = key.length
    for (const key of [...keys].reverse()) backward[key] = key.length
    expect(stableStringify(forward)).toBe(stableStringify(backward))
  })
})

describe('compareCodepoint at the edges', () => {
  test('answers zero for two empty strings and orders the empty string first', () => {
    expect(compareCodepoint('', '')).toBe(0)
    expect(compareCodepoint('', '\u0000')).toBeLessThan(0)
  })

  test('orders a trailing NUL after the shorter string rather than treating it as an end', () => {
    expect(compareCodepoint('a\u0000', 'a')).toBeGreaterThan(0)
  })

  test('orders a lone high surrogate before the astral character it would start', () => {
    expect(compareCodepoint('\ud83d', '\u{1f600}')).toBeLessThan(0)
  })

  test('orders upper case before lower case, as code points do', () => {
    expect(['b', 'B', 'a', 'A'].sort(compareCodepoint)).toEqual(['A', 'B', 'a', 'b'])
  })

  test('orders digits as text, not as numbers', () => {
    expect(['10', '9', '1'].sort(compareCodepoint)).toEqual(['1', '10', '9'])
  })

  test('answers zero for the same text even when built from separate strings', () => {
    expect(compareCodepoint(['a', 'b'].join(''), 'ab')).toBe(0)
  })
})

describe('toPosix at the edges', () => {
  test('leaves the empty string alone', () => {
    expect(toPosix('')).toBe('')
  })

  test('rewrites a drive letter path and a UNC path', () => {
    expect(toPosix('C:\\work\\locales\\en.json')).toBe('C:/work/locales/en.json')
    expect(toPosix('\\\\server\\share\\en.json')).toBe('//server/share/en.json')
  })

  test('rewrites a trailing separator too', () => {
    expect(toPosix('locales\\')).toBe('locales/')
  })

  test('leaves unicode segments intact', () => {
    expect(toPosix('locales\\日本\\caf\u00e9.json')).toBe('locales/日本/caf\u00e9.json')
  })
})

describe('escapeIcuLiteral on input with nothing to quote', () => {
  test('leaves whitespace-only text alone', () => {
    expect(escapeIcuLiteral(' \t ')).toBe(' \t ')
  })

  test('leaves CRLF, a lone CR and a BOM alone', () => {
    expect(escapeIcuLiteral('a\r\nb\rc\ufeff')).toBe('a\r\nb\rc\ufeff')
  })

  test('leaves a closing angle bracket alone in both markup modes', () => {
    expect(escapeIcuLiteral('a > b')).toBe('a > b')
    expect(escapeIcuLiteral('a > b', { markup: 'tags' })).toBe('a > b')
  })
})

describe('escapeIcuLiteral options', () => {
  test('treats explicitly undefined options as the defaults', () => {
    const text = "a{b}<c>#d'"
    expect(escapeIcuLiteral(text, { inPlural: undefined, markup: undefined })).toBe(escapeIcuLiteral(text))
    expect(escapeIcuLiteral(text, {})).toBe(escapeIcuLiteral(text))
  })

  test('treats markup literal exactly as the default', () => {
    expect(escapeIcuLiteral('<b>x</b>', { markup: 'literal' })).toBe(escapeIcuLiteral('<b>x</b>'))
  })

  test('quotes a pound inside a plural body under the tags mode too', () => {
    expect(escapeIcuLiteral('#<b>', { inPlural: true, markup: 'tags' })).toBe("'#'<b>")
  })

  test('quotes a pound and a brace beside it as one run inside a plural body', () => {
    expect(escapeIcuLiteral('#{', { inPlural: true })).toBe("'#{'")
  })

  test('doubles an apostrophe that touches no special character', () => {
    expect(escapeIcuLiteral("l'heure")).toBe("l''heure")
  })
})

describe('requiredCategories at the edges', () => {
  test('answers the same for a tag in odd casing as for its canonical form', () => {
    expect(requiredCategories('EN-us', false)).toEqual(requiredCategories('en-US', false))
  })

  test('answers through a unicode extension subtag', () => {
    expect(requiredCategories('ar-u-nu-latn', false)).toEqual(requiredCategories('ar', false))
  })

  test('throws for a tag that is not a locale, rather than caching a guess', () => {
    expect(() => requiredCategories('not a locale', false)).toThrow(RangeError)
    expect(() => requiredCategories('not a locale', false)).toThrow(RangeError)
  })

  test('always includes other, which every plural must carry', () => {
    for (const locale of ['en', 'ar', 'ja', 'ru', 'pl', 'cy', 'fr']) {
      expect(requiredCategories(locale, false)).toContain('other')
      expect(requiredCategories(locale, true)).toContain('other')
    }
  })

  test('answers in the same order on a cached and an uncached call', () => {
    const first = [...requiredCategories('cy', true)]
    expect([...requiredCategories('cy', true)]).toEqual(first)
  })
})

