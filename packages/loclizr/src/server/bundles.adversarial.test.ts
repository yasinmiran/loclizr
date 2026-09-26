import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import type { LocaleResolver, LocaleSetup, NegotiateOptions } from '../types'
import { resetRuntime } from '../runtime/__fixtures__/reset'

const DIST = resolve(dirname(fileURLToPath(import.meta.url)), '../../dist')
const CLIENT_ENTRY = resolve(DIST, 'index.js')
const SERVER_ENTRY = resolve(DIST, 'server/index.js')

const SETUP: LocaleSetup = { locales: ['de', 'de-AT', 'en', 'fr'], sourceLocale: 'en', cookie: 'locale' }

const OPTIONS: NegotiateOptions = {
  locales: [...SETUP.locales],
  sourceLocale: SETUP.sourceLocale,
  cookie: SETUP.cookie,
}

interface ClientBundle {
  readonly $configure1: (setup: LocaleSetup) => LocaleResolver
  readonly getLocale: () => string
  readonly setLocale: (locale: string) => void
}

interface ServerBundle {
  readonly runWithLocale: <T>(locale: string, fn: () => T) => T
  readonly localeFromHeaders: (
    headers: { readonly cookie?: string | undefined; readonly acceptLanguage?: string | undefined },
    options: NegotiateOptions,
  ) => string
  readonly withLocale: (
    handler: (request: Request) => Response | Promise<Response>,
    options: NegotiateOptions,
  ) => (request: Request) => Promise<Response>
}

let client: ClientBundle
let server: ServerBundle

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

const built = existsSync(CLIENT_ENTRY) && existsSync(SERVER_ENTRY)

// The two published entries are separate platform groups, so each carries its
// own copy of the runtime store and of the scope handle's module. Everything
// here runs against those artifacts rather than against src, because the
// duplication only exists after the bundler has run.
describe.skipIf(!built)('the published client and server entries', () => {
  beforeAll(async () => {
    client = (await import(pathToFileURL(CLIENT_ENTRY).href)) as unknown as ClientBundle
    server = (await import(pathToFileURL(SERVER_ENTRY).href)) as unknown as ServerBundle
  })

  afterEach(() => {
    resetRuntime()
    vi.restoreAllMocks()
  })

  test('are two module instances that share one request scope', () => {
    const resolveLocale = client.$configure1(SETUP)
    expect(server.runWithLocale('de-AT', () => resolveLocale())).toBe('de-AT')
    expect(server.runWithLocale('de-CH', () => resolveLocale())).toBe('de')
    expect(server.runWithLocale('sp', () => resolveLocale())).toBe('en')
    expect(resolveLocale()).toBe('en')
  })

  test('agree on the locale a request negotiated, across the bundle boundary', () => {
    const resolveLocale = client.$configure1(SETUP)
    for (const cookie of ['locale=de-AT', 'locale=DE-at', 'locale=de-CH', 'locale=sp']) {
      const negotiated = server.localeFromHeaders({ cookie }, OPTIONS)
      expect(server.runWithLocale(negotiated, () => resolveLocale()), cookie).toBe(negotiated)
    }
  })

  test('refuse a client switch while the server scope is active', () => {
    client.$configure1(SETUP)
    expect(() => server.runWithLocale('de', () => client.setLocale('fr'))).toThrow(/request scope/)
    expect(() => client.setLocale('fr')).not.toThrow()
    expect(client.getLocale()).toBe('fr')
  })

  test('keep two parked requests apart while a client switch lands between them', async () => {
    const resolveLocale = client.$configure1(SETUP)
    const first = gate()
    const second = gate()
    let started = 0
    const handler = server.withLocale(async () => {
      const mine = started
      started += 1
      const before = resolveLocale()
      if (mine === 0) {
        second.open()
        await first.reached
      } else {
        await second.reached
        first.open()
      }
      return new Response(`${before}|${resolveLocale()}`)
    }, OPTIONS)
    const responses = Promise.all([
      handler(request({ cookie: 'locale=de' })),
      handler(request({ 'accept-language': 'fr' })),
    ])
    client.setLocale('de-AT')
    const [a, b] = await responses
    expect(await a.text()).toBe('de|de')
    expect(await b.text()).toBe('fr|fr')
    expect(resolveLocale()).toBe('de-AT')
  })

  test('let the client half resolve an override with no scope and no document', () => {
    const resolveLocale = client.$configure1(SETUP)
    expect(resolveLocale({ locale: 'de-AT' })).toBe('de-AT')
    expect(resolveLocale({ locale: 'de-CH' })).toBe('de')
    expect(resolveLocale({ locale: undefined })).toBe('en')
    expect(resolveLocale()).toBe('en')
  })

  test('let a per call override outrank the request scope it renders inside', () => {
    const resolveLocale = client.$configure1(SETUP)
    server.runWithLocale('de', () => {
      expect(resolveLocale({ locale: 'fr' })).toBe('fr')
      expect(resolveLocale({ locale: undefined })).toBe('de')
      expect(resolveLocale()).toBe('de')
    })
  })

  test('publish the runtime type names the generated barrel augments through', () => {
    const declarations = readFileSync(resolve(DIST, 'index.d.ts'), 'utf8')
    for (const name of [
      'EmptyArgs',
      'IntlOptions',
      'Locale',
      'LocaleListener',
      'LocaleRegistry',
      'LocaleResolver',
      'LocaleSetup',
      'LoclizrConfig',
      'MessageOptions',
      'NegotiateOptions',
      'SetLocaleOptions',
    ]) {
      expect(declarations, name).toMatch(new RegExp(`\\b${name}\\b`))
    }
    for (const name of ['$configure1', '$dateTime1', '$number1', '$plural1']) {
      expect(declarations, name).toContain(`export declare function ${name}(`)
    }
  })

  test('unwind the scope when a handler throws, leaving nothing installed', async () => {
    const resolveLocale = client.$configure1(SETUP)
    const handler = server.withLocale(() => {
      throw new Error('render failed')
    }, OPTIONS)
    await expect(handler(request({ cookie: 'locale=de' }))).rejects.toThrow(/render failed/)
    expect(resolveLocale()).toBe('en')
    expect(() => client.setLocale('fr')).not.toThrow()
  })
})
