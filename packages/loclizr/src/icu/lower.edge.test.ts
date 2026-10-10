import { describe, expect, it } from 'vitest'
import type { Diagnostic, Node } from '../types'
import { icuContext, SPAN } from './__fixtures__/context'
import { lower, type LowerResult } from './lower'

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

function first(result: LowerResult): Node {
  const node = result.nodes[0]
  if (node === undefined) throw new Error('the value lowered to no nodes')
  return node
}

function expectRoundTrip(value: string): LowerResult {
  const once = lower(value, icuContext())
  const twice = lower(once.normalized, icuContext())
  expect(twice.nodes).toStrictEqual(once.nodes)
  expect(twice.args).toStrictEqual(once.args)
  expect(twice.normalized).toBe(once.normalized)
  return once
}

const RLM = '‏'
const LRM = '‎'
const BOM = '﻿'

describe('a value made of nothing but whitespace or invisible characters', () => {
  it('keeps whitespace-only text as one text node with no diagnostic', () => {
    const result = lower('   ', icuContext())
    expect(result.nodes).toStrictEqual([{ kind: 'text', value: '   ' }])
    expect(result.normalized).toBe('   ')
    expect(result.diagnostics).toStrictEqual([])
  })

  it('keeps a leading byte order mark as text rather than dropping it', () => {
    const result = lower(`${BOM}Hi {x}`, icuContext())
    expect(result.nodes).toStrictEqual([
      { kind: 'text', value: `${BOM}Hi ` },
      { kind: 'arg', name: 'x' },
    ])
    expect(result.normalized).toBe(`${BOM}Hi {x}`)
  })

  it('keeps a right-to-left mark that sits in text beside an argument', () => {
    const result = expectRoundTrip(`${RLM}{x}${RLM}`)
    expect(result.nodes).toStrictEqual([
      { kind: 'text', value: RLM },
      { kind: 'arg', name: 'x' },
      { kind: 'text', value: RLM },
    ])
  })
})

describe('line endings', () => {
  it.each([
    ['CRLF', 'a\r\nb {x}'],
    ['a lone CR', 'a\rb {x}'],
    ['a lone LF', 'a\nb {x}'],
  ])('keeps %s inside text byte for byte', (_label, value) => {
    const result = expectRoundTrip(value)
    expect(result.normalized).toBe(value)
  })

  it('treats CRLF between argument parts as the whitespace it is', () => {
    const result = lower('{x,\r\nnumber,\r\ninteger}', icuContext())
    expect(result.normalized).toBe('{x, number, integer}')
    expect(result.diagnostics).toStrictEqual([])
  })

  it('keeps CRLF inside a plural branch body', () => {
    const result = expectRoundTrip('{c, plural, one {a\r\n#} other {b\r\n#}}')
    expect(result.normalized).toBe('{c, plural, one {a\r\n#} other {b\r\n#}}')
  })
})

describe('argument names at the edge of the identifier predicate', () => {
  it.each([
    ['a lone underscore', '_'],
    ['a dotted capital I', 'İ'],
    ['a letter number', 'ⅷ'],
    ['an Other_ID_Start symbol', '℘x'],
    ['a middle dot after the first character', 'a·b'],
  ])('accepts %s', (_label, name) => {
    const result = lower(`{${name}}`, icuContext())
    expect(codes(result.diagnostics)).toStrictEqual([])
    expect(result.args).toStrictEqual([{ name, type: { kind: 'stringish' } }])
  })

  it('reports a middle dot in first position, which is ID_Continue only', () => {
    expect(codes(lower('{·x}', icuContext()).diagnostics)).toStrictEqual(['LZ2007'])
  })

  it('reports a lone surrogate as a name without throwing', () => {
    const result = lower('{\ud800}', icuContext())
    expect(codes(result.diagnostics)).toStrictEqual(['LZ2007'])
    expect(result.args.map((arg) => arg.name)).toStrictEqual(['\ud800'])
  })

  it('reports a bidi mark glued to the end of a name rather than keeping it silently', () => {
    const result = lower(`{x${LRM}}`, icuContext())
    expect(codes(result.diagnostics)).toStrictEqual(['LZ2007'])
  })

  it('composes a base letter and a combining accent into one NFC name', () => {
    const result = lower('{é}', icuContext())
    expect(result.args).toStrictEqual([{ name: 'é', type: { kind: 'stringish' } }])
    expect(result.normalized).toBe('{é}')
  })

  it('composes conjoining Hangul jamo into one syllable', () => {
    const result = lower('{가}', icuContext())
    expect(result.args.map((arg) => arg.name)).toStrictEqual(['가'])
  })

  it('keeps a compatibility ligature apart from its spelled out twin, because NFC is not NFKC', () => {
    const result = lower('{ﬁle} {file}', icuContext())
    expect(result.args.map((arg) => arg.name)).toStrictEqual(['ﬁle', 'file'])
    expect(result.diagnostics).toStrictEqual([])
  })

  it('accepts a prototype named markup tag as an ordinary markup argument', () => {
    const result = expectRoundTrip('<constructor>x</constructor>')
    expect(result.args).toStrictEqual([{ name: 'constructor', type: { kind: 'markup' } }])
    expect(result.markupTags).toStrictEqual(['constructor'])
  })

  it('accepts a tag name with a trailing digit', () => {
    const result = lower('<b1>x</b1>', icuContext())
    expect(result.markupTags).toStrictEqual(['b1'])
    expect(result.diagnostics).toStrictEqual([])
  })
})

