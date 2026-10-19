// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'
import { resetRuntime } from './__fixtures__/reset'
import { storeState } from './state'
import { getLocale, registerDefaults, resetLocale, setLocale } from './store'

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

describe('resetLocale with a document', () => {
  test('expires the cookie and removes <html lang>, so the source locale comes back', () => {
    registerDefaults(SETUP)
    setLocale('de')
    expect(document.cookie).toBe('locale=de')
    resetLocale()
    expect(document.cookie).toBe('')
    expect(document.documentElement.hasAttribute('lang')).toBe(false)
    expect(getLocale()).toBe('en')
  })

  test('expires the cookie under the registered name', () => {
    registerDefaults({ ...SETUP, cookie: 'lang' })
    setLocale('de')
    document.cookie = 'locale=de-AT; path=/'
    resetLocale()
    expect(document.cookie).toBe('locale=de-AT')
  })

  test('unlatches detection, so the next read detects again', () => {
    registerDefaults(SETUP)
    expect(getLocale()).toBe('en')
    resetLocale()
    document.cookie = 'locale=de-AT; path=/'
    expect(getLocale()).toBe('de-AT')
    expect(document.documentElement.lang).toBe('de-AT')
  })

  test('drops a detected cookie still waiting for a registration to write <html lang>', () => {
    document.cookie = 'locale=de; path=/'
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    getLocale()
    expect(storeState().pendingLang).toBe('de')
    resetLocale()
    expect(storeState().pendingLang).toBe(null)
    registerDefaults(SETUP)
    expect(document.documentElement.hasAttribute('lang')).toBe(false)
  })
})
