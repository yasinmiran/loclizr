import { describe, expect, it } from 'vitest'
import type { Diagnostic } from '../types'
import { icuContext } from './__fixtures__/context'
import { lower } from './lower'

function codes(diagnostics: readonly Diagnostic[]): readonly string[] {
  return diagnostics.map((diagnostic) => diagnostic.code)
}

const NFD_CAFE = 'café'
const NFC_CAFE = 'café'

describe('an argument name the parser accepts but JavaScript would not', () => {
  it.each([
    ['an Arabic-Indic digit', '١'],
    ['a digit first', '9x'],
    ['a combining mark first', '́x'],
    ['a fullwidth digit', '９'],
  ])('reports %s', (_label, name) => {
    const result = lower(`{${name}}`, icuContext())
    expect(codes(result.diagnostics)).toStrictEqual(['LZ2007'])
  })

  it.each([
    ['an astral letter', '\u{1d465}'],
    ['a Latin letter with an accent', 'café'],
    ['a Cyrillic word', 'имя'],
    ['a CJK word', '名前'],
    ['a leading underscore', '_x'],
    ['a zero width joiner', 'x‍'],
  ])('accepts %s', (_label, name) => {
    const result = lower(`{${name}}`, icuContext())
    expect(codes(result.diagnostics)).toStrictEqual([])
    expect(result.args).toStrictEqual([{ name, type: { kind: 'stringish' } }])
    expect(result.normalized).toBe(`{${name}}`)
  })

  it.each(['if', 'class', 'new', 'default', 'then', 'constructor', 'toString'])(
    'leaves the identifier question to the generator for %j',
    (name) => {
      expect(codes(lower(`{${name}}`, icuContext()).diagnostics)).toStrictEqual([])
    },
  )

  it('reports one invalid name once however many branches use it', () => {
    const result = lower('{c, plural, one {{9x}} other {{9x} {9x}}}', icuContext())
    expect(codes(result.diagnostics)).toStrictEqual(['LZ2007'])
  })

  it('reports an invalid markup tag name once', () => {
    const result = lower('<my-tag>a</my-tag> and <my-tag>b</my-tag>', icuContext())
    expect(codes(result.diagnostics)).toStrictEqual(['LZ2007'])
    expect(result.markupTags).toStrictEqual(['my-tag'])
  })

  it('does not apply the name rule to a select option', () => {
    const result = lower('{s, select, 9x {a} __proto__ {b} other {c}}', icuContext())
    expect(codes(result.diagnostics)).toStrictEqual([])
  })
})

describe('Unicode normalization of argument names', () => {
  it('folds an NFD spelling onto its NFC twin inside one value', () => {
    const result = lower(`{${NFD_CAFE}} and {${NFC_CAFE}}`, icuContext())
    expect(result.args).toStrictEqual([{ name: NFC_CAFE, type: { kind: 'stringish' } }])
  })

  it('prints the NFC spelling, so two catalogs that differ only by form agree', () => {
    expect(lower(`{${NFD_CAFE}}`, icuContext()).normalized).toBe(
      lower(`{${NFC_CAFE}}`, icuContext()).normalized,
    )
  })

  it('normalizes a name that first appears inside a plural branch', () => {
    const result = lower(
      `{c, plural, other {{${NFD_CAFE}}} one {{${NFC_CAFE}}}}`,
      icuContext(),
    )
    expect(result.args.map((arg) => arg.name)).toStrictEqual(['c', NFC_CAFE])
  })

  it('leaves text alone, because only names become identifiers', () => {
    const result = lower(`${NFD_CAFE} au lait`, icuContext())
    expect(result.nodes).toStrictEqual([{ kind: 'text', value: `${NFD_CAFE} au lait` }])
  })

  it('keeps names that differ by case apart', () => {
    const result = lower('{x} and {X}', icuContext())
    expect(result.args.map((arg) => arg.name)).toStrictEqual(['x', 'X'])
  })

  it('trims the whitespace the parser already trimmed', () => {
    expect(lower('{ x }', icuContext()).args).toStrictEqual([
      { name: 'x', type: { kind: 'stringish' } },
    ])
    expect(lower('{ x }', icuContext()).normalized).toBe('{x}')
  })
})

describe('markup tags as arguments', () => {
  it('sorts the tag set by code point, not by case-insensitive order', () => {
    const result = lower('<i>a</i><b>b</b><B>c</B><I>d</I>', icuContext())
    expect(result.markupTags).toStrictEqual(['B', 'I', 'b', 'i'])
  })

  it('registers a tag before the arguments inside it', () => {
    const result = lower('<link>{inner}</link> {outer}', icuContext())
    expect(result.args.map((arg) => arg.name)).toStrictEqual(['link', 'inner', 'outer'])
  })

  it('narrows a plain argument of the same name to the tag', () => {
    const result = lower('{link} then <link>terms</link>', icuContext())
    expect(codes(result.diagnostics)).toStrictEqual([])
    expect(result.args).toStrictEqual([{ name: 'link', type: { kind: 'markup' } }])
    expect(result.kind).toBe('markup')
    expect(result.markupTags).toStrictEqual(['link'])
  })

  it('reaches the same type with the tag first', () => {
    const result = lower('<link>terms</link> then {link}', icuContext())
    expect(codes(result.diagnostics)).toStrictEqual([])
    expect(result.args).toStrictEqual([{ name: 'link', type: { kind: 'markup' } }])
  })

  it('refuses to reconcile a tag with a formatted argument', () => {
    const result = lower('{n, number} then <n>x</n>', icuContext())
    expect(codes(result.diagnostics)).toStrictEqual(['LZ2009'])
    expect(result.args).toStrictEqual([{ name: 'n', type: { kind: 'number' } }])
  })

  it('counts a tag only once for kind, however deeply it nests', () => {
    const result = lower('<b>a<b>b</b></b>', icuContext())
    expect(result.markupTags).toStrictEqual(['b'])
    expect(result.args).toStrictEqual([{ name: 'b', type: { kind: 'markup' } }])
  })
})
