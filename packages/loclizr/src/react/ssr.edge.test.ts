import { Suspense, createElement, use } from 'react'
import type { ReactElement } from 'react'
import { renderToReadableStream, renderToStaticMarkup, renderToString } from 'react-dom/server'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { LocaleSetup } from '../types'
import { $configure1 } from '../runtime/abi'
import { resetRuntime } from '../runtime/__fixtures__/reset'
import { runWithLocale } from '../server/index'
import { Parts, useLocale, useSetLocale } from './index'

const SETUP: LocaleSetup = { locales: ['de', 'de-AT', 'en'], sourceLocale: 'en', cookie: 'locale' }

function Label(): ReactElement {
  return createElement('span', null, useLocale())
}

function labelIn(locale: string): string {
  return runWithLocale(locale, () => renderToStaticMarkup(createElement(Label)))
}

function deferred(): { readonly promise: Promise<string>; readonly resolve: (value: string) => void } {
  let resolve: (value: string) => void = () => {}
  const promise = new Promise<string>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

afterEach(() => {
  resetRuntime()
  vi.restoreAllMocks()
})

describe('useLocale inside a request scope', () => {
  test.each([
    ['DE-at', 'de-AT'],
    ['de-AT-u-ca-gregory', 'de-AT'],
    ['de-x-formal', 'de'],
    ['__proto__', 'en'],
    ['constructor', 'en'],
    ['de_AT', 'en'],
  ])('renders the scope %j as %j', (scope, declared) => {
    $configure1(SETUP)
    expect(labelIn(scope)).toBe(`<span>${declared}</span>`)
  })

  test('renders an empty scope as the source locale without the detached warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    $configure1(SETUP)
    expect(labelIn('')).toBe('<span>en</span>')
    expect(warn).not.toHaveBeenCalled()
  })

  test('lets an inner scope win and restores the outer one after it', () => {
    $configure1(SETUP)
    const markup = runWithLocale('de', () => {
      const outer = renderToStaticMarkup(createElement(Label))
      const inner = runWithLocale('de-AT', () => renderToStaticMarkup(createElement(Label)))
      const after = renderToStaticMarkup(createElement(Label))
      return [outer, inner, after]
    })
    expect(markup).toEqual(['<span>de</span>', '<span>de-AT</span>', '<span>de</span>'])
  })

  test('renders the same markup on two runs of the same scope', () => {
    $configure1(SETUP)
    const tree = (): ReactElement =>
      createElement('p', null, createElement(Label), createElement(Parts, { of: ['a', 'b'] }))
    const first = runWithLocale('de-AT', () => renderToString(tree()))
    const second = runWithLocale('de-AT', () => renderToString(tree()))
    expect(second).toBe(first)
  })

  test('surfaces the request scope error when a component switches during render', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    $configure1(SETUP)
    function Rogue(): ReactElement {
      useSetLocale()('de')
      return createElement('span', null, 'unreachable')
    }
    expect(() => runWithLocale('en', () => renderToString(createElement(Rogue)))).toThrow(
      /request scope/,
    )
  })
})

describe('streamed renders', () => {
  test('keep their own locale across a Suspense boundary resolved outside both scopes', async () => {
    $configure1(SETUP)
    function Late({ wait }: { readonly wait: Promise<string> }): ReactElement {
      return createElement('i', null, `${use(wait)}:${useLocale()}`)
    }
    function page(wait: Promise<string>): ReactElement {
      return createElement(
        'div',
        null,
        createElement(Label),
        createElement(Suspense, { fallback: '...' }, createElement(Late, { wait })),
      )
    }
    const german = deferred()
    const english = deferred()
    const [deStream, enStream] = await Promise.all([
      runWithLocale('de', () => renderToReadableStream(page(german.promise))),
      runWithLocale('en', () => renderToReadableStream(page(english.promise))),
    ])
    setTimeout(() => {
      english.resolve('late')
      german.resolve('spät')
    }, 1)
    const [de, en] = await Promise.all([new Response(deStream).text(), new Response(enStream).text()])
    expect(de).toContain('<span>de</span>')
    expect(de).toContain('<i>spät:de</i>')
    expect(en).toContain('<span>en</span>')
    expect(en).toContain('<i>late:en</i>')
  })
})

describe('Parts on the server', () => {
  test('separates adjacent text chunks so hydration can split them again', () => {
    expect(renderToString(createElement(Parts, { of: ['a', 'b'] }))).toBe('a<!-- -->b')
  })

  test('escapes every markup significant character in catalog text', () => {
    expect(renderToStaticMarkup(createElement(Parts, { of: [`<&>"'`] }))).toBe(
      '&lt;&amp;&gt;&quot;&#x27;',
    )
  })

  test('does not unescape an already escaped entity', () => {
    expect(renderToStaticMarkup(createElement(Parts, { of: ['&amp;'] }))).toBe('&amp;amp;')
  })

  test('keeps emoji, RTL marks and CRLF unchanged', () => {
    const text = '\u{1F44B}‏مرحبا\r\nnext\rline'
    expect(renderToStaticMarkup(createElement(Parts, { of: [text] }))).toBe(text)
  })

  test('renders numbers at the limits as their string form', () => {
    expect(
      renderToStaticMarkup(
        createElement(Parts, { of: [0, '|', -0, '|', Number.NaN, '|', 1e21, '|', Number.MAX_SAFE_INTEGER] }),
      ),
    ).toBe('0|0|NaN|1e+21|9007199254740991')
  })

  test('renders an empty chunk list as an empty string', () => {
    expect(renderToStaticMarkup(createElement(Parts, { of: [] }))).toBe('')
  })

  test('escapes a hostile attribute value inside handler output', () => {
    const link = createElement('a', { href: '"><script>x</script>' }, 'terms')
    const markup = renderToStaticMarkup(createElement(Parts, { of: ['Read ', link] }))
    expect(markup).not.toContain('<script>')
    expect(markup).toBe('Read <a href="&quot;&gt;&lt;script&gt;x&lt;/script&gt;">terms</a>')
  })
})
