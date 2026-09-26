import { afterEach, describe, expect, test, vi } from 'vitest'
import type { NegotiateOptions } from '../types'
import { resetRuntime } from '../runtime/__fixtures__/reset'
import { registerDefaults } from '../runtime/store'
import { localeFromHeaders, localeFromRequest, negotiate, withLocale } from './index'

const DECLARED = ['de', 'de-AT', 'en', 'fr'] as const

const OPTIONS: NegotiateOptions = {
  locales: [...DECLARED],
  sourceLocale: 'en',
  cookie: 'locale',
}

// Everything a tampered cookie or a hand-written Accept-Language can carry: a
// header split, script text, a broken percent escape, a Unicode fold onto an
// ASCII letter, the prototype keys, and a tag long enough to be a budget on its
// own.
const HOSTILE = [
  'de\r\nX-Injected: yes',
  '<script>alert(1)</script>',
  '"de"',
  '%E0%A4%A',
  'Ko',
  'İstanbul',
  '\u0000de',
  'de\u0000',
  '__proto__',
  'constructor',
  'prototype',
  '../../../etc/passwd',
  'de'.repeat(4000),
  ' de ',
  'de;Domain=evil.test',
  '*',
  '-',
  '--',
]

function declaredOrSource(value: string): boolean {
  return value === OPTIONS.sourceLocale || DECLARED.includes(value as (typeof DECLARED)[number])
}

function request(headers: Record<string, string>): Request {
  return new Request('https://example.test/cart', { headers })
}

afterEach(() => {
  resetRuntime()
  vi.restoreAllMocks()
})

describe('a tampered cookie', () => {
  test('always resolves to a declared locale and never to its own text', () => {
    for (const value of HOSTILE) {
      const wire = `locale=${encodeURIComponent(value)}`
      const resolved = localeFromHeaders({ cookie: wire }, OPTIONS)
      expect(declaredOrSource(resolved), `${value} -> ${resolved}`).toBe(true)
      expect(resolved).not.toBe(value)
    }
  })

  test('survives a hand-written cookie header that is not name=value at all', () => {
    const headers = [
      'locale',
      '=de',
      ';;;',
      'locale=de=AT',
      'mylocale=fr; locale=de',
      'locale=fr; locale=de',
      'LOCALE=fr',
      '   locale   =   de-AT   ',
    ]
    for (const cookie of headers) {
      const resolved = localeFromHeaders({ cookie }, OPTIONS)
      expect(declaredOrSource(resolved), `${cookie} -> ${resolved}`).toBe(true)
    }
    expect(localeFromHeaders({ cookie: 'mylocale=fr; locale=de' }, OPTIONS)).toBe('de')
    expect(localeFromHeaders({ cookie: 'LOCALE=fr' }, OPTIONS)).toBe('en')
    expect(localeFromHeaders({ cookie: '   locale   =   de-AT   ' }, OPTIONS)).toBe('de-AT')
  })

  test('outranks Accept-Language even when it matches nothing', () => {
    expect(localeFromHeaders({ cookie: 'locale=sp', acceptLanguage: 'fr' }, OPTIONS)).toBe('en')
    expect(localeFromHeaders({ cookie: 'locale=de', acceptLanguage: 'fr' }, OPTIONS)).toBe('de')
  })
})

describe('a hand-written Accept-Language', () => {
  test('never yields an undeclared tag, whatever the quality values say', () => {
    const headers = [
      'de;q=abc',
      'de;q=-1',
      'de;q=2',
      'de;q=',
      'de;q=0.0',
      'de;;q=0.5',
      '*',
      '*;q=1',
      ',,,',
      '',
      '   ',
      'sp,zz-ZZ,qq',
      'de-CH-1996-x-private',
      `${'x'.repeat(5000)},de`,
    ]
    for (const acceptLanguage of headers) {
      const resolved = localeFromHeaders({ acceptLanguage }, OPTIONS)
      expect(declaredOrSource(resolved), `${acceptLanguage} -> ${resolved}`).toBe(true)
    }
  })

  test('keeps a declared match reachable behind a thousand junk ranges of higher quality', () => {
    const junk = Array.from({ length: 1000 }, (_, index) => `zz-${index};q=0.9`)
    expect(negotiate([...junk, 'de;q=0.8'], OPTIONS)).toBe('de')
  })

  test('orders by quality and then by header position, deterministically', () => {
    const header = ['fr;q=0.5', 'de;q=0.5', 'de-AT;q=0.5']
    expect(negotiate(header, OPTIONS)).toBe('fr')
    expect(negotiate([...header].reverse(), OPTIONS)).toBe('de-AT')
    expect(negotiate(['fr;q=0.5', 'de;q=0.9'], OPTIONS)).toBe('de')
  })

  test('matches case insensitively and answers with the declared spelling', () => {
    expect(negotiate(['DE-at'], OPTIONS)).toBe('de-AT')
    expect(negotiate(['FR'], OPTIONS)).toBe('fr')
  })
})

describe('the server half', () => {
  test('reads its locale list and cookie name from its argument, never from the store', () => {
    registerDefaults({ locales: ['en', 'fr'], sourceLocale: 'fr', cookie: 'lang' })
    const options: NegotiateOptions = { locales: ['en', 'de'], sourceLocale: 'de' }
    expect(localeFromHeaders({ cookie: 'lang=fr' }, options)).toBe('de')
    expect(localeFromHeaders({ cookie: 'locale=en' }, options)).toBe('en')
    expect(localeFromHeaders({ cookie: 'locale=fr' }, options)).toBe('de')
    expect(negotiate(['fr', 'de'], options)).toBe('de')
  })

  test('agrees with localeFromRequest on every hostile header a Request can carry', () => {
    for (const value of HOSTILE) {
      const cookie = `locale=${encodeURIComponent(value)}`
      const acceptLanguage = encodeURIComponent(value)
      expect(localeFromRequest(request({ cookie }), OPTIONS)).toBe(
        localeFromHeaders({ cookie }, OPTIONS),
      )
      expect(localeFromRequest(request({ 'accept-language': acceptLanguage }), OPTIONS)).toBe(
        localeFromHeaders({ acceptLanguage }, OPTIONS),
      )
    }
  })
})

describe('withLocale', () => {
  test('announces a declared locale for a hostile request, never the attacker text', async () => {
    const handler = withLocale(() => new Response('ok'), OPTIONS)
    for (const value of HOSTILE) {
      const response = await handler(request({ cookie: `locale=${encodeURIComponent(value)}` }))
      const announced = response.headers.get('Content-Language')
      expect(announced).not.toBeNull()
      expect(declaredOrSource(announced ?? ''), `${value} -> ${announced}`).toBe(true)
      expect(response.headers.get('Vary')).toBe('Accept-Language')
    }
  })

  test('replaces a Content-Language the handler set itself', async () => {
    const handler = withLocale(
      () => new Response('ok', { headers: { 'Content-Language': 'sp' } }),
      OPTIONS,
    )
    const response = await handler(request({ cookie: 'locale=de' }))
    expect(response.headers.get('Content-Language')).toBe('de')
  })
})
