import { afterEach, describe, expect, test, vi } from 'vitest'
import type { IntlOptions } from '../types'
import { runWithLocale } from '../server/index'
import { $configure1, $dateTime1, $number1, $plural1 } from './abi'
import { resetRuntime } from './__fixtures__/reset'
import { getLocale, setLocale } from './store'

const SETUP = { locales: ['de', 'de-AT', 'en'], sourceLocale: 'en', cookie: 'locale' } as const

// LZ1019's probe. A Node built --with-intl=small-icu answers every locale with
// English data, so a CLDR category claim there is a platform difference rather
// than a regression.
const FULL_ICU = new Intl.PluralRules('ru').resolvedOptions().pluralCategories.length >= 4

afterEach(() => {
  resetRuntime()
  vi.restoreAllMocks()
})

describe('$plural1', () => {
  test('selects cardinal categories', () => {
    expect($plural1('en', 1, false)).toBe('one')
    expect($plural1('en', 2, false)).toBe('other')
  })

  test.skipIf(!FULL_ICU)('reads a non English category set from full ICU data', () => {
    expect($plural1('ru', 2, false)).toBe('few')
  })

  test('selects ordinal categories under the same locale', () => {
    expect($plural1('en', 2, true)).toBe('two')
    expect($plural1('en', 3, true)).toBe('few')
    expect($plural1('en', 4, true)).toBe('other')
  })

  test('keeps the two variants of one locale apart', () => {
    expect($plural1('en', 2, false)).toBe('other')
    expect($plural1('en', 2, true)).toBe('two')
  })
})

describe('$number1', () => {
  test('formats through Intl for the locale it is handed', () => {
    const plain: IntlOptions = {}
    expect($number1('en', 1000.5, plain)).toBe(new Intl.NumberFormat('en').format(1000.5))
    expect($number1('de', 1000.5, plain)).toBe(new Intl.NumberFormat('de').format(1000.5))
    expect($number1('en', 1000.5, plain)).not.toBe($number1('de', 1000.5, plain))
  })

  test('honours a hoisted options object', () => {
    const percent: IntlOptions = { style: 'percent' }
    expect($number1('en', 0.5, percent)).toBe('50%')
  })

  test('caches one formatter per options identity per locale', () => {
    const real = Intl.NumberFormat
    let constructed = 0
    function counting(locale?: string, options?: Intl.NumberFormatOptions): Intl.NumberFormat {
      constructed += 1
      return new real(locale, options)
    }
    Intl.NumberFormat = counting as unknown as typeof Intl.NumberFormat
    try {
      const hoisted: IntlOptions = { maximumFractionDigits: 0 }
      $number1('en', 1.4, hoisted)
      $number1('en', 2.6, hoisted)
      expect(constructed).toBe(1)
      $number1('de', 2.6, hoisted)
      expect(constructed).toBe(2)
      const equalButDistinct: IntlOptions = { maximumFractionDigits: 0 }
      $number1('en', 2.6, equalButDistinct)
      expect(constructed).toBe(3)
    } finally {
      Intl.NumberFormat = real
    }
  })
})

describe('$dateTime1', () => {
  const options: IntlOptions = { dateStyle: 'medium', timeZone: 'UTC' }

  test('accepts a Date and an epoch number alike', () => {
    const at = Date.UTC(2026, 0, 15)
    expect($dateTime1('en', at, options)).toBe($dateTime1('en', new Date(at), options))
  })

  test('formats through Intl with the resolved options', () => {
    const at = new Date(Date.UTC(2026, 0, 15))
    expect($dateTime1('de', at, options)).toBe(
      new Intl.DateTimeFormat('de', { dateStyle: 'medium', timeZone: 'UTC' }).format(at),
    )
  })
})

describe('$configure1', () => {
  test('takes options.locale and matches it against its own list', () => {
    const resolve = $configure1(SETUP)
    expect(resolve({ locale: 'de-AT' })).toBe('de-AT')
    expect(resolve({ locale: 'de-CH' })).toBe('de')
    expect(resolve({ locale: 'sp' })).toBe('en')
  })

  test('reads the raw requested tag when no override is given', () => {
    const resolve = $configure1(SETUP)
    expect(resolve()).toBe('en')
    setLocale('de-at')
    expect(resolve()).toBe('de-AT')
  })

  test('treats an explicitly undefined locale as no override', () => {
    const resolve = $configure1(SETUP)
    setLocale('de')
    expect(resolve({ locale: undefined })).toBe('de')
    expect(resolve({})).toBe('de')
  })

  test('takes the per call override over an active request scope', () => {
    const resolve = $configure1(SETUP)
    runWithLocale('de', () => {
      expect(resolve()).toBe('de')
      expect(resolve({ locale: 'de-AT' })).toBe('de-AT')
      expect(resolve({ locale: undefined })).toBe('de')
    })
  })

  test('resolves two generated directories with different lists from one store', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const first = $configure1(SETUP)
    const second = $configure1({ locales: ['en', 'fr'], sourceLocale: 'en', cookie: 'locale' })
    setLocale('fr')
    expect(second()).toBe('fr')
    expect(first()).toBe('en')
    expect(getLocale()).toBe('en')
  })
})
