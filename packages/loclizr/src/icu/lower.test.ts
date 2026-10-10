import { describe, expect, it } from 'vitest'
import type { Diagnostic } from '../types'
import { icuContext, SPAN, withFormats } from './__fixtures__/context'
import { lower } from './lower'
import { NAMED_DATE_STYLES, NAMED_NUMBER_STYLES, NAMED_TIME_STYLES } from './styles'

function codes(diagnostics: readonly Diagnostic[]): readonly string[] {
  return diagnostics.map((diagnostic) => diagnostic.code)
}

function only(diagnostics: readonly Diagnostic[], code: string): Diagnostic {
  const found = diagnostics.filter((diagnostic) => diagnostic.code === code)
  expect(found).toHaveLength(1)
  const first = found[0]
  if (first === undefined) throw new Error(`no ${code}`)
  return first
}

function optionsOf(icu: string, formats = icuContext().formats): Record<string, unknown> {
  const node = lower(icu, icuContext({ formats })).nodes[0]
  if (node === undefined || (node.kind !== 'number' && node.kind !== 'dateTime')) {
    throw new Error(`${icu} did not lower to a formatted argument`)
  }
  return node.format.options
}

describe('lower, argument types', () => {
  it('types a bare argument stringish and a formatted one by its form', () => {
    expect(lower('{x}', icuContext()).args).toStrictEqual([
      { name: 'x', type: { kind: 'stringish' } },
    ])
    expect(lower('{x, number}', icuContext()).args).toStrictEqual([
      { name: 'x', type: { kind: 'number' } },
    ])
    expect(lower('{x, date, short}', icuContext()).args).toStrictEqual([
      { name: 'x', type: { kind: 'date' } },
    ])
    expect(lower('{x, time, short}', icuContext()).args).toStrictEqual([
      { name: 'x', type: { kind: 'date' } },
    ])
  })

  it('types a plural and a selectordinal selector as a number', () => {
    expect(lower('{c, plural, other {x}}', icuContext()).args).toStrictEqual([
      { name: 'c', type: { kind: 'number' } },
    ])
    expect(lower('{c, selectordinal, other {x}}', icuContext()).args).toStrictEqual([
      { name: 'c', type: { kind: 'number' } },
    ])
  })

  it('types a select as the union of its non-other options, in source order', () => {
    const result = lower('{s, select, shipped {a} delivered {b} other {c}}', icuContext())
    expect(result.args).toStrictEqual([
      { name: 's', type: { kind: 'select', options: ['shipped', 'delivered'] } },
    ])
  })

  it('leaves the option union empty when only other is present', () => {
    expect(lower('{s, select, other {c}}', icuContext()).args).toStrictEqual([
      { name: 's', type: { kind: 'select', options: [] } },
    ])
  })

  it('types a markup tag as markup and reports the message as markup', () => {
    const result = lower('Read our <link>terms</link>.', icuContext())
    expect(result.kind).toBe('markup')
    expect(result.markupTags).toStrictEqual(['link'])
    expect(result.args).toStrictEqual([{ name: 'link', type: { kind: 'markup' } }])
  })

  it('deduplicates and sorts markup tags by code point', () => {
    const result = lower('<i>a</i> <b>b <i>c</i></b>', icuContext())
    expect(result.markupTags).toStrictEqual(['b', 'i'])
  })

  it('keeps a tagless message text', () => {
    expect(lower('plain', icuContext()).kind).toBe('text')
    expect(lower('plain', icuContext()).markupTags).toStrictEqual([])
  })

  it('lists arguments once, in first appearance order in the body', () => {
    const result = lower('{b} then {a} then {b}', icuContext())
    expect(result.args.map((arg) => arg.name)).toStrictEqual(['b', 'a'])
  })

  it('folds a repeated name through unify so stringish narrows', () => {
    expect(lower('{x} of {x, number}', icuContext()).args).toStrictEqual([
      { name: 'x', type: { kind: 'number' } },
    ])
    expect(lower('{x, number} of {x}', icuContext()).args).toStrictEqual([
      { name: 'x', type: { kind: 'number' } },
    ])
  })

  it('unifies a date and a time use of one name', () => {
    const result = lower('{d, date, medium} at {d, time, short}', icuContext())
    expect(result.args).toStrictEqual([{ name: 'd', type: { kind: 'date' } }])
    expect(codes(result.diagnostics)).toStrictEqual([])
  })

  it('normalizes argument names to NFC so an NFD spelling is the same argument', () => {
    const nfc = 'café'
    const nfd = 'café'
    const result = lower(`{${nfc}} and {${nfd}}`, icuContext())
    expect(result.args).toStrictEqual([{ name: nfc, type: { kind: 'stringish' } }])
    expect(result.nodes).toStrictEqual([
      { kind: 'arg', name: nfc },
      { kind: 'text', value: ' and ' },
      { kind: 'arg', name: nfc },
    ])
  })
})

