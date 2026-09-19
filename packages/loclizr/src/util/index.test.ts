import { isLiteralElement, isPluralElement, parse } from '@formatjs/icu-messageformat-parser'
import { describe, expect, test } from 'vitest'
import {
  compareCodepoint,
  escapeIcuLiteral,
  hash16,
  requiredCategories,
  stableStringify,
  toPosix,
} from './index'

const PARSE_OPTIONS = {
  shouldParseSkeletons: true,
  requiresOtherClause: true,
  captureLocation: false,
  ignoreTag: false,
} as const

function readLiteral(icu: string): string {
  const elements = parse(icu, PARSE_OPTIONS)
  if (elements.length === 0) return ''
  const [only] = elements
  if (elements.length !== 1 || only === undefined || !isLiteralElement(only)) {
    throw new Error(`expected one literal element from ${JSON.stringify(icu)}`)
  }
  return only.value
}

function readLiteralInsidePlural(icu: string): string {
  const [only] = parse(`{c, plural, other {${icu}}}`, PARSE_OPTIONS)
  if (only === undefined || !isPluralElement(only)) {
    throw new Error(`expected a plural from ${JSON.stringify(icu)}`)
  }
  const body = only.options['other']?.value ?? []
  if (body.length === 0) return ''
  const [first] = body
  if (body.length !== 1 || first === undefined || !isLiteralElement(first)) {
    throw new Error(`expected one literal branch body from ${JSON.stringify(icu)}`)
  }
  return first.value
}

describe('hash16', () => {
  test('reproduces the hoisted format const names of the generated tree', () => {
    expect(hash16('{}')).toBe('44136fa355b3678a')
    expect(hash16('{"currency":"USD","style":"currency"}')).toBe('56d532f63ea89042')
    expect(hash16('{"dateStyle":"medium"}')).toBe('67d978756bf2d048')
  })

  test('reproduces the context record sourceHash values', () => {
    expect(hash16('Home')).toBe('3a78695388b38b5c')
    expect(
      hash16(
        '{count, plural, =0 {Your cart is empty} one {# item in your cart} other {# items in your cart}}',
      ),
    ).toBe('a826cf6a40d3293e')
  })

  test('is 16 hex characters of sha256', () => {
    expect(hash16('')).toMatch(/^[0-9a-f]{16}$/)
  })
})

describe('stableStringify', () => {
  test('names a format by its contents, not by the order they were written', () => {
    const written = stableStringify({ style: 'currency', currency: 'USD' })
    expect(written).toBe('{"currency":"USD","style":"currency"}')
    expect(hash16(written)).toBe('56d532f63ea89042')
    expect(stableStringify({ currency: 'USD', style: 'currency' })).toBe(written)
  })

  test('emits no whitespace and sorts nested keys too', () => {
    expect(stableStringify({ b: { d: 1, c: 2 }, a: [3, 1, 2] })).toBe('{"a":[3,1,2],"b":{"c":2,"d":1}}')
  })

  test('keeps array order, which carries meaning', () => {
    expect(stableStringify(['b', 'a'])).toBe('["b","a"]')
  })

  test('drops undefined-valued keys the way JSON.stringify does', () => {
    expect(stableStringify({ a: undefined, b: 1 })).toBe('{"b":1}')
  })

  test('handles the empty options object', () => {
    expect(stableStringify({})).toBe('{}')
  })

  test('sorts by code point rather than by locale collation', () => {
    expect(stableStringify({ Z: 1, a: 2 })).toBe('{"Z":1,"a":2}')
  })
})

describe('compareCodepoint', () => {
  test('orders astral characters above the top of the basic plane', () => {
    expect(compareCodepoint('￿', '\u{1f600}')).toBeLessThan(0)
    expect('￿' < '\u{1f600}').toBe(false)
  })

  test('orders a prefix before the longer string', () => {
    expect(compareCodepoint('nav', 'nav.home')).toBeLessThan(0)
    expect(compareCodepoint('nav.home', 'nav')).toBeGreaterThan(0)
    expect(compareCodepoint('nav', 'nav')).toBe(0)
  })

  test('sorts the canonical format strings so a quote precedes a closing brace', () => {
    const canonical = ['{}', '{"dateStyle":"medium"}', '{"currency":"USD","style":"currency"}']
    expect([...canonical].sort(compareCodepoint)).toEqual([
      '{"currency":"USD","style":"currency"}',
      '{"dateStyle":"medium"}',
      '{}',
    ])
  })
})

