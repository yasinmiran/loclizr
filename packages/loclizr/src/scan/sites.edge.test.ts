import { describe, expect, it } from 'vitest'
import type { ScanGroup } from './index'
import { scanFile } from './index'

const IDS: ReadonlySet<string> = new Set([
  'cart_items',
  'errors_forbidden',
  'errors_not_found',
  'nav_cart',
  'nav_home',
])

const GROUPS: readonly ScanGroup[] = [
  {
    id: 'errors',
    memberIds: ['errors_forbidden', 'errors_not_found'],
    memberProps: { forbidden: 'errors_forbidden', not_found: 'errors_not_found' },
  },
]

const IMPORT = "import * as m from './loclizr/messages'"

function sitesOf(source: readonly string[], file = 'src/App.ts') {
  const text = `${source.join('\n')}\n`
  return scanFile({ text, file, outDir: 'src/loclizr', ids: IDS, groups: GROUPS })
}

function idsOf(source: readonly string[], file = 'src/App.ts'): readonly string[] {
  return sitesOf(source, file).map((site) => site.id)
}

function scopesOf(source: readonly string[], file = 'src/App.ts'): readonly (string | null)[] {
  return sitesOf([IMPORT, ...source], file).map((site) => site.scope)
}

describe('the enclosing declaration', () => {
  it('names the inner arrow for its own usage and the outer one after it', () => {
    expect(
      scopesOf([
        'const Outer = () => {',
        '  const inner = () => m.nav_home()',
        '  return m.nav_cart()',
        '}',
      ]),
    ).toEqual(['inner', 'Outer'])
  })

  it('leaves an immediately invoked anonymous arrow without a scope', () => {
    expect(scopesOf([';(() => {', '  m.nav_home()', '})()'])).toEqual([null])
  })

  it('leaves an anonymous default export without a scope', () => {
    expect(scopesOf(['export default function () {', '  return m.nav_home()', '}'])).toEqual([
      null,
    ])
  })

  it('names a default-exported function by its own name', () => {
    expect(scopesOf(['export default function Cart() {', '  return m.nav_home()', '}'])).toEqual([
      'Cart',
    ])
  })

  it('names an exported async function', () => {
    expect(scopesOf(['export async function load() {', '  return m.nav_home()', '}'])).toEqual([
      'load',
    ])
  })

  it('names a generator function through its star', () => {
    expect(scopesOf(['function* gen() {', '  yield m.nav_home()', '}'])).toEqual(['gen'])
  })

  it('names a class constructor', () => {
    expect(
      scopesOf(['class Panel {', '  constructor() {', '    this.x = m.nav_home()', '  }', '}']),
    ).toEqual(['constructor'])
  })

  it('names an arrow that returns a parenthesized object literal', () => {
    expect(scopesOf(['const make = () => ({ label: m.nav_home() })'])).toEqual(['make'])
  })

  it('names an arrow whose single parameter has no parentheses', () => {
    expect(scopesOf(['const Cart = props => {', '  return m.nav_home()', '}'])).toEqual(['Cart'])
  })

  it('names an arrow behind a generic type annotation and a destructured parameter', () => {
    expect(
      scopesOf(['const Cart: FC<Props> = ({ a }) => {', '  return m.nav_home()', '}']),
    ).toEqual(['Cart'])
  })

  it('keeps the function name through a switch and its case label', () => {
    expect(
      scopesOf([
        'function pick(x) {',
        '  switch (x) {',
        '    case 1: return m.nav_home()',
        '  }',
        '}',
      ]),
    ).toEqual(['pick'])
  })

  it('keeps the function name through try and catch blocks', () => {
    expect(
      scopesOf([
        'function load() {',
        '  try {',
        '    m.nav_home()',
        '  } catch (error) {',
        '    m.nav_cart()',
        '  }',
        '}',
      ]),
    ).toEqual(['load', 'load'])
  })

  it('names a function whose identifier is Cyrillic', () => {
    expect(scopesOf(['function Корзина() {', '  return m.nav_home()', '}'])).toEqual(['Корзина'])
  })

  it('names a function whose identifier starts outside the basic plane', () => {
    expect(scopesOf(['function \u{20000}x() {', '  return m.nav_home()', '}'])).toEqual([
      '\u{20000}x',
    ])
  })
})

