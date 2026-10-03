// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { MockInstance } from 'vitest'
import type { LocaleSetup, SetLocaleOptions } from '../types'
import { $configure1 } from '../runtime/abi'
import { resetRuntime } from '../runtime/__fixtures__/reset'
import { runWithLocale } from '../server/index'
import { storeState } from '../runtime/state'
import { setLocale } from '../runtime/store'
import { Parts, useLocale, useSetLocale } from './index'

const SETUP: LocaleSetup = { locales: ['de', 'de-AT', 'en'], sourceLocale: 'en', cookie: 'locale' }

function Label({ id = 'locale' }: { readonly id?: string }): ReactElement {
  return <span data-testid={id}>{useLocale()}</span>
}

function clearCookies(): void {
  for (const pair of document.cookie.split(';')) {
    const name = pair.split('=')[0]?.trim()
    if (name !== undefined && name !== '') document.cookie = `${name}=; path=/; max-age=0`
  }
}

function cookieNames(): string[] {
  return document.cookie
    .split(';')
    .map((pair) => pair.split('=')[0]?.trim() ?? '')
    .filter((name) => name !== '')
}

function quiet(): MockInstance<typeof console.warn> {
  return vi.spyOn(console, 'warn').mockImplementation(() => {})
}

function shown(tag: string, getByTestId: (id: string) => HTMLElement): string | null {
  return getByTestId(tag).textContent
}

afterEach(() => {
  cleanup()
  clearCookies()
  document.documentElement.removeAttribute('lang')
  vi.unstubAllEnvs()
  resetRuntime()
  vi.restoreAllMocks()
})

describe('useLocale resolving a stored tag', () => {
  test.each([
    ['DE-at', 'de-AT'],
    ['de-at', 'de-AT'],
    ['DE', 'de'],
    ['de-AT-u-ca-buddhist', 'de-AT'],
    ['de-x-formal', 'de'],
    ['de-CH', 'de'],
  ])('resolves %j to the declared %j', (requested, declared) => {
    quiet()
    $configure1(SETUP)
    const { getByTestId } = render(<Label />)
    act(() => setLocale(requested))
    expect(shown('locale', getByTestId)).toBe(declared)
  })

  test.each(['', 'de_AT', '__proto__', 'constructor', 'toString', 'prototype', '0', '\u{1F600}'])(
    'falls back to the source locale for %j without throwing',
    (requested) => {
      quiet()
      $configure1(SETUP)
      const { getByTestId } = render(<Label />)
      act(() => setLocale('de'))
      act(() => setLocale(requested))
      expect(shown('locale', getByTestId)).toBe('en')
    },
  )

  test('returns a stored tag verbatim when no generated module registered a locale list', () => {
    const warn = quiet()
    const { getByTestId } = render(<Label />)
    expect(shown('locale', getByTestId)).toBe('en')
    act(() => setLocale('fr-CA'))
    expect(shown('locale', getByTestId)).toBe('fr-CA')
    expect(warn.mock.calls.some(([text]) => String(text).includes('no locale list'))).toBe(true)
  })
})

