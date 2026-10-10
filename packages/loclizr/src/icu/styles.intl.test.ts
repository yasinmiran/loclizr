import { describe, expect, it } from 'vitest'
import type { Diagnostic } from '../types'
import { icuContext } from './__fixtures__/context'
import { lower, type LowerResult } from './lower'

function codes(diagnostics: readonly Diagnostic[]): readonly string[] {
  return diagnostics.map((diagnostic) => diagnostic.code)
}

function optionsAt(result: LowerResult, index: number): Record<string, unknown> {
  const node = result.nodes[index]
  if (node === undefined || (node.kind !== 'number' && node.kind !== 'dateTime')) {
    throw new Error('the value did not lower to a formatted argument')
  }
  return { ...node.format.options }
}

describe('a :: skeleton that resolves to options Intl cannot build', () => {
  it.each([
    '{n, number, ::unit/furlong}',
    '{n, number, ::currency/US}',
    '{n, number, ::measure-unit/consumption-liter-per-100-kilometer}',
  ])('reports %j and falls back to the bare number format', (value) => {
    const result = lower(value, icuContext())
    expect(codes(result.diagnostics)).toStrictEqual(['LZ2003'])
    expect(result.diagnostics[0]?.fatal).toBe(false)
    expect(optionsAt(result, 0)).toStrictEqual({})
    expect(result.normalized).toBe(value)
  })

  it('names the skeleton and the Intl constructor that refused it', () => {
    const diagnostic = lower('{n, number, ::currency/US}', icuContext()).diagnostics[0]
    expect(diagnostic?.message).toContain('::currency/US')
    expect(diagnostic?.message).toContain('Intl.NumberFormat')
  })

  it('probes a skeleton that only resolved through the degraded re-parse', () => {
    const result = lower('{n, number, ::unit/furlong} {d, date, ::qqqq}', icuContext())
    expect(codes(result.diagnostics)).toStrictEqual(['LZ2003', 'LZ2003'])
    expect(optionsAt(result, 0)).toStrictEqual({})
  })

  it('never emits options that make Intl throw', () => {
    for (const value of [
      '{n, number, ::unit/furlong}',
      '{n, number, ::currency/US}',
      '{n, number, ::unit/kilometer-per-hour}',
      '{n, number, ::unit/meter-per-second}',
    ]) {
      const options = optionsAt(lower(value, icuContext()), 0)
      expect(() => new Intl.NumberFormat('en', options).format(90)).not.toThrow()
    }
  })
})

describe('the unit/ stem, which takes a core unit id with no type prefix', () => {
  it.each([
    ['{n, number, ::unit/kilometer-per-hour}', 'kilometer-per-hour', '90 km/h'],
    ['{n, number, ::unit/meter-per-second}', 'meter-per-second', '90 m/s'],
    ['{n, number, ::unit/fluid-ounce}', 'fluid-ounce', '90 fl oz'],
  ])('keeps the whole id of %j', (value, unit, rendered) => {
    const result = lower(value, icuContext())
    expect(codes(result.diagnostics)).toStrictEqual([])
    expect(optionsAt(result, 0)).toStrictEqual({ style: 'unit', unit })
    expect(new Intl.NumberFormat('en', optionsAt(result, 0)).format(90)).toBe(rendered)
  })

  it('keeps the whole id through the degraded re-parse too', () => {
    const result = lower('{n, number, ::unit/kilometer-per-hour} {d, date, ::qqqq}', icuContext())
    expect(optionsAt(result, 0)).toStrictEqual({ style: 'unit', unit: 'kilometer-per-hour' })
  })

  it('leaves measure-unit/, which does carry the type prefix, as the parser resolves it', () => {
    const result = lower('{n, number, ::measure-unit/speed-kilometer-per-hour}', icuContext())
    expect(codes(result.diagnostics)).toStrictEqual([])
    expect(optionsAt(result, 0)).toStrictEqual({ style: 'unit', unit: 'kilometer-per-hour' })
  })
})

describe('a unit paired with per-measure-unit/', () => {
  it.each([
    [
      '{n, number, ::measure-unit/length-meter per-measure-unit/duration-second}',
      'meter-per-second',
      '5 m/s',
    ],
    [
      '{n, number, ::measure-unit/length-kilometer per-measure-unit/duration-hour}',
      'kilometer-per-hour',
      '5 km/h',
    ],
    ['{n, number, ::unit/kilometer per-measure-unit/duration-hour}', 'kilometer-per-hour', '5 km/h'],
  ])('composes %j into one compound unit id', (value, unit, rendered) => {
    const result = lower(value, icuContext())
    expect(codes(result.diagnostics)).toStrictEqual([])
    expect(optionsAt(result, 0)).toStrictEqual({ style: 'unit', unit })
    expect(new Intl.NumberFormat('en', optionsAt(result, 0)).format(5)).toBe(rendered)
  })

  it('composes the pair through the degraded re-parse too', () => {
    const result = lower(
      '{n, number, ::measure-unit/length-meter per-measure-unit/duration-second} {d, date, ::qqqq}',
      icuContext(),
    )
    expect(optionsAt(result, 0)).toStrictEqual({ style: 'unit', unit: 'meter-per-second' })
  })

  it('reports a pair Intl does not support and falls back to the bare number format', () => {
    const result = lower(
      '{n, number, ::measure-unit/length-meter per-measure-unit/duration-fortnight}',
      icuContext(),
    )
    expect(codes(result.diagnostics)).toStrictEqual(['LZ2003'])
    expect(result.diagnostics[0]?.message).toContain('Intl.NumberFormat')
    expect(optionsAt(result, 0)).toStrictEqual({})
  })

  it.each([
    '{n, number, ::per-measure-unit/duration-hour}',
    '{n, number, ::percent per-measure-unit/duration-hour}',
    '{n, number, ::per-measure-unit/duration-hour .00}',
  ])('reports %j, a per-measure-unit/ with no unit, instead of dropping it', (value) => {
    const result = lower(value, icuContext())
    expect(codes(result.diagnostics)).toStrictEqual(['LZ2003'])
    expect(result.diagnostics[0]?.message).toContain('no unit to divide')
    expect(optionsAt(result, 0)).toStrictEqual({})
  })

  it('reports a per-measure-unit/ with no unit through the degraded re-parse too', () => {
    const result = lower(
      '{n, number, ::percent per-measure-unit/duration-hour} {d, date, ::qqqq}',
      icuContext(),
    )
    expect(codes(result.diagnostics)).toStrictEqual(['LZ2003', 'LZ2003'])
    expect(result.diagnostics.map((diagnostic) => diagnostic.message)).toContainEqual(
      expect.stringContaining('no unit to divide'),
    )
    expect(optionsAt(result, 0)).toStrictEqual({})
  })
})
