import { afterEach, describe, expect, test, vi } from 'vitest'
import type { IntlOptions } from '../types'
import { $configure1, $dateTime1, $number1, $plural1 } from './abi'
import { resetRuntime } from './__fixtures__/reset'
import { setLocale } from './store'

const SETUP = { locales: ['de', 'de-AT', 'en'], sourceLocale: 'en', cookie: 'locale' } as const

// What the generated _formats.js hoists: frozen, shared, and the cache key.
const PLAIN: IntlOptions = Object.freeze({})
const CURRENCY: IntlOptions = Object.freeze({ currency: 'USD', style: 'currency' })
const MEDIUM: IntlOptions = Object.freeze({ dateStyle: 'medium', timeZone: 'UTC' })

// LZ1019's probe. Under --with-intl=small-icu every locale resolves to English
// data, so a CLDR category claim there reports the build rather than the code.
const FULL_ICU = new Intl.PluralRules('ru').resolvedOptions().pluralCategories.length >= 4

const HOSTILE_TAGS = [
  'de\r\nX-Injected: yes',
  '<script>',
  'Ko',
  '__proto__',
  'constructor',
  '',
  '-',
  'de-',
  'not a tag',
  'de'.repeat(500),
]

afterEach(() => {
  resetRuntime()
  vi.restoreAllMocks()
})

describe('$plural1', () => {
  test('reports the categories every ICU build agrees on', () => {
    expect($plural1('de', 0, false)).toBe('other')
    expect($plural1('en', 0, false)).toBe('other')
    expect($plural1('en', 1, false)).toBe('one')
  })

  test.skipIf(!FULL_ICU)('reports each locale own category set under full ICU data', () => {
    expect($plural1('ar', 0, false)).toBe('zero')
    expect($plural1('lv', 10, false)).toBe('zero')
    expect($plural1('lv', 20, false)).toBe('zero')
    expect($plural1('ru', 2, false)).toBe('few')
    expect($plural1('ru', 5, false)).toBe('many')
  })

  test('keeps cardinal and ordinal apart for one locale, both directions', () => {
    for (const value of [0, 1, 2, 3, 4, 11, 21, 101]) {
      const cardinal = $plural1('en', value, false)
      const ordinal = $plural1('en', value, true)
      expect(typeof cardinal).toBe('string')
      expect(typeof ordinal).toBe('string')
    }
    expect($plural1('en', 1, true)).toBe('one')
    expect($plural1('en', 1, false)).toBe('one')
    expect($plural1('en', 2, true)).toBe('two')
    expect($plural1('en', 2, false)).toBe('other')
    expect($plural1('en', 11, true)).toBe('other')
    expect($plural1('en', 21, true)).toBe('one')
  })

  test('answers for every number a call site can pass, without throwing', () => {
    const values = [0, -0, -1, 1.5, -1.5, 1e21, Number.MAX_SAFE_INTEGER, Number.NaN, Infinity, -Infinity]
    for (const value of values) {
      const cardinal = $plural1('en', value, false)
      expect(typeof cardinal, `${value}`).toBe('string')
      expect(cardinal.length).toBeGreaterThan(0)
    }
    expect($plural1('en', Number.NaN, false)).toBe('other')
  })

  test('is stable under repetition, so the cache cannot change an answer', () => {
    const first = [$plural1('ru', 2, false), $plural1('ru', 2, true), $plural1('ru', 5, false)]
    const second = [$plural1('ru', 2, false), $plural1('ru', 2, true), $plural1('ru', 5, false)]
    expect(second).toEqual(first)
    expect(first[0]).not.toBe(first[1])
  })

  test('accepts a declared tag carrying an extension subtag', () => {
    expect($plural1('de-u-nu-latn', 1, false)).toBe($plural1('de', 1, false))
    expect($plural1('de-AT', 2, false)).toBe('other')
  })
})

describe('$number1 and $dateTime1', () => {
  test('cache on the identity of a frozen hoisted object, not on its contents', () => {
    const twin: IntlOptions = Object.freeze({ currency: 'USD', style: 'currency' })
    expect($number1('en', 42.5, CURRENCY)).toBe($number1('en', 42.5, twin))
    expect($number1('en', 42.5, CURRENCY)).toBe(
      new Intl.NumberFormat('en', { currency: 'USD', style: 'currency' }).format(42.5),
    )
    expect($number1('de', 42.5, CURRENCY)).not.toBe($number1('en', 42.5, CURRENCY))
  })

  test('never mutate the options object they were handed', () => {
    const before = JSON.stringify(CURRENCY)
    $number1('en', 1, CURRENCY)
    $number1('de', 1, CURRENCY)
    expect(JSON.stringify(CURRENCY)).toBe(before)
    expect(Object.isFrozen(CURRENCY)).toBe(true)
  })

  test('format an empty option set as the locale default', () => {
    expect($number1('en', 1000.5, PLAIN)).toBe(new Intl.NumberFormat('en').format(1000.5))
    expect($number1('de', 1000.5, PLAIN)).toBe(new Intl.NumberFormat('de').format(1000.5))
  })

  test('take a Date and an epoch number alike, across the epoch and before it', () => {
    for (const at of [0, -1, Date.UTC(1969, 6, 20), Date.UTC(2026, 0, 15), 1e12]) {
      expect($dateTime1('en', at, MEDIUM), `${at}`).toBe($dateTime1('en', new Date(at), MEDIUM))
    }
    expect($dateTime1('en', 0, MEDIUM)).toBe(
      new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' }).format(0),
    )
  })

  test('are stable under repetition for one locale and options pair', () => {
    const at = new Date(Date.UTC(2026, 0, 15))
    expect($dateTime1('de', at, MEDIUM)).toBe($dateTime1('de', at, MEDIUM))
    expect($number1('de', 1.005, PLAIN)).toBe($number1('de', 1.005, PLAIN))
  })
})

describe('$configure1', () => {
  test('hands the helpers a declared locale for every hostile override', () => {
    const resolve = $configure1(SETUP)
    for (const locale of HOSTILE_TAGS) {
      const resolved = resolve({ locale })
      expect([...SETUP.locales], `${locale} -> ${resolved}`).toContain(resolved)
      expect(() => $plural1(resolved, 1, false)).not.toThrow()
      expect(() => $number1(resolved, 1, PLAIN)).not.toThrow()
      expect(() => $dateTime1(resolved, 0, MEDIUM)).not.toThrow()
    }
  })

  test('binds its own locale list at creation, immune to a later registration', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const first = $configure1({ locales: ['de', 'en'], sourceLocale: 'en', cookie: 'locale' })
    setLocale('fr')
    expect(first()).toBe('en')
    const second = $configure1({ locales: ['en', 'fr'], sourceLocale: 'en', cookie: 'locale' })
    expect(second()).toBe('fr')
    expect(first()).toBe('en')
  })

  test('returns a fresh resolver per call and reads the store on every call', () => {
    const first = $configure1(SETUP)
    const second = $configure1(SETUP)
    expect(second).not.toBe(first)
    expect(first()).toBe('en')
    setLocale('de')
    expect(first()).toBe('de')
    expect(second()).toBe('de')
    setLocale('de-AT')
    expect(first()).toBe('de-AT')
  })
})
