import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import type { ReactElement } from 'react'
import { renderToStaticMarkup, renderToString } from 'react-dom/server'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { LocaleSetup, MessageOptions } from '../types'
import { $configure1 } from '../runtime/abi'
import { resetRuntime } from '../runtime/__fixtures__/reset'
import { runWithLocale } from '../server/index'
import { storeState } from '../runtime/state'
import { getRawLocale, setLocale } from '../runtime/store'
import { Parts, useLocale } from './index'

const SETUP: LocaleSetup = { locales: ['de', 'de-AT', 'en'], sourceLocale: 'en', cookie: 'locale' }

// One generated message function, imported by a component that renders on the
// server: a resolver call and a switch, with no React import of its own.
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

function Label(): ReactElement {
  return createElement('span', null, useLocale())
}

afterEach(() => {
  resetRuntime()
  vi.restoreAllMocks()
})

describe('a server render with no DOM anywhere', () => {
  test('reads the locale of the scope it runs inside', () => {
    $configure1(SETUP)
    expect(runWithLocale('de-AT', () => renderToString(createElement(Label)))).toContain('de-AT')
    expect(runWithLocale('de-CH', () => renderToString(createElement(Label)))).toContain('de')
    expect(runWithLocale('sp', () => renderToString(createElement(Label)))).toContain('en')
  })

  test('renders a message function and the hook to the same locale', () => {
    const greeting = makeGreeting()
    function Cart(): ReactElement {
      return createElement('p', null, `${useLocale()}:${greeting()}`)
    }
    expect(runWithLocale('de', () => renderToString(createElement(Cart)))).toContain('de:Hallo')
    expect(runWithLocale('en', () => renderToString(createElement(Cart)))).toContain('en:Hello')
  })

  test('writes nothing into the process wide store', () => {
    $configure1(SETUP)
    runWithLocale('de', () => renderToString(createElement(Label)))
    expect(storeState().raw).toBeNull()
    expect(getRawLocale()).toBe('')
  })

  test('degrades to the source locale outside any scope, warning rather than throwing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    $configure1(SETUP)
    runWithLocale('de', () => 0)
    expect(() => renderToString(createElement(Label))).not.toThrow()
    expect(renderToString(createElement(Label))).toContain('en')
    expect(warn).toHaveBeenCalledTimes(1)
  })

  test('is not disturbed by a switch that landed before it', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    $configure1(SETUP)
    setLocale('de')
    expect(runWithLocale('en', () => renderToString(createElement(Label)))).toContain('en')
    expect(renderToString(createElement(Label))).toContain('de')
  })
})

describe('Parts on the server', () => {
  test('renders markup chunks with no client boundary and no document', () => {
    const link = (chunks: readonly (string | ReactElement)[]): ReactElement =>
      createElement('a', { href: '/terms' }, ...chunks)
    const markup = renderToStaticMarkup(
      createElement(Parts, { of: ['Read our ', link(['terms']), ' before you continue.'] }),
    )
    expect(markup).toBe('Read our <a href="/terms">terms</a> before you continue.')
  })

  test('escapes catalog text rather than emitting it as markup', () => {
    const chunk = '<img src=x onerror="alert(1)">'
    const markup = renderToStaticMarkup(createElement(Parts, { of: [chunk] }))
    expect(markup).not.toContain('<img')
    expect(markup).toContain('&lt;img')
  })

  test('renders a coerced one element array as plain text', () => {
    expect(renderToStaticMarkup(createElement(Parts, { of: ['Lies unsere AGB.'] }))).toBe(
      'Lies unsere AGB.',
    )
  })
})

describe('the react binding', () => {
  test('ships no client directive, in source or in the built entry', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const candidates = [
      resolve(here, 'index.ts'),
      resolve(here, '../index.ts'),
      resolve(here, '../../dist/react/index.js'),
      resolve(here, '../../dist/index.js'),
    ]
    let checked = 0
    for (const file of candidates) {
      if (!existsSync(file)) continue
      checked += 1
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/^\s*['"]use client['"];?\s*$/m)
    }
    expect(checked).toBeGreaterThanOrEqual(2)
  })
})