describe('lower, format styles', () => {
  it('resolves the bare forms to the documented option sets', () => {
    expect(optionsOf('{x, number}')).toStrictEqual({})
    expect(optionsOf('{x, date}')).toStrictEqual({ dateStyle: 'medium' })
    expect(optionsOf('{x, time}')).toStrictEqual({ timeStyle: 'medium' })
  })

  it('resolves the built-in named styles', () => {
    expect(optionsOf('{x, number, integer}')).toStrictEqual({ maximumFractionDigits: 0 })
    expect(optionsOf('{x, number, percent}')).toStrictEqual({ style: 'percent' })
    expect(optionsOf('{x, date, full}')).toStrictEqual({ dateStyle: 'full' })
    expect(optionsOf('{x, time, long}')).toStrictEqual({ timeStyle: 'long' })
  })

  it('publishes the same tables it resolves against', () => {
    expect(NAMED_NUMBER_STYLES['integer']).toStrictEqual({ maximumFractionDigits: 0 })
    expect(NAMED_NUMBER_STYLES['currency']).toBeUndefined()
    expect(Object.keys(NAMED_DATE_STYLES)).toStrictEqual(['short', 'medium', 'long', 'full'])
    expect(Object.keys(NAMED_TIME_STYLES)).toStrictEqual(['short', 'medium', 'long', 'full'])
  })

  it('takes a skeleton parsedOptions verbatim', () => {
    expect(optionsOf('{amount, number, ::currency/USD}')).toStrictEqual({
      currency: 'USD',
      style: 'currency',
    })
    expect(optionsOf('{d, date, ::yyyyMMdd}')).toStrictEqual({
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
  })

  it('keeps the style token exactly as written so the source round trips', () => {
    const skeleton = lower('{d, date, ::yyyyMMdd}', icuContext()).nodes[0]
    expect(skeleton).toMatchObject({ style: '::yyyyMMdd', form: 'date' })
    const named = lower('{d, time, short}', icuContext()).nodes[0]
    expect(named).toMatchObject({ style: 'short', form: 'time' })
    const plain = lower('{d, date}', icuContext()).nodes[0]
    expect(plain).toMatchObject({ style: null })
  })

  it('looks an unknown named style up in the configured formats', () => {
    const formats = withFormats({
      number: { compact: { notation: 'compact', maximumFractionDigits: 1 } },
      dateTime: { weekday: { weekday: 'long' } },
    }).formats
    expect(optionsOf('{x, number, compact}', formats)).toStrictEqual({
      notation: 'compact',
      maximumFractionDigits: 1,
    })
    expect(optionsOf('{x, date, weekday}', formats)).toStrictEqual({ weekday: 'long' })
    expect(optionsOf('{x, time, weekday}', formats)).toStrictEqual({ weekday: 'long' })
  })

  it('raises LZ2002 for a style in neither table and keeps the bare options', () => {
    const result = lower('{x, number, zesty}', icuContext())
    const diagnostic = only(result.diagnostics, 'LZ2002')
    expect(diagnostic.severity).toBe('error')
    expect(diagnostic.fatal).toBe(false)
    expect(diagnostic.hint).toContain('formats.number.zesty')
    expect(result.nodes[0]).toMatchObject({
      kind: 'number',
      style: 'zesty',
      format: { kind: 'number', options: {} },
    })
  })

  it('raises LZ2002 for currency, which ICU cannot carry a code for', () => {
    const diagnostic = only(lower('{x, number, currency}', icuContext()).diagnostics, 'LZ2002')
    expect(diagnostic.hint).toContain('::currency/USD')
  })

  it('resolves a configured currency style rather than raising LZ2002', () => {
    const formats = withFormats({
      number: { currency: { style: 'currency', currency: 'EUR' } },
    }).formats
    expect(optionsOf('{x, number, currency}', formats)).toStrictEqual({
      style: 'currency',
      currency: 'EUR',
    })
  })

  it('raises LZ2003 for a skeleton the parser rejects and still lowers the message', () => {
    const result = lower('Due {d, date, ::qqqq}', icuContext())
    const diagnostic = only(result.diagnostics, 'LZ2003')
    expect(diagnostic.fatal).toBe(false)
    expect(diagnostic.message).toContain('::qqqq')
    expect(result.nodes).toHaveLength(2)
    expect(result.nodes[1]).toMatchObject({
      kind: 'dateTime',
      style: '::qqqq',
      format: { kind: 'dateTime', options: { dateStyle: 'medium' } },
    })
    expect(result.normalized).toBe('Due {d, date, ::qqqq}')
  })

  it('keeps every other skeleton in a message that carries one bad skeleton', () => {
    const result = lower('{a, number, ::currency/USD} {d, date, ::qqqq}', icuContext())
    expect(codes(result.diagnostics)).toStrictEqual(['LZ2003'])
    expect(result.nodes[0]).toMatchObject({
      format: { kind: 'number', options: { currency: 'USD', style: 'currency' } },
    })
  })

  it('raises LZ2003 for a skeleton the parser accepts but maps to nothing', () => {
    const result = lower('{x, number, ::bogusdoesnotexist}', icuContext())
    expect(codes(result.diagnostics)).toStrictEqual(['LZ2003'])
    expect(result.nodes[0]).toMatchObject({
      style: '::bogusdoesnotexist',
      format: { kind: 'number', options: {} },
    })
  })

  it.each([
    ['{d, date, ::ccc}', '"::ccc": `c..ccc` (weekday) patterns are not supported.'],
    ['{d, date, ::D}', '"::D": `D/F/g` (day) patterns are not supported, use `d` instead.'],
    [
      '{d, time, ::HmO}',
      '"::HmO": `Z/O/v/V/X/x` (timeZone) patterns are not supported, use `z` instead.',
    ],
    [
      '{n, number, ::integer-width/000}',
      '"::integer-width/000": We currently do not support exact integer digits.',
    ],
    [
      '{d, date, ::qqqq} {s, select, a {x}}',
      '"::qqqq": `q/Q` (quarter) patterns are not supported.',
    ],
  ])('quotes the reason the parser rejected the skeleton in %s', (value, reason) => {
    const diagnostic = only(lower(value, icuContext()).diagnostics, 'LZ2003')
    expect(diagnostic.message).toBe(`The parser rejected the skeleton ${reason}`)
  })

  it.each([['{n, number, ::currency/}'], ['{t, time, ::}']])(
    'quotes no parser error kind for %s, which the tokenizer refused',
    (value) => {
      const diagnostic = only(lower(value, icuContext()).diagnostics, 'LZ2003')
      expect(diagnostic.message).toMatch(/^The parser rejected the skeleton "::[^"]*"\.$/)
    },
  )

  it.each([['{n, number, ::latin}'], ['{n, number, ::currrency/USD}']])(
    'does not call every stem in %s a misspelling when it maps to nothing',
    (value) => {
      const diagnostic = only(lower(value, icuContext()).diagnostics, 'LZ2003')
      expect(diagnostic.hint).toContain('misspelled or not supported by loclizr')
    },
  )

  it('merges formats.timeZone into every resolved date and time option set', () => {
    const formats = withFormats({ timeZone: 'UTC' }).formats
    expect(optionsOf('{d, date, medium}', formats)).toStrictEqual({
      dateStyle: 'medium',
      timeZone: 'UTC',
    })
    expect(optionsOf('{d, time}', formats)).toStrictEqual({
      timeStyle: 'medium',
      timeZone: 'UTC',
    })
    expect(optionsOf('{d, date, ::yyyyMMdd}', formats)).toMatchObject({ timeZone: 'UTC' })
    expect(optionsOf('{x, number}', formats)).toStrictEqual({})
  })
})

describe('lower, plural semantics', () => {
  it('splits exact branches from keyword branches and orders both canonically', () => {
    const node = lower(
      '{c, plural, other {o} one {a} =7 {seven} =0 {none}}',
      icuContext(),
    ).nodes[0]
    expect(node).toMatchObject({
      kind: 'plural',
      name: 'c',
      ordinal: false,
      offset: 0,
      exact: [{ value: 0 }, { value: 7 }],
      branches: [{ keyword: 'one' }, { keyword: 'other' }],
    })
  })

  it('orders arguments by the canonical branch order, not the catalog order', () => {
    const result = lower('{c, plural, other {{y}} =3 {{z}} one {{x}}}', icuContext())
    expect(result.args.map((arg) => arg.name)).toStrictEqual(['c', 'z', 'x', 'y'])
    expect(result.normalized).toBe('{c, plural, =3 {{z}} one {{x}} other {{y}}}')
  })

  it('marks a selectordinal ordinal and keeps the offset', () => {
    expect(lower('{c, selectordinal, offset:2 other {#}}', icuContext()).nodes[0]).toMatchObject({
      kind: 'plural',
      ordinal: true,
      offset: 2,
    })
  })

  it('lowers # inside a plural body to a pound node', () => {
    const node = lower('{c, plural, other {# left}}', icuContext()).nodes[0]
    expect(node).toMatchObject({
      branches: [{ keyword: 'other', body: [{ kind: 'pound' }, { kind: 'text', value: ' left' }] }],
    })
  })

  it('leaves # outside a plural as literal text with no diagnostic', () => {
    const result = lower('Order #42', icuContext())
    expect(result.nodes).toStrictEqual([{ kind: 'text', value: 'Order #42' }])
    expect(codes(result.diagnostics)).toStrictEqual([])
  })

  it('raises LZ2008 for the # the parser demotes inside a nested select', () => {
    const result = lower('{a, plural, offset:1 other {# and {b, select, x {#} other {#}}}}', icuContext())
    const found = result.diagnostics.filter((diagnostic) => diagnostic.code === 'LZ2008')
    expect(found).toHaveLength(2)
    expect(found[0]?.severity).toBe('warn')
    expect(found[0]?.fatal).toBe(false)
    expect(found[0]?.hint).toContain('{a, number}')
  })

  it('names no select in the LZ2008 hint when no select encloses the #', () => {
    const result = lower("{a, plural, other {'#' items}}", icuContext())
    expect(only(result.diagnostics, 'LZ2008').hint).toBe(
      'Write # without the quotes, or {a, number}, to print the count.',
    )
  })

  it('gives the LZ2008 hint in i18next syntax for a value converted from i18next', () => {
    const result = lower(
      "{count, plural, one {'#' item} other {'#' items}}",
      icuContext({ catalogFormat: 'i18next' }),
    )
    const found = result.diagnostics.filter((diagnostic) => diagnostic.code === 'LZ2008')
    expect(found).toHaveLength(2)
    expect(found[0]?.hint).toBe('In an i18next file # is always the character. If you meant the count, write {{count}}.')
  })

  it('raises LZ2006 for a branch keyword that is not a CLDR category', () => {
    const result = lower('{c, plural, banana {x} other {y}}', icuContext())
    expect(only(result.diagnostics, 'LZ2006').message).toContain('banana')
    expect(result.nodes[0]).toMatchObject({ branches: [{ keyword: 'banana' }, { keyword: 'other' }] })
  })
})

describe('lower, select semantics', () => {
  it('recovers the author order of integer-like options the parser reorders', () => {
    const result = lower('{rank, select, 1 {gold} 0 {none} other {rest}}', icuContext())
    expect(result.nodes[0]).toMatchObject({
      branches: [{ option: '1' }, { option: '0' }, { option: 'other' }],
    })
    expect(result.args[0]?.type).toStrictEqual({ kind: 'select', options: ['1', '0'] })
  })

  it('moves other last even when the catalog wrote it first', () => {
    const result = lower('{s, select, other {c} a {x} b {y}}', icuContext())
    expect(result.nodes[0]).toMatchObject({
      branches: [{ option: 'a' }, { option: 'b' }, { option: 'other' }],
    })
  })

  it('keeps an option spelled as the catalog spells it, since the runtime matches it verbatim', () => {
    const result = lower('{s, select, cafe\u0301 {a} other {c}}', icuContext())
    expect(result.args[0]?.type).toStrictEqual({ kind: 'select', options: ['cafe\u0301'] })
    expect(result.nodes[0]).toMatchObject({
      branches: [{ option: 'cafe\u0301' }, { option: 'other' }],
    })
    expect(result.diagnostics).toStrictEqual([])
  })

  it('raises LZ2001 at the second option when two options are equal under NFC', () => {
    const result = lower('{s, select, caf\u00e9 {a} cafe\u0301 {b} other {c}}', icuContext())
    const found = only(result.diagnostics, 'LZ2001')
    expect(found.message).toBe('The select {s} has two options that are both "caf\u00e9" under NFC.')
    expect(found.span).toStrictEqual({ line: 3, column: 5 + 21, offset: 42 + 21, length: 5 })
  })
})

describe('lower, argument names', () => {
  it('accepts the names the parser lets through that are usable properties', () => {
    const result = lower('{constructor} {toString} {ä} {_y} {x_1}', icuContext())
    expect(codes(result.diagnostics)).toStrictEqual([])
  })

  it('raises LZ2007 for a name that would not be a JavaScript identifier', () => {
    expect(only(lower('{9x}', icuContext()).diagnostics, 'LZ2007').message).toContain('9x')
  })

  it('raises LZ2007 for __proto__, which reads back as the prototype', () => {
    expect(only(lower('{__proto__}', icuContext()).diagnostics, 'LZ2007').message).toContain(
      '__proto__',
    )
  })

  it('raises LZ2007 for a markup tag name that is not an identifier', () => {
    const result = lower('<my-tag>x</my-tag>', icuContext())
    expect(only(result.diagnostics, 'LZ2007').message).toContain('my-tag')
  })

  it('reports one name once however often it repeats', () => {
    expect(codes(lower('{9x} {9x} {9x}', icuContext()).diagnostics)).toStrictEqual(['LZ2007'])
  })
})

describe('lower, local argument conflicts', () => {
  it('raises LZ2009 once and keeps the first type', () => {
    const result = lower('{x, number} of {x, date, short} of {x, date, long}', icuContext())
    const diagnostic = only(result.diagnostics, 'LZ2009')
    expect(diagnostic.severity).toBe('error')
    expect(diagnostic.message).toContain('number')
    expect(diagnostic.message).toContain('date')
    expect(result.args).toStrictEqual([{ name: 'x', type: { kind: 'number' } }])
  })

  it('does not raise LZ2009 where unify succeeds', () => {
    expect(codes(lower('{x} {x, number} {x}', icuContext()).diagnostics)).toStrictEqual([])
  })
})

describe('lower, parse failures', () => {
  it('returns an empty result rather than throwing', () => {
    const result = lower('{unclosed', icuContext())
    expect(result.nodes).toStrictEqual([])
    expect(result.args).toStrictEqual([])
    expect(result.markupTags).toStrictEqual([])
    expect(result.kind).toBe('text')
    expect(result.normalized).toBe('')
    expect(codes(result.diagnostics)).toStrictEqual(['LZ2001'])
  })

  it('never throws on any malformed input', () => {
    for (const value of ['{', '{x,}', '{x, bogus}', '{$x}', '<b>unclosed', '{c, plural, =1.5 {a} other {b}}']) {
      expect(() => lower(value, icuContext())).not.toThrow()
      const result = lower(value, icuContext())
      expect(result.nodes).toStrictEqual([])
      expect(codes(result.diagnostics)).toStrictEqual(['LZ2001'])
    }
  })

  it('separates a missing plural other from a missing select other', () => {
    const plural = only(lower('{c, plural, one {a}}', icuContext()).diagnostics, 'LZ2004')
    expect(plural.message).toContain('"c"')
    const select = only(lower('{s, select, a {x}}', icuContext()).diagnostics, 'LZ2005')
    expect(select.message).toContain('"s"')
  })

  it('treats a selectordinal without other as a missing plural other', () => {
    const result = lower('{c, selectordinal, one {1st}}', icuContext())
    expect(codes(result.diagnostics)).toStrictEqual(['LZ2004'])
  })

  it('finds the select nested inside a complete plural', () => {
    const result = lower('{c, plural, other {{g, select, a {q}}}}', icuContext())
    expect(only(result.diagnostics, 'LZ2005').message).toContain('"g"')
  })

  it('stamps a parse failure non-fatal, because the scope drops the message', () => {
    expect(only(lower('{unclosed', icuContext()).diagnostics, 'LZ2001').fatal).toBe(false)
    expect(only(lower('{c, plural, one {a}}', icuContext()).diagnostics, 'LZ2004').fatal).toBe(false)
  })

  it('names the parser error in the message', () => {
    expect(only(lower('{unclosed', icuContext()).diagnostics, 'LZ2001').message).toContain(
      'EXPECT_ARGUMENT_CLOSING_BRACE',
    )
  })

  it('rejects i18next interpolation in a file read as ICU rather than guessing', () => {
    const result = lower('Hi {{name}}', icuContext())
    expect(only(result.diagnostics, 'LZ2001').message).toContain('MALFORMED_ARGUMENT')
    expect(result.nodes).toStrictEqual([])
  })

  it('lowers an empty value to nothing with no diagnostic', () => {
    const result = lower('', icuContext())
    expect(result.nodes).toStrictEqual([])
    expect(result.normalized).toBe('')
    expect(result.diagnostics).toStrictEqual([])
  })
})

describe('lower, diagnostic positions', () => {
  it('carries the entry key, locale and file onto every diagnostic', () => {
    const diagnostic = only(lower('{x, number, zesty}', icuContext()).diagnostics, 'LZ2002')
    expect(diagnostic.file).toBe('locales/en.json')
    expect(diagnostic.locale).toBe('en')
    expect(diagnostic.key).toBe('cart.items')
  })

  it('composes the parser offset onto the entry span for an ICU file', () => {
    const diagnostic = only(lower('abc {x, number, zesty}', icuContext()).diagnostics, 'LZ2002')
    expect(diagnostic.span).toStrictEqual({
      line: SPAN.line,
      column: SPAN.column + 4,
      offset: SPAN.offset + 4,
      length: 18,
    })
  })

  it('falls back to the entry span once a JSON escape has shifted the value', () => {
    const newline = lower('line one\nline {x, number, zesty} two', icuContext())
    expect(only(newline.diagnostics, 'LZ2002').span).toStrictEqual(SPAN)

    const quote = lower('say "hi" to {x, number, zesty}', icuContext())
    expect(only(quote.diagnostics, 'LZ2002').span).toStrictEqual(SPAN)

    const backslash = lower('a\\b {x, number, zesty}', icuContext())
    expect(only(backslash.diagnostics, 'LZ2002').span).toStrictEqual(SPAN)
  })

  it('still composes when the escape sits after the error it would have shifted', () => {
    const result = lower('{x, number, zesty} then "quoted"', icuContext())
    expect(only(result.diagnostics, 'LZ2002').span).toStrictEqual({
      line: SPAN.line,
      column: SPAN.column,
      offset: SPAN.offset,
      length: 18,
    })
  })

  it('reports the entry span verbatim for a converted i18next file', () => {
    const context = icuContext({ catalogFormat: 'i18next' })
    const diagnostic = only(lower('abc {x, number, zesty}', context).diagnostics, 'LZ2002')
    expect(diagnostic.span).toStrictEqual(SPAN)
  })

  it('names the conversion rather than a character in the hint for an i18next file', () => {
    const context = icuContext({ catalogFormat: 'i18next' })
    const converted = only(lower('{unclosed', context).diagnostics, 'LZ2001')
    expect(converted.hint).toContain('i18next')
    expect(converted.hint).toContain('EXPECT_ARGUMENT_CLOSING_BRACE')
  })
})

describe('lower, syntax error fixes', () => {
  function syntax(value: string): Diagnostic {
    return only(lower(value, icuContext()).diagnostics, 'LZ2001')
  }

  it('keeps the parser name in the message and puts the fix in the hint', () => {
    const diagnostic = syntax('Total: {amount, number, ::currency/USD')
    expect(diagnostic.message).toContain('EXPECT_ARGUMENT_CLOSING_BRACE')
    expect(diagnostic.hint).toContain('never closed')
  })

  it('points an i18next placeholder in a file read as ICU at the single brace form', () => {
    expect(syntax('Hi {{name}}').hint).toContain('Write {name}')
  })

  it('names the characters the parser refuses in an argument name', () => {
    const diagnostic = syntax('{$total}')
    expect(diagnostic.message).toContain('MALFORMED_ARGUMENT')
    expect(diagnostic.hint).toContain('a $')
    expect(diagnostic.hint).not.toContain('digits, _ and $')
  })

  it('offers markup or quoting for an unclosed tag', () => {
    const diagnostic = syntax('Line<br>break')
    expect(diagnostic.message).toContain('UNCLOSED_TAG')
    expect(diagnostic.hint).toContain("'<br>'")
  })

  it('asks for matching names on a mismatched closing tag', () => {
    const diagnostic = syntax('<b>bold</i>')
    expect(diagnostic.message).toContain('UNMATCHED_CLOSING_TAG')
    expect(diagnostic.hint).toContain('closing tag')
  })

  it('sends an attribute to the call site rather than into the catalog', () => {
    const diagnostic = syntax('Read <a href="/t">terms</a>')
    expect(diagnostic.message).toContain('INVALID_TAG')
    expect(diagnostic.hint).toContain('no attributes')
    expect(diagnostic.hint).toContain('<link>terms</link>')
  })

  it('falls through to what to look for on a kind with no fix of its own', () => {
    const diagnostic = syntax('{foo,}')
    expect(diagnostic.message).toContain('EXPECT_ARGUMENT_TYPE')
    expect(diagnostic.hint).toContain('unbalanced')
  })

  it('leaves no LZ2001 without a hint', () => {
    for (const value of ['{', '{}', '{x,}', '{x, bogus}', '<b>unclosed', '{c, plural, =x {a}}']) {
      const diagnostic = syntax(value)
      expect(diagnostic.hint).not.toBeNull()
      expect(diagnostic.hint).not.toBe('')
    }
  })
})

describe('lower, skeleton scale', () => {
  function formatOf(icu: string): unknown {
    const result = lower(icu, icuContext())
    expect(result.diagnostics).toStrictEqual([])
    const node = result.nodes[0]
    if (node === undefined || node.kind !== 'number') throw new Error(`${icu} did not lower to a number`)
    return node.format
  }

  it('lifts scale out of the Intl options into a multiplier', () => {
    expect(formatOf('{n, number, ::scale/1000}')).toStrictEqual({
      kind: 'number',
      options: {},
      multiplier: 1000,
    })
  })

  it('keeps a currency format beside its scale', () => {
    expect(formatOf('{n, number, ::currency/USD scale/1000}')).toStrictEqual({
      kind: 'number',
      options: { currency: 'USD', style: 'currency' },
      multiplier: 1000,
    })
  })

  it('carries a fractional scale', () => {
    expect(formatOf('{n, number, ::scale/0.01}')).toStrictEqual({
      kind: 'number',
      options: {},
      multiplier: 0.01,
    })
  })

  it('reads ::percent scale/100 as plain percent, since Intl already multiplies by 100', () => {
    expect(formatOf('{n, number, ::percent scale/100}')).toStrictEqual({
      kind: 'number',
      options: { style: 'percent' },
    })
    expect(formatOf('{n, number, ::percent scale/1000}')).toStrictEqual({
      kind: 'number',
      options: { style: 'percent' },
      multiplier: 10,
    })
  })

  it('rejects a scale that is not a number instead of rendering NaN', () => {
    for (const icu of ['{n, number, ::scale/abc}', '{n, number, ::scale}', '{n, number, ::percent scale/abc}']) {
      const result = lower(icu, icuContext())
      expect(codes(result.diagnostics)).toStrictEqual(['LZ2003'])
      const node = result.nodes[0]
      if (node === undefined || node.kind !== 'number') throw new Error(`${icu} did not lower to a number`)
      expect(node.format).toStrictEqual({ kind: 'number', options: {} })
    }
  })

  it('lifts scale on the retry path a bad sibling skeleton forces', () => {
    const result = lower('{n, number, ::scale/1000} {d, date, ::qqqq}', icuContext())
    expect(codes(result.diagnostics)).toStrictEqual(['LZ2003'])
    expect(result.nodes[0]).toMatchObject({
      format: { kind: 'number', options: {}, multiplier: 1000 },
    })
  })
})
