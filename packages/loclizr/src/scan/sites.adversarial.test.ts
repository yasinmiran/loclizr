import { describe, expect, test } from 'vitest'
import type { ScanGroup } from './index'
import { scanFile } from './index'

const NO_GROUPS: readonly ScanGroup[] = []
const IMPORT = "import * as m from './loclizr/messages'"

const CJK_ID = '导航_首页'
const ASTRAL_ID = '\u{20000}_home'
const DOLLAR_ID = '$default'

const IDS: ReadonlySet<string> = new Set([
  'cart_items',
  'nav_cart',
  'nav_home',
  CJK_ID,
  ASTRAL_ID,
  DOLLAR_ID,
])

function sitesOf(text: string, file = 'src/App.ts') {
  return scanFile({ text, file, outDir: 'src/loclizr', ids: IDS, groups: NO_GROUPS })
}

function fromLines(source: readonly string[], file = 'src/App.ts') {
  return sitesOf(`${source.join('\n')}\n`, file)
}

function isLoneSurrogate(char: string): boolean {
  const code = char.codePointAt(0) ?? 0
  return char.length === 1 && code >= 0xd800 && code <= 0xdfff
}

describe('line endings and leading bytes', () => {
  test('counts lines across CRLF and keeps the carriage return out of the snippet', () => {
    const text = `${IMPORT}\r\nexport function Cart() {\r\n  return m.nav_home()\r\n}\r\n`
    expect(sitesOf(text, 'src/Cart.tsx')).toEqual([
      {
        id: 'nav_home',
        file: 'src/Cart.tsx',
        line: 3,
        column: 10,
        scope: 'Cart',
        snippet: 'return m.nav_home()',
      },
    ])
  })

  test('reads a file that opens with a byte order mark', () => {
    const sites = sitesOf(`﻿${IMPORT}\nm.nav_home()\n`)
    expect(sites.map((site) => [site.id, site.line, site.column])).toEqual([['nav_home', 2, 1]])
  })

  test('reports the last line of a file with no final newline', () => {
    const sites = sitesOf(`${IMPORT}\nm.nav_cart()`)
    expect(sites.map((site) => [site.line, site.snippet])).toEqual([[2, 'm.nav_cart()']])
  })
})

describe('non-ASCII identifiers', () => {
  test('records a member access on a CJK identifier', () => {
    expect(fromLines([IMPORT, `m.${CJK_ID}()`]).map((site) => site.id)).toEqual([CJK_ID])
  })

  test('records a member access on an identifier outside the basic plane', () => {
    expect(fromLines([IMPORT, `m.${ASTRAL_ID}()`]).map((site) => site.id)).toEqual([ASTRAL_ID])
  })

  test('records a bare binding whose identifier is outside the basic plane', () => {
    expect(
      fromLines([
        `import { ${ASTRAL_ID} } from './loclizr/messages'`,
        `${ASTRAL_ID}()`,
      ]).map((site) => site.id),
    ).toEqual([ASTRAL_ID])
  })

  test('records a member access on an identifier the mangler prefixed with a dollar sign', () => {
    expect(fromLines([IMPORT, `m.${DOLLAR_ID}()`]).map((site) => site.id)).toEqual([DOLLAR_ID])
  })
})

describe('the snippet', () => {
  test('carries the source line verbatim, comment and all', () => {
    expect(
      fromLines([IMPORT, 'const label = m.nav_home() // the home label'])[0]?.snippet,
    ).toBe('const label = m.nav_home() // the home label')
  })

  test('caps at 160 code points and never ends on half a surrogate pair', () => {
    const snippet = fromLines([IMPORT, `const long = [m.nav_home(), '${'\u{1f600}'.repeat(200)}']`])[0]
      ?.snippet
    expect(Array.from(snippet ?? '')).toHaveLength(160)
    expect(Array.from(snippet ?? '').some(isLoneSurrogate)).toBe(false)
  })

  test('reports the line holding the usage, not the line opening the template', () => {
    const sites = fromLines([
      IMPORT,
      'const label = `',
      '  ${m.nav_cart()}',
      '`',
    ])
    expect(sites.map((site) => [site.line, site.snippet])).toEqual([[3, '${m.nav_cart()}']])
  })
})

describe('columns', () => {
  test('counts a tab as one column', () => {
    expect(fromLines([IMPORT, '\tm.nav_home()'])[0]?.column).toBe(2)
  })

  test('points at the bound identifier of a bare call', () => {
    expect(
      fromLines(["import { nav_home } from './loclizr/messages'", '  nav_home()'])[0]?.column,
    ).toBe(3)
  })

  test('separates two usages written on one line', () => {
    expect(
      fromLines([IMPORT, 'const both = [m.nav_home(), m.nav_cart()]']).map((site) => [
        site.id,
        site.column,
      ]),
    ).toEqual([
      ['nav_home', 15],
      ['nav_cart', 29],
    ])
  })
})
