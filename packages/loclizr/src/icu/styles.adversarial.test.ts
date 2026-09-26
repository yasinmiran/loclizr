import { describe, expect, it } from 'vitest'
import type { Diagnostic } from '../types'
import { stableStringify } from '../util'
import { icuContext, withFormats } from './__fixtures__/context'
import { lower, type LowerResult } from './lower'
import { NAMED_DATE_STYLES, NAMED_NUMBER_STYLES, NAMED_TIME_STYLES } from './styles'

function codes(diagnostics: readonly Diagnostic[]): readonly string[] {
  return diagnostics.map((diagnostic) => diagnostic.code)
}

function resolvedOptions(result: LowerResult): unknown {
  const node = result.nodes[0]
  if (node === undefined || (node.kind !== 'number' && node.kind !== 'dateTime')) {
    throw new Error('the value did not lower to a formatted argument')
  }
  return node.format.options
}

function isPlainRecord(value: unknown): boolean {
  return typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype
}

const INHERITED_NAMES: readonly string[] = [
  'toString',
  'valueOf',
  'constructor',
  'hasOwnProperty',
  'isPrototypeOf',
  '__proto__',
]

describe('a named style that a catalog can only reach through Object.prototype', () => {
  it.each(INHERITED_NAMES)('is an unknown number style: %j', (style) => {
    const result = lower(`{x, number, ${style}}`, icuContext())
    expect(codes(result.diagnostics)).toStrictEqual(['LZ2002'])
    expect(isPlainRecord(resolvedOptions(result))).toBe(true)
    expect(resolvedOptions(result)).toStrictEqual({})
  })

  it.each(INHERITED_NAMES)('is an unknown date style: %j', (style) => {
    const result = lower(`{d, date, ${style}}`, icuContext())
    expect(codes(result.diagnostics)).toStrictEqual(['LZ2002'])
    expect(isPlainRecord(resolvedOptions(result))).toBe(true)
    expect(resolvedOptions(result)).toStrictEqual({ dateStyle: 'medium' })
  })

  it.each(INHERITED_NAMES)('is an unknown time style: %j', (style) => {
    const result = lower(`{d, time, ${style}}`, icuContext())
    expect(codes(result.diagnostics)).toStrictEqual(['LZ2002'])
    expect(isPlainRecord(resolvedOptions(result))).toBe(true)
    expect(resolvedOptions(result)).toStrictEqual({ timeStyle: 'medium' })
  })

  it('stays unknown when the project configures other styles in the same bucket', () => {
    const context = withFormats({ number: { compact: { notation: 'compact' } } })
    const result = lower('{x, number, valueOf}', context)
    expect(codes(result.diagnostics)).toStrictEqual(['LZ2002'])
    expect(isPlainRecord(resolvedOptions(result))).toBe(true)
  })

  it('resolves an option set that survives canonical serialization', () => {
    const result = lower('{x, number, toString}', icuContext())
    expect(stableStringify(resolvedOptions(result))).toBe('{}')
  })

  it('publishes tables that answer only for their own styles', () => {
    expect(Object.hasOwn(NAMED_NUMBER_STYLES, 'toString')).toBe(false)
    expect(Object.hasOwn(NAMED_DATE_STYLES, 'valueOf')).toBe(false)
    expect(Object.hasOwn(NAMED_TIME_STYLES, '__proto__')).toBe(false)
  })
})

interface RejectedSkeleton {
  readonly value: string
  readonly node: 'number' | 'dateTime'
  readonly argType: 'number' | 'date'
  readonly options: Record<string, string | number>
}

const REJECTED_SKELETONS: readonly RejectedSkeleton[] = [
  { value: '{x, number, ::}', node: 'number', argType: 'number', options: {} },
  { value: '{x, number, ::currency/}', node: 'number', argType: 'number', options: {} },
  { value: '{x, number, ::.00/}', node: 'number', argType: 'number', options: {} },
  { value: '{x, number, ::percent scale/}', node: 'number', argType: 'number', options: {} },
  { value: '{x, date, ::}', node: 'dateTime', argType: 'date', options: { dateStyle: 'medium' } },
]

describe('a :: skeleton the parser refuses to tokenize', () => {
  it.each(REJECTED_SKELETONS)('reports $value as an invalid skeleton, not a syntax error', (entry) => {
    const result = lower(entry.value, icuContext())
    expect(codes(result.diagnostics)).toContain('LZ2003')
    expect(codes(result.diagnostics)).not.toContain('LZ2001')
  })

  it.each(REJECTED_SKELETONS)('keeps $value as a usable message', (entry) => {
    const result = lower(entry.value, icuContext())
    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0]).toMatchObject({ kind: entry.node, name: 'x' })
    expect(result.args).toStrictEqual([{ name: 'x', type: { kind: entry.argType } }])
    expect(resolvedOptions(result)).toStrictEqual(entry.options)
  })

  it.each(REJECTED_SKELETONS)('prints $value back as re-parseable ICU', (entry) => {
    const result = lower(entry.value, icuContext())
    const again = lower(result.normalized, icuContext())
    expect(codes(again.diagnostics)).not.toContain('LZ2001')
    expect(again.nodes).toStrictEqual(result.nodes)
  })

  it('reports the rejected skeleton once, whatever else the message holds', () => {
    const result = lower('Due {d, date, ::} and {n, number, ::currency/USD}', icuContext())
    expect(codes(result.diagnostics).filter((code) => code === 'LZ2003')).toHaveLength(1)
  })
})

