import { parse } from '@formatjs/icu-messageformat-parser'
import { describe, expect, it } from 'vitest'
import type { RawEntry } from '../types'
import { classifyFormat, findTypedArgument } from './i18next'

const SPAN = { line: 1, column: 1, offset: 0, length: 0 }

function entries(values: Readonly<Record<string, string>>): readonly RawEntry[] {
  return Object.entries(values).map(([key, value]) => ({ key, value, span: SPAN }))
}

function parses(icu: string): boolean {
  try {
    parse(icu, {
      shouldParseSkeletons: true,
      requiresOtherClause: true,
      captureLocation: false,
      ignoreTag: false,
    })
    return true
  } catch {
    return false
  }
}

describe('classifyFormat on a double brace behind an unbalanced one', () => {
  const values: readonly string[] = [
    'a { color: {{c}} }',
    'Wrap it in { and add {{name}}',
    'Open {{{name}}',
  ]

  it.each(values)('has nothing to lose by reading %j as i18next', (value) => {
    expect(parses(value)).toBe(false)
  })

  it.each(values)('reads a file holding %j as i18next', (value) => {
    expect(classifyFormat(entries({ snippet: value })).format).toBe('i18next')
  })
})

describe('classifyFormat on keys the fold step would fold', () => {
  it('decides on an ordinal group and names the key that decided', () => {
    expect(classifyFormat(entries({ place_ordinal_one: '1st', place_ordinal_other: 'nth' }))).toEqual({
      format: 'i18next',
      because: 'place_ordinal_one',
    })
  })

  it('decides on a zero and other pair, which folds', () => {
    expect(classifyFormat(entries({ x_zero: 'none', x_other: 'some' })).format).toBe('i18next')
  })

  it('reads an empty file as ICU', () => {
    expect(classifyFormat([])).toEqual({ format: 'icu', because: null })
  })
})

describe('findTypedArgument on runs that hide behind other braces', () => {
  const found: Readonly<Record<string, string>> = {
    '{name} joined {x, number, integer}': '{x, number',
    '{{a}} {b, select, other {x}}': '{b, select',
    'closed }} then {c, date, short}': '{c, date',
    '{ count , plural, one {a} other {b}}': '{ count , plural',
    '{count,plural,one {a} other {b}}': '{count,plural',
    '{0, selectordinal, other {b}}': '{0, selectordinal',
    'nested {a, select, other {{b, time, short}}}': '{a, select',
  }
  const missing: readonly string[] = [
    '{x, selectable, other {a}}',
    '{x, plurality}',
    '{x, numbers, other {a}}',
    '{x, dated}',
    '{{x, plural, one {a} other {b}}}',
    'plural, select, number',
  ]

  it.each(Object.entries(found))('finds the run in %j', (value, head) => {
    expect(findTypedArgument(value)).toBe(head)
  })

  it.each(missing)('finds no run in %j', (value) => {
    expect(findTypedArgument(value)).toBeNull()
  })
})