describe('brace depth in a module file', () => {
  it.each([
    ["a quoted closing brace", "  const s = '}'"],
    ['a regular expression holding a closing brace', '  const r = /}/'],
    ['a template holding a closing brace', '  const t = `}`'],
    ['a line comment holding a closing brace', '  // }'],
    ['a block comment holding a closing brace', '  /* } */'],
  ])('%s does not pop the enclosing function', (_name, line) => {
    expect(scopesOf(['function Cart() {', line, '  return m.nav_home()', '}'])).toEqual(['Cart'])
  })

  it('survives five thousand nested blocks and restores the top level after them', () => {
    const sites = sitesOf([
      IMPORT,
      'function Cart() {',
      `${'{'.repeat(5000)}m.nav_home()${'}'.repeat(5000)}`,
      '}',
      'm.nav_cart()',
    ])
    expect(sites.map((site) => [site.id, site.scope])).toEqual([
      ['nav_home', 'Cart'],
      ['nav_cart', null],
    ])
  })
})

describe('what counts as an access', () => {
  // Section 12: "A reference in type position, `typeof m.nav_home`, is a member
  // access like any other and is recorded as a usage."
  it('records a namespace member in type position', () => {
    expect(
      sitesOf([IMPORT, 'type Label = typeof m.nav_home']).map((site) => [site.id, site.column]),
    ).toEqual([['nav_home', 21]])
  })

  it('does not record a namespace alias that is itself a property', () => {
    expect(idsOf([IMPORT, 'this.m.nav_home()', 'store.m.nav_cart()'])).toEqual([])
  })

  it('does not record a bound bare name called as a method of something else', () => {
    expect(
      idsOf([
        "import { nav_home } from './loclizr/messages'",
        'this.nav_home()',
        'obj?.nav_home()',
      ]),
    ).toEqual([])
  })

  it('does not record a local function declaration that reuses a bound name', () => {
    expect(
      idsOf(["import { nav_home } from './loclizr/messages'", 'function nav_home() {}']),
    ).toEqual([])
  })

  it('records a bound bare call with whitespace or a newline before its parenthesis', () => {
    expect(
      sitesOf(["import { nav_home } from './loclizr/messages'", 'nav_home ()', 'nav_home', '()']).map(
        (site) => site.line,
      ),
    ).toEqual([2, 3])
  })

  it.each(['am.nav_home()', '$m.nav_home()', 'm2.nav_home()', '_m.nav_home()'])(
    'does not mistake %s for the namespace alias',
    (line) => {
      expect(idsOf([IMPORT, line])).toEqual([])
    },
  )

  it.each(['m.nav_homeX()', 'm.nav_home_()', 'm.Nav_home()'])(
    'does not record %s, whose member only resembles an id',
    (line) => {
      expect(idsOf([IMPORT, line])).toEqual([])
    },
  )

  it('reads through whitespace and a comment between the alias and the dot', () => {
    expect(idsOf([IMPORT, 'm . nav_home()', 'm /* note */ .nav_cart()'])).toEqual([
      'nav_home',
      'nav_cart',
    ])
  })

  it('records an optional call on an optionally chained member once', () => {
    expect(idsOf([IMPORT, 'm?.nav_home?.()'])).toEqual(['nav_home'])
  })

  it('resolves an optionally chained computed group access through the barrel', () => {
    expect(idsOf([IMPORT, 'm.errors?.[code]()'])).toEqual(['errors_forbidden', 'errors_not_found'])
  })

  it('records a group with no members as nothing', () => {
    const sites = scanFile({
      text: "import { empty } from './loclizr/groups'\nempty[code]()\n",
      file: 'src/App.ts',
      outDir: 'src/loclizr',
      ids: IDS,
      groups: [{ id: 'empty', memberIds: [], memberProps: {} }],
    })
    expect(sites).toEqual([])
  })

  it('resolves a group property that shares its name with an Object.prototype member when it is an own property', () => {
    const sites = scanFile({
      text: "import { errors } from './loclizr/groups'\nerrors.constructor()\nerrors.toString()\n",
      file: 'src/App.ts',
      outDir: 'src/loclizr',
      ids: new Set(['errors_constructor']),
      groups: [
        {
          id: 'errors',
          memberIds: ['errors_constructor'],
          memberProps: Object.fromEntries([['constructor', 'errors_constructor']]),
        },
      ],
    })
    expect(sites.map((site) => site.id)).toEqual(['errors_constructor'])
  })
})

