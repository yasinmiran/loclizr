// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://shop.example.com/" }
import { afterEach, expect, test, vi } from 'vitest'
import { localeFromHeaders } from '../server/index'
import type { LocaleSetup } from '../types'
import { $configure1 } from './abi'
import { resetRuntime } from './__fixtures__/reset'
import { getLocale, resetLocale, setLocale } from './store'

const SETUP: LocaleSetup = {
  locales: ['de', 'en'],
  sourceLocale: 'en',
  cookie: 'locale',
  cookieAttributes: 'path=/; max-age=31536000; domain=example.com; SameSite=Lax',
}

afterEach(() => {
  document.cookie = 'locale=; path=/; max-age=0'
  document.cookie = 'locale=; path=/; max-age=0; domain=example.com'
  resetRuntime()
  vi.restoreAllMocks()
})

// A site that adds `domain` to its config still carries each visitor's earlier
// host-only cookie, which every read finds before the shared one.
test('replaces a host-only cookie from a config without a domain', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  document.cookie = 'locale=en; path=/; max-age=31536000; SameSite=Lax'
  $configure1(SETUP)
  setLocale('de')
  expect(document.cookie).toBe('locale=de')
  expect(warn).not.toHaveBeenCalled()
  expect(localeFromHeaders({ cookie: document.cookie }, SETUP)).toBe('de')
  resetRuntime()
  $configure1(SETUP)
  expect(getLocale()).toBe('de')
})

// The same leftover outlives a reset that expires only the shared cookie, and
// the next read latches it again.
test('a reset expires a host-only cookie as well as the shared one', () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  document.cookie = 'locale=de; path=/; max-age=31536000; SameSite=Lax'
  $configure1(SETUP)
  expect(getLocale()).toBe('de')
  resetLocale()
  expect(document.cookie).toBe('')
  expect(getLocale()).toBe('en')
})