describe('a :: skeleton the parser tokenizes into nothing usable', () => {
  it.each([
    '{x, number, ::currrency/USD}',
    '{x, number, ::compact-shrt}',
    '{x, number, ::percnt}',
    '{d, date, ::foo}',
  ])('reports %j rather than rendering unformatted', (value) => {
    const result = lower(value, icuContext())
    expect(codes(result.diagnostics)).toStrictEqual(['LZ2003'])
  })

  it('falls back to the bare format for the argument form', () => {
    expect(resolvedOptions(lower('{x, number, ::percnt}', icuContext()))).toStrictEqual({})
    expect(resolvedOptions(lower('{d, date, ::foo}', icuContext()))).toStrictEqual({
      dateStyle: 'medium',
    })
  })

  it('reports a currency skeleton carrying no code, which throws at render time', () => {
    const result = lower('{x, number, ::currency}', icuContext())
    const diagnostic = result.diagnostics[0]
    expect(codes(result.diagnostics)).toStrictEqual(['LZ2003'])
    expect(diagnostic?.hint).toContain('::currency/USD')
    expect(resolvedOptions(result)).toStrictEqual({})
  })

  it('stays quiet for a skeleton whose only option is a false', () => {
    const result = lower('{x, number, ::group-off}', icuContext())
    expect(codes(result.diagnostics)).toStrictEqual([])
    expect(resolvedOptions(result)).toStrictEqual({ useGrouping: false })
  })

  it('keeps the token in the canonical form so a translator sees what is on disk', () => {
    expect(lower('{x, number, ::percnt}', icuContext()).normalized).toBe('{x, number, ::percnt}')
  })
})

describe('the degraded re-parse a rejected skeleton forces', () => {
  it('prints every surviving skeleton token verbatim', () => {
    const value = '{a, number, ::currency/USD} {d, date, ::qqqq}'
    expect(lower(value, icuContext()).normalized).toBe(value)
  })

  it('resolves the surviving skeletons through their own probe', () => {
    const result = lower('{a, number, ::currency/USD} {d, date, ::qqqq}', icuContext())
    expect(result.nodes[0]).toMatchObject({
      format: { kind: 'number', options: { currency: 'USD', style: 'currency' } },
    })
    expect(result.nodes[2]).toMatchObject({
      format: { kind: 'dateTime', options: { dateStyle: 'medium' } },
    })
  })

  it('still merges formats.timeZone into a skeleton it had to degrade', () => {
    const result = lower('{d, date, ::qqqq}', withFormats({ timeZone: 'UTC' }))
    expect(resolvedOptions(result)).toStrictEqual({ dateStyle: 'medium', timeZone: 'UTC' })
  })
})

describe('the built-in style tables', () => {
  it('answer before a configured style of the same name', () => {
    const context = withFormats({
      number: { integer: { maximumFractionDigits: 4 } },
      dateTime: { short: { dateStyle: 'full' } },
    })
    expect(resolvedOptions(lower('{x, number, integer}', context))).toStrictEqual({
      maximumFractionDigits: 0,
    })
    expect(resolvedOptions(lower('{d, date, short}', context))).toStrictEqual({
      dateStyle: 'short',
    })
  })

  it('are never rewritten by a project time zone', () => {
    lower('{d, date, medium}', withFormats({ timeZone: 'UTC' }))
    lower('{d, time, long}', withFormats({ timeZone: 'Asia/Colombo' }))
    expect(NAMED_DATE_STYLES['medium']).toStrictEqual({ dateStyle: 'medium' })
    expect(NAMED_TIME_STYLES['long']).toStrictEqual({ timeStyle: 'long' })
    expect(resolvedOptions(lower('{d, date, medium}', icuContext()))).toStrictEqual({
      dateStyle: 'medium',
    })
  })

  it('yield to a zone a configured style pins for itself', () => {
    const context = withFormats({
      timeZone: 'UTC',
      dateTime: { berlin: { dateStyle: 'short', timeZone: 'Europe/Berlin' } },
    })
    expect(resolvedOptions(lower('{d, date, berlin}', context))).toStrictEqual({
      dateStyle: 'short',
      timeZone: 'Europe/Berlin',
    })
    expect(resolvedOptions(lower('{d, date, medium}', context))).toStrictEqual({
      dateStyle: 'medium',
      timeZone: 'UTC',
    })
  })

  it('give two messages sharing one style the same canonical option bytes', () => {
    const first = resolvedOptions(lower('{a, date, full}', icuContext()))
    const second = resolvedOptions(lower('{b, date, full}', icuContext()))
    expect(stableStringify(first)).toBe(stableStringify(second))
  })
})
