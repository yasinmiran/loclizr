// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { createElement, useState } from 'react'
import type { Dispatch, ReactElement, SetStateAction } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { MessageOptions } from '../types'
import { $configure1 } from '../runtime/abi'
import { resetRuntime } from '../runtime/__fixtures__/reset'
import { setLocale } from '../runtime/store'
import { Parts, useLocale } from './index'

const SETUP = { locales: ['de', 'de-AT', 'en'], sourceLocale: 'en', cookie: 'locale' }

// A stand-in for one generated message function: a resolver call and a switch,
// importing nothing from React, exactly as emitted code does.
function makeGreeting(): (options?: MessageOptions) => string {
  const resolveLocale = $configure1(SETUP)
  return (options) => {
    switch (resolveLocale(options)) {
      case 'de':
      case 'de-AT':
        return 'Hallo'
      default:
        return 'Hello'
    }
  }
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

describe('a component that only calls messages', () => {
  test('does not re-render on a switch, which is the cost of a message call being plain', () => {
    const greeting = makeGreeting()
    let renders = 0
    function Plain(): ReactElement {
      renders += 1
      return createElement('span', { 'data-testid': 'plain' }, greeting())
    }
    const { getByTestId } = render(createElement(Plain))
    expect(getByTestId('plain').textContent).toBe('Hello')
    const before = renders
    act(() => setLocale('de'))
    expect(renders).toBe(before)
    expect(getByTestId('plain').textContent).toBe('Hello')
  })
})

describe('the precise pattern', () => {
  test('re-renders in place on a switch and keeps local state', () => {
    const greeting = makeGreeting()
    let bump: Dispatch<SetStateAction<number>> = () => {}
    function Draft(): ReactElement {
      const locale = useLocale()
      const [typed, setTyped] = useState(0)
      bump = setTyped
      return createElement('span', { 'data-testid': 'draft' }, `${greeting({ locale })}/${typed}`)
    }
    const { getByTestId } = render(createElement(Draft))
    act(() => bump(7))
    expect(getByTestId('draft').textContent).toBe('Hello/7')
    act(() => setLocale('de-at'))
    expect(getByTestId('draft').textContent).toBe('Hallo/7')
  })

  test('costs exactly one re-render per switch', () => {
    const greeting = makeGreeting()
    let renders = 0
    function Draft(): ReactElement {
      const locale = useLocale()
      renders += 1
      return createElement('span', { 'data-testid': 'draft' }, greeting({ locale }))
    }
    render(createElement(Draft))
    const before = renders
    act(() => setLocale('de'))
    expect(renders).toBe(before + 1)
  })
})

describe('the whole tree pattern', () => {
  test('remounts on a switch, so every string changes and local state resets', () => {
    const greeting = makeGreeting()
    let bump: Dispatch<SetStateAction<number>> = () => {}
    function Child(): ReactElement {
      const [count, setCount] = useState(0)
      bump = setCount
      return createElement('span', { 'data-testid': 'child' }, `${greeting()}/${count}`)
    }
    function Root(): ReactElement {
      return createElement(Child, { key: useLocale() })
    }
    const { getByTestId } = render(createElement(Root))
    act(() => bump(3))
    expect(getByTestId('child').textContent).toBe('Hello/3')
    act(() => setLocale('de'))
    expect(getByTestId('child').textContent).toBe('Hallo/0')
  })
})

describe('two subscribers', () => {
  test('never disagree inside one commit', () => {
    makeGreeting()
    function Label({ id }: { readonly id: string }): ReactElement {
      return createElement('span', { 'data-testid': id }, useLocale())
    }
    const { getByTestId } = render(
      createElement(
        'div',
        null,
        createElement(Label, { id: 'a' }),
        createElement(Label, { id: 'b' }),
      ),
    )
    act(() => setLocale('de-at'))
    expect(getByTestId('a').textContent).toBe('de-AT')
    expect(getByTestId('b').textContent).toBe(getByTestId('a').textContent)
    act(() => setLocale('sp'))
    expect(getByTestId('a').textContent).toBe('en')
    expect(getByTestId('b').textContent).toBe('en')
  })
})

describe('Parts', () => {
  test('renders catalog text as text, never as markup', () => {
    const chunk = '<img src=x onerror="alert(1)"> & <b>bold</b>'
    const { container } = render(createElement(Parts, { of: [chunk] }))
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('b')).toBeNull()
    expect(container.textContent).toBe(chunk)
  })

  test('renders an empty chunk list as nothing, with no key warning', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { container } = render(createElement(Parts, { of: [] }))
    expect(container.innerHTML).toBe('')
    expect(error).not.toHaveBeenCalled()
  })

  test('keeps handler output and text in source order', () => {
    const link = (chunks: readonly (string | ReactElement)[]): ReactElement =>
      createElement('a', { href: '/terms' }, ...chunks)
    const { container } = render(
      createElement(Parts, { of: ['Read our ', link(['terms']), ' before you continue.'] }),
    )
    expect(container.textContent).toBe('Read our terms before you continue.')
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/terms')
  })
})

describe('production', () => {
  test('leaves html lang to the store and says nothing about it', () => {
    vi.stubEnv('NODE_ENV', 'production')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    document.documentElement.lang = 'en'
    document.cookie = 'locale=de; path=/'
    makeGreeting()
    function Label(): ReactElement {
      return createElement('span', { 'data-testid': 'locale' }, useLocale())
    }
    const { getByTestId } = render(createElement(Label))
    expect(getByTestId('locale').textContent).toBe('de')
    expect(document.documentElement.lang).toBe('de')
    expect(warn).not.toHaveBeenCalled()
  })
})
