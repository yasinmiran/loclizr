import { afterEach, describe, expect, test, vi } from 'vitest'
import { runWithLocale } from '../server/index'
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
  vi.unstubAllEnvs()
  resetRuntime()
  vi.restoreAllMocks()
})

describe('matchLocale on odd tags', () => {
  test('climbs out of a unicode extension to the declared region', () => {
    expect(matchLocale('de-AT-u-nu-latn', SETUP.locales, 'en')).toBe('de-AT')
    expect(matchLocale('de-u-ca-gregory', SETUP.locales, 'en')).toBe('de')
  })

  test('climbs out of a private use subtag', () => {
    expect(matchLocale('de-x-informal', SETUP.locales, 'en')).toBe('de')
  })

  test('folds case on the declared side too and returns the declared spelling', () => {
    expect(matchLocale('zh-hant', ['zh-Hant', 'en'], 'en')).toBe('zh-Hant')
    expect(matchLocale('ZH-HANT-TW', ['zh-Hant', 'en'], 'en')).toBe('zh-Hant')
  })

  test('takes the first declared spelling when two differ only in case', () => {
    expect(matchLocale('EN-us', ['en-us', 'en-US'], 'de')).toBe('en-us')
    expect(matchLocale('EN-us', ['en-US', 'en-us'], 'de')).toBe('en-US')
  })

  test('does not truncate on an underscore, which is not a BCP 47 separator', () => {
    expect(matchLocale('de_AT', SETUP.locales, 'en')).toBe('en')
  })

  test('drops a trailing hyphen on the way down to the base tag', () => {
    expect(matchLocale('de-', SETUP.locales, 'en')).toBe('de')
  })

  test('never reaches a declared tag through a leading hyphen', () => {
    expect(matchLocale('-de', SETUP.locales, 'en')).toBe('en')
  })

  test('falls back for whitespace rather than trimming it into a match', () => {
    expect(matchLocale(' de', SETUP.locales, 'en')).toBe('en')
    expect(matchLocale('de ', SETUP.locales, 'en')).toBe('en')
    expect(matchLocale(' ', SETUP.locales, 'en')).toBe('en')
  })

  test('folds ASCII case only, so a dotted capital I never becomes a declared i', () => {
    expect(matchLocale('IT', ['it', 'en'], 'en')).toBe('it')
    expect(matchLocale('İT', ['it', 'en'], 'en')).toBe('en')
  })

  test('matches a declared tag that happens to be a prototype key', () => {
    expect(matchLocale('__PROTO__', ['__proto__', 'en'], 'en')).toBe('__proto__')
    expect(matchLocale('constructor', ['en'], 'en')).toBe('en')
  })

  test('returns the fallback even when the fallback is not declared', () => {
    expect(matchLocale('fr', ['de'], 'en')).toBe('en')
  })

  test('returns the fallback for an empty request even when the empty tag is declared', () => {
    expect(matchLocale('', ['', 'de'], 'en')).toBe('en')
  })

  test('walks a tag with thousands of subtags down to its base', () => {
    const tag = `de${'-a'.repeat(2000)}`
    expect(matchLocale(tag, SETUP.locales, 'en')).toBe('de')
    expect(matchLocale(`zz${'-a'.repeat(2000)}`, SETUP.locales, 'en')).toBe('en')
  })

  test('answers the same twice for the same input', () => {
    const inputs = ['de-AT-1996', 'DE', 'sp', '', 'de-CH']
    const first = inputs.map((tag) => matchLocale(tag, SETUP.locales, 'en'))
    const second = inputs.map((tag) => matchLocale(tag, SETUP.locales, 'en'))
    expect(second).toEqual(first)
  })
})

describe('getLocale with nothing detected', () => {
  test('returns the registered source locale rather than the literal en', () => {
    registerDefaults({ locales: ['fr', 'de'], sourceLocale: 'fr', cookie: 'locale' })
    expect(getLocale()).toBe('fr')
  })

  test('stays silent when no request scope was ever installed', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    registerDefaults(SETUP)
    expect(getLocale()).toBe('en')
    expect(warn).not.toHaveBeenCalled()
  })

  test('returns the source locale for an empty stored tag once registered', () => {
    registerDefaults(SETUP)
    setLocale('')
    expect(getRawLocale()).toBe('')
    expect(getLocale()).toBe('en')
  })
})

