import { describe, expect, it } from 'vitest'
import type { Config, Program } from '../types'
import { catalog, config, forRule, run } from './__fixtures__/program'

function english(input: {
  readonly config: Config
  readonly entries: Readonly<Record<string, string>>
}): Program {
  return run({ config: input.config, catalogs: [catalog({ locale: 'en', entries: input.entries })] })
}

describe('identifiers entries that match nothing', () => {
  it('warns on an entry no key, segment or group uses, naming the closest key', () => {
    const program = english({
      config: config({ identifiers: { cart_totl: 'total' } }),
      entries: { cart_total: 'Total', 'nav.home': 'Home' },
    })
    const [orphan, ...rest] = forRule(program, 'identifier-orphan')
    expect(rest).toEqual([])
    expect(orphan).toMatchObject({ code: 'LZ4007', severity: 'warn', fatal: false, key: null, file: null })
    expect(orphan?.message).toContain('"cart_totl"')
    expect(orphan?.hint).toContain("identifiers: { 'cart_total': 'total' }")
    expect(program.messages.map((message) => message.id)).toEqual(['cart_total', 'nav_home'])
  })

  it('stays silent for an entry matched by a key, a top-level segment, the root namespace or a group', () => {
    const program = english({
      config: config({
        groups: { errors: 'errors' },
        identifiers: { 'nav.home': 'navHome', nav: 'navigation', _root: 'top', errors: 'appErrors' },
      }),
      entries: { 'nav.home': 'Home', 'errors.forbidden': 'Forbidden', title: 'Title' },
    })
    expect(forRule(program, 'identifier-orphan')).toEqual([])
  })

  it('stays silent for an entry naming a key whose source failed to lower', () => {
    const program = english({
      config: config({ identifiers: { broken: 'fixed' } }),
      entries: { broken: '{count, plural, one {#}}' },
    })
    expect(program.messages).toEqual([])
    expect(forRule(program, 'identifier-orphan')).toEqual([])
  })

  it('reports every orphan in code point order, ties on distance going to the first candidate', () => {
    const program = english({
      config: config({ identifiers: { zz: 'z', ab: 'a' } }),
      entries: { ac: 'A', aa: 'B' },
    })
    const orphans = forRule(program, 'identifier-orphan')
    expect(orphans.map((orphan) => orphan.message.match(/"([^"]+)"/)?.[1])).toEqual(['ab', 'zz'])
    expect(orphans[0]?.hint).toContain("identifiers: { 'aa': 'a' }")
  })

  it('names the key a regenerated id moved to, never the root namespace', () => {
    const program = english({
      config: config({ identifiers: { rM52go: 'checkout' } }),
      entries: { 'kLF5Q+': 'Go to checkout' },
    })
    const [orphan] = forRule(program, 'identifier-orphan')
    expect(orphan?.hint).toContain("identifiers: { 'kLF5Q+': 'checkout' }")
  })

  it('drops the closest-key hint when there is no key to name', () => {
    const program = english({ config: config({ identifiers: { stale: 'gone' } }), entries: {} })
    const [orphan] = forRule(program, 'identifier-orphan')
    expect(orphan?.hint).toBe('Remove the entry from loclizr.config.ts.')
  })

  it.each([7, 11, 23, 101, 4099])('names the closest key an exhaustive Levenshtein search names (seed %i)', (start) => {
    let seed = start
    const next = (bound: number): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return Math.floor(seed / 65536) % bound
    }
    const word = (): string => {
      let text = ''
      const length = 1 + next(12)
      for (let index = 0; index < length; index += 1) text += 'abcde'[next(5)]
      return text
    }
    const keys = [...new Set(Array.from({ length: 150 }, word))]
    const stale = [...new Set(Array.from({ length: 40 }, () => `${word()}x`))].sort()
    const program = english({
      config: config({ identifiers: Object.fromEntries(stale.map((entry) => [entry, 'renamed'])) }),
      entries: Object.fromEntries(keys.map((key) => [key, 'Text'])),
    })
    const sortedKeys = [...keys].sort()
    const expected = stale.map((entry) => {
      let pick = ''
      let best = Number.POSITIVE_INFINITY
      for (const key of sortedKeys) {
        const distance = levenshtein(entry, key)
        if (distance < best) {
          best = distance
          pick = key
        }
      }
      return `The closest existing name is "${pick}".`
    })
    const hints = forRule(program, 'identifier-orphan').map((orphan) => orphan.hint?.split(' Fix')[0])
    expect(hints).toEqual(expected)
  })
})

function levenshtein(a: string, b: string): number {
  const table = Array.from({ length: a.length + 1 }, (_row, row) =>
    Array.from({ length: b.length + 1 }, (_column, column) => (row === 0 ? column : column === 0 ? row : 0)),
  )
  for (let row = 1; row <= a.length; row += 1) {
    for (let column = 1; column <= b.length; column += 1) {
      const above = table[row - 1] ?? []
      const here = table[row] ?? []
      here[column] = Math.min(
        (above[column] ?? 0) + 1,
        (here[column - 1] ?? 0) + 1,
        (above[column - 1] ?? 0) + (a[row - 1] === b[column - 1] ? 0 : 1),
      )
    }
  }
  return table[a.length]?.[b.length] ?? 0
}
