import { afterEach, describe, expect, test, vi } from 'vitest'
import { resetRuntime } from './__fixtures__/reset'
import {
  getLocale,
  getRawLocale,
  matchLocale,
  registerDefaults,
  setLocale,
  subscribe,
} from './store'

const SETUP = { locales: ['de', 'de-AT', 'en'], sourceLocale: 'en', cookie: 'locale' } as const

afterEach(() => {
  resetRuntime()
  vi.restoreAllMocks()
})

describe('matchLocale', () => {
  test('takes an exact match before anything else', () => {
    expect(matchLocale('de-AT', SETUP.locales, 'en')).toBe('de-AT')
  })

  test('matches case insensitively and returns the declared spelling', () => {
    expect(matchLocale('DE-at', SETUP.locales, 'en')).toBe('de-AT')
  })

  test('truncates subtags progressively', () => {
    expect(matchLocale('de-AT-1996', SETUP.locales, 'en')).toBe('de-AT')
    expect(matchLocale('de-CH', SETUP.locales, 'en')).toBe('de')
    expect(matchLocale('zh-Hant-TW', ['zh', 'en'], 'en')).toBe('zh')
  })

  test('never matches sideways', () => {
    expect(matchLocale('de-DE', ['de-AT', 'en'], 'en')).toBe('en')
  })

  test('never widens a base tag onto a declared region, which is what LZ1018 warns about', () => {
    expect(matchLocale('de', ['de-AT', 'en'], 'en')).toBe('en')
  })

  test('falls back for an unknown tag, an empty tag and an empty list', () => {
    expect(matchLocale('sp', SETUP.locales, 'en')).toBe('en')
    expect(matchLocale('', SETUP.locales, 'en')).toBe('en')
    expect(matchLocale('de', [], 'en')).toBe('en')
  })
})

describe('getRawLocale', () => {
  test('is the empty string when no scope, no stored tag and no DOM', () => {
    expect(getRawLocale()).toBe('')
  })

  test('returns the stored tag verbatim, unmatched', () => {
    setLocale('sp')
    expect(getRawLocale()).toBe('sp')
  })
})

describe('getLocale', () => {
  test('returns the literal en and warns once when nothing is registered', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(getLocale()).toBe('en')
    expect(getLocale()).toBe('en')
    expect(warn).toHaveBeenCalledTimes(1)
  })

  test('returns the stored tag when nothing is registered', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    setLocale('de')
    expect(getLocale()).toBe('de')
  })

  test('matches the stored tag against the registered list', () => {
    registerDefaults(SETUP)
    setLocale('de-at')
    expect(getLocale()).toBe('de-AT')
  })

  test('renders the source locale for a tampered tag, never undefined', () => {
    registerDefaults(SETUP)
    setLocale('sp')
    expect(getLocale()).toBe('en')
  })
})

describe('registerDefaults', () => {
  test('keeps the first registration and stays silent on an identical one', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    registerDefaults(SETUP)
    registerDefaults({ locales: ['de', 'de-AT', 'en'], sourceLocale: 'en', cookie: 'locale' })
    expect(warn).not.toHaveBeenCalled()
  })

  test('ignores a second registration with a different set and warns once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    registerDefaults(SETUP)
    registerDefaults({ locales: ['en', 'fr'], sourceLocale: 'fr', cookie: 'lang' })
    registerDefaults({ locales: ['en', 'es'], sourceLocale: 'es', cookie: 'lang' })
    expect(warn).toHaveBeenCalledTimes(1)
    setLocale('fr')
    expect(getLocale()).toBe('en')
  })
})

describe('an environment with no document', () => {
  test('keeps an in-memory store and persists nothing', () => {
    expect(typeof document).toBe('undefined')
    registerDefaults(SETUP)
    const listener = vi.fn()
    subscribe(listener)
    setLocale('de')
    expect(listener).toHaveBeenCalledTimes(1)
    expect(getLocale()).toBe('de')
  })
})

describe('the shared store handle', () => {
  test('shares one subscriber list across two module instances', async () => {
    const first = await import('./store')
    vi.resetModules()
    const second = await import('./store')
    expect(second).not.toBe(first)
    const listener = vi.fn()
    first.subscribe(listener)
    second.setLocale('de')
    expect(listener).toHaveBeenCalledTimes(1)
    expect(first.getRawLocale()).toBe('de')
  })
})

describe('subscribe', () => {
  test('notifies every listener on setLocale and stops after unsubscribing', () => {
    const seen: string[] = []
    const stop = subscribe(() => seen.push(getRawLocale()))
    const other = vi.fn()
    const stopOther = subscribe(other)
    setLocale('de')
    stop()
    setLocale('en')
    stopOther()
    setLocale('de')
    expect(seen).toEqual(['de'])
    expect(other).toHaveBeenCalledTimes(2)
  })

  test('survives a listener that unsubscribes during the notification', () => {
    const stop = subscribe(() => stop())
    const after = vi.fn()
    subscribe(after)
    expect(() => setLocale('de')).not.toThrow()
    expect(after).toHaveBeenCalledTimes(1)
  })
})
