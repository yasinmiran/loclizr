import { afterEach, describe, expect, test, vi } from 'vitest'
import { resetRuntime } from './__fixtures__/reset'
import { setLocaleScope, storeState } from './state'
import { getLocale, getRawLocale, registerDefaults, resetLocale, setLocale, subscribe } from './store'

const SETUP = { locales: ['de', 'de-AT', 'en'], sourceLocale: 'en', cookie: 'locale' } as const

afterEach(() => {
  resetRuntime()
  vi.restoreAllMocks()
})

describe('resetLocale without a document', () => {
  test('drops the stored tag and keeps the registration', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    registerDefaults(SETUP)
    setLocale('de')
    resetLocale()
    expect(getRawLocale()).toBe('')
    expect(getLocale()).toBe('en')
    expect(storeState().setup).toEqual(SETUP)
    expect(warn).not.toHaveBeenCalled()
  })

  test('keeps listeners subscribed and notifies them', () => {
    registerDefaults(SETUP)
    setLocale('de')
    const seen: string[] = []
    subscribe(() => seen.push(getLocale()))
    resetLocale()
    setLocale('de-AT')
    expect(seen).toEqual(['en', 'de-AT'])
  })

  test('keeps the once-per-process warnings spent', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    getLocale()
    resetLocale()
    getLocale()
    expect(warn).toHaveBeenCalledTimes(1)
  })

  test('throws inside a request scope, as setLocale does', () => {
    registerDefaults(SETUP)
    setLocale('de')
    setLocaleScope({ getStore: () => 'en' })
    expect(() => resetLocale()).toThrow(
      'loclizr: resetLocale() cannot run inside a request scope. Pass { locale } per call instead.',
    )
    expect(storeState().raw).toBe('de')
  })
})
