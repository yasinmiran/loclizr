import { describe, expect, it } from 'vitest'
import type { Diagnostic } from '../types'
import { icuContext } from './__fixtures__/context'
import { lower } from './lower'

function codes(diagnostics: readonly Diagnostic[]): readonly string[] {
  return diagnostics.map((diagnostic) => diagnostic.code)
}

function count(diagnostics: readonly Diagnostic[], code: string): number {
  return diagnostics.filter((diagnostic) => diagnostic.code === code).length
}

const SAME_VALUE_TWICE: readonly string[] = [
  '{c, plural, =0 {a} =00 {b} other {c}}',
  '{c, plural, =1 {a} =+1 {b} other {c}}',
  '{c, selectordinal, =2 {a} =002 {b} other {c}}',
]

describe('two exact branches the parser accepts for one numeric value', () => {
  it.each(SAME_VALUE_TWICE)('prints %j as ICU that parses again', (value) => {
    const first = lower(value, icuContext())
    expect(codes(first.diagnostics)).not.toContain('LZ2001')

    const second = lower(first.normalized, icuContext())
    expect(codes(second.diagnostics)).not.toContain('LZ2001')
  })

  it.each(SAME_VALUE_TWICE)('round trips %j through its canonical form', (value) => {
    const first = lower(value, icuContext())
    const second = lower(first.normalized, icuContext())
    expect(second.nodes).toStrictEqual(first.nodes)
    expect(second.normalized).toBe(first.normalized)
  })

  it('keeps the branch a reader would see selected first', () => {
    const result = lower('{c, plural, =0 {first} =00 {second} other {rest}}', icuContext())
    expect(result.normalized).toContain('=0 {first}')
    expect(result.normalized).not.toContain('=0 {second}')
  })
})

describe('exact branch values a catalog can legally write', () => {
  it('orders them by number rather than by text', () => {
    const result = lower('{c, plural, =10 {a} =2 {b} =-1 {c} other {d}}', icuContext())
    expect(result.normalized).toBe('{c, plural, =-1 {c} =2 {b} =10 {a} other {d}}')
  })

  it('round trips a negative exact branch', () => {
    const result = lower('{c, plural, =-1 {owed} other {rest}}', icuContext())
    expect(lower(result.normalized, icuContext()).nodes).toStrictEqual(result.nodes)
  })

  it('round trips a negative offset', () => {
    const result = lower('{c, plural, offset:-2 other {#}}', icuContext())
    expect(result.nodes[0]).toMatchObject({ offset: -2 })
    expect(result.normalized).toBe('{c, plural, offset:-2 other {#}}')
    expect(lower(result.normalized, icuContext()).nodes).toStrictEqual(result.nodes)
  })

  it('prints offset before the first branch of a selectordinal', () => {
    const value = '{c, selectordinal, offset:3 =1 {a} few {b} other {c}}'
    const result = lower(value, icuContext())
    expect(result.normalized).toBe(value)
  })
})

describe('a branch keyword no locale has', () => {
  it('reports a prototype shaped keyword and keeps the branch', () => {
    const result = lower('{c, plural, __proto__ {a} other {b}}', icuContext())
    expect(codes(result.diagnostics)).toStrictEqual(['LZ2006'])
    expect(result.nodes[0]).toMatchObject({
      branches: [{ keyword: '__proto__' }, { keyword: 'other' }],
    })
    expect(result.normalized).toBe('{c, plural, __proto__ {a} other {b}}')
  })

  it('prints an invented keyword after every CLDR category and before other', () => {
    const result = lower('{c, plural, other {o} banana {b} many {m} one {n}}', icuContext())
    expect(result.normalized).toBe('{c, plural, one {n} many {m} banana {b} other {o}}')
    expect(count(result.diagnostics, 'LZ2006')).toBe(1)
  })

  it('reports every invented keyword in one message', () => {
    const result = lower('{c, plural, banana {a} kumquat {b} other {c}}', icuContext())
    expect(count(result.diagnostics, 'LZ2006')).toBe(2)
  })

  it('rejects a repeated keyword the way the parser does', () => {
    const result = lower('{c, plural, one {a} one {b} other {c}}', icuContext())
    expect(codes(result.diagnostics)).toStrictEqual(['LZ2001'])
    expect(result.nodes).toStrictEqual([])
    expect(result.diagnostics[0]?.fatal).toBe(false)
  })
})

describe('the pound the parser demotes to text', () => {
  it('reports every literal # a nested select swallowed', () => {
    const value = '{c, plural, other {{a, select, x {{b, select, y {#} other {#}}} other {#}}}}'
    const result = lower(value, icuContext())
    expect(count(result.diagnostics, 'LZ2008')).toBe(3)
    expect(result.normalized).toBe(value)
  })

  it('leaves # inside markup inside a plural as the count', () => {
    const value = '{c, plural, other {<b># files</b>}}'
    const result = lower(value, icuContext())
    expect(codes(result.diagnostics)).toStrictEqual([])
    expect(result.normalized).toBe(value)
  })

  it('demotes # inside markup inside a select inside a plural', () => {
    const value = '{c, plural, other {{s, select, other {<b># x</b>}}}}'
    const result = lower(value, icuContext())
    expect(count(result.diagnostics, 'LZ2008')).toBe(1)
    expect(result.normalized).toBe(value)
  })

  it('reads # in a nested plural as the inner selector', () => {
    const value = '{a, plural, other {{b, plural, other {# and #}}}}'
    const result = lower(value, icuContext())
    expect(codes(result.diagnostics)).toStrictEqual([])
    expect(result.normalized).toBe(value)
    expect(lower(result.normalized, icuContext()).nodes).toStrictEqual(result.nodes)
  })

  it('names the enclosing selector in the hint, not an outer one', () => {
    const result = lower('{outer, plural, other {{s, select, other {#}}}}', icuContext())
    expect(result.diagnostics[0]?.hint).toContain('{outer, number}')
  })
})

describe('an empty plural or select body', () => {
  it.each(['{c, plural, other {}}', '{s, select, other {}}', '{c, plural, =0 {} other {x}}'])(
    'round trips %j',
    (value) => {
      const result = lower(value, icuContext())
      expect(codes(result.diagnostics)).not.toContain('LZ2001')
      const again = lower(result.normalized, icuContext())
      expect(codes(again.diagnostics)).not.toContain('LZ2001')
      expect(again.nodes).toStrictEqual(result.nodes)
    },
  )
})

describe('a select option shaped like something else', () => {
  it('keeps a prototype shaped option in the type union', () => {
    const result = lower('{s, select, __proto__ {a} other {b}}', icuContext())
    expect(codes(result.diagnostics)).toStrictEqual([])
    expect(result.args).toStrictEqual([
      { name: 's', type: { kind: 'select', options: ['__proto__'] } },
    ])
    expect(result.normalized).toBe('{s, select, __proto__ {a} other {b}}')
  })

  it('keeps the author order of options the parser reordered as array indices', () => {
    const result = lower('{r, select, 2 {two} 10 {ten} 1 {one} other {rest}}', icuContext())
    expect(result.normalized).toBe('{r, select, 2 {two} 10 {ten} 1 {one} other {rest}}')
    expect(result.args[0]?.type).toStrictEqual({ kind: 'select', options: ['2', '10', '1'] })
  })
})