describe('literals and comments in a module file', () => {
  it('reads an escaped template hole as template text', () => {
    expect(idsOf([IMPORT, 'const t = `\\${m.nav_home()}`', 'm.nav_cart()'])).toEqual(['nav_cart'])
  })

  it('reads an escaped quote as part of the string', () => {
    expect(idsOf([IMPORT, "const t = 'it\\'s m.nav_home()'", 'm.nav_cart()'])).toEqual([
      'nav_cart',
    ])
  })

  it('closes a string that ends on an escaped backslash', () => {
    expect(idsOf([IMPORT, "const t = 'a\\\\'; m.nav_home()"])).toEqual(['nav_home'])
  })

  it('reads a slash inside a regular expression class as part of the class', () => {
    expect(idsOf([IMPORT, 'const r = /[/]m.nav_home()/; m.nav_cart()'])).toEqual(['nav_cart'])
  })

  it('reads a slash after return as a regular expression', () => {
    expect(idsOf([IMPORT, 'function f() { return /m.nav_home()/ }'])).toEqual([])
  })

  it('reads a slash after a closing parenthesis as a division', () => {
    expect(idsOf([IMPORT, 'const r = (a) / b; m.nav_home(); const h = n / 2'])).toEqual([
      'nav_home',
    ])
  })
})

describe('component files', () => {
  it('keeps a closing brace in a quoted attribute out of the scope depth', () => {
    expect(
      scopesOf(['function Cart() {', '  return <p title="}">{m.nav_home()}</p>', '}'], 'src/Cart.tsx'),
    ).toEqual(['Cart'])
  })

  it('records a usage inside a template hole inside a JSX expression', () => {
    expect(scopesOf(['const Cart = () => <p>{`${m.nav_home()}`}</p>'], 'src/Cart.tsx')).toEqual([
      'Cart',
    ])
  })

  // Section 12: "No regular expression is lexed there", so a pattern's contents
  // read as code in a component file and cost one extra usage site.
  it('accepts a usage inside a regular expression as the documented component-file false positive', () => {
    expect(idsOf([IMPORT, 'const r = /m.nav_home()/'], 'src/Cart.tsx')).toEqual(['nav_home'])
    expect(idsOf([IMPORT, 'const r = /m.nav_home()/'], 'src/Cart.ts')).toEqual([])
  })

  it('narrows string lexing for an upper-case .TSX extension too', () => {
    expect(
      scopesOf(['function Cart() {', "  return <p>Don't {m.nav_home()}</p>", '}'], 'src/Cart.TSX'),
    ).toEqual(['Cart'])
  })

  it('keeps a usage after a quoted word in JSX text that closes on its line', () => {
    expect(
      idsOf([IMPORT, "const Cart = () => <p>Note: 'quoted' {m.nav_home()}</p>"], 'src/Cart.tsx'),
    ).toEqual(['nav_home'])
  })

  it('keeps a usage after double quotes in JSX text that follow a word', () => {
    expect(
      idsOf([IMPORT, 'const Cart = () => <p>Say "hi {m.nav_home()}</p>'], 'src/Cart.tsx'),
    ).toEqual(['nav_home'])
  })
})

describe('the snippet and the input edges', () => {
  it('keeps a line of exactly 160 characters whole', () => {
    const line = `m.nav_home()${'x'.repeat(148)}`
    expect(sitesOf([IMPORT, line])[0]?.snippet).toBe(line)
  })

  it('trims non-breaking spaces around the line', () => {
    expect(sitesOf([IMPORT, '\u00a0\u00a0m.nav_home()\u00a0'])[0]?.snippet).toBe('m.nav_home()')
  })

  it('returns nothing for an empty file', () => {
    expect(
      scanFile({ text: '', file: 'src/App.ts', outDir: 'src/loclizr', ids: IDS, groups: GROUPS }),
    ).toEqual([])
  })

  it('returns nothing for a file holding only a byte order mark', () => {
    expect(
      scanFile({ text: '\ufeff', file: 'src/App.ts', outDir: 'src/loclizr', ids: IDS, groups: GROUPS }),
    ).toEqual([])
  })

  it('returns nothing for a whitespace-only file', () => {
    expect(
      scanFile({
        text: ' \t\n\r\n  \n',
        file: 'src/App.ts',
        outDir: 'src/loclizr',
        ids: IDS,
        groups: GROUPS,
      }),
    ).toEqual([])
  })

  it('records ten thousand usages on one line in source order', () => {
    const sites = sitesOf([IMPORT, 'm.nav_home();'.repeat(10_000)])
    expect(sites).toHaveLength(10_000)
    expect(sites[9_999]?.column).toBe(9_999 * 13 + 1)
  }, 5000)

  it('returns the same sites whatever order the id set was built in', () => {
    const text = `${IMPORT}\nm.nav_cart()\nm.nav_home()\nm.cart_items()\n`
    const forward = scanFile({ text, file: 'src/App.ts', outDir: 'src/loclizr', ids: IDS, groups: GROUPS })
    const backward = scanFile({
      text,
      file: 'src/App.ts',
      outDir: 'src/loclizr',
      ids: new Set([...IDS].reverse()),
      groups: GROUPS,
    })
    expect(backward).toEqual(forward)
  })
})