describe('toPosix', () => {
  test('rewrites separators and leaves a posix path alone', () => {
    expect(toPosix('locales\\en.json')).toBe('locales/en.json')
    expect(toPosix('src/loclizr/messages.js')).toBe('src/loclizr/messages.js')
  })
})

describe('escapeIcuLiteral', () => {
  const roundTrips = [
    '',
    'Home',
    "Don't panic",
    "Don''t ",
    "'",
    "''",
    "''''",
    'Set {color} in CSS',
    'a{b}c',
    '{}',
    '{{name}}',
    "'{",
    "{'",
    '<{',
    'Click <b>here</b> ',
    'Line<br>break',
    'Read <a href="/t">terms</a>',
    '<b>',
    'a > b',
    "a'>b",
    '50% off',
  ]

  test.each(roundTrips)('escapes %j back to itself at the top level', (text) => {
    expect(readLiteral(escapeIcuLiteral(text))).toBe(text)
  })

  test.each(roundTrips.filter((text) => text !== ''))(
    'escapes %j back to itself inside a plural body',
    (text) => {
      expect(readLiteralInsidePlural(escapeIcuLiteral(text))).toBe(text)
    },
  )

  test('quotes the characters that would otherwise change the parse', () => {
    expect(escapeIcuLiteral('Set {color} in CSS')).toBe("Set '{'color'}' in CSS")
    expect(escapeIcuLiteral('Line<br>break')).toBe("Line'<'br>break")
    expect(escapeIcuLiteral("Don''t ")).toBe("Don''''t ")
  })

  test('quotes a maximal run of special characters once', () => {
    expect(escapeIcuLiteral('a{}b')).toBe("a'{}'b")
  })

  test('leaves text with nothing special untouched', () => {
    expect(escapeIcuLiteral('Home')).toBe('Home')
    expect(escapeIcuLiteral('')).toBe('')
  })

  test('keeps an unescaped placeholder from inventing a required argument', () => {
    expect(parse('Set {color} in CSS', PARSE_OPTIONS)).toHaveLength(3)
    expect(readLiteral(escapeIcuLiteral('Set {color} in CSS'))).toBe('Set {color} in CSS')
  })

  test('keeps tag-shaped text literal instead of lowering it to markup', () => {
    expect(parse('Click <b>here</b> ', PARSE_OPTIONS)).not.toHaveLength(1)
    expect(readLiteral(escapeIcuLiteral('Click <b>here</b> '))).toBe('Click <b>here</b> ')
    expect(() => parse('Line<br>break', PARSE_OPTIONS)).toThrow()
    expect(() => parse('Read <a href="/t">terms</a>', PARSE_OPTIONS)).toThrow()
  })

  test('keeps a pound literal inside a plural body, where it would otherwise be the selector', () => {
    const body = parse('{c, plural, other {C# rocks}}', PARSE_OPTIONS)
    const [plural] = body
    if (plural === undefined || !isPluralElement(plural)) throw new Error('expected a plural')
    expect(plural.options['other']?.value).toHaveLength(3)
    expect(readLiteralInsidePlural(escapeIcuLiteral('C# rocks'))).toBe('C# rocks')
    expect(readLiteralInsidePlural(escapeIcuLiteral("a '#' b"))).toBe("a '#' b")
  })

  test('quoting a pound is visible at the top level, where a pound is already literal', () => {
    expect(escapeIcuLiteral('C# rocks')).toBe("C'#' rocks")
    expect(readLiteral('C# rocks')).toBe('C# rocks')
    expect(readLiteral(escapeIcuLiteral('C# rocks'))).toBe("C'#' rocks")
  })
})

describe('requiredCategories', () => {
  test('reads the real per-locale set rather than a CLDR table', () => {
    expect(requiredCategories('en', false)).toEqual(['one', 'other'])
    expect(requiredCategories('en', true)).toEqual(['few', 'one', 'two', 'other'])
    expect(requiredCategories('ru', false)).toEqual(['few', 'many', 'one', 'other'])
  })

  test('decides zero per locale', () => {
    expect(requiredCategories('de', false)).not.toContain('zero')
    expect(requiredCategories('lv', false)).toContain('zero')
    expect(requiredCategories('ar', false)).toContain('zero')
  })

  test('separates cardinal from ordinal for one locale', () => {
    expect(requiredCategories('en', true)).not.toEqual(requiredCategories('en', false))
  })

  test('hands out one frozen array per locale and type', () => {
    expect(requiredCategories('fr', false)).toBe(requiredCategories('fr', false))
    expect(Object.isFrozen(requiredCategories('fr', false))).toBe(true)
  })
})
