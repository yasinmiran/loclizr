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

  it('ends an expression-bodied arrow at its line when no semicolon follows', () => {
    expect(
      scopesOf(['export const Label = () => m.nav_home()', 'export const title = m.nav_cart()']),
    ).toEqual(['Label', null])
  })

  it('does not name the statements after an arrow that holds no usage', () => {
    expect(
      scopesOf(['function Cart() {', '  const pick = (x) => x', '  m.nav_home()', '}']),
    ).toEqual(['Cart'])
  })

  it('keeps an expression body open across a break the expression continues over', () => {
    expect(
      scopesOf([
        'const Label = () =>',
        '  m.nav_home()',
        '    .toUpperCase() + m.nav_cart()',
        '    + m.cart_items()',
      ]),
    ).toEqual(['Label', 'Label', 'Label'])
  })

  it('keeps an unparenthesized multiline jsx body open', () => {
    expect(
      scopesOf(['const Cart = () => <p>', '  {m.nav_home()}', '</p>'], 'src/Cart.tsx'),
    ).toEqual(['Cart'])
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

describe('an expression-bodied arrow whose body is a template literal', () => {
  it('keeps a multiline tagged template open across the breaks inside it', () => {
    expect(
      scopesOf([
        'const view = () => html`',
        '  <p>${m.nav_home()}</p>',
        '  <p>${m.nav_cart()}</p>',
        '`',
        'export const title = m.cart_items()',
      ]),
    ).toEqual(['view', 'view', null])
  })

  it('keeps a template body open when a semicolon ends it', () => {
    expect(
      scopesOf([
        'function Cart() {',
        '  const view = () => `',
        '    ${m.nav_home()}',
        '  `;',
        '  return m.nav_cart()',
        '}',
      ]),
    ).toEqual(['view', 'Cart'])
  })

  it('keeps a template body open past a hole that closes on its line', () => {
    expect(
      scopesOf([
        'const view = () => `${m.nav_home()}',
        '  ${m.nav_cart()}',
        '`',
        'const title = m.cart_items()',
      ]),
    ).toEqual(['view', 'view', null])
  })

  it('keeps a multiline template body open in a .tsx file, whose lexer keeps its text', () => {
    expect(
      scopesOf(
        ['const view = () => `', '  ${m.nav_home()}', '`', 'const title = m.nav_cart()'],
        'src/Cart.tsx',
      ),
    ).toEqual(['view', null])
  })

  it('ends a body whose one-line template closes before the break', () => {
    expect(scopesOf(['const view = () => `x`', 'const title = m.nav_home()'])).toEqual([null])
  })
})

describe('an expression-bodied arrow whose body is a jsx element', () => {
  function jsxScopes(source: readonly string[], file = 'src/Cart.tsx') {
    return scopesOf([...source, 'export const title = m.cart_items()'], file)
  }

  it('ends a one-line self-closing element at its line', () => {
    expect(jsxScopes(['export const Icon = () => <svg />'])).toEqual([null])
  })

  it('ends a one-line element at its line', () => {
    expect(jsxScopes(['const Label = () => <span>{m.nav_home()}</span>'])).toEqual([
      'Label',
      null,
    ])
  })

  it('ends a one-line fragment at its line', () => {
    expect(jsxScopes(['const Label = () => <>{m.nav_home()}</>'])).toEqual(['Label', null])
  })

  it('ends a multiline element at the line of its closing tag', () => {
    expect(jsxScopes(['const Cart = () => <p>', '  {m.nav_home()}', '</p>'])).toEqual([
      'Cart',
      null,
    ])
  })

  it('keeps the element open across adjacent children on their own lines', () => {
    expect(
      jsxScopes(['const Cart = () => <div>', '  {m.nav_home()}', '  {m.nav_cart()}', '</div>']),
    ).toEqual(['Cart', 'Cart', null])
  })

  it('keeps the element open across a line of text', () => {
    expect(
      jsxScopes(['const Cart = () => <p>', '  Hello world', '  {m.nav_home()}', '</p>']),
    ).toEqual(['Cart', null])
  })

  it('reads keywords and entities in element text as prose', () => {
    expect(
      jsxScopes(['const Cart = () => <p>Sign in with {m.nav_home()}&nbsp;{m.nav_cart()}</p>']),
    ).toEqual(['Cart', 'Cart', null])
  })

  it('keeps a tag open across attributes on their own lines', () => {
    expect(
      jsxScopes([
        'const Cart = () => <Badge',
        '  title={m.nav_home()}',
        '  label={m.nav_cart()}',
        '/>',
      ]),
    ).toEqual(['Cart', 'Cart', null])
  })

  it('keeps an element open whose opening tag spans lines', () => {
    expect(
      jsxScopes(['const Cart = () => <p', '  className="cart">', '  {m.nav_home()}', '</p>']),
    ).toEqual(['Cart', null])
  })

  it('counts nested elements', () => {
    expect(
      jsxScopes(['const Cart = () => <div>', '  <p>x</p>', '  {m.nav_home()}', '</div>']),
    ).toEqual(['Cart', null])
  })

  it('reads an element in each branch of a ternary written across lines', () => {
    expect(
      jsxScopes([
        'const Cart = () => ok',
        '  ? <p>{m.nav_home()}</p>',
        '  : <p>{m.nav_cart()}</p>',
      ]),
    ).toEqual(['Cart', 'Cart', null])
  })

  it('names the enclosing function after an element body inside it', () => {
    expect(
      scopesOf(
        ['function Page() {', '  const Icon = () => <svg />', '  const title = m.nav_home()', '}'],
        'src/Page.tsx',
      ),
    ).toEqual(['Page'])
  })

  it('reads an element in a .js file, where a < in operand position can only be jsx', () => {
    expect(
      jsxScopes(
        ['const Cart = () => <p>', '  Hello world', '  {m.nav_home()}', '</p>'],
        'src/Cart.js',
      ),
    ).toEqual(['Cart', null])
  })

  it.each([
    ['a trailing comma', 'const make = () => <T,>(x: T) => x'],
    ['a constraint', 'const make = () => <T extends object>(x: T) => x'],
  ])('reads a generic arrow with %s as code, not an element', (_name, line) => {
    expect(
      scopesOf([line, 'function Cart() {', '  return m.nav_home()', '}'], 'src/Cart.tsx'),
    ).toEqual(['Cart'])
  })

  it.each([
    ['an apostrophe in a .js file', "const Empty = () => <p>Your cart's empty</p>", 'src/Cart.js'],
    ['a url in a .js file', 'const Help = () => <p>see http://example.com</p>', 'src/Cart.js'],
    ['a double slash in a .tsx file', 'const Help = () => <p>and // or</p>', 'src/Cart.tsx'],
  ])('finds the usages after element text the tokenizer blanked, %s', (_name, line, file) => {
    expect(idsOf([IMPORT, line, 'export const title = m.cart_items()'], file)).toEqual([
      'cart_items',
    ])
  })

  it('reads a < after an operand as a comparison', () => {
    expect(jsxScopes(['const less = (a, b) => a < b'])).toEqual([null])
  })

  it('keeps a body open across a > that ends its line as an operator', () => {
    expect(scopesOf(['const big = (x) => x >', '  m.nav_home()'], 'src/Cart.tsx')).toEqual(['big'])
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
