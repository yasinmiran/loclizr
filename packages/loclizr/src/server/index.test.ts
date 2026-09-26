import { afterEach, describe, expect, test, vi } from 'vitest'
import type { NegotiateOptions } from '../types'
import { $configure1 } from '../runtime/abi'
import { resetRuntime } from '../runtime/__fixtures__/reset'
import { getLocale, setLocale } from '../runtime/store'
import {
  localeFromHeaders,
  localeFromRequest,
  negotiate,
  runWithLocale,
  withLocale,
} from './index'

const OPTIONS: NegotiateOptions = {
  locales: ['de', 'de-AT', 'en', 'fr'],
  sourceLocale: 'en',
  cookie: 'locale',
}

const SETUP = { locales: ['de', 'de-AT', 'en', 'fr'], sourceLocale: 'en', cookie: 'locale' }

interface Gate {
  readonly reached: Promise<void>
  readonly open: () => void
}

function request(headers: Record<string, string>): Request {
  return new Request('https://example.test/cart', { headers })
}

function gate(): Gate {
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

describe('negotiate', () => {
  test('lookups by subtag truncation', () => {
    expect(negotiate(['de-CH'], OPTIONS)).toBe('de')
    expect(negotiate(['de-AT-1996'], OPTIONS)).toBe('de-AT')
  })

  test('orders by quality and keeps header order on a tie', () => {
    expect(negotiate(['en;q=0.8', 'de;q=0.9'], OPTIONS)).toBe('de')
    expect(negotiate(['fr', 'de'], OPTIONS)).toBe('fr')
  })

  test('drops a zero quality and ignores the wildcard', () => {
    expect(negotiate(['de;q=0', 'en'], OPTIONS)).toBe('en')
    expect(negotiate(['*'], OPTIONS)).toBe('en')
  })

  test('gives every accepted range a turn before the source locale', () => {
    expect(negotiate(['sp', 'de'], OPTIONS)).toBe('de')
  })

  test('falls to the source locale when nothing matches', () => {
    expect(negotiate(['sp', 'zz-ZZ'], OPTIONS)).toBe('en')
    expect(negotiate([], OPTIONS)).toBe('en')
  })
})

describe('localeFromHeaders', () => {
  test('reads the configured cookie before Accept-Language', () => {
    expect(localeFromHeaders({ cookie: 'locale=de', acceptLanguage: 'fr' }, OPTIONS)).toBe('de')
    expect(
      localeFromHeaders({ cookie: 'session=x; locale=de-AT; theme=dark' }, OPTIONS),
    ).toBe('de-AT')
    expect(
      localeFromHeaders({ cookie: 'lang=fr' }, { ...OPTIONS, cookie: 'lang' }),
    ).toBe('fr')
  })

  test('a cookie the locale list cannot match resolves to the source locale', () => {
    expect(localeFromHeaders({ cookie: 'locale=sp', acceptLanguage: 'de' }, OPTIONS)).toBe('en')
  })

  test('negotiates Accept-Language when no cookie is present', () => {
    expect(
      localeFromHeaders({ acceptLanguage: 'de-CH,en;q=0.5,fr;q=0.1' }, OPTIONS),
    ).toBe('de')
    expect(localeFromHeaders({ cookie: 'theme=dark', acceptLanguage: 'fr' }, OPTIONS)).toBe('fr')
  })

  test('falls to the source locale with neither header', () => {
    expect(localeFromHeaders({}, OPTIONS)).toBe('en')
    expect(localeFromHeaders({ cookie: '', acceptLanguage: '' }, OPTIONS)).toBe('en')
  })
})

describe('localeFromRequest', () => {
  test('agrees with localeFromHeaders on both headers, either one, and neither', () => {
    const cases = [
      { cookie: 'locale=de', acceptLanguage: 'fr' },
      { cookie: 'locale=de' },
      { acceptLanguage: 'fr,de;q=0.5' },
      {},
    ]
    for (const headers of cases) {
      const wire: Record<string, string> = {}
      if (headers.cookie !== undefined) wire['cookie'] = headers.cookie
      if (headers.acceptLanguage !== undefined) wire['accept-language'] = headers.acceptLanguage
      expect(localeFromRequest(request(wire), OPTIONS)).toBe(localeFromHeaders(headers, OPTIONS))
    }
  })
})

describe('runWithLocale', () => {
  test('als-scopes-are-isolated', async () => {
    const resolve = $configure1(SETUP)
    // Each scope blocks until the other has taken its first reading, so the
    // interleaving is a property of the test rather than of the scheduler.
    const observe = (locale: string, mine: Gate, other: Gate): Promise<readonly string[]> =>
      runWithLocale(locale, async () => {
        const before = resolve()
        mine.open()
        await other.reached
        const during = resolve()
        await new Promise((done) => setTimeout(done, 0))
        return [before, during, resolve()]
      })
    const de = gate()
    const en = gate()
    const [seenDe, seenEn] = await Promise.all([observe('de', de, en), observe('en', en, de)])
    expect(seenDe).toEqual(['de', 'de', 'de'])
    expect(seenEn).toEqual(['en', 'en', 'en'])
    expect(resolve()).toBe('en')
  })

  test('a scoped locale outranks the stored tag and leaves it untouched', () => {
    const resolve = $configure1(SETUP)
    setLocale('fr')
    expect(runWithLocale('de', () => resolve())).toBe('de')
    expect(resolve()).toBe('fr')
  })

  test('getLocale outside a scope returns the source locale, warns once, and never throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    $configure1(SETUP)
    runWithLocale('de', () => 0)
    expect(getLocale()).toBe('en')
    expect(getLocale()).toBe('en')
    expect(warn).toHaveBeenCalledTimes(1)
  })

  test('setLocale throws inside a scope and works while the scope is idle', () => {
    $configure1(SETUP)
    runWithLocale('de', () => 0)
    expect(() => setLocale('fr')).not.toThrow()
    expect(() => runWithLocale('de', () => setLocale('fr'))).toThrow(/request scope/)
  })
})

