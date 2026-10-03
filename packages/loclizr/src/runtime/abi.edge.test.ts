import { afterEach, describe, expect, test, vi } from 'vitest'
import type { IntlOptions } from '../types'
import { runWithLocale } from '../server/index'
import { $configure1, $dateTime1, $number1, $plural1 } from './abi'
import { resetRuntime } from './__fixtures__/reset'
import { getLocale, setLocale } from './store'

const SETUP = { locales: ['de', 'de-AT', 'en'], sourceLocale: 'en', cookie: 'locale' } as const

const PLAIN: IntlOptions = Object.freeze({})
const UTC_DATE: IntlOptions = Object.freeze({ dateStyle: 'medium', timeZone: 'UTC' })

afterEach(() => {
  resetRuntime()
  vi.restoreAllMocks()
})

function countConstructions(
  name: 'NumberFormat' | 'DateTimeFormat' | 'PluralRules',
  run: () => void,
): number {
  const real = Intl[name]
  let constructed = 0
  const counting = function (...args: unknown[]): unknown {
    constructed += 1
    return Reflect.construct(real, args)
  }
  ;(Intl as unknown as Record<string, unknown>)[name] = counting
  try {
    run()
  } finally {
    ;(Intl as unknown as Record<string, unknown>)[name] = real
  }
  return constructed
}

describe('$plural1 caching', () => {
  test('constructs one rule set per locale and variant, however often it is asked', () => {
    const constructed = countConstructions('PluralRules', () => {
      for (let round = 0; round < 3; round += 1) {
        $plural1('fr-CA', 1, false)
        $plural1('fr-CA', 2, true)
        $plural1('fr-BE', 1, false)
      }
    })
    expect(constructed).toBe(3)
  })

  test('keys case variants of one tag apart yet answers them alike', () => {
    expect($plural1('EN', 1, false)).toBe($plural1('en', 1, false))
    expect($plural1('EN', 2, true)).toBe($plural1('en', 2, true))
  })
})

describe('$plural1 at the numeric limits', () => {
  test('treats negative zero like zero', () => {
    expect($plural1('en', -0, false)).toBe($plural1('en', 0, false))
    expect($plural1('en', -0, true)).toBe($plural1('en', 0, true))
  })

  test('selects one for a float that equals one and other for one and a half', () => {
    expect($plural1('en', 1.0, false)).toBe('one')
    expect($plural1('en', 1.5, false)).toBe('other')
  })

  test('agrees with Intl directly for the extremes', () => {
    for (const value of [Number.MAX_SAFE_INTEGER, 1e21, Infinity, -Infinity, -1]) {
      expect($plural1('en', value, false), `${value}`).toBe(new Intl.PluralRules('en').select(value))
    }
  })
})

describe('$number1 at the numeric limits', () => {
  test('formats each extreme exactly as Intl does, with no rewriting', () => {
    const values = [0, -0, Number.NaN, Infinity, -Infinity, 1e21, Number.MAX_SAFE_INTEGER, 5e-324]
    for (const value of values) {
      expect($number1('en', value, PLAIN), `${value}`).toBe(new Intl.NumberFormat('en').format(value))
      expect($number1('de', value, PLAIN), `${value}`).toBe(new Intl.NumberFormat('de').format(value))
    }
  })

  test('keeps the sign of negative zero the way Intl does', () => {
    expect($number1('en', -0, PLAIN)).toBe('-0')
  })
})

describe('the formatter caches', () => {
  test('keep number and date formatters apart for one shared options object', () => {
    const shared: IntlOptions = Object.freeze({ timeZone: 'UTC' })
    expect($number1('en', 5, shared)).toBe('5')
    expect($dateTime1('en', 0, shared)).toBe(
      new Intl.DateTimeFormat('en', { timeZone: 'UTC' }).format(0),
    )
  })

  test('construct one date formatter per options identity per locale', () => {
    const hoisted: IntlOptions = Object.freeze({ dateStyle: 'short', timeZone: 'UTC' })
    const constructed = countConstructions('DateTimeFormat', () => {
      $dateTime1('en', 0, hoisted)
      $dateTime1('en', 86_400_000, hoisted)
      $dateTime1('de', 0, hoisted)
      $dateTime1('de', new Date(0), hoisted)
    })
    expect(constructed).toBe(2)
  })

  test('key a region apart from its base tag', () => {
    const hoisted: IntlOptions = Object.freeze({ style: 'currency', currency: 'EUR' })
    const constructed = countConstructions('NumberFormat', () => {
      $number1('de', 1, hoisted)
      $number1('de-AT', 1, hoisted)
    })
    expect(constructed).toBe(2)
  })

  test('do not cache a construction that threw', () => {
    const broken: IntlOptions = Object.freeze({ style: 'currency' })
    expect(() => $number1('en', 1, broken)).toThrow(TypeError)
    expect(() => $number1('en', 1, broken)).toThrow(TypeError)
  })
})

describe('$dateTime1', () => {
  test('formats the earliest and latest representable instants like Intl does', () => {
    for (const at of [-8.64e15, 8.64e15]) {
      expect($dateTime1('en', at, UTC_DATE), `${at}`).toBe(
        new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' }).format(at),
      )
    }
  })

  test('treats a negative zero epoch as the epoch', () => {
    expect($dateTime1('en', -0, UTC_DATE)).toBe($dateTime1('en', 0, UTC_DATE))
  })
})

describe('$configure1 resolvers', () => {
  test('take an empty override as a request for nothing, which is the source locale', () => {
    const resolve = $configure1(SETUP)
    setLocale('de')
    expect(resolve({ locale: '' })).toBe('en')
  })

  test('match an override with an extension subtag down to the declared region', () => {
    const resolve = $configure1(SETUP)
    expect(resolve({ locale: 'de-AT-u-nu-latn' })).toBe('de-AT')
  })

  test('answer the source locale even when it is missing from the declared list', () => {
    const resolve = $configure1({ locales: ['de'], sourceLocale: 'en', cookie: 'locale' })
    expect(resolve()).toBe('en')
    expect(resolve({ locale: 'de-CH' })).toBe('de')
  })

  test('register on creation, so getLocale matches before any resolver is called', () => {
    $configure1(SETUP)
    setLocale('DE-at')
    expect(getLocale()).toBe('de-AT')
  })

  test('follow an empty request scope to the source locale, not the stored tag', () => {
    const resolve = $configure1(SETUP)
    setLocale('de')
    expect(runWithLocale('', () => resolve())).toBe('en')
    expect(resolve()).toBe('de')
  })

  test('let an override beat an empty request scope', () => {
    const resolve = $configure1(SETUP)
    expect(runWithLocale('', () => resolve({ locale: 'de' }))).toBe('de')
  })

  test('answer identically for a prototype key whether stored or passed', () => {
    const resolve = $configure1({ locales: ['en', 'constructor'], sourceLocale: 'en', cookie: 'locale' })
    expect(resolve({ locale: 'constructor' })).toBe('constructor')
    setLocale('__proto__')
    expect(resolve()).toBe('en')
  })
})
