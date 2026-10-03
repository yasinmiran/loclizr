// @vitest-environment jsdom
import { createElement } from 'react'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, test } from 'vitest'
import { emit } from '../../src/emit'
import { Parts } from '../../src/react/index'
import { $configure1 } from '../../src/runtime/abi'
import { storeState } from '../../src/runtime/state'
import { getLocale, getRawLocale, setLocale } from '../../src/runtime/store'
import { localeFromHeaders, negotiate, withLocale } from '../../src/server/index'
import type { EmittedFile, LocaleSetup, NegotiateOptions } from '../../src/types'
import { singleMessageProgram } from './__fixtures__/catalog'

const SETUP: LocaleSetup = { locales: ['de', 'de-AT', 'en'], sourceLocale: 'en', cookie: 'locale' }

const OPTIONS: NegotiateOptions = {
  locales: SETUP.locales,
  sourceLocale: SETUP.sourceLocale,
  cookie: SETUP.cookie,
}

// Raw strings a framework can hand localeFromHeaders straight off the socket,
// before any Headers object has had the chance to reject them.
const RAW_HOSTILE = [
  'de\r\nX-Injected: 1',
  'de\nX-Injected: 1',
  'de\u0000en',
  'de-AT\r\n\r\n<html>',
  '__proto__',
  'constructor',
  'x'.repeat(65536),
]

// Values a Fetch Headers object accepts, which the cookie reader then percent
// decodes into control characters.
const ENCODED_HOSTILE = [
  'de%0D%0AX-Injected%3A%201',
  'de%0AX-Injected%3A%201',
  'de%00en',
  'de%3B%20Domain%3Dexample.test',
  '%E0%A4%A',
]

type Arm = (args: Readonly<Record<string, unknown>>) => unknown

function resetRuntime(): void {
  Reflect.deleteProperty(globalThis, Symbol.for('loclizr.store'))
  Reflect.deleteProperty(globalThis, Symbol.for('loclizr.locale'))
}

function clearCookies(): void {
  for (const pair of document.cookie.split(';')) {
    const name = pair.split('=')[0]?.trim()
    if (name !== undefined && name !== '') document.cookie = `${name}=; path=/; max-age=0`
  }
}

function compiledArm(key: string, value: string): Arm {
  const namespace = key.split('.')[0] ?? '_root'
  const files: readonly EmittedFile[] = emit(singleMessageProgram(key, value)).files
  const module = files.find((file) => file.path === `messages/${namespace}.js`)?.contents ?? ''
  const id = key.replaceAll('.', '_')
  const chunk = module.split('\n\n').find((part) => part.startsWith(`export function ${id}(`))
  if (chunk === undefined) throw new Error(`no function ${id} in the emitted module`)
  const factory = new Function('$l', `'use strict';\nreturn ${chunk.slice('export '.length)}`) as (
    resolve: () => string,
  ) => Arm
  return factory(() => 'en')
}

function hasLineBreak(value: string | null): boolean {
  return value !== null && /[\r\n\u0000]/u.test(value)
}

afterEach(() => {
  clearCookies()
  document.documentElement.removeAttribute('lang')
  document.body.replaceChildren()
  resetRuntime()
})

