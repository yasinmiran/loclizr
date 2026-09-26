import { describe, expect, it } from 'vitest'
import type { Node } from '../types'
import { hash16 } from '../util'
import { icuContext } from './__fixtures__/context'
import { lower } from './lower'
import { printIcu } from './print'

const bare = (value: string): Node => ({ kind: 'text', value })

function normalize(icu: string): string {
  return printIcu(lower(icu, icuContext()).nodes)
}

describe('printIcu', () => {
  it('prints nothing for no nodes', () => {
    expect(printIcu([])).toBe('')
  })

  it('separates the name and the type keyword with exactly one comma and space', () => {
    expect(
      printIcu([
        {
          kind: 'number',
          name: 'amount',
          style: '::currency/USD',
          format: { kind: 'number', options: { currency: 'USD', style: 'currency' } },
        },
      ]),
    ).toBe('{amount, number, ::currency/USD}')
    expect(
      printIcu([
        { kind: 'number', name: 'n', style: null, format: { kind: 'number', options: {} } },
      ]),
    ).toBe('{n, number}')
  })

  it('prints the date and time forms apart', () => {
    expect(
      printIcu([
        {
          kind: 'dateTime',
          name: 'at',
          form: 'time',
          style: 'short',
          format: { kind: 'dateTime', options: { timeStyle: 'short' } },
        },
      ]),
    ).toBe('{at, time, short}')
    expect(
      printIcu([
        {
          kind: 'dateTime',
          name: 'at',
          form: 'date',
          style: null,
          format: { kind: 'dateTime', options: { dateStyle: 'medium' } },
        },
      ]),
    ).toBe('{at, date}')
  })

  it('orders exact branches ascending and keyword branches in CLDR order', () => {
    const node: Node = {
      kind: 'plural',
      name: 'c',
      ordinal: false,
      offset: 0,
      exact: [
        { value: 7, body: [bare('seven')] },
        { value: 0, body: [bare('none')] },
      ],
      branches: [
        { keyword: 'other', body: [bare('many')] },
        { keyword: 'few', body: [bare('few')] },
        { keyword: 'one', body: [bare('one')] },
        { keyword: 'zero', body: [bare('zero')] },
      ],
    }
    expect(printIcu([node])).toBe(
      '{c, plural, =0 {none} =7 {seven} zero {zero} one {one} few {few} other {many}}',
    )
  })

  it('prints offset only when it is not zero, right after the type keyword', () => {
    const body: Node[] = [{ kind: 'pound' }]
    const withOffset: Node = {
      kind: 'plural',
      name: 'c',
      ordinal: true,
      offset: 2,
      exact: [],
      branches: [{ keyword: 'other', body }],
    }
    expect(printIcu([withOffset])).toBe('{c, selectordinal, offset:2 other {#}}')
    expect(printIcu([{ ...withOffset, offset: 0 }])).toBe('{c, selectordinal, other {#}}')
  })

  it('keeps select branches in their given order with other last', () => {
    const node: Node = {
      kind: 'select',
      name: 's',
      branches: [
        { option: 'other', body: [bare('o')] },
        { option: 'shipped', body: [bare('s')] },
        { option: 'delivered', body: [bare('d')] },
      ],
    }
    expect(printIcu([node])).toBe('{s, select, shipped {s} delivered {d} other {o}}')
  })

  it('wraps markup children in the tag', () => {
    const nested: Node = {
      kind: 'markup',
      name: 'b',
      children: [bare('bold '), { kind: 'markup', name: 'i', children: [bare('and italic')] }],
    }
    expect(printIcu([nested])).toBe('<b>bold <i>and italic</i></b>')
  })

  it('escapes ICU syntax in text so the output re-parses', () => {
    expect(printIcu([bare("Don't stop")])).toBe("Don''t stop")
    expect(printIcu([bare('Set {color} in CSS')])).toBe("Set '{'color'}' in CSS")
    expect(printIcu([bare('A < B')])).toBe("A '<' B")
    expect(normalize("Don't stop")).toBe("Don''t stop")
    expect(normalize('A < B')).toBe("A '<' B")
  })

  it('leaves # alone outside a plural body and quotes it inside one', () => {
    expect(normalize('Order #42 shipped')).toBe('Order #42 shipped')
    expect(printIcu([bare('#')])).toBe('#')
    const node: Node = {
      kind: 'plural',
      name: 'c',
      ordinal: false,
      offset: 0,
      exact: [],
      branches: [{ keyword: 'other', body: [bare('# of them')] }],
    }
    expect(printIcu([node])).toBe("{c, plural, other {'#' of them}}")
  })

  it('leaves # alone inside a select, which is where the parser demotes it', () => {
    const node: Node = {
      kind: 'plural',
      name: 'a',
      ordinal: false,
      offset: 1,
      exact: [],
      branches: [
        {
          keyword: 'other',
          body: [
            { kind: 'pound' },
            bare(' and '),
            {
              kind: 'select',
              name: 'b',
              branches: [
                { option: 'x', body: [bare('#')] },
                { option: 'other', body: [bare('#')] },
              ],
            },
          ],
        },
      ],
    }
    expect(printIcu([node])).toBe('{a, plural, offset:1 other {# and {b, select, x {#} other {#}}}}')
  })

  it('reproduces the source strings the record hashes', () => {
    expect(normalize('Home')).toBe('Home')
    expect(hash16(normalize('Home'))).toBe('3a78695388b38b5c')
    const items =
      '{count, plural, =0 {Your cart is empty} one {# item in your cart} other {# items in your cart}}'
    expect(normalize(items)).toBe(items)
    expect(hash16(normalize(items))).toBe('a826cf6a40d3293e')
  })

  it('prints one canonical form for an i18next plural and its ICU twin', () => {
    const converted = '{count, plural, =0 {leer} one {{count} Artikel} other {{count} Artikel}}'
    const icuNative = '{count, plural, one {{count} Artikel} =0 {leer} other {{count} Artikel}}'
    expect(normalize(converted)).toBe(normalize(icuNative))
  })
})
