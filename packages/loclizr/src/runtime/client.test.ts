// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'
import { $configure1 } from './abi'
import { resetRuntime } from './__fixtures__/reset'
import { getLocale, getRawLocale, registerDefaults, setLocale } from './store'

const SETUP = { locales: ['de', 'de-AT', 'en'], sourceLocale: 'en', cookie: 'locale' } as const

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

describe('client detection', () => {
  test('reads the configured cookie first', () => {
    registerDefaults({ locales: ['en', 'fr'], sourceLocale: 'en', cookie: 'lang' })
    document.cookie = 'locale=de; path=/'
    document.cookie = 'lang=fr; path=/'
    expect(getRawLocale()).toBe('fr')
  })

  test('cookie-without-prior-getLocale', () => {
    document.cookie = 'locale=de; path=/'
    const resolve = $configure1(SETUP)
    expect(resolve()).toBe('de')
  })

  test('falls to a plausible html lang and ignores an implausible one', () => {
    document.documentElement.lang = 'de-AT'
    expect(getRawLocale()).toBe('de-AT')
    resetRuntime()
    document.documentElement.lang = 'not a tag'
    expect(getRawLocale()).toBe('')
  })

  test('latches what it detected, so a later cookie cannot move it silently', () => {
    registerDefaults(SETUP)
    expect(getRawLocale()).toBe('')
    document.cookie = 'locale=de; path=/'
    expect(getRawLocale()).toBe('')
    setLocale('de')
    expect(getRawLocale()).toBe('de')
  })

  test('prefers the cookie over html lang, which is what makes a reload survive', () => {
    document.documentElement.lang = 'en'
    document.cookie = 'locale=de; path=/'
    expect(getRawLocale()).toBe('de')
  })

  test('decodes a cookie value and tolerates a malformed escape', () => {
    document.cookie = 'locale=de%2DAT; path=/'
    expect(getRawLocale()).toBe('de-AT')
    clearCookies()
    resetRuntime()
    document.cookie = 'locale=%E0%A4%A; path=/'
    expect(() => getRawLocale()).not.toThrow()
    expect(getRawLocale()).toBe('%E0%A4%A')
  })

  test('renders the source locale for a tampered cookie', () => {
    registerDefaults(SETUP)
    document.cookie = 'locale=sp; path=/'
    expect(getLocale()).toBe('en')
  })

  test('getLocale ignores a detected cookie until something is registered', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    document.cookie = 'locale=de; path=/'
    expect(getLocale()).toBe('en')
    expect(warn).toHaveBeenCalledTimes(1)
    expect($configure1(SETUP)()).toBe('de')
  })
})

describe('setLocale in a browser', () => {
  test('persists the cookie and updates html lang', () => {
    registerDefaults(SETUP)
    setLocale('de-AT')
    expect(document.cookie).toContain('locale=de-AT')
    expect(document.documentElement.lang).toBe('de-AT')
  })

  test('persist false updates the document without writing the cookie', () => {
    registerDefaults(SETUP)
    setLocale('de', { persist: false })
    expect(document.cookie).not.toContain('locale=')
    expect(document.documentElement.lang).toBe('de')
    expect(getLocale()).toBe('de')
  })

  test('writes the configured cookie name', () => {
    registerDefaults({ locales: ['en', 'fr'], sourceLocale: 'en', cookie: 'lang' })
    setLocale('fr')
    expect(document.cookie).toContain('lang=fr')
  })
})