describe('select options a catalog can legally write', () => {
  it('keeps an emoji option in the type union', () => {
    const result = expectRoundTrip('{s, select, \u{1f44d} {a} other {b}}')
    expect(result.args).toStrictEqual([
      { name: 's', type: { kind: 'select', options: ['\u{1f44d}'] } },
    ])
  })

  it('keeps every Object.prototype member name as an option in author order', () => {
    const result = expectRoundTrip(
      '{s, select, constructor {a} toString {b} hasOwnProperty {c} other {d}}',
    )
    expect(result.args[0]?.type).toStrictEqual({
      kind: 'select',
      options: ['constructor', 'toString', 'hasOwnProperty'],
    })
  })

  it('refuses a repeated option the way the parser does', () => {
    const result = lower('{s, select, a {x} a {y} other {z}}', icuContext())
    expect(only(result.diagnostics, 'LZ2001').message).toContain(
      'DUPLICATE_SELECT_ARGUMENT_SELECTOR',
    )
    expect(result.nodes).toStrictEqual([])
  })

  it('refuses a repeated other branch', () => {
    const result = lower('{s, select, other {a} other {b}}', icuContext())
    expect(codes(result.diagnostics)).toStrictEqual(['LZ2001'])
  })

  it('keeps the first option union when one select name repeats', () => {
    const result = lower(
      '{s, select, a {x} other {y}} {s, select, b {x} other {y}}',
      icuContext(),
    )
    expect(result.args).toStrictEqual([{ name: 's', type: { kind: 'select', options: ['a'] } }])
    expect(result.diagnostics).toStrictEqual([])
  })

  it('narrows a bare argument to the select that later reuses its name', () => {
    const result = lower('{s} {s, select, a {x} other {y}}', icuContext())
    expect(result.args).toStrictEqual([{ name: 's', type: { kind: 'select', options: ['a'] } }])
    expect(result.diagnostics).toStrictEqual([])
  })

  it('refuses to reconcile a select with a number of the same name', () => {
    const result = lower('{s, select, a {x} other {y}} {s, number}', icuContext())
    expect(codes(result.diagnostics)).toStrictEqual(['LZ2009'])
    expect(result.args).toStrictEqual([{ name: 's', type: { kind: 'select', options: ['a'] } }])
  })

  it('reports a three way conflict on one name once', () => {
    const result = lower(
      '{x, number} of {x, date, short} and {x, select, other {q}}',
      icuContext(),
    )
    expect(codes(result.diagnostics)).toStrictEqual(['LZ2009'])
    expect(result.args).toStrictEqual([{ name: 'x', type: { kind: 'number' } }])
  })
})

