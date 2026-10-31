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

describe('a top-level usage in a single-file component', () => {
  test.each([
    ['src/components/Cart.vue', '<template>\n<p>{{ m.cart_items({ count }) }}</p>\n</template>'],
    ['src/components/Cart.svelte', '<p>{m.cart_items({ count })}</p>'],
    ['src/components/Cart.astro', '---\n<p>{m.cart_items({ count })}</p>'],
  ])('takes the component name from the file name in %s', (file, template) => {
    expect(scopesOf([template], file)).toEqual(['Cart'])
  })

  test('keeps the enclosing function inside the component script', () => {
    expect(
      scopesOf(['function label() {', '  return m.nav_home()', '}', '<p>{m.nav_cart()}</p>'], 'src/Nav.svelte'),
    ).toEqual(['label', 'Nav'])
  })

  test('strips only the last extension and matches it case-insensitively', () => {
    expect(scopesOf(['<p>{m.nav_home()}</p>'], 'src/Cart.page.SVELTE')).toEqual(['Cart.page'])
  })

  test('ends a braceless arrow written last in the script at the closing script tag', () => {
    expect(
      scopesOf(
        ['<script>', 'const greet = () => m.nav_cart()', '</script>', '<p>{m.nav_home()}</p>'],
        'src/Cart.svelte',
      ),
    ).toEqual(['greet', 'Cart'])
    expect(
      scopesOf(
        [
          '<script setup lang="ts">',
          "const close = () => emit('close')",
          '</script>',
          '',
          '<template>',
          '  <p>{{ m.nav_home() }}</p>',
          '</template>',
        ],
        'src/Cart.vue',
      ),
    ).toEqual(['Cart'])
  })

  test('ends a braceless arrow at a closing script tag on the same line', () => {
    expect(
      scopesOf(
        ['<script>const greet = () => m.nav_cart()</script>', '<p>{m.nav_home()}</p>'],
        'src/Cart.svelte',
      ),
    ).toEqual(['greet', 'Cart'])
  })

  test('ends a braceless arrow in a module script before the instance script', () => {
    expect(
      scopesOf(
        [
          '<script context="module">',
          'export const load = () => m.nav_cart()',
          '</script>',
          '<script>let x = 1</script>',
          '<p>{m.nav_home()}</p>',
        ],
        'src/Cart.svelte',
      ),
    ).toEqual(['load', 'Cart'])
  })

  test('ends a braceless arrow written last in the frontmatter at the closing fence', () => {
    expect(
      scopesOf(
        ['---', 'const day = (d) => d.toISOString()', '---', '<p>{m.nav_home()}</p>'],
        'src/pages/Cart.astro',
      ),
    ).toEqual(['Cart'])
  })

  test('keeps a template literal body open to the closing script tag', () => {
    expect(
      scopesOf(
        [
          '<script setup>',
          'const view = () => `',
          '  ${m.nav_cart()}',
          '`',
          '</script>',
          '<template>{{ m.nav_home() }}</template>',
        ],
        'src/Cart.vue',
      ),
    ).toEqual(['view', 'Cart'])
  })

  test('leaves a top-level usage in a script module unnamed', () => {
    expect(scopesOf(['export const home = m.nav_home()'], 'src/Cart.ts')).toEqual([null])
    expect(scopesOf(['m.nav_home()'], 'src/Cart.tsx')).toEqual([null])
  })
})
