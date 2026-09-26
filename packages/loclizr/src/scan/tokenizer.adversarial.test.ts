import { describe, expect, test } from 'vitest'
import type { ScanGroup } from './index'
import { scanFile } from './index'

const IDS: ReadonlySet<string> = new Set(['cart_items', 'nav_cart', 'nav_home'])
const NO_GROUPS: readonly ScanGroup[] = []
const IMPORT = "import * as m from './loclizr/messages'"

function idsOf(source: readonly string[], file = 'src/App.ts'): readonly string[] {
  const text = `${source.join('\n')}\n`
  return scanFile({ text, file, outDir: 'src/loclizr', ids: IDS, groups: NO_GROUPS }).map(
    (site) => site.id,
  )
}

describe('import clause shapes', () => {
  test('binds a multi-line clause with a trailing comma and an inline type modifier', () => {
    expect(
      idsOf([
        'import {',
        '  type CartKey,',
        '  nav_home,',
        "} from './loclizr/messages'",
        'nav_home()',
      ]),
    ).toEqual(['nav_home'])
  })

  test('binds a named entry beside a default import', () => {
    expect(
      idsOf(["import fallback, { nav_home } from './loclizr/messages'", 'nav_home()']),
    ).toEqual(['nav_home'])
  })

  test('binds through a terminating semicolon and double quotes', () => {
    expect(idsOf(['import * as m from "./loclizr/messages";', 'm.nav_home();'])).toEqual([
      'nav_home',
    ])
  })

  test('binds the second of two import statements written on one line', () => {
    expect(idsOf([`import { useState } from 'react'; ${IMPORT}`, 'm.nav_home()'])).toEqual([
      'nav_home',
    ])
  })

  test('does not bind an import that only appears inside a block comment', () => {
    expect(idsOf(['/*', ` ${IMPORT}`, '*/', 'm.nav_home()'])).toEqual([])
  })
})

describe('string and regular-expression lexing in a module file', () => {
  test('an unterminated quote costs its own line and no more', () => {
    expect(idsOf([IMPORT, "const label = 'unterminated", 'm.nav_home()'])).toEqual(['nav_home'])
  })

  test('a division does not swallow the rest of its line', () => {
    expect(idsOf([IMPORT, 'const half = total / count; m.nav_home()'])).toEqual(['nav_home'])
  })

  test('a regular expression holding a slash does not swallow the next line', () => {
    expect(idsOf([IMPORT, "const parts = value.replace(/\\//g, '-')", 'm.nav_cart()'])).toEqual([
      'nav_cart',
    ])
  })

  test('a usage nested two template levels deep is recorded and template text is not', () => {
    expect(
      idsOf([
        IMPORT,
        'const label = `outer m.nav_home() ${`inner ${m.cart_items({ count: 1 })}`}`',
      ]),
    ).toEqual(['cart_items'])
  })

  test('an object literal inside a template hole does not end the template early', () => {
    expect(
      idsOf([IMPORT, 'const label = `${format({ a: 1 })} m.nav_home()`', 'm.nav_cart()']),
    ).toEqual(['nav_cart'])
  })
})

describe('comment stripping in a component file', () => {
  test('strips the JSX expression comment form', () => {
    expect(idsOf([IMPORT, '<div>{/* m.nav_home() */}</div>'], 'src/Cart.tsx')).toEqual([])
  })

  test('keeps a usage beside a JSX expression comment', () => {
    expect(idsOf([IMPORT, '<div>{/* label */}{m.nav_cart()}</div>'], 'src/Cart.tsx')).toEqual([
      'nav_cart',
    ])
  })
})

const HOSTILE_TAILS: readonly string[] = [
  "const a = 'unterminated",
  'const a = "unterminated',
  'const a = `unterminated',
  'const a = `${',
  '/* unterminated',
  '// trailing',
  'const a = /unterminated',
  'const a = 1 \\',
  '{'.repeat(2000),
  '}'.repeat(2000),
  '`${`${`${',
  'import',
  "import * as x from '",
  '\u0000￾\ud800',
]

describe('hostile input', () => {
  test.each(HOSTILE_TAILS)('a tail of %j cannot erase a usage above it', (tail) => {
    expect(idsOf([IMPORT, 'm.nav_home()', tail])).toEqual(['nav_home'])
  })

  test.each(HOSTILE_TAILS)('a file that is only %j scans to a stable empty result', (tail) => {
    const first = idsOf([tail])
    expect(first).toEqual([])
    expect(idsOf([tail])).toEqual(first)
  })

  // The clock is half of this assertion. A whitespace run behind an `import` or
  // `export` token that never reaches a `from` clause is where the binding
  // patterns can backtrack once per split of the run.
  test.each(['import', 'export'])(
    'a long whitespace run behind a bare %s token does not stall the scan',
    (keyword) => {
      expect(idsOf([IMPORT, `${keyword}${' '.repeat(200_000)}`, 'm.nav_home()'])).toEqual([
        'nav_home',
      ])
    },
    2000,
  )

  test('scanning the same text twice returns the same sites', () => {
    const source = [IMPORT, 'export function Cart() {', '  return m.nav_home()', '}']
    const input = {
      text: `${source.join('\n')}\n`,
      file: 'src/Cart.tsx',
      outDir: 'src/loclizr',
      ids: IDS,
      groups: NO_GROUPS,
    }
    expect(scanFile(input)).toEqual(scanFile(input))
  })

  test('leaves the id set and the group list untouched', () => {
    const ids = new Set(['nav_home'])
    const group: ScanGroup = {
      id: 'errors',
      memberIds: ['errors_forbidden'],
      memberProps: { forbidden: 'errors_forbidden' },
    }
    const groups: ScanGroup[] = [group]
    scanFile({
      text: `${[IMPORT, 'm.nav_home()', 'errors.forbidden()'].join('\n')}\n`,
      file: 'src/App.ts',
      outDir: 'src/loclizr',
      ids,
      groups,
    })
    expect([...ids]).toEqual(['nav_home'])
    expect(groups).toEqual([group])
  })
})
