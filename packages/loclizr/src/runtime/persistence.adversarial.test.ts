// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { LocaleSetup, NegotiateOptions } from '../types'
import { localeFromHeaders } from '../server/index'
import { $configure1 } from './abi'
import { resetRuntime } from './__fixtures__/reset'
import { getRawLocale, setLocale } from './store'

const ONE_YEAR = 31536000

const SETUP: LocaleSetup = { locales: ['de', 'de-AT', 'en'], sourceLocale: 'en', cookie: 'locale' }

const OPTIONS: NegotiateOptions = {
  locales: [...SETUP.locales],
  sourceLocale: SETUP.sourceLocale,
  cookie: SETUP.cookie,
}

// Locales a tampered switcher can reach: an attribute injection, a second
// cookie, a header split, and a value that needs escaping to survive the wire.
const HOSTILE = [
  'de; Domain=evil.test',
  'de; Path=/admin',
  'de=AT; HttpOnly',
  'de\r\nSet-Cookie: session=stolen',
  'de,fr',
  'de AT',
  'ü-DE',
  '"de"',
]

let written: string[] = []

function captureCookieWrites(): void {
  written = []
  const real = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie')
  Object.defineProperty(document, 'cookie', {
    configurable: true,
    get: () => real?.get?.call(document) ?? '',
    set: (value: string) => {
      written.push(value)
      real?.set?.call(document, value)
    },
  })
}

function attributesOf(header: string): readonly string[] {
  return header
    .split(';')
    .slice(1)
    .map((part) => part.trim())
}

function clearCookies(): void {
  for (const pair of document.cookie.split(';')) {
    const name = pair.split('=')[0]?.trim()
    if (name !== undefined && name !== '') document.cookie = `${name}=; path=/; max-age=0`
  }
}

afterEach(() => {
  Reflect.deleteProperty(document, 'cookie')
  Reflect.deleteProperty(navigator, 'languages')
  localStorage.clear()
  clearCookies()
  document.documentElement.removeAttribute('lang')
  resetRuntime()
  vi.restoreAllMocks()
})

describe('the cookie setLocale writes', () => {
  test('carries the three attributes the hydration channel depends on', () => {
    captureCookieWrites()
    $configure1(SETUP)
    setLocale('de-AT')
    expect(written).toHaveLength(1)
    const header = written[0] ?? ''
    expect(header.startsWith('locale=de-AT;')).toBe(true)
    expect(attributesOf(header)).toEqual(['path=/', `max-age=${ONE_YEAR}`, 'SameSite=Lax'])
  })

  test('takes the configured name rather than the default one', () => {
    captureCookieWrites()
    $configure1({ locales: ['en', 'fr'], sourceLocale: 'en', cookie: 'lang' })
    setLocale('fr')
    expect(written[0]?.startsWith('lang=fr;')).toBe(true)
    expect(document.cookie).not.toContain('locale=')
  })

  test('keeps the name the first generated directory registered', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const first = $configure1({ locales: ['de', 'en'], sourceLocale: 'en', cookie: 'lang' })
    const second = $configure1({ locales: ['en', 'fr'], sourceLocale: 'en', cookie: 'other' })
    document.cookie = 'other=fr; path=/'
    document.cookie = 'lang=de; path=/'
    expect(getRawLocale()).toBe('de')
    expect(first()).toBe('de')
    expect(second()).toBe('en')
    captureCookieWrites()
    setLocale('fr')
    expect(written[0]?.startsWith('lang=fr;')).toBe(true)
  })

  test('reads nothing from the name a second generated directory asked for', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    $configure1({ locales: ['de', 'en'], sourceLocale: 'en', cookie: 'lang' })
    const second = $configure1({ locales: ['en', 'fr'], sourceLocale: 'en', cookie: 'other' })
    document.cookie = 'other=fr; path=/'
    expect(getRawLocale()).toBe('')
    expect(second()).toBe('en')
  })

  test('escapes a hostile locale into one value with no attribute of its own', () => {
    for (const locale of HOSTILE) {
      captureCookieWrites()
      $configure1(SETUP)
      setLocale(locale)
      const header = written[0] ?? ''
      expect(header, locale).not.toMatch(/[\r\n]/)
      expect(attributesOf(header), locale).toEqual(['path=/', `max-age=${ONE_YEAR}`, 'SameSite=Lax'])
      expect(header.slice(0, header.indexOf(';'))).toBe(`locale=${encodeURIComponent(locale)}`)
      Reflect.deleteProperty(document, 'cookie')
      clearCookies()
      resetRuntime()
    }
  })

  test('is not written at all when persistence is declined', () => {
    captureCookieWrites()
    $configure1(SETUP)
    setLocale('de', { persist: false })
    expect(written).toEqual([])
    expect(document.documentElement.lang).toBe('de')
    expect($configure1(SETUP)()).toBe('de')
  })

  test('is what the server reads back for the same tag', () => {
    for (const locale of ['de-AT', 'de', ...HOSTILE]) {
      $configure1(SETUP)
      setLocale(locale)
      const wire = document.cookie
      resetRuntime()
      const client = $configure1(SETUP)()
      expect(localeFromHeaders({ cookie: wire }, OPTIONS), `${locale} -> ${wire}`).toBe(client)
      clearCookies()
      resetRuntime()
    }
  })
})

describe('html lang', () => {
  test('follows every switch, persisted or not', () => {
    $configure1(SETUP)
    setLocale('de')
    expect(document.documentElement.lang).toBe('de')
    setLocale('de-AT', { persist: false })
    expect(document.documentElement.lang).toBe('de-AT')
    setLocale('sp')
    expect(document.documentElement.lang).toBe('sp')
  })

  test('is the only channel besides the cookie, whatever the browser also offers', () => {
    Object.defineProperty(navigator, 'languages', { configurable: true, value: ['fr-FR', 'fr'] })
    localStorage.setItem('locale', 'fr')
    localStorage.setItem('loclizr.locale', 'fr')
    $configure1(SETUP)
    expect(getRawLocale()).toBe('')
    resetRuntime()
    document.documentElement.lang = 'de'
    $configure1(SETUP)
    expect(getRawLocale()).toBe('de')
    resetRuntime()
    document.cookie = 'locale=de-AT; path=/'
    $configure1(SETUP)
    expect(getRawLocale()).toBe('de-AT')
    setLocale('en')
    expect(localStorage.getItem('locale')).toBe('fr')
  })

  test('is read as a plausible tag only, and never outranks the cookie', () => {
    document.documentElement.lang = 'de-AT'
    expect(getRawLocale()).toBe('de-AT')
    resetRuntime()
    document.cookie = 'locale=de; path=/'
    expect(getRawLocale()).toBe('de')
    resetRuntime()
    clearCookies()
    document.documentElement.lang = 'javascript:alert(1)'
    expect(getRawLocale()).toBe('')
    resetRuntime()
    document.documentElement.lang = 'de_AT'
    expect(getRawLocale()).toBe('')
  })
})
