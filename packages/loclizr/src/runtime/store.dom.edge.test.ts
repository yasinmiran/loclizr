// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'
import { $configure1 } from './abi'
import { resetRuntime } from './__fixtures__/reset'
import { getLocale, getRawLocale, registerDefaults, setLocale, subscribe } from './store'

const SETUP = { locales: ['de', 'de-AT', 'en'], sourceLocale: 'en', cookie: 'locale' } as const

function clearCookies(): void {
  for (const pair of document.cookie.split(';')) {
    const name = pair.split('=')[0]?.trim()
    if (name !== undefined && name !== '') document.cookie = `${name}=; path=/; max-age=0`
  }
}

function countCookieReads(): () => number {
  let reads = 0
  const real = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie')
  Object.defineProperty(document, 'cookie', {
    configurable: true,
    get: () => {
      reads += 1
      return real?.get?.call(document) ?? ''
    },
    set: (value: string) => real?.set?.call(document, value),
  })
  return () => reads
}

// A rewrite of the same value leaves the cookie string as it was, so only the
// setter can show one happened.
function countCookieWrites(): () => number {
  let writes = 0
  const real = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie')
  Object.defineProperty(document, 'cookie', {
    configurable: true,
    get: () => real?.get?.call(document) ?? '',
    set: (value: string) => {
      writes += 1
      real?.set?.call(document, value)
    },
  })
  return () => writes
}

afterEach(() => {
  Reflect.deleteProperty(document, 'cookie')
  clearCookies()
  document.documentElement.removeAttribute('lang')
  resetRuntime()
  vi.restoreAllMocks()
})

describe('client detection reads the document once', () => {
  test('across many getRawLocale, getLocale and resolver calls', () => {
    const reads = countCookieReads()
    const resolve = $configure1(SETUP)
    for (let round = 0; round < 5; round += 1) {
      getRawLocale()
      getLocale()
      resolve()
    }
    expect(reads()).toBe(1)
  })

  test('not at all when setLocale ran before the first read', () => {
    const reads = countCookieReads()
    $configure1(SETUP)
    setLocale('de', { persist: false })
    expect(getRawLocale()).toBe('de')
    expect(reads()).toBe(0)
  })
})

describe('the detected cookie', () => {
  test('sets html lang to the resolved locale, with no cookie write and no notification', () => {
    document.cookie = 'locale=de; path=/'
    document.documentElement.lang = 'en'
    $configure1({ locales: ['en', 'de'], sourceLocale: 'en', cookie: 'locale' })
    const listener = vi.fn()
    subscribe(listener)
    const writes = countCookieWrites()
    expect(getLocale()).toBe('de')
    expect(document.documentElement.lang).toBe('de')
    expect(writes()).toBe(0)
    expect(listener).not.toHaveBeenCalled()
  })

  test('sets html lang when the locale list registers after the first read', () => {
    document.cookie = 'locale=de; path=/'
    document.documentElement.lang = 'en'
    const listener = vi.fn()
    subscribe(listener)
    const writes = countCookieWrites()
    expect(getRawLocale()).toBe('de')
    expect(document.documentElement.lang).toBe('en')
    $configure1(SETUP)
    expect(getLocale()).toBe('de')
    expect(document.documentElement.lang).toBe('de')
    expect(writes()).toBe(0)
    expect(listener).not.toHaveBeenCalled()
  })

  test('leaves html lang to setLocale when it ran before the list registered', () => {
    document.cookie = 'locale=de; path=/'
    getRawLocale()
    setLocale('en', { persist: false })
    $configure1(SETUP)
    expect(document.documentElement.lang).toBe('en')
  })

  test('registers into a store an older copy created without the pending field', () => {
    document.cookie = 'locale=de; path=/'
    document.documentElement.lang = 'en'
    Reflect.set(globalThis, Symbol.for('loclizr.store'), {
      raw: null,
      detected: 'de',
      setup: null,
      listeners: new Set(),
      warned: new Set(),
    })
    expect(() => $configure1(SETUP)).not.toThrow()
    expect(getLocale()).toBe('de')
  })

  test('is the only detection that writes html lang on registration', () => {
    document.documentElement.lang = 'fr'
    expect(getRawLocale()).toBe('fr')
    $configure1(SETUP)
    expect(document.documentElement.lang).toBe('fr')
  })

  test('sets html lang to the declared form of the tag it resolves to', () => {
    document.cookie = 'locale=DE-at-u-nu-latn; path=/'
    document.documentElement.lang = 'en'
    expect($configure1(SETUP)()).toBe('de-AT')
    expect(document.documentElement.lang).toBe('de-AT')
  })

  test('falls through to html lang when it is present but empty', () => {
    document.cookie = 'locale=; path=/'
    document.documentElement.lang = 'de'
    expect(getRawLocale()).toBe('de')
  })

  test('outranks html lang when it decodes to whitespace, so it matches nothing', () => {
    document.cookie = 'locale=%20; path=/'
    document.documentElement.lang = 'de'
    expect(getRawLocale()).toBe(' ')
    expect($configure1(SETUP)()).toBe('en')
  })

  test('is matched case insensitively by the resolver', () => {
    document.cookie = 'locale=DE-at; path=/'
    expect($configure1(SETUP)()).toBe('de-AT')
  })

  test('carries an extension subtag down to the declared region', () => {
    document.cookie = 'locale=de-AT-u-nu-latn; path=/'
    expect($configure1(SETUP)()).toBe('de-AT')
  })

  test('is read under the default name when nothing is registered', () => {
    document.cookie = 'lang=fr; path=/'
    document.cookie = 'locale=de; path=/'
    expect(getRawLocale()).toBe('de')
  })
})

