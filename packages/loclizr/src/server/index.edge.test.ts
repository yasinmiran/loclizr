import { afterEach, describe, expect, test, vi } from 'vitest'
import type { NegotiateOptions } from '../types'
import { $configure1 } from '../runtime/abi'
import { resetRuntime } from '../runtime/__fixtures__/reset'
import { getRawLocale, setLocale } from '../runtime/store'
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

function request(headers: HeadersInit = {}): Request {
  return new Request('https://example.test/cart', { headers })
}

// Stands in for a response from fetch(), whose headers are immutable: a body
// and a status only a real constructor call can carry, plus the guard.
function immutable(response: Response): Response {
  Object.defineProperty(response.headers, 'set', {
    value: () => {
      throw new TypeError('immutable')
    },
  })
  return response
}

function tick(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms))
}

afterEach(() => {
  resetRuntime()
  vi.restoreAllMocks()
})

describe('negotiate on whitespace and invisible characters', () => {
  test('trims tabs and no-break spaces around a range', () => {
    expect(negotiate(['\tde\t'], OPTIONS)).toBe('de')
    expect(negotiate([' fr '], OPTIONS)).toBe('fr')
  })

  test('treats a right-to-left mark as part of the tag, so the next range gets its turn', () => {
    expect(negotiate(['‏de', 'fr'], OPTIONS)).toBe('fr')
  })

  test('skips empty and blank entries left by stray commas', () => {
    expect(negotiate(['', ' ', 'fr'], OPTIONS)).toBe('fr')
    expect(localeFromHeaders({ acceptLanguage: 'fr,' }, OPTIONS)).toBe('fr')
    expect(localeFromHeaders({ acceptLanguage: ',fr' }, OPTIONS)).toBe('fr')
  })

  test('resolves emoji, a lone surrogate and a combining mark to the source locale', () => {
    expect(negotiate(['\u{1F1E9}\u{1F1EA}'], OPTIONS)).toBe('en')
    expect(negotiate(['\uD800'], OPTIONS)).toBe('en')
    expect(negotiate(['dé'], OPTIONS)).toBe('en')
  })

  test('answers a Unicode case fold with a declared spelling, never the input', () => {
    const options: NegotiateOptions = { locales: ['ko', 'en'], sourceLocale: 'en' }
    const kelvin = 'Ko'
    const resolved = negotiate([kelvin], options)
    expect(['ko', 'en']).toContain(resolved)
    expect(resolved).not.toBe(kelvin)
  })
})

describe('negotiate on quality values', () => {
  test('reads the q parameter case insensitively and around spaces', () => {
    expect(negotiate(['de ; Q = 0.1', 'fr;q=0.2'], OPTIONS)).toBe('fr')
  })

  test('ignores parameters other than q', () => {
    expect(negotiate(['de;level=1', 'fr;q=0.5'], OPTIONS)).toBe('de')
  })

  test('drops a negative zero and a NaN quality', () => {
    expect(negotiate(['de;q=-0'], OPTIONS)).toBe('en')
    expect(negotiate(['de;q=NaN', 'fr;q=0.1'], OPTIONS)).toBe('fr')
  })

  test('keeps the smallest positive quality and ranks three decimal places', () => {
    expect(negotiate(['de;q=0.001'], OPTIONS)).toBe('de')
    expect(negotiate(['fr;q=0.501', 'de;q=0.502'], OPTIONS)).toBe('de')
  })

  test('reads a quality written without its leading zero', () => {
    expect(negotiate(['fr;q=0.4', 'de;q=.5'], OPTIONS)).toBe('de')
  })

  test('ties an explicit q=1 with an implicit one and keeps header order', () => {
    expect(negotiate(['fr;q=1', 'de'], OPTIONS)).toBe('fr')
    expect(negotiate(['de', 'fr;q=1.0'], OPTIONS)).toBe('de')
  })
})

describe('negotiate on tag shape', () => {
  test('truncates extension, private use and script subtags onto a declared locale', () => {
    expect(negotiate(['de-AT-u-ca-buddhist'], OPTIONS)).toBe('de-AT')
    expect(negotiate(['de-x-private'], OPTIONS)).toBe('de')
    expect(negotiate(['fr-Latn-FR'], OPTIONS)).toBe('fr')
  })

  test('does not treat an underscore as a subtag boundary', () => {
    expect(negotiate(['de_AT', 'fr'], OPTIONS)).toBe('fr')
  })

  test('skips a wildcard with a region attached', () => {
    expect(negotiate(['*-DE', 'fr'], OPTIONS)).toBe('fr')
  })

  test('passes over prototype key names to the next range', () => {
    expect(negotiate(['__proto__', 'constructor', 'toString', 'prototype', 'fr'], OPTIONS)).toBe(
      'fr',
    )
  })

  test('lets a range that truncates onto the source locale stop the walk', () => {
    expect(negotiate(['en-GB', 'de'], OPTIONS)).toBe('en')
  })
})

