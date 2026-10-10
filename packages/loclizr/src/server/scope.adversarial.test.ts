import { AsyncLocalStorage } from 'node:async_hooks'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { NegotiateOptions } from '../types'
import { $configure1 } from '../runtime/abi'
import { resetRuntime } from '../runtime/__fixtures__/reset'
import { getLocale, getRawLocale, setLocale } from '../runtime/store'
import { localeFromHeaders, negotiate, runWithLocale, withLocale } from './index'

const OPTIONS: NegotiateOptions = {
  locales: ['de', 'de-AT', 'en', 'fr'],
  sourceLocale: 'en',
  cookie: 'locale',
}

const SETUP = { locales: ['de', 'de-AT', 'en', 'fr'], sourceLocale: 'en', cookie: 'locale' }

const SCOPE_KEY = Symbol.for('loclizr.locale')

function handle(): unknown {
  return (globalThis as unknown as Record<symbol, unknown>)[SCOPE_KEY]
}

function request(headers: Record<string, string>): Request {
  return new Request('https://example.test/cart', { headers })
}

function gate(): { readonly reached: Promise<void>; readonly open: () => void } {
  let open = (): void => {}
  const reached = new Promise<void>((done) => {
    open = () => {
      done()
    }
  })
  return { reached, open }
}

afterEach(() => {
  resetRuntime()
  vi.restoreAllMocks()
})

describe('the scope handle', () => {
  test('is installed when loclizr/server loads, before any request has run', async () => {
    resetRuntime()
    vi.resetModules()
    await import('./index')
    expect(handle()).toBeInstanceOf(AsyncLocalStorage)
  })

  test('makes getLocale() warn before the first request, as it does between requests', async () => {
    resetRuntime()
    vi.resetModules()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await import('./index')
    const store = await import('../runtime/store')
    const configure = await import('../runtime/abi')
    configure.$configure1(SETUP)
    expect(store.getLocale()).toBe('en')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toContain('outside a request scope')
  })

  test('is one immutable AsyncLocalStorage, never a locale, and is idle outside a run', () => {
    runWithLocale('de', () => 0)
    const installed = handle()
    expect(installed).toBeInstanceOf(AsyncLocalStorage)
    runWithLocale('fr', () => 0)
    expect(handle()).toBe(installed)
    expect((installed as AsyncLocalStorage<string>).getStore()).toBeUndefined()
  })

  test('carries a scope across two module instances of the same file', async () => {
    const first = await import('./index')
    vi.resetModules()
    const second = await import('../runtime/store')
    const secondServer = await import('./index')
    expect(second.getRawLocale).not.toBe(getRawLocale)
    expect(secondServer.runWithLocale).not.toBe(first.runWithLocale)
    expect(first.runWithLocale('de-AT', () => second.getRawLocale())).toBe('de-AT')
    expect(secondServer.runWithLocale('fr', () => getRawLocale())).toBe('fr')
  })
})

describe('a scoped request', () => {
  test('hands generated code the raw requested tag with no matching', () => {
    expect(runWithLocale('de-CH', () => getRawLocale())).toBe('de-CH')
    expect(runWithLocale('SP', () => getRawLocale())).toBe('SP')
    expect(runWithLocale('de-AT-1996', () => getRawLocale())).toBe('de-AT-1996')
  })

  test('is what an empty scoped tag means too, rather than falling through', () => {
    setLocale('fr')
    expect(runWithLocale('', () => getRawLocale())).toBe('')
    expect(getRawLocale()).toBe('fr')
  })

  test('lets two generated directories with different lists each resolve their own', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const first = $configure1({ locales: ['de', 'en'], sourceLocale: 'en', cookie: 'locale' })
    const second = $configure1({ locales: ['en', 'fr'], sourceLocale: 'en', cookie: 'locale' })
    runWithLocale('fr', () => {
      expect(first()).toBe('en')
      expect(second()).toBe('fr')
    })
    runWithLocale('de-CH', () => {
      expect(first()).toBe('de')
      expect(second()).toBe('en')
    })
  })

  test('restores the outer scope after nesting and after a throw', () => {
    const resolve = $configure1(SETUP)
    const seen = runWithLocale('de', () => {
      const outer = resolve()
      const inner = runWithLocale('fr', () => resolve())
      return [outer, inner, resolve()]
    })
    expect(seen).toEqual(['de', 'fr', 'de'])
    expect(() =>
      runWithLocale('de', () => {
        throw new Error('render failed')
      }),
    ).toThrow(/render failed/)
    expect(getRawLocale()).toBe('')
  })

  test('does not leak into a continuation scheduled from inside it', async () => {
    const resolve = $configure1(SETUP)
    const later = new Promise<string>((done) => {
      setTimeout(() => done(resolve()), 0)
    })
    runWithLocale('de', () => 0)
    expect(await later).toBe('en')
  })

  test('changes nothing about negotiation, which reads its argument alone', () => {
    expect(runWithLocale('fr', () => localeFromHeaders({}, OPTIONS))).toBe('en')
    expect(runWithLocale('fr', () => localeFromHeaders({ cookie: 'locale=de' }, OPTIONS))).toBe('de')
    expect(runWithLocale('fr', () => negotiate(['de-CH'], OPTIONS))).toBe('de')
  })

  test('refuses setLocale while it is active, including on an empty scoped tag', () => {
    $configure1(SETUP)
    expect(() => runWithLocale('de', () => setLocale('fr'))).toThrow(/request scope/)
    expect(() => runWithLocale('', () => setLocale('fr'))).toThrow(/request scope/)
    expect(() => setLocale('fr')).not.toThrow()
  })

  test('leaves getLocale outside it degrading to the source locale, never throwing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    $configure1(SETUP)
    runWithLocale('de', () => 0)
    expect(getLocale()).toBe('en')
    expect(runWithLocale('sp', () => getLocale())).toBe('en')
    expect(warn).toHaveBeenCalledTimes(1)
  })
})

describe('two requests in flight', () => {
  test('never observe each other locale, whichever order they resume in', async () => {
    const resolve = $configure1(SETUP)
    const first = gate()
    const second = gate()
    let started = 0
    const handler = withLocale(async () => {
      const mine = started
      started += 1
      const before = resolve()
      if (mine === 0) {
        second.open()
        await first.reached
      } else {
        await second.reached
        first.open()
      }
      return new Response(`${before}|${resolve()}`)
    }, OPTIONS)
    const [a, b] = await Promise.all([
      handler(request({ cookie: 'locale=de' })),
      handler(request({ 'accept-language': 'fr' })),
    ])
    expect(started).toBe(2)
    expect(await a.text()).toBe('de|de')
    expect(a.headers.get('Content-Language')).toBe('de')
    expect(await b.text()).toBe('fr|fr')
    expect(b.headers.get('Content-Language')).toBe('fr')
    expect(resolve()).toBe('en')
  })

  test('keep their scope across an await inside the handler', async () => {
    const resolve = $configure1(SETUP)
    const handler = withLocale(async () => {
      await Promise.resolve()
      await new Promise((done) => setTimeout(done, 1))
      return new Response(resolve())
    }, OPTIONS)
    const response = await handler(request({ cookie: 'locale=de-AT' }))
    expect(await response.text()).toBe('de-AT')
  })
})
