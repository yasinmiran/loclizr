import type { MessageFormatElement } from '@formatjs/icu-messageformat-parser'
import { parse, TYPE } from '@formatjs/icu-messageformat-parser'
import { describe, expect, it } from 'vitest'
import type { RawEntry } from '../types'
import { requiredCategories } from '../util'
import { foldPluralSuffixes, toIcu } from './i18next'

const SPAN = { line: 1, column: 1, offset: 0, length: 0 }

function entries(values: Readonly<Record<string, string>>): readonly RawEntry[] {
  return Object.entries(values).map(([key, value]) => ({ key, value, span: SPAN }))
}

function ast(icu: string): readonly MessageFormatElement[] {
  return parse(icu, {
    shouldParseSkeletons: true,
    requiresOtherClause: true,
    captureLocation: false,
    ignoreTag: false,
  })
}

function foldedValue(values: Readonly<Record<string, string>>, locale: string): string {
  const result = foldPluralSuffixes(entries(values), locale, `locales/${locale}.json`)
  return result.entries.find((entry) => entry.key === 'x')?.value ?? ''
}

const ALL_SUFFIXES: Readonly<Record<string, string>> = {
  x_zero: 'none',
  x_one: 'one',
  x_two: 'two',
  x_few: 'few',
  x_many: 'many',
  x_other: 'other',
}

describe('foldPluralSuffixes across locales that disagree about their categories', () => {
  const locales: readonly string[] = ['en', 'de', 'lv', 'ar', 'cy', 'ru', 'ja']

  it.each(locales)('emits re-parseable ICU for %s', (locale) => {
    const [element] = ast(foldedValue(ALL_SUFFIXES, locale))
    if (element === undefined || element.type !== TYPE.plural) throw new Error('not a plural')
    const wantsKeywordZero = requiredCategories(locale, false).includes('zero')
    expect(Object.keys(element.options)).toEqual(
      wantsKeywordZero
        ? ['zero', 'one', 'two', 'few', 'many', 'other']
        : ['=0', 'one', 'two', 'few', 'many', 'other'],
    )
  })

  it('keeps a branch the locale can never select, so the unreachable rule can see it', () => {
    expect(foldedValue({ x_few: 'wenige', x_one: 'eins', x_other: 'viele' }, 'de')).toBe(
      '{count, plural, one {eins} few {wenige} other {viele}}',
    )
  })

  it('folds the i18next zero idiom into an exact branch where the locale has no zero category', () => {
    const value = foldedValue({ x_zero: 'nothing', x_other: 'something' }, 'en')
    expect(value).toBe('{count, plural, =0 {nothing} other {something}}')
    expect(ast(value)).toHaveLength(1)
  })

  it('quotes a pound beside markup and an apostrophe under i18nextMarkup tags', () => {
    const converted = entries({
      x_one: toIcu("Don't <b>#1</b>", {
        key: 'x_one',
        locale: 'en',
        file: 'locales/en.json',
        span: SPAN,
        markup: 'tags',
      }).icu,
      x_other: 'rest',
    })
    const [element] = ast(
      foldPluralSuffixes(converted, 'en', 'locales/en.json').entries[0]?.value ?? '',
    )
    if (element === undefined || element.type !== TYPE.plural) throw new Error('not a plural')
    expect(element.options['one']?.value).toEqual([
      { type: TYPE.literal, value: "Don't " },
      { type: TYPE.tag, value: 'b', children: [{ type: TYPE.literal, value: '#1' }] },
    ])
  })

  it('folds a branch a translator left empty without breaking the message', () => {
    const value = foldedValue({ x_one: '', x_other: 'many' }, 'en')
    expect(value).toBe('{count, plural, one {} other {many}}')
    expect(ast(value)).toHaveLength(1)
  })
})
