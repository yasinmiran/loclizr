// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { MockInstance } from 'vitest'
import type { LocaleSetup } from '../types'
import { $configure1 } from '../runtime/abi'
import { resetRuntime } from '../runtime/__fixtures__/reset'
import { setLocale } from '../runtime/store'
import { useLocale } from './index'

const SETUP: LocaleSetup = { locales: ['de', 'de-AT', 'en'], sourceLocale: 'en', cookie: 'locale' }

function Label(): ReactElement {
  return <span data-testid="locale">{useLocale()}</span>
}

function clearCookies(): void {
  for (const pair of document.cookie.split(';')) {
    const name = pair.split('=')[0]?.trim()
    if (name !== undefined && name !== '') document.cookie = `${name}=; path=/; max-age=0`
  }
}

function quiet(): MockInstance<typeof console.warn> {
  return vi.spyOn(console, 'warn').mockImplementation(() => {})
}

afterEach(() => {
  cleanup()
  clearCookies()
  document.documentElement.removeAttribute('lang')
  resetRuntime()
  vi.restoreAllMocks()
})

describe('html lang agreement', () => {
  // Letter case is ignored on both sides, so an upper case lang must not read as
  // a disagreement any more than a lower case one does.
  test('stays quiet when lang names the resolved locale in upper case', () => {
    const warn = quiet()
    document.documentElement.lang = 'DE-AT'
    $configure1(SETUP)
    const { getByTestId } = render(<Label />)
    expect(getByTestId('locale').textContent).toBe('de-AT')
    expect(document.documentElement.lang).toBe('de-AT')
    expect(warn).not.toHaveBeenCalled()
  })

  // The store writes the tag as passed; the check runs again on every switch
  // so lang ends up naming the declared locale, not the caller's spelling.
  test('rewrites lang to the declared casing after a switch to a differently cased tag', () => {
    const warn = quiet()
    document.documentElement.lang = 'en'
    $configure1(SETUP)
    const { getByTestId } = render(<Label />)
    act(() => setLocale('de-at'))
    expect(getByTestId('locale').textContent).toBe('de-AT')
    expect(document.documentElement.lang).toBe('de-AT')
    expect(warn).not.toHaveBeenCalled()
  })
})
