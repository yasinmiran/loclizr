import { describe, expect, it } from 'vitest'
import { printIcu } from '../icu'
import type { ExactBranch, Node, PluralBranch, RecordVariant, SelectBranch } from '../types'
import { message, program } from './__fixtures__/program'
import { buildRecord } from './index'

type BranchArrival = number | string

// Two invented keywords, not one: they rank equal, so the order they arrive in
// is the only thing that can separate them, on either side of the comparison.
const PLURAL_ARRIVAL: readonly BranchArrival[] = [
  7,
  'other',
  0,
  'wibble',
  'many',
  2,
  'few',
  'bogus',
  'two',
  'one',
  'zero',
]

const SELECT_ARRIVAL: readonly string[] = ['other', 'shipped', 'delivered', 'held']

const CANONICAL_PLURAL: readonly string[] = [
  '=0',
  '=2',
  '=7',
  'zero',
  'one',
  'two',
  'few',
  'many',
  'wibble',
  'bogus',
  'other',
]

const CANONICAL_SELECT: readonly string[] = ['shipped', 'delivered', 'held', 'other']

// Every branch body is empty, so the sequence printIcu chose reads back out of
// its own output without a second ICU parser living in this file.
const PRINTED_SELECTOR = /(?:^|\s)([^\s{}]+) \{\}/gu

function printedSelectors(printed: string): readonly string[] {
  const selectors: string[] = []
  for (const match of printed.matchAll(PRINTED_SELECTOR)) {
    const selector = match[1]
    if (selector !== undefined) selectors.push(selector)
  }
  return selectors
}

function selectorsOf(node: Node): readonly string[] {
  return printedSelectors(printIcu([node]))
}

function variantsOf(node: Node): readonly RecordVariant[] {
  const nodes: readonly Node[] = [node]
  const record = buildRecord(
    program({
      messages: [message({ key: 'a', id: 'a', namespace: 'n', source: printIcu(nodes), nodes })],
    }),
  )
  return record.messages[0]?.variants ?? []
}

function pluralOf(
  arrival: readonly BranchArrival[],
  shape: { readonly ordinal: boolean; readonly offset: number },
): Node {
  const exact: ExactBranch[] = []
  const branches: PluralBranch[] = []
  for (const entry of arrival) {
    if (typeof entry === 'number') exact.push({ value: entry, body: [] })
    else branches.push({ keyword: entry, body: [] })
  }
  return {
    kind: 'plural',
    name: 'count',
    ordinal: shape.ordinal,
    offset: shape.offset,
    exact,
    branches,
  }
}

function selectOf(arrival: readonly string[]): Node {
  const branches: readonly SelectBranch[] = arrival.map((option) => ({ option, body: [] }))
  return { kind: 'select', name: 'state', branches }
}

function arrivals<T>(values: readonly T[]): readonly { readonly arrival: readonly T[] }[] {
  return values.flatMap((_, at) => {
    const rotated = [...values.slice(at), ...values.slice(0, at)]
    return [{ arrival: rotated }, { arrival: [...rotated].reverse() }]
  })
}

describe('RecordVariant.matches and printIcu list one order', () => {
  it.each(arrivals(PLURAL_ARRIVAL))(
    'merges a plural whose branches arrive as %j',
    ({ arrival }) => {
      const cardinal = pluralOf(arrival, { ordinal: false, offset: 0 })
      expect(variantsOf(cardinal)).toEqual([
        { arg: 'count', kind: 'plural', matches: selectorsOf(cardinal) },
      ])

      const ordinal = pluralOf(arrival, { ordinal: true, offset: 3 })
      expect(variantsOf(ordinal)).toEqual([
        { arg: 'count', kind: 'selectordinal', matches: selectorsOf(ordinal) },
      ])
    },
  )

  it.each(arrivals(SELECT_ARRIVAL))('lists a select whose options arrive as %j', ({ arrival }) => {
    const node = selectOf(arrival)

    expect(variantsOf(node)).toEqual([{ arg: 'state', kind: 'select', matches: selectorsOf(node) }])
  })

  it('holds the sequence itself, so the two cannot drift together and stay green', () => {
    const plural = pluralOf(PLURAL_ARRIVAL, { ordinal: false, offset: 0 })
    const select = selectOf(SELECT_ARRIVAL)

    expect(variantsOf(plural)).toEqual([
      { arg: 'count', kind: 'plural', matches: CANONICAL_PLURAL },
    ])
    expect(selectorsOf(plural)).toEqual(CANONICAL_PLURAL)
    expect(variantsOf(select)).toEqual([
      { arg: 'state', kind: 'select', matches: CANONICAL_SELECT },
    ])
    expect(selectorsOf(select)).toEqual(CANONICAL_SELECT)
  })
})