describe('html lang as a plausible tag', () => {
  test('accepts a tag with an extension subtag', () => {
    document.documentElement.lang = 'de-AT-u-ca-gregory'
    expect(getRawLocale()).toBe('de-AT-u-ca-gregory')
    expect($configure1(SETUP)()).toBe('de-AT')
  })

  test('accepts odd casing and leaves matching to the resolver', () => {
    document.documentElement.lang = 'DE'
    expect(getRawLocale()).toBe('DE')
    expect($configure1(SETUP)()).toBe('de')
  })

  test('rejects a single letter or nine letter primary subtag', () => {
    document.documentElement.lang = 'x-klingon'
    expect(getRawLocale()).toBe('')
    resetRuntime()
    document.documentElement.lang = 'abcdefghi'
    expect(getRawLocale()).toBe('')
  })

  test('rejects an empty subtag, a trailing hyphen and surrounding whitespace', () => {
    for (const lang of ['de--AT', 'de-', ' de', 'de ', '']) {
      resetRuntime()
      document.documentElement.lang = lang
      expect(getRawLocale(), JSON.stringify(lang)).toBe('')
    }
  })

  test('rejects non ASCII letters, an emoji and a right to left mark', () => {
    for (const lang of ['dé', 'de-😀', '‏de', 'ar‏']) {
      resetRuntime()
      document.documentElement.lang = lang
      expect(getRawLocale(), JSON.stringify(lang)).toBe('')
    }
  })

  test('rejects a subtag longer than eight characters', () => {
    document.documentElement.lang = 'de-abcdefghi'
    expect(getRawLocale()).toBe('')
  })
})

describe('setLocale in a browser', () => {
  test('writes a cookie that detection reads back as the same unicode tag', () => {
    setLocale('ü-DE')
    resetRuntime()
    expect(getRawLocale()).toBe('ü-DE')
  })

  test('writes an empty value that detection then treats as absent', () => {
    setLocale('')
    expect(document.documentElement.lang).toBe('')
    resetRuntime()
    document.documentElement.lang = 'de'
    expect(getRawLocale()).toBe('de')
  })

  test('moves the store, lang and subscribers together for a tag with a lone surrogate', () => {
    registerDefaults(SETUP)
    setLocale('de')
    const listener = vi.fn()
    subscribe(listener)
    expect(() => setLocale('\uD800')).not.toThrow()
    expect(listener).toHaveBeenCalledTimes(1)
    expect(getLocale()).toBe('en')
    expect(document.documentElement.lang).toBe('\uD800')
    resetRuntime()
    registerDefaults(SETUP)
    expect(getLocale()).toBe('en')
  })

  test('overwrites the earlier cookie rather than adding a second one', () => {
    setLocale('de')
    setLocale('de-AT')
    expect(document.cookie.match(/locale=/g)).toHaveLength(1)
    expect(document.cookie).toContain('locale=de-AT')
  })

  test('with persist explicitly undefined still writes the cookie', () => {
    setLocale('de', { persist: undefined })
    expect(document.cookie).toContain('locale=de')
  })

  test('with persist true writes the cookie', () => {
    setLocale('de-AT', { persist: true })
    expect(document.cookie).toContain('locale=de-AT')
  })

  test('after a detected miss wins over a cookie written behind its back', () => {
    registerDefaults(SETUP)
    expect(getLocale()).toBe('en')
    document.cookie = 'locale=de-AT; path=/'
    setLocale('de', { persist: false })
    expect(getLocale()).toBe('de')
  })
})