describe('useLocale on the first read', () => {
  test('matches a cookie whose casing differs from the declared tag', () => {
    quiet()
    document.cookie = 'locale=DE-at; path=/'
    $configure1(SETUP)
    const { getByTestId } = render(<Label />)
    expect(shown('locale', getByTestId)).toBe('de-AT')
  })

  test('decodes a percent encoded cookie value', () => {
    quiet()
    document.cookie = 'locale=de%2DAT; path=/'
    $configure1(SETUP)
    const { getByTestId } = render(<Label />)
    expect(shown('locale', getByTestId)).toBe('de-AT')
  })

  test('falls back to the source locale on a malformed percent escape', () => {
    quiet()
    document.cookie = 'locale=%E0%A4%A; path=/'
    $configure1(SETUP)
    const { getByTestId } = render(<Label />)
    expect(shown('locale', getByTestId)).toBe('en')
  })

  test('ignores a cookie whose name merely ends with the configured one', () => {
    quiet()
    document.cookie = 'mylocale=de; path=/'
    $configure1(SETUP)
    const { getByTestId } = render(<Label />)
    expect(shown('locale', getByTestId)).toBe('en')
  })

  test('reads the cookie name the generated module registered', () => {
    quiet()
    document.cookie = 'locale=en; path=/'
    document.cookie = 'lang_pref=de; path=/'
    $configure1({ ...SETUP, cookie: 'lang_pref' })
    const { getByTestId } = render(<Label />)
    expect(shown('locale', getByTestId)).toBe('de')
  })

  test('prefers the cookie over html lang', () => {
    quiet()
    document.documentElement.lang = 'de-AT'
    document.cookie = 'locale=de; path=/'
    $configure1(SETUP)
    const { getByTestId } = render(<Label />)
    expect(shown('locale', getByTestId)).toBe('de')
  })

  test('truncates an html lang carrying an extension subtag', () => {
    quiet()
    document.documentElement.lang = 'de-AT-u-nu-latn'
    $configure1(SETUP)
    const { getByTestId } = render(<Label />)
    expect(shown('locale', getByTestId)).toBe('de-AT')
  })

  test('treats an html lang that is not a plausible tag as absent', () => {
    quiet()
    document.documentElement.lang = 'not a tag'
    $configure1(SETUP)
    const { getByTestId } = render(<Label />)
    expect(shown('locale', getByTestId)).toBe('en')
    expect(document.documentElement.lang).toBe('en')
  })

  test('stays latched when a cookie arrives after the first read', () => {
    quiet()
    $configure1(SETUP)
    const { getByTestId, rerender } = render(<Label />)
    document.cookie = 'locale=de; path=/'
    rerender(<Label />)
    expect(shown('locale', getByTestId)).toBe('en')
    act(() => setLocale('de'))
    expect(shown('locale', getByTestId)).toBe('de')
  })
})

describe('useLocale re-rendering', () => {
  function counted(): { readonly Counter: () => ReactElement; readonly renders: () => number } {
    let renders = 0
    function Counter(): ReactElement {
      renders += 1
      return <span data-testid="counter">{useLocale()}</span>
    }
    return { Counter, renders: () => renders }
  }

  test('skips the render when the same tag is set again', () => {
    quiet()
    $configure1(SETUP)
    const { Counter, renders } = counted()
    render(<Counter />)
    act(() => setLocale('de'))
    const settled = renders()
    act(() => setLocale('de'))
    expect(renders()).toBe(settled)
  })

  test('skips the render when a different tag resolves to the same locale', () => {
    quiet()
    $configure1(SETUP)
    const { Counter, renders } = counted()
    render(<Counter />)
    act(() => setLocale('de'))
    const settled = renders()
    act(() => setLocale('DE'))
    act(() => setLocale('de-CH'))
    expect(renders()).toBe(settled)
  })

  test('skips the render when an unknown tag resolves to the source locale already shown', () => {
    quiet()
    $configure1(SETUP)
    const { Counter, renders } = counted()
    render(<Counter />)
    const settled = renders()
    act(() => setLocale('sp'))
    expect(renders()).toBe(settled)
  })

  test('settles on the last of several switches inside one act', () => {
    quiet()
    $configure1(SETUP)
    const { getByTestId } = render(<Label />)
    act(() => {
      setLocale('de')
      setLocale('en')
      setLocale('de-at')
    })
    expect(shown('locale', getByTestId)).toBe('de-AT')
  })

  test('moves fifty mounted subscribers together and releases all of them', () => {
    quiet()
    $configure1(SETUP)
    const ids = Array.from({ length: 50 }, (_, index) => `l${index}`)
    const { getByTestId, unmount } = render(
      <div>
        {ids.map((id) => (
          <Label key={id} id={id} />
        ))}
      </div>,
    )
    expect(storeState().listeners.size).toBe(50)
    act(() => setLocale('de-AT'))
    expect(ids.map((id) => shown(id, getByTestId))).toEqual(ids.map(() => 'de-AT'))
    unmount()
    expect(storeState().listeners.size).toBe(0)
  })

  test('lets a switch unmount a subscriber without disturbing its sibling', () => {
    quiet()
    $configure1(SETUP)
    function Gate(): ReactElement {
      const locale = useLocale()
      return <div>{locale === 'en' ? <Label id="only-en" /> : null}</div>
    }
    const { getByTestId, queryByTestId } = render(
      <div>
        <Gate />
        <Label id="always" />
      </div>,
    )
    expect(storeState().listeners.size).toBe(3)
    act(() => setLocale('de'))
    expect(queryByTestId('only-en')).toBeNull()
    expect(shown('always', getByTestId)).toBe('de')
    expect(storeState().listeners.size).toBe(2)
  })

  test('switches two separately mounted roots together', () => {
    quiet()
    $configure1(SETUP)
    const first = document.body.appendChild(document.createElement('div'))
    const second = document.body.appendChild(document.createElement('div'))
    render(<Label id="main" />, { container: first })
    render(<Label id="toast" />, { container: second })
    act(() => setLocale('de'))
    expect(first.textContent).toBe('de')
    expect(second.textContent).toBe('de')
  })
})

