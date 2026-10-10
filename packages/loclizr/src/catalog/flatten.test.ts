import { describe, expect, it } from 'vitest'
import type { Span } from '../types'
import { flatten } from './flatten'

const SPAN: Span = { line: 1, column: 1, offset: 0, length: 0 }

function run(value: unknown, ns: string | null = null, spans: ReadonlyMap<string, Span> = new Map()) {
  return flatten({ value, file: 'locales/en.json', locale: 'en', ns, spans })
}

describe('flatten', () => {
  it('joins nesting into a dotted key', () => {
    const { entries } = run({ nav: { home: 'Home', cart: 'Cart' } })
    expect(entries.map((entry) => entry.key)).toEqual(['nav.home', 'nav.cart'])
    expect(entries[0]?.value).toBe('Home')
  })

  it('flattens a dotted key to the same shape as the nested form', () => {
    expect(run({ 'nav.home': 'Home' }).entries[0]?.key).toBe('nav.home')
  })

  it('prefixes every key with the namespace segment', () => {
    const { entries } = run({ nav: { home: 'Home' } }, 'common')
    expect(entries[0]?.key).toBe('common.nav.home')
  })

  it('carries the span the scanner recorded for the path', () => {
    const spans = new Map([['nav.home', { line: 3, column: 5, offset: 17, length: 6 }]])
    expect(run({ nav: { home: 'Home' } }, null, spans).entries[0]?.span).toEqual({
      line: 3,
      column: 5,
      offset: 17,
      length: 6,
    })
  })

  it('drops a null leaf with no diagnostic, so it reaches the fallback chain', () => {
    const { entries, diagnostics } = run({ nav: { home: null, cart: 'Cart' } })
    expect(entries.map((entry) => entry.key)).toEqual(['nav.cart'])
    expect(diagnostics).toEqual([])
  })

  it('reports an array leaf and names the deferred escape hatch', () => {
    const { entries, diagnostics } = run({ tips: ['a', 'b'] })
    expect(entries).toEqual([])
    expect(diagnostics.map((one) => one.code)).toEqual(['LZ1010'])
    expect(diagnostics[0]?.hint).toContain('format()')
    expect(diagnostics[0]?.key).toBe('tips')
  })

  it('points formatjs compile --ast output at compiling without --ast', () => {
    const { entries, diagnostics } = run({
      greeting: [
        { type: 0, value: 'Hello, ' },
        { type: 1, value: 'name' },
      ],
    })
    expect(entries).toEqual([])
    expect(diagnostics.map((one) => one.code)).toEqual(['LZ1010'])
    expect(diagnostics[0]?.hint).toContain('without --ast')
    expect(diagnostics[0]?.hint).not.toContain('format()')
  })

  it('keeps the format() hint for an array that is not all AST nodes', () => {
    for (const value of [[], [{ type: 0, value: 'a' }, 'b'], [{ type: 'literal' }], [[{ type: 0 }]]]) {
      expect(run({ tips: value }).diagnostics[0]?.hint).toContain('format()')
    }
  })

  it('reports a leaf that is neither a string, an object nor null', () => {
    expect(run({ count: 3 }).diagnostics.map((one) => one.code)).toEqual(['LZ1010'])
    expect(run({ on: true }).diagnostics.map((one) => one.code)).toEqual(['LZ1010'])
  })

  it('reports a root that is not an object', () => {
    for (const value of ['text', ['a'], null, undefined, 7]) {
      expect(run(value).diagnostics.map((one) => one.code)).toEqual(['LZ1010'])
    }
  })

  it('reports a formatjs extract record instead of shipping its fields as messages', () => {
    const { entries, diagnostics } = run({
      cart: { checkout: { defaultMessage: 'Check out', description: 'Button on the cart page' } },
    })
    expect(entries).toEqual([])
    expect(diagnostics.map((one) => one.code)).toEqual(['LZ1010'])
    expect(diagnostics[0]?.key).toBe('cart.checkout')
    expect(diagnostics[0]?.message).toContain('formatjs extract')
    expect(diagnostics[0]?.hint).toContain('formatjs compile')
    expect(diagnostics[0]?.hint).toContain('meta sidecar')
  })

  it('reports an extract record once, whatever shape its description or location fields take', () => {
    const { entries, diagnostics } = run({
      'cart.checkout': {
        id: 'cart.checkout',
        defaultMessage: 'Check out',
        description: { text: 'Button on the cart page', maxLength: 20 },
        file: 'src/Cart.tsx',
        start: 120,
        end: 180,
        line: 7,
        col: 4,
      },
      'cart.total': { defaultMessage: 'Total' },
    })
    expect(entries).toEqual([])
    expect(diagnostics.map((one) => one.key)).toEqual(['cart.checkout', 'cart.total'])
  })

  it('still nests an object with a key no extract writes, or a defaultMessage that is not a string', () => {
    const { entries, diagnostics } = run({
      form: { defaultMessage: 'Save', label: 'Name' },
      errors: { defaultMessage: { title: 'Oops' } },
    })
    expect(entries.map((entry) => entry.key)).toEqual([
      'form.defaultMessage',
      'form.label',
      'errors.defaultMessage.title',
    ])
    expect(diagnostics).toEqual([])
  })

  it('keeps the last of two colliding keys, as JSON itself does', () => {
    const { entries } = run({ 'nav.home': 'dotted', nav: { home: 'nested' } })
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ key: 'nav.home', value: 'nested' })
  })

  it('produces nothing for an empty object leaf', () => {
    expect(run({ nav: {} }).entries).toEqual([])
  })

  it('keeps an empty string, which is a message that lowers to zero nodes', () => {
    expect(run({ blank: '' }).entries).toEqual([{ key: 'blank', value: '', span: SPAN }])
  })
})
