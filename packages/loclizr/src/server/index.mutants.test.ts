import { describe, expect, test } from 'vitest'
import type { NegotiateOptions } from '../types'
import { negotiate } from './index'

const OPTIONS: NegotiateOptions = {
  locales: ['de', 'de-AT', 'en', 'fr'],
  sourceLocale: 'en',
  cookie: 'locale',
}

describe('negotiate reads only the q parameter', () => {
  // A non-q parameter whose value is zero or not a number must not be read as
  // a weight, or it would drop a range the client asked for at full quality.
  test('a non-q parameter never lowers or zeroes the weight', () => {
    expect(negotiate(['de;level=0', 'fr;q=0.5'], OPTIONS)).toBe('de')
    expect(negotiate(['de;charset=x', 'fr;q=0.5'], OPTIONS)).toBe('de')
  })

  test('a non-q parameter after q does not overwrite it', () => {
    expect(negotiate(['de;q=0.9;level=0.1', 'fr;q=0.5'], OPTIONS)).toBe('de')
  })
})

describe('negotiate skips the * range', () => {
  // The caller supplies the locale list, so a literal '*' in it is reachable.
  test('a wildcard range never matches a locale spelled *', () => {
    expect(negotiate(['*'], { locales: ['*', 'en'], sourceLocale: 'en' })).toBe('en')
  })
})