describe('useSetLocale', () => {
  function Switcher({
    onSetter,
  }: {
    readonly onSetter: (set: (locale: string, options?: SetLocaleOptions) => void) => void
  }): ReactElement {
    onSetter(useSetLocale())
    return <Label />
  }

  function mountSwitcher(): {
    readonly set: (locale: string, options?: SetLocaleOptions) => void
    readonly getByTestId: (id: string) => HTMLElement
  } {
    let captured: ((locale: string, options?: SetLocaleOptions) => void) | undefined
    const { getByTestId } = render(<Switcher onSetter={(set) => (captured = set)} />)
    if (captured === undefined) throw new Error('setter never captured')
    const set = captured
    return { set, getByTestId }
  }

  test('is the store setter itself, the same across separate mounts', () => {
    quiet()
    $configure1(SETUP)
    const first = mountSwitcher().set
    cleanup()
    const second = mountSwitcher().set
    expect(first).toBe(setLocale)
    expect(second).toBe(first)
  })

  test('with persist false moves the UI and html lang but writes no cookie', () => {
    quiet()
    $configure1(SETUP)
    const { set, getByTestId } = mountSwitcher()
    act(() => set('de', { persist: false }))
    expect(shown('locale', getByTestId)).toBe('de')
    expect(document.documentElement.lang).toBe('de')
    expect(cookieNames()).not.toContain('locale')
  })

  test.each<[string, SetLocaleOptions | undefined]>([
    ['absent options', undefined],
    ['empty options', {}],
    ['persist left undefined', { persist: undefined }],
    ['persist true', { persist: true }],
  ])('persists the cookie with %s', (_, options) => {
    quiet()
    $configure1(SETUP)
    const { set } = mountSwitcher()
    act(() => set('de', options))
    expect(document.cookie).toContain('locale=de')
  })

  test('encodes reserved cookie characters so they cannot mint a second cookie', () => {
    quiet()
    $configure1(SETUP)
    const { set, getByTestId } = mountSwitcher()
    act(() => set('de; other=1'))
    expect(cookieNames()).toEqual(['locale'])
    expect(shown('locale', getByTestId)).toBe('en')
  })

  test('round trips an emoji tag through the cookie without throwing', () => {
    quiet()
    $configure1(SETUP)
    const { set } = mountSwitcher()
    act(() => set('\u{1F600}'))
    expect(document.cookie).toContain(`locale=${encodeURIComponent('\u{1F600}')}`)
  })

  test('throws inside a request scope and leaves the mounted UI where it was', () => {
    quiet()
    $configure1(SETUP)
    const { set, getByTestId } = mountSwitcher()
    act(() => set('de'))
    expect(() => runWithLocale('en', () => set('de-AT'))).toThrow(/request scope/)
    expect(storeState().raw).toBe('de')
    expect(shown('locale', getByTestId)).toBe('de')
  })
})