describe('getLocale warnings', () => {
  test('prefix every message with the package name', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    getLocale()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/^loclizr: /)
  })

  test('name the missing generated module import when nothing is registered', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    getLocale()
    expect(String(warn.mock.calls[0]?.[0])).toContain('generated')
  })

  test('name runWithLocale for an idle request scope', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    registerDefaults(SETUP)
    runWithLocale('de', () => 0)
    getLocale()
    expect(String(warn.mock.calls[0]?.[0])).toContain('runWithLocale()')
  })

  test('warn about both an idle scope and a missing registration, once each', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    runWithLocale('de', () => 0)
    getLocale()
    getLocale()
    expect(warn).toHaveBeenCalledTimes(2)
  })

  test('start over once the store handle is dropped', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    getLocale()
    resetRuntime()
    getLocale()
    expect(warn).toHaveBeenCalledTimes(2)
  })

  test('stay silent inside a scope whose locale is the empty string', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    registerDefaults(SETUP)
    runWithLocale('de', () => 0)
    expect(runWithLocale('', () => getLocale())).toBe('en')
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('setLocale inside a request scope', () => {
  test('throws even when the scope holds the empty string', () => {
    expect(() => runWithLocale('', () => setLocale('de'))).toThrow(/request scope/)
  })

  test('leaves the stored tag and the subscribers untouched when it throws', () => {
    const listener = vi.fn()
    subscribe(listener)
    setLocale('de-AT')
    listener.mockClear()
    expect(() => runWithLocale('de', () => setLocale('en'))).toThrow()
    expect(getRawLocale()).toBe('de-AT')
    expect(listener).not.toHaveBeenCalled()
  })

  test('works again once the scope has exited', () => {
    runWithLocale('de', () => 0)
    expect(() => setLocale('de-AT')).not.toThrow()
    expect(getRawLocale()).toBe('de-AT')
  })
})

describe('setLocale in memory', () => {
  test('stores unicode and a lone surrogate verbatim when there is no document', () => {
    setLocale('ü-DE')
    expect(getRawLocale()).toBe('ü-DE')
    setLocale('\uD800')
    expect(getRawLocale()).toBe('\uD800')
  })

  test('replaces a stored tag with the next one, never merging them', () => {
    setLocale('de')
    setLocale('de-AT')
    expect(getRawLocale()).toBe('de-AT')
  })
})

describe('subscribe', () => {
  test('notifies a function subscribed twice only once per switch', () => {
    const listener = vi.fn()
    subscribe(listener)
    subscribe(listener)
    setLocale('de')
    expect(listener).toHaveBeenCalledTimes(1)
  })

  test('does not call a listener added during a notification until the next switch', () => {
    const late = vi.fn()
    subscribe(() => {
      subscribe(late)
    })
    setLocale('de')
    expect(late).not.toHaveBeenCalled()
    setLocale('en')
    expect(late).toHaveBeenCalledTimes(1)
  })

  test('still calls a listener another one removed during the same notification', () => {
    const second = vi.fn()
    let stopSecond: () => void = () => {}
    subscribe(() => stopSecond())
    stopSecond = subscribe(second)
    setLocale('de')
    expect(second).toHaveBeenCalledTimes(1)
    setLocale('en')
    expect(second).toHaveBeenCalledTimes(1)
  })

  test('notifies in subscription order', () => {
    const order: number[] = []
    for (const index of [1, 2, 3, 4]) subscribe(() => order.push(index))
    setLocale('de')
    expect(order).toEqual([1, 2, 3, 4])
  })

  test('lets a listener switch again without losing the final tag', () => {
    let redirected = false
    subscribe(() => {
      if (redirected) return
      redirected = true
      setLocale('de-AT')
    })
    setLocale('de')
    expect(getRawLocale()).toBe('de-AT')
  })
})

describe('registerDefaults', () => {
  test('keeps the first registration when a second differs only by cookie name', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    registerDefaults(SETUP)
    registerDefaults({ ...SETUP, cookie: 'lang' })
    expect(warn).toHaveBeenCalledTimes(1)
  })

  test('keeps the first registration when a second differs only by locale case', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    registerDefaults(SETUP)
    registerDefaults({ ...SETUP, locales: ['de', 'de-at', 'en'] })
    expect(warn).toHaveBeenCalledTimes(1)
    setLocale('DE-AT')
    expect(getLocale()).toBe('de-AT')
  })

  test('accepts an empty locale list and still answers the source locale', () => {
    registerDefaults({ locales: [], sourceLocale: 'en', cookie: 'locale' })
    setLocale('de')
    expect(getLocale()).toBe('en')
  })
})