describe('negotiate on the locale list', () => {
  test('answers the source locale for any range when the list is empty', () => {
    const options: NegotiateOptions = { locales: [], sourceLocale: 'en' }
    expect(negotiate(['de', 'en', 'fr'], options)).toBe('en')
  })

  test('returns the source locale verbatim, even undeclared and oddly cased', () => {
    const options: NegotiateOptions = { locales: ['de'], sourceLocale: 'EN-us' }
    expect(negotiate(['fr'], options)).toBe('EN-us')
  })

  test('answers with the first declared spelling when two differ only in case', () => {
    const options: NegotiateOptions = { locales: ['DE', 'de'], sourceLocale: 'en' }
    expect(negotiate(['de'], options)).toBe('DE')
  })

  test('leaves a frozen input untouched and answers the same twice', () => {
    const accepted = Object.freeze(['fr;q=0.5', 'de;q=0.5', 'de-AT;q=0.9'])
    const first = negotiate(accepted, OPTIONS)
    expect(negotiate(accepted, OPTIONS)).toBe(first)
    expect(first).toBe('de-AT')
    expect(accepted).toEqual(['fr;q=0.5', 'de;q=0.5', 'de-AT;q=0.9'])
  })
})

describe('localeFromHeaders', () => {
  test('falls through to Accept-Language on an empty cookie header', () => {
    expect(localeFromHeaders({ cookie: '', acceptLanguage: 'fr' }, OPTIONS)).toBe('fr')
  })

  test('treats a named cookie with an empty value as absent, as the client does', () => {
    expect(localeFromHeaders({ cookie: 'locale=', acceptLanguage: 'fr' }, OPTIONS)).toBe('fr')
    expect(localeFromHeaders({ cookie: 'locale=; theme=dark' }, OPTIONS)).toBe('en')
  })

  test('takes the first of two cookies with the configured name', () => {
    expect(localeFromHeaders({ cookie: 'locale=fr; locale=de' }, OPTIONS)).toBe('fr')
  })

  test('percent decodes the cookie before matching it', () => {
    expect(localeFromHeaders({ cookie: 'locale=de%2DAT' }, OPTIONS)).toBe('de-AT')
    expect(localeFromHeaders({ cookie: 'locale=DE%2Dat' }, OPTIONS)).toBe('de-AT')
  })

  test('ignores a cookie whose name only contains the configured one', () => {
    expect(
      localeFromHeaders({ cookie: 'locales=fr; xlocale=fr', acceptLanguage: 'de-AT' }, OPTIONS),
    ).toBe('de-AT')
  })

  test('treats explicitly undefined fields the same as absent ones', () => {
    expect(localeFromHeaders({ cookie: undefined, acceptLanguage: undefined }, OPTIONS)).toBe('en')
    expect(localeFromHeaders({ cookie: undefined, acceptLanguage: 'fr' }, OPTIONS)).toBe('fr')
  })

  test('reads the default cookie name when the option is explicitly undefined', () => {
    const options: NegotiateOptions = { ...OPTIONS, cookie: undefined }
    expect(localeFromHeaders({ cookie: 'locale=fr' }, options)).toBe('fr')
  })

  test('reads a cookie named after a prototype key', () => {
    expect(localeFromHeaders({ cookie: 'constructor=fr' }, { ...OPTIONS, cookie: 'constructor' })).toBe(
      'fr',
    )
    expect(localeFromHeaders({ cookie: '__proto__=de' }, { ...OPTIONS, cookie: '__proto__' })).toBe(
      'de',
    )
  })

  test('falls to the source locale on an Accept-Language of tabs and line breaks', () => {
    expect(localeFromHeaders({ acceptLanguage: '\t\r\n' }, OPTIONS)).toBe('en')
  })
})

describe('localeFromRequest', () => {
  test('finds the locale cookie in a second Cookie field', () => {
    const headers = new Headers()
    headers.append('cookie', 'session=x')
    headers.append('cookie', 'locale=de')
    expect(localeFromRequest(request(headers), OPTIONS)).toBe('de')
  })

  test('reads two Accept-Language fields as one list', () => {
    const headers = new Headers()
    headers.append('accept-language', 'zz')
    headers.append('accept-language', 'fr')
    expect(localeFromRequest(request(headers), OPTIONS)).toBe('fr')
  })

  test('does not care how the header names are cased on the wire', () => {
    expect(localeFromRequest(request({ COOKIE: 'locale=de' }), OPTIONS)).toBe('de')
    expect(localeFromRequest(request({ 'Accept-Language': 'fr' }), OPTIONS)).toBe('fr')
  })
})

