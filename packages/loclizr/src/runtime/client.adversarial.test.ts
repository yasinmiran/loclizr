// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { NegotiateOptions } from '../types'
import { localeFromHeaders, runWithLocale } from '../server/index'
import { $configure1 } from './abi'
import { resetRuntime } from './__fixtures__/reset'
import { getRawLocale, matchLocale, setLocale } from './store'

const SETUP = { locales: ['de', 'de-AT', 'en'], sourceLocale: 'en', cookie: 'locale' } as const

const OPTIONS: NegotiateOptions = {
  locales: [...SETUP.locales],
  sourceLocale: SETUP.sourceLocale,
  cookie: SETUP.cookie,
}

const HOSTILE = [
  'de\r\nX-Injected: yes',
  'de; Domain=evil.test; Path=/',
  'de=AT',
  '<script>alert(1)</script>',
  'Ko',
  'İstanbul',
  'de\u0000',
  '__proto__',
  'constructor',
  'prototype',
  'toString',
  '',
  '-',
  'de-',
  '-de',
  'DE',
  'de'.repeat(500),
]

function clearCookies(): void {
  for (const pair of document.cookie.split(';')) {
    const name = pair.split('=')[0]?.trim()
    if (name !== undefined && name !== '') document.cookie = `${name}=; path=/; max-age=0`
  }
}

afterEach(() => {
  clearCookies()
  document.documentElement.removeAttribute('lang')
  resetRuntime()
  vi.restoreAllMocks()
})

describe('matchLocale', () => {
  test('answers with a declared tag or the fallback, never with its input', () => {
    for (const requested of HOSTILE) {
      const matched = matchLocale(requested, SETUP.locales, 'en')
      expect([...SETUP.locales, 'en'], `${requested} -> ${matched}`).toContain(matched)
    }
  })

  test('serves the fallback to an undeclared base tag rather than guessing sideways', () => {
    expect(matchLocale('de', ['de-AT', 'en'], 'en')).toBe('en')
    expect(matchLocale('de-DE', ['de-AT', 'en'], 'en')).toBe('en')
    expect(matchLocale('de-AT', ['de-AT', 'en'], 'en')).toBe('de-AT')
  })

  test('truncates one subtag at a time and takes the first declared match', () => {
    expect(matchLocale('en-GB-oed', ['en-GB', 'en'], 'de')).toBe('en-GB')
    expect(matchLocale('en-GB-oed', ['en', 'en-GB'], 'de')).toBe('en-GB')
    expect(matchLocale('de-CH-1996-x-private', ['de', 'en'], 'en')).toBe('de')
    expect(matchLocale('zh-Hant-TW', ['zh-Hans', 'en'], 'en')).toBe('en')
  })
})

describe('a locale written by setLocale', () => {
  test('round-trips through the cookie with no raw separator in the header', () => {
    for (const locale of HOSTILE.filter((value) => value !== '')) {
      $configure1(SETUP)
      setLocale(locale)
      expect(document.cookie).not.toMatch(/[\r\n]/)
      expect(document.cookie.split(';').length).toBe(1)
      resetRuntime()
      expect(getRawLocale(), locale).toBe(locale)
      clearCookies()
    }
  })

  test('is still matched down to a declared locale when it is read back', () => {
    $configure1(SETUP)
    setLocale('de\r\nX-Injected: yes')
    resetRuntime()
    const resolver = $configure1(SETUP)
    expect(resolver()).toBe('en')
  })
})

describe('the hydration agreement', () => {
  test('gives the server and the client one answer for every cookie', () => {
    for (const value of ['de-AT', 'DE-at', 'sp', 'de%2DAT', '', ...HOSTILE]) {
      clearCookies()
      resetRuntime()
      document.cookie = `locale=${encodeURIComponent(value)}; path=/`
      const client = $configure1(SETUP)()
      const server = localeFromHeaders({ cookie: document.cookie }, OPTIONS)
      expect(server, `${value}: server ${server} client ${client}`).toBe(client)
    }
  })

  test('agrees when no cookie exists and the server negotiated into html lang', () => {
    document.documentElement.lang = 'de'
    const client = $configure1(SETUP)()
    const server = localeFromHeaders({ acceptLanguage: 'de-CH,en;q=0.5' }, OPTIONS)
    expect(client).toBe('de')
    expect(server).toBe('de')
  })

  test('lets the cookie beat a frozen html lang, which is what a SPA reload needs', () => {
    document.documentElement.lang = 'en'
    document.cookie = 'locale=de-AT; path=/'
    expect($configure1(SETUP)()).toBe('de-AT')
  })
})

describe('a request scope in a runtime that also has a document', () => {
  test('outranks the cookie and is not overwritten by it', () => {
    document.cookie = 'locale=de; path=/'
    const resolver = $configure1(SETUP)
    expect(runWithLocale('de-AT', () => resolver())).toBe('de-AT')
    expect(runWithLocale('', () => getRawLocale())).toBe('')
    expect(resolver()).toBe('de')
  })
})