describe('html lang agreement', () => {
  test('stays quiet across switches when lang agreed at mount', () => {
    const warn = quiet()
    document.documentElement.lang = 'en'
    $configure1(SETUP)
    render(<Label />)
    act(() => setLocale('de'))
    act(() => setLocale('de-AT'))
    act(() => setLocale('en'))
    expect(warn).not.toHaveBeenCalled()
    expect(document.documentElement.lang).toBe('en')
  })

  test('warns once when many mounted components see the same disagreement', () => {
    const warn = quiet()
    document.documentElement.lang = 'fr'
    $configure1(SETUP)
    render(
      <div>
        <Label id="a" />
        <Label id="b" />
        <Label id="c" />
      </div>,
    )
    expect(warn).toHaveBeenCalledTimes(1)
    expect(document.documentElement.lang).toBe('en')
  })

  test('names the declared value verbatim in the warning', () => {
    const warn = quiet()
    document.documentElement.lang = 'fr-CA'
    $configure1(SETUP)
    render(<Label />)
    expect(warn.mock.calls[0]?.[0]).toBe(
      'loclizr: <html lang="fr-CA"> disagrees with the resolved locale "en". Render lang from the Content-Language header withLocale sets.',
    )
  })

  test('stays quiet when lang names the resolved locale in another case', () => {
    const warn = quiet()
    document.documentElement.lang = 'de-at'
    $configure1(SETUP)
    render(<Label />)
    expect(warn).not.toHaveBeenCalled()
    expect(document.documentElement.lang).toBe('de-AT')
  })

  test('with no process at all renders and skips the check instead of throwing', () => {
    const warn = quiet()
    document.documentElement.lang = 'fr'
    $configure1(SETUP)
    const host = globalThis as unknown as Record<string, unknown>
    const original = host['process']
    Reflect.deleteProperty(globalThis, 'process')
    try {
      const { getByTestId } = render(<Label />)
      expect(shown('locale', getByTestId)).toBe('en')
    } finally {
      host['process'] = original
    }
    expect(warn).not.toHaveBeenCalled()
    expect(document.documentElement.lang).toBe('fr')
  })

  test('in production adds no lang to a document that has none', () => {
    vi.stubEnv('NODE_ENV', 'production')
    const warn = quiet()
    $configure1(SETUP)
    render(<Label />)
    expect(document.documentElement.hasAttribute('lang')).toBe(false)
    expect(warn).not.toHaveBeenCalled()
  })

  test('in production still lets a switch update lang through the store', () => {
    vi.stubEnv('NODE_ENV', 'production')
    const warn = quiet()
    document.documentElement.lang = 'en'
    $configure1(SETUP)
    render(<Label />)
    act(() => setLocale('de'))
    expect(document.documentElement.lang).toBe('de')
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('Parts', () => {
  function noErrors(): MockInstance<typeof console.error> {
    return vi.spyOn(console, 'error').mockImplementation(() => {})
  }

  test.each([
    ['emoji with a ZWJ sequence', 'Hi \u{1F469}‍\u{1F4BB}!'],
    ['combining characters', 'Café naïve'],
    ['RTL text with directional marks', '‏مرحبا‎ 42'],
    ['CRLF and a lone CR', 'one\r\ntwo\rthree\nfour'],
    ['a byte order mark', '﻿start'],
    ['a lone surrogate', 'x\uD800y'],
    ['prototype names', '__proto__ constructor prototype toString'],
  ])('keeps %s byte for byte', (_, text) => {
    const { container } = render(<Parts of={['[', text, ']']} />)
    expect(container.textContent).toBe(`[${text}]`)
  })

  test('renders null, undefined and booleans as nothing', () => {
    const { container } = render(<Parts of={['a', null, undefined, true, false, 'b']} />)
    expect(container.innerHTML).toBe('ab')
  })

  test('renders an empty string chunk as nothing between its neighbours', () => {
    const { container } = render(<Parts of={['a', '', 'b']} />)
    expect(container.textContent).toBe('ab')
  })

  test.each<[number, string]>([
    [0, '0'],
    [-0, '0'],
    [Number.NaN, 'NaN'],
    [Number.POSITIVE_INFINITY, 'Infinity'],
    [1e21, '1e+21'],
    [Number.MAX_SAFE_INTEGER, '9007199254740991'],
  ])('renders the number %s as %j', (value, text) => {
    const { container } = render(<Parts of={['<', value, '>']} />)
    expect(container.textContent).toBe(`<${text}>`)
  })

  test('renders five thousand chunks in order with no key warning', () => {
    const error = noErrors()
    const chunks: ReactNode[] = Array.from({ length: 5000 }, (_, index) =>
      index % 2 === 0 ? String(index) : <b>{index}</b>,
    )
    const { container } = render(<Parts of={chunks} />)
    expect(container.querySelectorAll('b')).toHaveLength(2500)
    expect(container.textContent).toBe(Array.from({ length: 5000 }, (_, i) => String(i)).join(''))
    expect(error).not.toHaveBeenCalled()
  })

  test('renders the same element instance twice when it appears twice', () => {
    const error = noErrors()
    const bold = <b>x</b>
    const { container } = render(<Parts of={[bold, ' and ', bold]} />)
    expect(container.innerHTML).toBe('<b>x</b> and <b>x</b>')
    expect(error).not.toHaveBeenCalled()
  })

  test('flattens a nested Parts chunk in source order', () => {
    const { container } = render(
      <Parts of={['a', <Parts of={['b', <i>c</i>, 'd']} />, 'e']} />,
    )
    expect(container.innerHTML).toBe('ab<i>c</i>de')
  })

  test('renders a frozen chunk list', () => {
    const chunks = Object.freeze(['Lies ', <a href="/agb">AGB</a>, '.'])
    const { container } = render(<Parts of={chunks} />)
    expect(container.innerHTML).toBe('Lies <a href="/agb">AGB</a>.')
  })

  test('renders a hole in a sparse chunk list as nothing', () => {
    const chunks: ReactNode[] = ['a']
    chunks[2] = 'c'
    const { container } = render(<Parts of={chunks} />)
    expect(container.textContent).toBe('ac')
  })

  test('reconciles positionally when a switch changes the chunk count, with no key warning', () => {
    const error = noErrors()
    const { container, rerender } = render(<Parts of={['Read our ', <a href="/terms">terms</a>, '.']} />)
    rerender(<Parts of={[<a href="/agb">AGB</a>, ' lesen']} />)
    expect(container.innerHTML).toBe('<a href="/agb">AGB</a> lesen')
    rerender(<Parts of={['plain']} />)
    expect(container.innerHTML).toBe('plain')
    expect(error).not.toHaveBeenCalled()
  })

  test('re-renders its chunks when the locale behind them switches', () => {
    quiet()
    $configure1(SETUP)
    function Terms(): ReactElement {
      const locale = useLocale()
      const link = <a href="/terms">{locale === 'en' ? 'terms' : 'AGB'}</a>
      return <Parts of={locale === 'en' ? ['Read our ', link, '.'] : ['Lies unsere ', link, '.']} />
    }
    const { container } = render(<Terms />)
    expect(container.textContent).toBe('Read our terms.')
    act(() => setLocale('de'))
    expect(container.textContent).toBe('Lies unsere AGB.')
  })
})
