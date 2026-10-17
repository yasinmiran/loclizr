import { describe, expect, test } from 'vitest'
import * as entry from '../index'
import * as server from '../server/index'

// The ABI is enforced by the JS import rather than by types, so a stale
// generated tree has to fail at link time on a missing named export.
const ABI = ['$configure1', '$dateTime1', '$number1', '$plural1']
const PUBLIC = [
  'defineConfig',
  'getLocale',
  'localeFromHeaders',
  'negotiate',
  'setLocale',
  'subscribe',
]

describe('the loclizr entry', () => {
  test('exports the four ABI helpers and the public store, and nothing else', () => {
    expect(Object.keys(entry).sort()).toEqual([...ABI, ...PUBLIC].sort())
  })

  // A static site picks its first locale in the browser, which cannot import
  // loclizr/server because of node:async_hooks.
  test('negotiate and localeFromHeaders are the ones loclizr/server exports', () => {
    expect(entry.negotiate).toBe(server.negotiate)
    expect(entry.localeFromHeaders).toBe(server.localeFromHeaders)
  })

  test('localeFromHeaders reads the configured cookie name, then the browser languages', () => {
    const options = { locales: ['en', 'de', 'fr'], sourceLocale: 'en', cookie: 'lang' }
    expect(entry.localeFromHeaders({ cookie: 'locale=fr; lang=de', acceptLanguage: 'fr' }, options)).toBe('de')
    expect(entry.localeFromHeaders({ cookie: 'locale=de', acceptLanguage: 'fr-CA,en' }, options)).toBe('fr')
  })

  test('defineConfig is the identity function', () => {
    const config = { locales: ['en', 'de'] } as const
    expect(entry.defineConfig(config)).toBe(config)
  })
})
