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

const STORE_KEY = Symbol.for('loclizr.store')

function storeHandle(): Record<string, unknown> | undefined {
  return (globalThis as unknown as Record<symbol, Record<string, unknown> | undefined>)[STORE_KEY]
}

afterEach(() => {
  vi.unstubAllEnvs()
  resetRuntime()
  vi.restoreAllMocks()
})

describe('getRawLocale', () => {
  test('says nothing about a missing registration, only about an escaped scope', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(runWithLocale('sp', () => getRawLocale())).toBe('sp')
    expect(warn).not.toHaveBeenCalled()
    expect(getRawLocale()).toBe('')
    expect(getRawLocale()).toBe('')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toContain('outside a request scope')
    setLocale('zz-ZZ')
    expect(getRawLocale()).toBe('zz-ZZ')
    expect(warn).toHaveBeenCalledTimes(1)
  })

  test('applies no source-locale default once a list is registered', () => {
    registerDefaults(SETUP)
    expect(getRawLocale()).toBe('')
    expect(getLocale()).toBe('en')
    setLocale('sp')
    expect(getRawLocale()).toBe('sp')
    expect(getLocale()).toBe('en')
  })
})

describe('getLocale with an installed but idle scope', () => {
  test('degrades to the source locale, warns once, and never throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    registerDefaults(SETUP)
    runWithLocale('de', () => 0)
    expect(() => getLocale()).not.toThrow()
    expect(getLocale()).toBe('en')
    expect(getLocale()).toBe('en')
    expect(warn).toHaveBeenCalledTimes(1)
  })

  test('says nothing at all in production, and answers the same', () => {
    vi.stubEnv('NODE_ENV', 'production')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    registerDefaults(SETUP)
    runWithLocale('de', () => 0)
    expect(getLocale()).toBe('en')
    expect(warn).not.toHaveBeenCalled()
  })

  test('stays quiet once a switch has given it something to return', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    registerDefaults(SETUP)
    runWithLocale('de', () => 0)
    setLocale('de-AT')
    expect(getLocale()).toBe('de-AT')
    expect(warn).not.toHaveBeenCalled()
  })

  test('still answers with nothing registered at all', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    runWithLocale('de', () => 0)
    expect(getLocale()).toBe('en')
    expect(matchLocale('de', [], 'en')).toBe('en')
    expect(matchLocale('', [], 'de')).toBe('de')
  })
})

describe('the store handle', () => {
  test('carries the raw tag, the listeners and the setup, and nothing locale shaped', () => {
    registerDefaults(SETUP)
    setLocale('de')
    const handle = storeHandle()
    expect(handle).toBeDefined()
    expect(Object.keys(handle ?? {})).toEqual(expect.arrayContaining(['raw', 'listeners', 'setup']))
    expect(handle?.['raw']).toBe('de')
    expect(handle?.['setup']).toEqual(SETUP)
    expect(handle?.['listeners']).toBeInstanceOf(Set)
  })

  test('shares one registration across two module instances', async () => {
    const first = await import('./store')
    vi.resetModules()
    const second = await import('./store')
    expect(second.getLocale).not.toBe(first.getLocale)
    first.registerDefaults(SETUP)
    second.setLocale('de-at')
    expect(first.getLocale()).toBe('de-AT')
    expect(second.getLocale()).toBe('de-AT')
    expect(second.getRawLocale()).toBe('de-at')
  })

  test('is recreated from scratch after the handle is dropped', () => {
    registerDefaults(SETUP)
    setLocale('de')
    resetRuntime()
    expect(storeHandle()).toBeUndefined()
    expect(getRawLocale()).toBe('')
  })
})

describe('subscribe', () => {
  test('notifies every listener exactly once per switch', () => {
    const calls: string[] = []
    subscribe(() => calls.push('a'))
    subscribe(() => calls.push('b'))
    subscribe(() => calls.push('c'))
    setLocale('de')
    expect(calls.filter((name) => name === 'a')).toHaveLength(1)
    expect(calls.filter((name) => name === 'b')).toHaveLength(1)
    expect(calls.filter((name) => name === 'c')).toHaveLength(1)
  })

  test('tolerates an unsubscribe called twice and after a reset', () => {
    const listener = vi.fn()
    const stop = subscribe(listener)
    stop()
    expect(() => stop()).not.toThrow()
    setLocale('de')
    expect(listener).not.toHaveBeenCalled()
    const other = subscribe(vi.fn())
    resetRuntime()
    expect(() => other()).not.toThrow()
  })

  test('sees the new tag already stored when it runs', () => {
    const seen: string[] = []
    subscribe(() => seen.push(getRawLocale()))
    setLocale('de')
    setLocale('de-AT')
    expect(seen).toEqual(['de', 'de-AT'])
  })
})
