import { describe, expect, it } from 'vitest'
import type { Config, Diagnostic, LoclizrConfig } from '../types'
import { resolveConfig } from './resolve'
import type { LoadConfigResult } from './resolve'

function run(cookie: unknown): LoadConfigResult {
  return resolveConfig({
    user: { cookie } as LoclizrConfig,
    root: '/project',
    discovered: [{ locale: 'en', ns: null, file: 'locales/en.json' }],
  })
}

function config(result: LoadConfigResult): Config {
  expect(result.diagnostics).toEqual([])
  expect(result.config).not.toBeNull()
  return result.config as Config
}

function rejected(result: LoadConfigResult): Diagnostic {
  expect(result.config).toBeNull()
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['LZ1001'])
  return result.diagnostics[0] as Diagnostic
}

describe('cookie as an object', () => {
  it('takes the name and every attribute', () => {
    const resolved = config(
      run({ name: 'lang', domain: 'example.com', path: '/app', secure: true, sameSite: 'none', maxAge: 3600 }),
    )
    expect(resolved.cookie).toBe('lang')
    expect(resolved.cookieAttributes).toEqual({
      domain: 'example.com',
      path: '/app',
      secure: true,
      sameSite: 'none',
      maxAge: 3600,
    })
  })

  it('carries only the attributes written, so the defaults stay with the runtime', () => {
    expect(config(run({ name: 'lang', secure: true })).cookieAttributes).toEqual({ secure: true })
  })

  it('reads a name alone exactly like the string form', () => {
    const resolved = config(run({ name: 'lang' }))
    expect(resolved.cookie).toBe('lang')
    expect(resolved.cookieAttributes).toBeUndefined()
  })

  it('leaves the string form without attributes', () => {
    expect(config(run('lang')).cookieAttributes).toBeUndefined()
  })

  it('accepts a leading dot on the domain', () => {
    expect(config(run({ name: 'lang', domain: '.example.com' })).cookieAttributes).toEqual({
      domain: '.example.com',
    })
  })

  it('accepts a max-age of one second', () => {
    expect(config(run({ name: 'lang', maxAge: 1 })).cookieAttributes).toEqual({ maxAge: 1 })
  })
})

describe('cookie attributes that never hold', () => {
  it('rejects SameSite=None without Secure, which browsers drop', () => {
    const diagnostic = rejected(run({ name: 'lang', sameSite: 'none' }))
    expect(diagnostic.message).toContain('`cookie.sameSite`')
    expect(diagnostic.hint).toContain('secure: true')
  })

  it.each([['https://example.com'], ['example.com:8080'], ['example.com; Secure'], ['']])(
    'rejects the domain %j',
    (domain) => {
      expect(rejected(run({ name: 'lang', domain })).message).toContain('`cookie.domain`')
    },
  )

  it.each([[1.5], [-1], [Number.NaN], [Number.POSITIVE_INFINITY], ['3600']])('rejects the max-age %j', (maxAge) => {
    expect(rejected(run({ name: 'lang', maxAge })).message).toContain('`cookie.maxAge`')
  })

  it.each([['0', 0], ['-0', -0]])(
    'rejects the max-age %s, which expires the cookie as setLocale writes it',
    (_, maxAge) => {
      const diagnostic = rejected(run({ name: 'lang', maxAge }))
      expect(diagnostic.message).toContain('`cookie.maxAge` is `0`')
      expect(diagnostic.hint).toContain('leave maxAge out')
    },
  )

  it.each([['app'], ['/app; Domain=evil.test'], ['']])('rejects the path %j', (path) => {
    expect(rejected(run({ name: 'lang', path })).message).toContain('`cookie.path`')
  })

  it.each([['Lax'], ['strict ']])('rejects the SameSite value %j', (sameSite) => {
    expect(rejected(run({ name: 'lang', sameSite })).message).toContain('`cookie.sameSite`')
  })

  it('rejects a non-boolean secure', () => {
    expect(rejected(run({ name: 'lang', secure: 'yes' })).message).toContain('`cookie.secure`')
  })

  it('rejects an object without a name', () => {
    expect(rejected(run({ secure: true })).message).toContain('`cookie.name`')
  })

  it('rejects an object name that is not a cookie name', () => {
    expect(rejected(run({ name: 'a b' })).message).toContain('not a cookie name')
  })

  it('names a misspelled attribute rather than dropping it', () => {
    const diagnostic = rejected(run({ name: 'lang', samesite: 'strict' }))
    expect(diagnostic.message).toContain('`cookie.samesite`')
    expect(diagnostic.hint).toContain('`sameSite`')
  })
})
