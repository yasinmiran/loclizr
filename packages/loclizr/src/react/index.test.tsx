// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { $configure1 } from '../runtime/abi'
import { resetRuntime } from '../runtime/__fixtures__/reset'
import { storeState } from '../runtime/state'
import { setLocale } from '../runtime/store'
import { Parts, useLocale, useSetLocale } from './index'

const SETUP = { locales: ['de', 'de-AT', 'en'], sourceLocale: 'en', cookie: 'locale' }

function Label() {
  return <span data-testid="locale">{useLocale()}</span>
}

function clearCookies(): void {
  for (const pair of document.cookie.split(';')) {
    const name = pair.split('=')[0]?.trim()
    if (name !== undefined && name !== '') document.cookie = `${name}=; path=/; max-age=0`
  }
}

afterEach(() => {
  cleanup()
  clearCookies()
  document.documentElement.removeAttribute('lang')
  resetRuntime()
  vi.restoreAllMocks()
})

describe('Parts', () => {
  test('renders its chunks positionally, with no key warning', () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { container } = render(
      <Parts of={['Read our ', <a href="/terms">terms</a>, ' before you continue.']} />,
    )
    expect(container.innerHTML).toBe('Read our <a href="/terms">terms</a> before you continue.')
    expect(warn).not.toHaveBeenCalled()
  })

  test('renders a coerced one element array', () => {
    const { container } = render(<Parts of={['Lies unsere AGB.']} />)
    expect(container.innerHTML).toBe('Lies unsere AGB.')
  })
})

describe('useLocale', () => {
  test('resolves through the store and re-renders on a switch', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    $configure1(SETUP)
    const { getByTestId } = render(<Label />)
    expect(getByTestId('locale').textContent).toBe('en')
    act(() => setLocale('de-at'))
    expect(getByTestId('locale').textContent).toBe('de-AT')
  })

  test('subscribes once per mount and unsubscribes on unmount', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    $configure1(SETUP)
    const { listeners } = storeState()
    const add = listeners.add.bind(listeners)
    let added = 0
    listeners.add = (listener: () => void) => {
      added += 1
      return add(listener)
    }
    const { rerender, unmount } = render(<Label />)
    rerender(<Label />)
    rerender(<Label />)
    // Counting live listeners would not see the bug: a resubscribe on every
    // render leaves exactly one behind each time.
    expect(added).toBe(1)
    expect(listeners.size).toBe(1)
    unmount()
    expect(listeners.size).toBe(0)
    setLocale('de')
    expect(listeners.size).toBe(0)
  })

  test('warns once and repairs html lang when the document disagrees', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    document.documentElement.lang = 'fr'
    $configure1(SETUP)
    const { getByTestId, rerender } = render(<Label />)
    expect(getByTestId('locale').textContent).toBe('en')
    expect(document.documentElement.lang).toBe('en')
    expect(warn).toHaveBeenCalledTimes(1)
    rerender(<Label />)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  test('keeps the disagreement warning unspent when html carries no lang at all', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    $configure1(SETUP)
    const { unmount } = render(<Label />)
    expect(document.documentElement.lang).toBe('en')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toContain('no lang attribute')
    unmount()
    document.documentElement.lang = 'fr-CA'
    render(<Label />)
    expect(document.documentElement.lang).toBe('en')
    expect(warn).toHaveBeenCalledTimes(2)
    expect(warn.mock.calls[1]?.[0]).toContain('disagrees with the resolved locale')
  })

  test('says nothing when detection already set html lang from the cookie', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    document.documentElement.lang = 'en'
    document.cookie = 'locale=de; path=/'
    $configure1(SETUP)
    const { getByTestId } = render(<Label />)
    expect(getByTestId('locale').textContent).toBe('de')
    expect(document.documentElement.lang).toBe('de')
    expect(warn).not.toHaveBeenCalled()
  })

  test('says nothing when the document already agrees', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    document.documentElement.lang = 'en'
    $configure1(SETUP)
    render(<Label />)
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('useSetLocale', () => {
  test('returns the store setter, stable across renders', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    $configure1(SETUP)
    const setters: ((locale: string) => void)[] = []
    function Switcher() {
      const set = useSetLocale()
      setters.push(set)
      return <span data-testid="locale">{useLocale()}</span>
    }
    const { getByTestId } = render(<Switcher />)
    act(() => setters[0]?.('de'))
    expect(getByTestId('locale').textContent).toBe('de')
    expect(setters.length).toBeGreaterThan(1)
    expect(setters[setters.length - 1]).toBe(setters[0])
  })
})