describe('runWithLocale', () => {
  test('returns what fn returns, by identity', () => {
    const value = { rendered: true }
    const pending = Promise.resolve(1)
    expect(runWithLocale('de', () => value)).toBe(value)
    expect(runWithLocale('de', () => pending)).toBe(pending)
    expect(runWithLocale('de', () => undefined)).toBeUndefined()
  })

  test('rethrows a thrown non-Error value unchanged', () => {
    const thrown = { reason: 'not an error' }
    let caught: unknown
    try {
      runWithLocale('de', () => {
        throw thrown
      })
    } catch (error) {
      caught = error
    }
    expect(caught).toBe(thrown)
    expect(getRawLocale()).toBe('')
  })

  test('reaches a timeout, an immediate, a microtask and a nextTick scheduled inside it', async () => {
    const seen = await runWithLocale('de-AT', () =>
      Promise.all([
        new Promise<string>((done) => setTimeout(() => done(getRawLocale()), 0)),
        new Promise<string>((done) => setImmediate(() => done(getRawLocale()))),
        new Promise<string>((done) => queueMicrotask(() => done(getRawLocale()))),
        new Promise<string>((done) => process.nextTick(() => done(getRawLocale()))),
      ]),
    )
    expect(seen).toEqual(['de-AT', 'de-AT', 'de-AT', 'de-AT'])
  })

  test('unwinds three nested scopes in order', () => {
    const seen: string[] = []
    runWithLocale('de', () => {
      seen.push(getRawLocale())
      runWithLocale('fr', () => {
        seen.push(getRawLocale())
        runWithLocale('de-AT', () => seen.push(getRawLocale()))
        seen.push(getRawLocale())
      })
      seen.push(getRawLocale())
    })
    expect(seen).toEqual(['de', 'fr', 'de-AT', 'fr', 'de'])
  })

  test('resolves a prototype-named or emoji scoped tag to the source locale', () => {
    const resolve = $configure1(SETUP)
    for (const tag of ['__proto__', 'constructor', 'toString', 'prototype', '\u{1F600}']) {
      expect(runWithLocale(tag, () => getRawLocale()), tag).toBe(tag)
      expect(runWithLocale(tag, () => resolve()), tag).toBe('en')
    }
  })

  test('keeps fifty concurrent scopes apart under staggered delays', async () => {
    const resolve = $configure1(SETUP)
    const tags = ['de', 'de-AT', 'en', 'fr']
    const runs = Array.from({ length: 50 }, (_, index) => {
      const tag = tags[index % tags.length] ?? 'en'
      return runWithLocale(tag, async () => {
        await tick((index * 7) % 5)
        const middle = resolve()
        await tick((index * 3) % 4)
        return { tag, middle, end: resolve() }
      })
    })
    for (const { tag, middle, end } of await Promise.all(runs)) {
      expect(middle).toBe(tag)
      expect(end).toBe(tag)
    }
    expect(resolve()).toBe('en')
  })
})

