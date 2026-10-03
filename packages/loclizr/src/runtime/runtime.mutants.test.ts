import { afterEach, describe, expect, test, vi } from 'vitest'
import { $configure1 } from './abi'
import { readCookie } from './cookie'
import { resetRuntime } from './__fixtures__/reset'

afterEach(() => {
  resetRuntime()
  vi.restoreAllMocks()
})

describe('$configure1 resolver fallback', () => {
  // A source other than 'en' is the only way to tell the directory's own
  // fallback apart from a hardcoded one.
  test('falls back to its own source locale when nothing is requested', () => {
    const resolve = $configure1({ locales: ['de', 'fr'], sourceLocale: 'de', cookie: 'locale' })
    expect(resolve()).toBe('de')
  })

  test('falls back to its own source locale for an undeclared tag', () => {
    const resolve = $configure1({ locales: ['de', 'fr'], sourceLocale: 'de', cookie: 'locale' })
    expect(resolve({ locale: 'ja' })).toBe('de')
  })
})

describe('readCookie pair splitting', () => {
  test('never reads a valueless pair whose name only starts with the wanted one', () => {
    expect(readCookie('locales', 'locale')).toBeNull()
    expect(readCookie('locales; locale=de', 'locale')).toBe('de')
  })

  // A Cookie header assembled by hand or by a proxy can omit the space after
  // the separator, and the server reads the same name from it.
  test('splits pairs on a bare semicolon', () => {
    expect(readCookie('theme=dark;locale=de', 'locale')).toBe('de')
  })
})

describe('a second registration', () => {
  test('warns when it declares a superset of the first list', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    $configure1({ locales: ['de', 'en'], sourceLocale: 'en', cookie: 'locale' })
    $configure1({ locales: ['de', 'en', 'fr'], sourceLocale: 'en', cookie: 'locale' })
    expect(warn).toHaveBeenCalledOnce()
  })
})
