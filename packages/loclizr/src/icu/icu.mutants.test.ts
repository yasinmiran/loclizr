import { describe, expect, it } from 'vitest'
import type { Diagnostic, IntlOptions } from '../types'
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

function resolvedOptions(result: LowerResult): IntlOptions | null {
  const node = result.nodes[0]
  if (node === undefined || (node.kind !== 'number' && node.kind !== 'dateTime')) return null
  return node.format.options
}

describe('a rejected skeleton beside another problem', () => {
  // The skeleton is fatal never, so it must not mask the select's missing other
  // behind an LZ2001 the author cannot act on.
  it('reports the missing other branch, not a syntax error', () => {
    const result = lower('{d, date, ::qqqq} {s, select, a {x}}', icuContext())
    expect(codes(result.diagnostics)).toContain('LZ2005')
    expect(codes(result.diagnostics)).not.toContain('LZ2001')
  })
})

describe('the span of each rejected skeleton', () => {
  it('starts at its own :: and keeps every later offset where the value put it', () => {
    const value = '{a, number, ::currency/} {b, number, ::currency/}'
    const result = lower(value, icuContext())
    const offsets = result.diagnostics.map((diagnostic) => diagnostic.span?.offset)
    expect(offsets).toStrictEqual([
      SPAN.offset + value.indexOf('::'),
      SPAN.offset + value.lastIndexOf('::'),
    ])
  })
})

describe('a time argument whose skeleton the tokenizer refuses', () => {
  it('raises LZ2003 and falls back to the bare time format', () => {
    const result = lower('{t, time, ::}', icuContext())
    expect(codes(result.diagnostics)).toStrictEqual(['LZ2003'])
    expect(result.nodes[0]).toMatchObject({ kind: 'dateTime', form: 'time', name: 't' })
    expect(resolvedOptions(result)).toStrictEqual({ timeStyle: 'medium' })
    expect(result.normalized).toBe('{t, time}')
  })
})

describe('a quoted # in an exact plural branch', () => {
  // Unquoted, the reprint would turn the literal character into the count.
  it('prints back quoted, so the reparse still reads it as text', () => {
    const value = "{c, plural, =0 {a'#'b} other {x}}"
    const result = lower(value, icuContext())
    expect(result.normalized).toBe(value)
    expect(lower(result.normalized, icuContext()).nodes).toStrictEqual(result.nodes)
  })
})

describe('two keywords the catalog invented', () => {
  it('keeps them in source order and survives the round trip unchanged', () => {
    const once = lower('{c, plural, foo {a} bar {b} other {c}}', icuContext())
    expect(once.normalized).toBe('{c, plural, foo {a} bar {b} other {c}}')
    const twice = lower(once.normalized, icuContext())
    expect(twice.nodes).toStrictEqual(once.nodes)
    expect(twice.normalized).toBe(once.normalized)
  })
})

describe('a literal # inside a select inside a plural', () => {
  it('names the nested select in the hint', () => {
    const result = lower('{c, plural, other {{s, select, other {#}}}}', icuContext())
    expect(only(result.diagnostics, 'LZ2008').hint).toContain('nested select')
  })
})

describe('the construct a missing other branch is reported against', () => {
  it('calls a plural a plural', () => {
    const result = lower('{c, plural, one {x}}', icuContext())
    const diagnostic = only(result.diagnostics, 'LZ2004')
    expect(diagnostic.message).toContain('plural')
    expect(diagnostic.message).not.toContain('select')
  })

  it('calls a select a select', () => {
    const result = lower('{s, select, a {x}}', icuContext())
    const diagnostic = only(result.diagnostics, 'LZ2005')
    expect(diagnostic.message).toContain('select')
    expect(diagnostic.message).not.toContain('plural')
  })
})