describe('withLocale', () => {
  test('turns a synchronous throw into a rejection, never a throw at the call', async () => {
    const handler = withLocale(() => {
      throw new Error('render failed')
    }, OPTIONS)
    let pending: Promise<Response> | undefined
    expect(() => {
      pending = handler(request({ cookie: 'locale=de' }))
    }).not.toThrow()
    await expect(pending).rejects.toThrow(/render failed/)
  })

  test('rejects with the handler error and leaves no scope active', async () => {
    $configure1(SETUP)
    const failure = new Error('late failure')
    const handler = withLocale(async () => {
      await tick(0)
      throw failure
    }, OPTIONS)
    await expect(handler(request({ cookie: 'locale=de' }))).rejects.toBe(failure)
    expect(getRawLocale()).toBe('')
    expect(() => setLocale('fr')).not.toThrow()
  })

  test('hands the handler the very Request it was given, and every rest argument', async () => {
    const incoming = request({ cookie: 'locale=fr' })
    const handler = withLocale(
      (seen: Request, first: string, second: number | undefined) =>
        new Response(`${String(seen === incoming)}|${first}|${String(second)}`),
      OPTIONS,
    )
    const response = await handler(incoming, 'ctx', undefined)
    expect(await response.text()).toBe('true|ctx|undefined')
  })

  test('negotiates each call afresh', async () => {
    const handler = withLocale(() => new Response('ok'), OPTIONS)
    const first = await handler(request({ cookie: 'locale=de' }))
    const second = await handler(request({}))
    expect(first.headers.get('Content-Language')).toBe('de')
    expect(second.headers.get('Content-Language')).toBe('en')
  })

  test('announces the source locale when the locale list is empty', async () => {
    const handler = withLocale(() => new Response('ok'), { locales: [], sourceLocale: 'en' })
    const response = await handler(request({ cookie: 'locale=de', 'accept-language': 'fr' }))
    expect(response.headers.get('Content-Language')).toBe('en')
  })

  test('stamps a bodiless 204', async () => {
    const handler = withLocale(() => new Response(null, { status: 204 }), OPTIONS)
    const response = await handler(request({ 'accept-language': 'fr' }))
    expect(response.status).toBe(204)
    expect(response.body).toBeNull()
    expect(response.headers.get('Content-Language')).toBe('fr')
  })

  test('keeps the scope for a streamed body pulled after the handler returned', async () => {
    const resolve = $configure1(SETUP)
    const handler = withLocale(() => {
      let pulls = 0
      const body = new ReadableStream<string>(
        {
          pull(controller) {
            pulls += 1
            controller.enqueue(`${resolve()};`)
            if (pulls === 3) controller.close()
          },
        },
        { highWaterMark: 0 },
      )
      return new Response(body.pipeThrough(new TextEncoderStream()))
    }, OPTIONS)
    const response = await handler(request({ cookie: 'locale=de' }))
    expect(await response.text()).toBe('de;de;de;')
  })
})

describe('withLocale on Vary', () => {
  async function varyAfter(headers: HeadersInit): Promise<string | null> {
    const handler = withLocale(() => new Response('ok', { headers }), OPTIONS)
    return (await handler(request())).headers.get('Vary')
  }

  test('recognises Accept-Language in any case and with stray spaces', async () => {
    expect(await varyAfter({ Vary: 'ACCEPT-LANGUAGE' })).toBe('ACCEPT-LANGUAGE')
    expect(await varyAfter({ Vary: ' accept-language ,Cookie' })).toBe('accept-language ,Cookie')
  })

  test('is not fooled by a field name that only starts with Accept-Language', async () => {
    expect(await varyAfter({ Vary: 'Accept-Language-Extra' })).toBe(
      'Accept-Language-Extra, Accept-Language',
    )
  })

  test('writes no empty list element around an empty or comma-padded Vary', async () => {
    expect(await varyAfter({ Vary: '' })).toBe('Accept-Language')
    expect(await varyAfter({ Vary: 'Cookie,' })).toBe('Cookie, Accept-Language')
    expect(await varyAfter({ Vary: ' , Cookie' })).toBe('Cookie, Accept-Language')
  })

  test('finds Accept-Language listed in a second Vary field', async () => {
    const headers = new Headers()
    headers.append('Vary', 'Cookie')
    headers.append('Vary', 'accept-language')
    expect(await varyAfter(headers)).toBe('Cookie, accept-language')
  })
})

describe('withLocale on a response with immutable headers', () => {
  test('rebuilds it keeping status, status text, body and every header', async () => {
    const headers = new Headers()
    headers.append('Set-Cookie', 'a=1')
    headers.append('Set-Cookie', 'b=2')
    headers.set('X-Trace', 'abc')
    headers.set('Vary', 'Cookie')
    const handler = withLocale(
      () => immutable(new Response('body', { status: 418, statusText: 'Teapot', headers })),
      OPTIONS,
    )
    const response = await handler(request({ cookie: 'locale=fr' }))
    expect(response.status).toBe(418)
    expect(response.statusText).toBe('Teapot')
    expect(await response.text()).toBe('body')
    expect(response.headers.getSetCookie()).toEqual(['a=1', 'b=2'])
    expect(response.headers.get('X-Trace')).toBe('abc')
    expect(response.headers.get('Content-Language')).toBe('fr')
    expect(response.headers.get('Vary')).toBe('Cookie, Accept-Language')
  })

  test('hands back a network error unchanged rather than rejecting', async () => {
    const error = Response.error()
    const response = await withLocale(() => error, OPTIONS)(request({ cookie: 'locale=de' }))
    expect(response).toBe(error)
  })

  test('rebuilds every redirect status', async () => {
    for (const status of [301, 302, 303, 307, 308]) {
      const handler = withLocale(() => Response.redirect('https://example.test/de', status), OPTIONS)
      const response = await handler(request({ cookie: 'locale=de' }))
      expect(response.status, String(status)).toBe(status)
      expect(response.headers.get('Location')).toBe('https://example.test/de')
      expect(response.headers.get('Content-Language')).toBe('de')
    }
  })
})
