import { describe, expect, it } from 'vitest'
import type { Diagnostic } from '../types'
import { icuContext } from './__fixtures__/context'
import { lower } from './lower'
import { printIcu } from './print'

function codes(diagnostics: readonly Diagnostic[]): readonly string[] {
  return diagnostics.map((diagnostic) => diagnostic.code)
}

function normalize(value: string): string {
  return lower(value, icuContext()).normalized
}

// Every value here parses, so a failure is the canonical form losing meaning
// rather than the parser refusing the input.
const HOSTILE: readonly string[] = [
  "''",
  "'''",
  "''''",
  "'{'",
  "'}'",
  "'{x}'",
  "a'{'b'}'c",
  "'<b>'",
  "'<'b'>'",
  '<b/>',
  '<b />',
  '<b></b>',
  '<b><i></i></b>',
  'A < B and C > D',
  'C# rocks',
  'a#b',
  "#'{'",
  "'#'",
  'Order #42 shipped, cost {amount, number, ::currency/USD}',
  "Don''t {x}",
  'line\nbreak {x}',
  'tab\there {x}',
  'a\uD800b',
  'a\u0000b',
  '‮reversed‬ {x}',
  '​zero width​',
  '𝑥 and 👨‍👩‍👧 {count, plural, one {# family} other {# families}}',
  'café {café}',
  '{ x , number , integer }',
  '{ c , plural , one {a} other {b} }',
  '{x}{y}{z}',
  '{x, number, zesty}',
  '{c, plural, other {a # b}}',
  "{c, plural, other {'#' items}}",
  "{c, plural, other {it''s # here}}",
  '{c, plural, other {<b># files</b>}}',
  "{c, plural, other {<b>'#' and #</b>}}",
  '{c, plural, other {{s, select, other {# raw}}}}',
  '{a, plural, other {{b, plural, other {# and #}}}}',
  '{c, plural, other {}}',
  '{s, select, other {}}',
  '{s, select, __proto__ {a} other {b}}',
  '{s, select, 1e3 {a} other {b}}',
  '{c, plural, =-1 {a} other {b}}',
  '{c, plural, offset:-2 other {#}}',
  '{c, selectordinal, offset:3 =1 {a} few {b} other {c}}',
  '{c, plural, other {o} banana {b} many {m} one {n}}',
  '{d, date, ::yyyyMMdd} {n, number, ::currency/USD}',
  '{a, number, ::currency/USD} {d, date, ::qqqq}',
  '<b>{c, plural, one {# <i>file</i>} other {# <i>files</i>}}</b>',
]

describe('printIcu against text a translator can actually type', () => {
  it.each(HOSTILE)('parses its own output for %j', (value) => {
    const first = lower(value, icuContext())
    expect(codes(first.diagnostics)).not.toContain('LZ2001')

    const printed = printIcu(first.nodes)
    const second = lower(printed, icuContext())
    expect(codes(second.diagnostics)).not.toContain('LZ2001')
  })

  it.each(HOSTILE)('round trips %j', (value) => {
    const first = lower(value, icuContext())
    const printed = printIcu(first.nodes)
    const second = lower(printed, icuContext())

    expect(second.nodes).toStrictEqual(first.nodes)
    expect(second.args).toStrictEqual(first.args)
    expect(second.markupTags).toStrictEqual(first.markupTags)
    expect(second.kind).toBe(first.kind)
    expect(printIcu(second.nodes)).toBe(printed)
  })
})

describe('the canonical form as a translator receives it', () => {
  it('drops the whitespace the parser already ignored', () => {
    expect(normalize('{ x , number , integer }')).toBe('{x, number, integer}')
    expect(normalize('{ c , plural , one {a} other {b} }')).toBe('{c, plural, one {a} other {b}}')
    expect(normalize('{ s , select , a {x} other {y} }')).toBe('{s, select, a {x} other {y}}')
  })

  it('keeps an unknown style token so the message a translator reads is the one on disk', () => {
    expect(normalize('{x, number, zesty}')).toBe('{x, number, zesty}')
    expect(normalize('{x, number, currency}')).toBe('{x, number, currency}')
  })

  it('does not collapse a quoted argument onto a real one', () => {
    expect(normalize("Set '{'color'}' in CSS")).not.toBe(normalize('Set {color} in CSS'))
    expect(normalize("'<b>'x'</b>'")).not.toBe(normalize('<b>x</b>'))
  })

  it('does not collapse two plurals that select differently', () => {
    const exact = '{c, plural, =1 {one thing} other {things}}'
    const keyword = '{c, plural, one {one thing} other {things}}'
    expect(normalize(exact)).not.toBe(normalize(keyword))
  })

  it('keeps a tag shaped literal literal', () => {
    const result = lower("'<b>'not markup'</b>'", icuContext())
    expect(result.kind).toBe('text')
    expect(result.markupTags).toStrictEqual([])
    expect(lower(result.normalized, icuContext()).kind).toBe('text')
  })
})

describe('lower on input no reviewer would write by hand', () => {
  const UNPARSEABLE: readonly string[] = [
    '{',
    '{}',
    '{x',
    '{x,}',
    '{x, plural}',
    '{x, plural, }',
    '{x, select, other}',
    '<b>unclosed',
    '</b>',
    'Line<br>break',
    'Read <a href="/t">terms</a>',
    'Hi {{name}}',
    '{x, number, ::}',
    '{c, plural, one {a} one {b} other {c}}',
    '{c, plural, =1.5 {a} other {b}}',
    '{c, plural, =100000000000000000000000 {a} other {b}}',
    '{c, plural, offset:1.5 other {#}}',
    '{$}',
    '{user.name}',
  ]

  it.each(UNPARSEABLE)('returns a diagnostic rather than throwing for %j', (value) => {
    expect(() => lower(value, icuContext())).not.toThrow()
    const result = lower(value, icuContext())
    expect(result.diagnostics.length).toBeGreaterThan(0)
    expect(result.normalized).toBe(printIcu(result.nodes))
  })

  it('survives nesting deep enough to exhaust a naive walk', () => {
    const tags = '<b>'.repeat(300) + 'x' + '</b>'.repeat(300)
    expect(() => lower(tags, icuContext())).not.toThrow()

    const plurals = '{c, plural, other {'.repeat(200) + 'x' + '}}'.repeat(200)
    expect(() => lower(plurals, icuContext())).not.toThrow()
  })

  it('survives a value of nothing but ICU specials', () => {
    for (const value of ["{{{{", "}}}}", "####", "''''''", "<<<<", "'#{}<'"]) {
      expect(() => lower(value, icuContext())).not.toThrow()
    }
  })
})
