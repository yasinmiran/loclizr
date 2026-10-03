import { describe, expect, it } from 'vitest'
import type { Node } from '../types'
import { icuContext } from './__fixtures__/context'
import { lower } from './lower'
import { printIcu } from './print'

const text = (value: string): Node => ({ kind: 'text', value })

function inPlural(body: readonly Node[]): Node {
  return { kind: 'plural', name: 'c', ordinal: false, offset: 0, exact: [], branches: [{ keyword: 'other', body }] }
}

function inSelect(body: readonly Node[]): Node {
  return { kind: 'select', name: 's', branches: [{ option: 'other', body }] }
}

function inMarkup(children: readonly Node[]): Node {
  return { kind: 'markup', name: 'b', children }
}

function relowered(nodes: readonly Node[]): readonly Node[] {
  return lower(printIcu(nodes), icuContext()).nodes
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

// Text a node can hold after lowering, chosen so every one of them needs the
// escape to do something different from its neighbours.
const AWKWARD_TEXT: readonly string[] = [
  "'",
  "''",
  "'''",
  "a'",
  "'a",
  "'{",
  "}'",
  "'{'",
  '{x}',
  "'{x}'",
  '<',
  '</',
  '<b>',
  '</b>',
  '<b/>',
  '#',
  "'#'",
  "#'",
  "x'y'z",
  "' '",
  "'\n'",
  '{}',
  '}{',
  '<<>>',
  "'''{'''",
  '﻿{',
  'a\u0000{b}',
  '\ud800{',
  "\u{1f44d}'{",
]

describe('printIcu escapes text so the parser reads back the same text', () => {
  it.each(AWKWARD_TEXT)('at the top level: %j', (value) => {
    expect(relowered([text(value)])).toStrictEqual([text(value)])
  })

  it.each(AWKWARD_TEXT)('directly inside a plural body: %j', (value) => {
    expect(relowered([inPlural([text(value)])])).toStrictEqual([inPlural([text(value)])])
  })

  it.each(AWKWARD_TEXT)('inside a select inside a plural: %j', (value) => {
    const nodes = [inPlural([inSelect([text(value)])])]
    expect(relowered(nodes)).toStrictEqual(nodes)
  })

  it.each(AWKWARD_TEXT)('inside markup: %j', (value) => {
    expect(relowered([inMarkup([text(value)])])).toStrictEqual([inMarkup([text(value)])])
  })
})

describe('an apostrophe at the end of one node and syntax at the start of the next', () => {
  const FOLLOWERS: readonly Node[] = [
    { kind: 'arg', name: 'x' },
    inMarkup([text('y')]),
    { kind: 'number', name: 'n', style: null, format: { kind: 'number', options: {} } },
    inSelect([text('z')]),
  ]

  it.each(["a'", "'", "a''", "it's"])('keeps %j from quoting away the node after it', (value) => {
    for (const follower of FOLLOWERS) {
      const nodes = [text(value), follower]
      expect(relowered(nodes)).toStrictEqual(nodes)
    }
  })

  it('keeps a trailing apostrophe from quoting away a pound', () => {
    const nodes = [inPlural([text("a'"), { kind: 'pound' }])]
    expect(printIcu(nodes)).toBe("{c, plural, other {a''#}}")
    expect(relowered(nodes)).toStrictEqual(nodes)
  })

  it('round trips a source that already doubled the apostrophe before an argument', () => {
    const result = lower("it''s{x}", icuContext())
    expect(result.nodes).toStrictEqual([text("it's"), { kind: 'arg', name: 'x' }])
    expect(result.normalized).toBe("it''s{x}")
  })

  it('collapses a triple apostrophe before a brace into one quoted literal', () => {
    const result = lower("'''{x}", icuContext())
    expect(result.nodes).toStrictEqual([text("'{x}")])
    expect(relowered(result.nodes)).toStrictEqual(result.nodes)
  })
})

describe('printIcu treats its input as read only', () => {
  const FROZEN_SOURCE =
    '{c, plural, other {o} =5 {five} one {x} =1 {single} few {f}} {s, select, b {1} other {2} a {3}}'

  it('prints deeply frozen nodes', () => {
    const nodes = deepFreeze(lower(FROZEN_SOURCE, icuContext()).nodes)
    expect(() => printIcu(nodes)).not.toThrow()
  })

  it('does not reorder the caller arrays it sorts for printing', () => {
    const nodes: Node[] = [
      {
        kind: 'plural',
        name: 'c',
        ordinal: false,
        offset: 0,
        exact: [
          { value: 5, body: [text('five')] },
          { value: 1, body: [text('one')] },
        ],
        branches: [
          { keyword: 'other', body: [text('o')] },
          { keyword: 'one', body: [text('x')] },
        ],
      },
      { kind: 'select', name: 's', branches: [{ option: 'other', body: [] }, { option: 'a', body: [] }] },
    ]
    const snapshot = structuredClone(nodes)
    printIcu(nodes)
    expect(nodes).toStrictEqual(snapshot)
  })

  it('prints the same string on every call', () => {
    const nodes = lower(FROZEN_SOURCE, icuContext()).nodes
    expect(printIcu(nodes)).toBe(printIcu(nodes))
  })
})

describe('printIcu on nodes lower never produces but a caller can build', () => {
  it('is never handed two adjacent text nodes by lower, even across quoted runs', () => {
    expect(lower("a'{'b'}'c''d'<'e", icuContext()).nodes).toStrictEqual([text("a{b}c'd<e")])
  })

  it('prints an empty text node as nothing', () => {
    expect(printIcu([text(''), { kind: 'arg', name: 'x' }, text('')])).toBe('{x}')
  })

  it('prints a select whose only branch is other', () => {
    expect(printIcu([inSelect([])])).toBe('{s, select, other {}}')
  })
})
