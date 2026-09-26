import { describe, expect, test } from 'vitest'
import type { ScanGroup } from './index'
import { scanFile } from './index'

const IDS: ReadonlySet<string> = new Set(['cart_items', 'nav_cart', 'nav_home'])
const NO_GROUPS: readonly ScanGroup[] = []
const IMPORT = "import * as m from './loclizr/messages'"

function scopesOf(source: readonly string[], file = 'src/Cart.tsx'): readonly (string | null)[] {
  const text = `${[IMPORT, ...source].join('\n')}\n`
  return scanFile({ text, file, outDir: 'src/loclizr', ids: IDS, groups: NO_GROUPS }).map(
    (site) => site.scope,
  )
}

describe('the enclosing declaration of an arrow component', () => {
  test('a parenthesized implicit return keeps the variable name', () => {
    expect(
      scopesOf(['const Cart = () => (', '  <p>{m.nav_home()}</p>', ')']),
    ).toEqual(['Cart'])
  })

  test('a brace-bodied arrow keeps the variable name', () => {
    expect(scopesOf(['const Cart = () => {', '  return m.nav_home()', '}'])).toEqual(['Cart'])
  })

  test('every site of an unparenthesized implicit return carries the variable name', () => {
    expect(
      scopesOf(['const Cart = () => <p>{m.nav_home()} {m.nav_cart()}</p>']),
    ).toEqual(['Cart', 'Cart'])
  })

  test('an async arrow keeps the variable name rather than the async keyword', () => {
    expect(
      scopesOf(['const load = async () => {', '  return m.nav_home()', '}'], 'src/load.ts'),
    ).toEqual(['load'])
  })

  test('a comma between JSX children does not end the arrow body', () => {
    expect(scopesOf(['const Cart = () => <p>{m.nav_home()}, {m.nav_cart()}</p>'])).toEqual([
      'Cart',
      'Cart',
    ])
  })

  test('a component wrapped in memo keeps the variable name', () => {
    expect(
      scopesOf(['export const Cart = memo(() => {', '  return m.nav_home()', '})']),
    ).toEqual(['Cart'])
  })

  test('a named function inside forwardRef names that function', () => {
    expect(
      scopesOf([
        'export const Cart = forwardRef(function Inner(props, ref) {',
        '  return m.nav_home()',
        '})',
      ]),
    ).toEqual(['Inner'])
  })
})

describe('the enclosing declaration around inline object types', () => {
  test('an inline object return type does not steal the function name', () => {
    expect(
      scopesOf(
        ['function useLabels(): { title: string } {', '  return m.nav_home()', '}'],
        'src/labels.ts',
      ),
    ).toEqual(['useLabels'])
  })

  test('an object literal method keeps its name through a return type', () => {
    expect(
      scopesOf(
        ['const handlers = {', '  onClick(): void {', '    m.nav_home()', '  },', '}'],
        'src/handlers.ts',
      ),
    ).toEqual(['onClick'])
  })

  test('an annotated variable declaration keeps its own name', () => {
    expect(
      scopesOf(
        ['const render: { (): string } = function () {', '  return m.nav_home()', '}'],
        'src/labels.ts',
      ),
    ).toEqual(['render'])
  })
})

describe('a name the enclosing declaration does not own', () => {
  test('an arrow type in a parameter list does not consume the variable name', () => {
    expect(
      scopesOf(
        ['const load = (render: () => string) => {', '  return m.nav_home()', '}'],
        'src/load.ts',
      ),
    ).toEqual(['load'])
  })

  test('a parenthesized expression does not name the block on the next line', () => {
    expect(
      scopesOf(['const total = (1 + 2)', 'if (total) {', '  m.nav_home()', '}'], 'src/total.ts'),
    ).toEqual([null])
  })

  test('a variable from the line above does not name an anonymous callback', () => {
    expect(scopesOf(["const label = 'x'", 'items.map(() => <p>{m.nav_home()}</p>)'])).toEqual([
      null,
    ])
  })
})

describe('the enclosing declaration in ordinary nesting', () => {
  test('an inner function wins and its closing brace restores the outer one', () => {
    expect(
      scopesOf(
        [
          'function outer() {',
          '  function inner() {',
          '    return m.nav_home()',
          '  }',
          '  return m.nav_cart()',
          '}',
        ],
        'src/labels.ts',
      ),
    ).toEqual(['inner', 'outer'])
  })

  test('a class method wins over the class', () => {
    expect(
      scopesOf(
        ['class Panel {', '  private label(): string {', '    return m.nav_home()', '  }', '}'],
        'src/panel.ts',
      ),
    ).toEqual(['label'])
  })

  test('an object literal method wins over the object', () => {
    expect(
      scopesOf(
        ['const handlers = {', '  onClick() {', '    m.nav_home()', '  },', '}'],
        'src/handlers.ts',
      ),
    ).toEqual(['onClick'])
  })

  test('a stray closing brace above a component does not cost its scope', () => {
    expect(
      scopesOf(['}', 'export function Cart() {', '  return <p>{m.nav_home()}</p>', '}']),
    ).toEqual(['Cart'])
  })

  test('a heritage clause does not take the name of the class it extends', () => {
    expect(
      scopesOf(
        ['class Panel extends mixin(Base) {', '  label = m.nav_home()', '}'],
        'src/panel.ts',
      ),
    ).toEqual(['Panel'])
  })

  test('a getter names itself', () => {
    expect(
      scopesOf(
        ['class Panel {', '  get label() {', '    return m.nav_home()', '  }', '}'],
        'src/panel.ts',
      ),
    ).toEqual(['label'])
  })

  test('a generic signature does not lose the function name', () => {
    expect(
      scopesOf(
        ['function pick<T extends object>(value: T) {', '  return m.nav_home()', '}'],
        'src/pick.ts',
      ),
    ).toEqual(['pick'])
  })
})
