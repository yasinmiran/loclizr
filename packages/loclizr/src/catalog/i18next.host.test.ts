import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { RawEntry } from '../types'
import { foldPluralSuffixes } from './i18next'

// `xx` has no plural data, so Intl answers for whichever locale the build machine
// runs under. The stub plays a host whose answer is a single-category locale and,
// for `yy`, one whose answer carries `zero`.
const RealPluralRules = Intl.PluralRules
const HOST_ANSWERS: Readonly<Record<string, string>> = { xx: 'ja', yy: 'lv' }

beforeAll(() => {
  vi.spyOn(Intl, 'PluralRules').mockImplementation(function (
    locales?: string | readonly string[],
    options?: Intl.PluralRulesOptions,
  ) {
    const tag = Array.isArray(locales) ? locales[0] : locales
    return new RealPluralRules(HOST_ANSWERS[tag ?? ''] ?? locales, options)
  } as unknown as () => Intl.PluralRules)
})

afterAll(() => {
  vi.restoreAllMocks()
})

const SPAN = { line: 1, column: 1, offset: 0, length: 0 }

function entries(pairs: Readonly<Record<string, string>>): readonly RawEntry[] {
  return Object.entries(pairs).map(([key, value]) => ({ key, value, span: SPAN }))
}

describe('foldPluralSuffixes for a locale Intl has no plural data for', () => {
  it('does not fold a lone _other on the host answer', () => {
    const result = foldPluralSuffixes(entries({ files_other: '{count} files' }), 'xx', 'f.json')
    expect(result.entries.map((entry) => entry.key)).toEqual(['files_other'])
  })

  it('writes _zero as =0 whatever the host answer carries', () => {
    const result = foldPluralSuffixes(
      entries({ inbox_zero: 'No mail', inbox_one: 'One', inbox_other: 'Many' }),
      'yy',
      'f.json',
    )
    expect(result.entries.map((entry) => entry.value)).toEqual([
      '{count, plural, =0 {No mail} one {One} other {Many}}',
    ])
  })

  it('still folds by the real data of a locale Intl knows', () => {
    const ja = foldPluralSuffixes(entries({ files_other: '{count} files' }), 'ja', 'f.json')
    expect(ja.entries.map((entry) => entry.key)).toEqual(['files'])
    const lv = foldPluralSuffixes(
      entries({ inbox_zero: 'No mail', inbox_one: 'One', inbox_other: 'Many' }),
      'lv',
      'f.json',
    )
    expect(lv.entries.map((entry) => entry.value)).toEqual([
      '{count, plural, zero {No mail} one {One} other {Many}}',
    ])
  })
})