describe('withLocale', () => {
  test('negotiates, scopes the handler, and sets Content-Language and Vary', async () => {
    const resolve = $configure1(SETUP)
    const handler = withLocale(() => new Response(resolve()), OPTIONS)
    const response = await handler(request({ cookie: 'locale=de-AT' }))
    expect(await response.text()).toBe('de-AT')
    expect(response.headers.get('Content-Language')).toBe('de-AT')
    expect(response.headers.get('Vary')).toBe('Accept-Language')
  })

  test('appends to an existing Vary rather than replacing it', async () => {
    const handler = withLocale(
      () => new Response('ok', { headers: { Vary: 'Cookie' } }),
      OPTIONS,
    )
    const response = await handler(request({ 'accept-language': 'fr' }))
    expect(response.headers.get('Vary')).toBe('Cookie, Accept-Language')
    expect(response.headers.get('Content-Language')).toBe('fr')
  })

  test('leaves an already listed Vary field alone', async () => {
    const handler = withLocale(
      () => new Response('ok', { headers: { Vary: 'Accept-Language, Cookie' } }),
      OPTIONS,
    )
    const response = await handler(request({}))
    expect(response.headers.get('Vary')).toBe('Accept-Language, Cookie')
  })

  test('rebuilds a response whose headers are immutable', async () => {
    const handler = withLocale(() => Response.redirect('https://example.test/de/cart', 302), OPTIONS)
    const response = await handler(request({ cookie: 'locale=de' }))
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('https://example.test/de/cart')
    expect(response.headers.get('Content-Language')).toBe('de')
    expect(response.headers.get('Vary')).toBe('Accept-Language')
  })

  test('passes the rest of the handler arguments through', async () => {
    const handler = withLocale(
      (_request: Request, extra: string) => new Response(extra),
      OPTIONS,
    )
    const response = await handler(request({}), 'context')
    expect(await response.text()).toBe('context')
  })
})