describe('plural branch selectors at the limits', () => {
  it('round trips an exact branch at Number.MAX_SAFE_INTEGER', () => {
    const result = expectRoundTrip('{c, plural, =9007199254740991 {a} other {b}}')
    const node = first(result)
    expect(node.kind === 'plural' && node.exact[0]?.value).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('refuses an exact branch one past Number.MAX_SAFE_INTEGER rather than rounding it', () => {
    const result = lower('{c, plural, =9007199254740992 {a} other {b}}', icuContext())
    expect(only(result.diagnostics, 'LZ2001').message).toContain(
      'INVALID_PLURAL_ARGUMENT_SELECTOR',
    )
  })

  it('round trips an offset at Number.MAX_SAFE_INTEGER', () => {
    const result = expectRoundTrip('{c, plural, offset:9007199254740991 other {#}}')
    expect(result.normalized).toBe('{c, plural, offset:9007199254740991 other {#}}')
  })

  it('prints an explicit offset:0 as no offset at all', () => {
    expect(lower('{c, plural, offset:0 other {#}}', icuContext()).normalized).toBe(
      '{c, plural, other {#}}',
    )
  })

  it('prints =+0 as =0', () => {
    expect(lower('{c, plural, =+0 {z} other {o}}', icuContext()).normalized).toBe(
      '{c, plural, =0 {z} other {o}}',
    )
  })

  it('orders many exact branches numerically whatever order the catalog wrote', () => {
    const result = lower('{c, plural, =5 {e} =3 {c} =10 {j} =1 {a} other {o}}', icuContext())
    expect(result.normalized).toBe('{c, plural, =1 {a} =3 {c} =5 {e} =10 {j} other {o}}')
  })

  it('refuses a textually identical exact branch the parser sees twice', () => {
    const result = lower('{c, plural, =1 {a} =01 {b} =1 {c} other {d}}', icuContext())
    expect(only(result.diagnostics, 'LZ2001').message).toContain(
      'DUPLICATE_PLURAL_ARGUMENT_SELECTOR',
    )
  })

  it('keeps an exact branch on a selectordinal', () => {
    const result = expectRoundTrip('{c, selectordinal, =1 {first} other {#th}}')
    const node = first(result)
    expect(node.kind === 'plural' && node.ordinal).toBe(true)
    expect(node.kind === 'plural' && node.exact.map((branch) => branch.value)).toStrictEqual([1])
  })
})

describe('plural keyword casing', () => {
  it('reports an upper case CLDR keyword as unknown, because categories are lower case', () => {
    const result = lower('{c, plural, ONE {a} other {b}}', icuContext())
    expect(codes(result.diagnostics)).toStrictEqual(['LZ2006'])
    expect(result.normalized).toBe('{c, plural, ONE {a} other {b}}')
  })

  it('treats a capitalised Other as a missing other branch', () => {
    const result = lower('{c, plural, one {a} Other {b}}', icuContext())
    expect(only(result.diagnostics, 'LZ2004').message).toContain('"c"')
    expect(result.nodes).toStrictEqual([])
  })
})

describe('branch bodies made of almost nothing', () => {
  it('keeps every keyword branch empty without merging or dropping one', () => {
    const result = expectRoundTrip('{c, plural, one {} other {}}')
    const node = first(result)
    expect(node.kind === 'plural' && node.branches).toStrictEqual([
      { keyword: 'one', body: [] },
      { keyword: 'other', body: [] },
    ])
  })

  it('keeps the spaces around a branch body as text', () => {
    const result = expectRoundTrip('{c, plural, other { a }}')
    const node = first(result)
    expect(node.kind === 'plural' && node.branches[0]?.body).toStrictEqual([
      { kind: 'text', value: ' a ' },
    ])
  })
})

describe('the pound across nesting', () => {
  it('reads # in a plural inside a select inside a plural as the innermost count', () => {
    const result = lower(
      '{c, plural, other {{s, select, other {{d, plural, other {#}}}}}}',
      icuContext(),
    )
    expect(result.diagnostics).toStrictEqual([])
    expect(result.args.map((arg) => arg.name)).toStrictEqual(['c', 's', 'd'])
    expect(result.normalized).toBe('{c, plural, other {{s, select, other {{d, plural, other {#}}}}}}')
  })

  it('leaves # inside markup outside any plural as quiet text', () => {
    const result = lower('<b>#</b>', icuContext())
    expect(result.diagnostics).toStrictEqual([])
    expect(result.normalized).toBe('<b>#</b>')
  })

  it('lowers a value that is a single # to text', () => {
    const result = lower('#', icuContext())
    expect(result.nodes).toStrictEqual([{ kind: 'text', value: '#' }])
    expect(result.diagnostics).toStrictEqual([])
  })
})

describe('a missing other branch buried in structure', () => {
  it('names the select inside a markup tag', () => {
    const result = lower('<b>{s, select, a {x}}</b>', icuContext())
    expect(only(result.diagnostics, 'LZ2005').message).toContain('"s"')
  })

  it('names the inner select when the outer one is complete', () => {
    const result = lower('{s, select, a {{t, select, b {y}}} other {z}}', icuContext())
    expect(only(result.diagnostics, 'LZ2005').message).toContain('"t"')
  })

  it('points the span at the select it names rather than at the value start', () => {
    const result = lower('<b>{s, select, a {x}}</b>', icuContext())
    const diagnostic = only(result.diagnostics, 'LZ2005')
    expect(diagnostic.span?.offset).toBe(SPAN.offset + 3)
  })
})

describe('skeletons at the edges of the retry', () => {
  it('trims trailing whitespace off an accepted skeleton token', () => {
    const result = lower('{n, number, ::percent  }', icuContext())
    expect(first(result)).toMatchObject({ style: '::percent' })
    expect(result.normalized).toBe('{n, number, ::percent}')
  })

  it('reports each of two rejected skeletons at its own position', () => {
    const result = lower('{a, number, ::currency/} {b, number, ::currency/}', icuContext())
    const spans = result.diagnostics.map((diagnostic) => diagnostic.span?.offset)
    expect(codes(result.diagnostics)).toStrictEqual(['LZ2003', 'LZ2003'])
    expect(new Set(spans).size).toBe(2)
    expect(result.normalized).toBe('{a, number} {b, number}')
  })

  it('lowers the plural around a rejected skeleton in one of its branches', () => {
    const result = lower('{c, plural, other {# {n, number, ::currency/}}}', icuContext())
    expect(codes(result.diagnostics)).toStrictEqual(['LZ2003'])
    expect(result.args.map((arg) => arg.name)).toStrictEqual(['c', 'n'])
    expect(result.normalized).toBe('{c, plural, other {# {n, number}}}')
  })
})

describe('diagnostic spans after characters JSON may or may not escape', () => {
  it.each([
    ['CRLF', 'a\r\n'],
    ['a lone CR', 'a\r'],
    ['a tab', 'a\t'],
    ['a NUL', 'a\u0000'],
  ])('falls back to the entry span after %s', (_label, prefix) => {
    const result = lower(`${prefix}{x, number, zesty}`, icuContext())
    expect(only(result.diagnostics, 'LZ2002').span).toStrictEqual(SPAN)
  })

  it.each([
    ['a right-to-left mark', RLM, 1],
    ['a byte order mark', BOM, 1],
    ['an astral emoji', '\u{1f44d}', 2],
  ])('composes the offset after %s, which JSON holds verbatim', (_label, prefix, width) => {
    const result = lower(`${prefix}{x, number, zesty}`, icuContext())
    const span = only(result.diagnostics, 'LZ2002').span
    expect(span?.offset).toBe(SPAN.offset + width)
    expect(span?.column).toBe(SPAN.column + width)
    expect(span?.line).toBe(SPAN.line)
  })

  it('never reports a span shorter than one character', () => {
    for (const value of ['{', '}', '{x, number, zesty}', '{9x}', '{c, plural, one {a}}']) {
      for (const diagnostic of lower(value, icuContext()).diagnostics) {
        expect(diagnostic.span?.length ?? 0).toBeGreaterThanOrEqual(1)
      }
    }
  })
})

describe('the context carried onto diagnostics', () => {
  it.each(['EN-us', 'de-DE-u-nu-latn', 'zh-Hant-TW', 'x-private'])(
    'passes the locale tag %j through verbatim',
    (locale) => {
      const result = lower('{9x}', icuContext({ locale }))
      expect(only(result.diagnostics, 'LZ2007').locale).toBe(locale)
    },
  )

  it.each(['__proto__', 'constructor', 'a.b.c', ''])('passes the key %j through verbatim', (key) => {
    const result = lower('{9x}', icuContext({ key }))
    expect(only(result.diagnostics, 'LZ2007').key).toBe(key)
  })

  it('lowers the same nodes whatever locale the context names', () => {
    const value = '{c, plural, zero {z} one {o} other {#}}'
    expect(lower(value, icuContext({ locale: 'ja' })).nodes).toStrictEqual(
      lower(value, icuContext({ locale: 'ar' })).nodes,
    )
  })
})

describe('determinism', () => {
  const VALUES: readonly string[] = [
    '{c, plural, other {{g, select, b {x} a {y} other {#}}} one {{z}}}',
    '{r, select, 2 {two} 10 {ten} 1 {one} other {rest}}',
    '{x, number, zesty} {9x} {y, number, ::currency/} <b>{c, plural, few {f} other {#}}</b>',
  ]

  it.each(VALUES)('lowers %j to the same result twice', (value) => {
    expect(lower(value, icuContext())).toStrictEqual(lower(value, icuContext()))
  })

  it('carries no state from one call into the next', () => {
    const before = lower('{x} {y, number}', icuContext())
    lower('{y} {x, date} {x, number} <x>q</x>', icuContext())
    expect(lower('{x} {y, number}', icuContext())).toStrictEqual(before)
  })
})

describe('very large values', () => {
  it('lowers a 200000 character text value to one text node', () => {
    const value = 'a'.repeat(200_000)
    const result = lower(value, icuContext())
    expect(result.nodes).toStrictEqual([{ kind: 'text', value }])
    expect(result.normalized).toBe(value)
  })

  it('keeps a thousand distinct arguments in first appearance order', () => {
    const names = Array.from({ length: 1000 }, (_, index) => `a${index}`)
    const result = lower(names.map((name) => `{${name}}`).join(' '), icuContext())
    expect(result.args.map((arg) => arg.name)).toStrictEqual(names)
  })

  it('keeps a plural with a hundred exact branches in ascending order', () => {
    const values = Array.from({ length: 100 }, (_, index) => 99 - index)
    const branches = values.map((value) => `=${value} {v${value}}`).join(' ')
    const result = lower(`{c, plural, ${branches} other {o}}`, icuContext())
    const node = first(result)
    const printed = node.kind === 'plural' ? node.exact.map((branch) => branch.value) : []
    expect(printed).toStrictEqual([...values].sort((a, b) => a - b))
  })
})

describe('a date or time skeleton asking for the locale-preferred hour', () => {
  it.each([
    ['{d, time, ::j}', { hour: 'numeric' }],
    ['{d, time, ::jm}', { hour: 'numeric', minute: 'numeric' }],
    ['{d, time, ::jjmm}', { hour: '2-digit', minute: '2-digit' }],
    [
      '{d, date, ::yMMMdjm}',
      { day: 'numeric', hour: 'numeric', minute: 'numeric', month: 'short', year: 'numeric' },
    ],
  ])('resolves %s with the hour and no cycle, so Intl picks the locale cycle', (value, options) => {
    const result = lower(value, icuContext())
    expect(result.diagnostics).toStrictEqual([])
    expect(first(result)).toMatchObject({ format: { kind: 'dateTime' } })
    const node = first(result)
    expect(node.kind === 'dateTime' ? node.format.options : null).toStrictEqual(options)
  })

  it('renders each locale cycle from the one set of options', () => {
    const node = first(lower('{d, time, ::jm}', icuContext()))
    const options = node.kind === 'dateTime' ? node.format.options : {}
    const at = new Date(Date.UTC(2026, 2, 5, 14, 5))
    const format = (locale: string): string =>
      new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(at)
    expect(format('en')).toMatch(/^2:05\sPM$/)
    expect(format('de')).toBe('14:05')
  })

  it.each(['{d, time, ::Jm}', '{d, time, ::Cm}'])(
    'raises LZ2003 for %s and falls back to the bare form instead of dropping the hour',
    (value) => {
      const result = lower(value, icuContext())
      const diagnostic = only(result.diagnostics, 'LZ2003')
      expect(diagnostic.hint).toContain(
        "Write ::jm for the locale's hour with its day period, or ::Hm for a 24-hour clock",
      )
      expect(first(result)).toMatchObject({
        format: { kind: 'dateTime', options: { timeStyle: 'medium' } },
      })
    },
  )

  it('resolves j and rejects J on the probe path after a degraded parse', () => {
    const result = lower('{q, date, ::qqqq} {d, time, ::jm} {e, time, ::Jm}', icuContext())
    expect(codes(result.diagnostics)).toStrictEqual(['LZ2003', 'LZ2003'])
    expect(result.diagnostics[1]?.hint).toContain("Write ::jm for the locale's hour")
    expect(result.nodes[2]).toMatchObject({
      style: '::jm',
      format: { kind: 'dateTime', options: { hour: 'numeric', minute: 'numeric' } },
    })
    expect(result.nodes[4]).toMatchObject({
      style: '::Jm',
      format: { kind: 'dateTime', options: { timeStyle: 'medium' } },
    })
  })

  it('leaves an explicit hour cycle alone', () => {
    const result = lower('{d, time, ::Hm} {d, time, ::hm}', icuContext())
    expect(result.diagnostics).toStrictEqual([])
    expect(result.nodes[0]).toMatchObject({ format: { options: { hourCycle: 'h23' } } })
    expect(result.nodes[2]).toMatchObject({ format: { options: { hourCycle: 'h12' } } })
  })

  it('round trips ::jm as written', () => {
    expect(expectRoundTrip('At {d, time, ::jm}').normalized).toBe('At {d, time, ::jm}')
  })
})
