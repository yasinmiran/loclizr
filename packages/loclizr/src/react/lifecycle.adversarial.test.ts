// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { StrictMode, createElement, useState } from 'react'
import type { Dispatch, ReactElement, SetStateAction } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { LocaleSetup } from '../types'
import { $configure1 } from '../runtime/abi'
import { resetRuntime } from '../runtime/__fixtures__/reset'
import { storeState } from '../runtime/state'
import { setLocale } from '../runtime/store'
import { useLocale, useSetLocale } from './index'

const SETUP: LocaleSetup = { locales: ['de', 'de-AT', 'en'], sourceLocale: 'en', cookie: 'locale' }

function listenerCount(): number {
  return storeState().listeners.size
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
  vi.unstubAllEnvs()
  resetRuntime()
  vi.restoreAllMocks()
})

describe('useLocale', () => {
  test('holds one subscription however many times its component re-renders', () => {
    $configure1(SETUP)
    let bump: Dispatch<SetStateAction<number>> = () => {}
    let renders = 0
    function Screen(): ReactElement {
      const [tick, setTick] = useState(0)
      bump = setTick
      renders += 1
      return createElement('span', { 'data-testid': 'screen' }, `${useLocale()}/${tick}`)
    }
    const { getByTestId } = render(createElement(Screen))
    expect(listenerCount()).toBe(1)
    for (let step = 1; step <= 5; step += 1) act(() => bump(step))
    expect(renders).toBeGreaterThan(5)
    expect(listenerCount()).toBe(1)
    expect(getByTestId('screen').textContent).toBe('en/5')
  })

  test('drops its subscription on unmount and adds none back on a later switch', () => {
    $configure1(SETUP)
    function Label(): ReactElement {
      return createElement('span', null, useLocale())
    }
    const { unmount } = render(createElement(Label))
    expect(listenerCount()).toBe(1)
    unmount()
    expect(listenerCount()).toBe(0)
    setLocale('de')
    expect(listenerCount()).toBe(0)
  })

  test('keeps one subscription per mounted component under StrictMode', () => {
    $configure1(SETUP)
    function Label(): ReactElement {
      return createElement('span', { 'data-testid': 'label' }, useLocale())
    }
    const { getByTestId } = render(createElement(StrictMode, null, createElement(Label)))
    expect(listenerCount()).toBe(1)
    act(() => setLocale('de-at'))
    expect(getByTestId('label').textContent).toBe('de-AT')
    expect(listenerCount()).toBe(1)
  })

  test('repairs a disagreeing html lang without switching the locale back', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    document.documentElement.lang = 'fr-CA'
    $configure1(SETUP)
    let renders = 0
    function Label(): ReactElement {
      renders += 1
      return createElement('span', { 'data-testid': 'label' }, useLocale())
    }
    const { getByTestId } = render(createElement(Label))
    expect(getByTestId('label').textContent).toBe('en')
    expect(document.documentElement.lang).toBe('en')
    expect(warn).toHaveBeenCalledTimes(1)
    const settled = renders
    act(() => {
      document.documentElement.lang = 'de'
    })
    expect(renders).toBe(settled)
    expect(getByTestId('label').textContent).toBe('en')
  })

  test('never lets two mounted components disagree after a cookie arrives from elsewhere', () => {
    $configure1(SETUP)
    let bump: Dispatch<SetStateAction<number>> = () => {}
    function Typing(): ReactElement {
      const [tick, setTick] = useState(0)
      bump = setTick
      return createElement('span', { 'data-testid': 'typing' }, `${useLocale()}/${tick}`)
    }
    function Quiet(): ReactElement {
      return createElement('span', { 'data-testid': 'quiet' }, useLocale())
    }
    const { getByTestId } = render(
      createElement('div', null, createElement(Typing), createElement(Quiet)),
    )
    expect(getByTestId('typing').textContent).toBe('en/0')
    expect(getByTestId('quiet').textContent).toBe('en')
    document.cookie = 'locale=de; path=/'
    act(() => bump(1))
    expect(getByTestId('typing').textContent).toBe(
      `${getByTestId('quiet').textContent ?? ''}/1`,
    )
  })

  test('reports the locale the store already holds when a listener runs', () => {
    $configure1(SETUP)
    const seen: string[] = []
    function Label(): ReactElement {
      seen.push(useLocale())
      return createElement('span', { 'data-testid': 'label' }, useLocale())
    }
    render(createElement(Label))
    act(() => setLocale('de'))
    act(() => setLocale('de-AT'))
    act(() => setLocale('sp'))
    expect(seen.at(-1)).toBe('en')
    expect(seen).toContain('de')
    expect(seen).toContain('de-AT')
  })
})

describe('useSetLocale', () => {
  test('refuses nothing on the client and moves every subscriber together', () => {
    $configure1(SETUP)
    let set: (locale: string) => void = () => {}
    function Switcher(): ReactElement {
      set = useSetLocale()
      return createElement('span', { 'data-testid': 'a' }, useLocale())
    }
    function Mirror(): ReactElement {
      return createElement('span', { 'data-testid': 'b' }, useLocale())
    }
    const { getByTestId } = render(
      createElement('div', null, createElement(Switcher), createElement(Mirror)),
    )
    expect(listenerCount()).toBe(2)
    act(() => set('de'))
    expect(getByTestId('a').textContent).toBe('de')
    expect(getByTestId('b').textContent).toBe('de')
    expect(document.cookie).toContain('locale=de')
  })
})