describe('request-controlled locale input on the server', () => {
  test('resolves every raw hostile cookie and Accept-Language to a declared locale', () => {
    for (const value of RAW_HOSTILE) {
      expect(SETUP.locales).toContain(localeFromHeaders({ cookie: `locale=${value}` }, OPTIONS))
      expect(SETUP.locales).toContain(localeFromHeaders({ acceptLanguage: value }, OPTIONS))
      expect(SETUP.locales).toContain(negotiate([value, `${value};q=2`], OPTIONS))
    }
  })

  test('stamps only a declared locale and no line break into the response headers', async () => {
    const handler = withLocale(() => new Response('ok'), OPTIONS)
    for (const value of ENCODED_HOSTILE) {
      const response = await handler(
        new Request('http://app.test/', {
          headers: { cookie: `locale=${value}`, 'accept-language': `${value}, de;q=0.5` },
        }),
      )
      const announced = response.headers.get('content-language')
      expect(SETUP.locales).toContain(announced)
      expect(hasLineBreak(announced)).toBe(false)
      expect(hasLineBreak(response.headers.get('vary'))).toBe(false)
      expect(response.headers.get('x-injected')).toBeNull()
    }
  })

  test('keeps two concurrent requests on their own locale and leaves the store untouched', async () => {
    const resolve = $configure1(SETUP)
    const seen: string[] = []
    const handler = withLocale(async (request: Request) => {
      const delay = request.headers.get('cookie') === 'locale=de' ? 15 : 1
      await new Promise((settle) => setTimeout(settle, delay))
      expect(() => setLocale('de-AT')).toThrow(/request scope/u)
      seen.push(`${request.headers.get('cookie')}->${resolve(undefined)}:${getLocale()}`)
      return new Response(resolve(undefined))
    }, OPTIONS)
    const [slow, fast] = await Promise.all([
      handler(new Request('http://app.test/', { headers: { cookie: 'locale=de' } })),
      handler(new Request('http://app.test/', { headers: { cookie: 'locale=en' } })),
    ])
    expect(await slow.text()).toBe('de')
    expect(await fast.text()).toBe('en')
    expect(slow.headers.get('content-language')).toBe('de')
    expect(fast.headers.get('content-language')).toBe('en')
    expect(seen.sort()).toEqual(['locale=de->de:de', 'locale=en->en:en'])
    expect(storeState().raw).toBeNull()
  })

  test('resolves a hostile per call locale override to a declared locale', () => {
    const resolve = $configure1(SETUP)
    for (const value of [...RAW_HOSTILE, 'de-AT-x-anything', 'DE-at', '']) {
      expect(SETUP.locales).toContain(resolve({ locale: value }))
    }
  })

  test('negotiates 64 KB headers in bounded time', () => {
    const hyphens = 'a-'.repeat(32768)
    const ranges = 'zz-a,'.repeat(13107)
    const parameters = `zz${';q=1'.repeat(16384)}`
    const started = performance.now()
    expect(localeFromHeaders({ cookie: `locale=${hyphens}` }, OPTIONS)).toBe('en')
    expect(localeFromHeaders({ acceptLanguage: hyphens }, OPTIONS)).toBe('en')
    expect(localeFromHeaders({ acceptLanguage: ranges }, OPTIONS)).toBe('en')
    expect(localeFromHeaders({ acceptLanguage: parameters }, OPTIONS)).toBe('en')
    expect(performance.now() - started).toBeLessThan(1000)
  })
})

describe('request-controlled locale input on the client', () => {
  test('declares only a matched locale on html lang for a hostile cookie', () => {
    for (const value of ENCODED_HOSTILE) {
      resetRuntime()
      clearCookies()
      document.documentElement.removeAttribute('lang')
      document.cookie = `locale=${value}; path=/`
      $configure1(SETUP)
      expect(SETUP.locales).toContain(getLocale())
      expect(SETUP.locales).toContain(document.documentElement.lang)
    }
  })

  test('reads a long html lang that is not tag shaped in bounded time', () => {
    document.documentElement.lang = `ab${'-a1'.repeat(20000)}!`
    const started = performance.now()
    expect(getRawLocale()).toBe('')
    expect(performance.now() - started).toBeLessThan(1000)
  })
})

describe('catalog text reaching the page', () => {
  test('renders tag shaped catalog text through Parts as escaped text', () => {
    const arm = compiledArm('dev.terms', "Tap '<'img src=x'>' and <link>go</link>")
    const parts = arm({
      link: (chunks: readonly ReactNode[]) => createElement('a', { href: '/terms' }, ...chunks),
    }) as readonly ReactNode[]
    expect(renderToStaticMarkup(createElement(Parts, { of: parts }))).toBe(
      'Tap &lt;img src=x&gt; and <a href="/terms">go</a>',
    )
  })

  test('renders a string message through textContent with no element created', () => {
    const arm = compiledArm('dev.greeting', "Tap '<'b>here'<'/b>, {name}")
    const host = document.createElement('p')
    document.body.append(host)
    host.textContent = arm({ name: '<i>Ada</i>' }) as string
    expect(host.childElementCount).toBe(0)
    expect(host.textContent).toBe('Tap <b>here</b>, <i>Ada</i>')
  })
})
