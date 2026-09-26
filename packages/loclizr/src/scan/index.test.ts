import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testConfig } from './__fixtures__/config'
import {
  APP_TSX,
  BARREL_TS,
  HELPER_TS,
  INSIDE_OUTDIR_TS,
  SIDE_EFFECT_TS,
  SWITCHER_TS,
  VENDORED_TS,
} from './__fixtures__/sources'
import type { ScanGroup } from './index'
import { scan, scanFile } from './index'

const IDS: ReadonlySet<string> = new Set([
  'cart_items',
  'cart_total',
  'errors_forbidden',
  'errors_not_found',
  'errors_rate_limited',
  'nav_cart',
  'nav_home',
])

const GROUPS: readonly ScanGroup[] = [
  {
    id: 'errors',
    memberIds: ['errors_forbidden', 'errors_not_found', 'errors_rate_limited'],
    memberProps: {
      forbidden: 'errors_forbidden',
      not_found: 'errors_not_found',
      rate_limited: 'errors_rate_limited',
    },
  },
]

function sitesOf(text: string, file = 'src/App.ts', outDir = 'src/loclizr') {
  return scanFile({ text, file, outDir, ids: IDS, groups: GROUPS })
}

function idsOf(text: string, file = 'src/App.ts', outDir = 'src/loclizr') {
  return sitesOf(text, file, outDir).map((site) => site.id)
}

function lines(...source: readonly string[]): string {
  return `${source.join('\n')}\n`
}

describe('specifier binding', () => {
  it.each([
    './loclizr/messages',
    './loclizr/messages.js',
    '../../loclizr/messages',
    '@/loclizr/messages',
    '~/loclizr/messages',
    'src/loclizr/messages',
    '@/loclizr/messages/nav',
    '#app/loclizr/messages/nav.js',
  ])('binds a namespace imported from %s', (specifier) => {
    expect(idsOf(lines(`import * as m from '${specifier}'`, 'm.nav_home()'))).toEqual(['nav_home'])
  })

  it.each([
    'react',
    './messages',
    './loclizr/other',
    '@/loclizr/messages/deep/nav',
    '@/loclizrmessages',
  ])('does not bind %s', (specifier) => {
    expect(idsOf(lines(`import * as m from '${specifier}'`, 'm.nav_home()'))).toEqual([])
  })

  it('binds the groups entry', () => {
    const text = lines("import { errors } from '#app/loclizr/groups'", 'errors.not_found()')
    expect(idsOf(text)).toEqual(['errors_not_found'])
  })

  it('follows the basename of a configured outDir', () => {
    const text = lines("import * as m from '@/i18n/messages'", 'm.nav_home()')
    expect(idsOf(text, 'src/App.ts', 'app/generated/i18n')).toEqual(['nav_home'])
    expect(idsOf(text, 'src/App.ts', 'src/loclizr')).toEqual([])
  })

  it('ignores a type-only import', () => {
    const text = lines("import type { nav_home } from './loclizr/messages'", 'nav_home()')
    expect(idsOf(text)).toEqual([])
  })
})

describe('pass two', () => {
  it('records a renamed bare binding only when it is called', () => {
    const text = lines(
      "import { nav_home as h, nav_cart } from './loclizr/messages'",
      'const unused = h',
      'const label = nav_cart',
      'h()',
    )
    expect(idsOf(text)).toEqual(['nav_home'])
  })

  it('records a namespace member access with no call', () => {
    const text = lines("import * as m from './loclizr/messages'", 'const f = m.nav_home')
    expect(idsOf(text)).toEqual(['nav_home'])
  })

  it('counts one site per access rather than one per token', () => {
    const text = lines(
      "import { nav_home } from './loclizr/messages'",
      "import * as m from './loclizr/messages'",
      'm.nav_home()',
    )
    expect(idsOf(text)).toEqual(['nav_home'])
  })

  it('does not resolve a computed access on a plain namespace', () => {
    const text = lines("import * as m from './loclizr/messages'", 'const key = "nav_home"', 'm[key]()')
    expect(idsOf(text)).toEqual([])
  })

  it('does not record a member access on an unbound object', () => {
    const text = lines(
      "import { errors } from './loclizr/groups'",
      'const other = { errors: {} }',
      'other.errors.forbidden()',
    )
    expect(idsOf(text)).toEqual([])
  })

  it('reads through optional chaining', () => {
    const text = lines(
      "import * as m from './loclizr/messages'",
      "import { errors } from './loclizr/groups'",
      'm?.nav_home()',
      'errors?.[code]()',
    )
    expect(idsOf(text)).toEqual([
      'nav_home',
      'errors_forbidden',
      'errors_not_found',
      'errors_rate_limited',
    ])
  })
})

describe('groups', () => {
  it('resolves a computed access to every member', () => {
    const text = lines("import { errors } from './loclizr/groups'", 'errors[code]({ seconds: 30 })')
    expect(idsOf(text)).toEqual(['errors_forbidden', 'errors_not_found', 'errors_rate_limited'])
  })

  it('resolves a static access to the one member the property maps to', () => {
    const text = lines("import { errors } from './loclizr/groups'", 'errors.rate_limited({ seconds: 1 })')
    expect(idsOf(text)).toEqual(['errors_rate_limited'])
  })

  it('resolves both forms through a namespace import', () => {
    const text = lines(
      "import * as g from './loclizr/groups'",
      'g.errors.forbidden()',
      'g.errors[code]()',
    )
    expect(idsOf(text)).toEqual([
      'errors_forbidden',
      'errors_forbidden',
      'errors_not_found',
      'errors_rate_limited',
    ])
  })

  it('records nothing for a property no member maps to', () => {
    const text = lines("import { errors } from './loclizr/groups'", 'errors.teapot()')
    expect(idsOf(text)).toEqual([])
  })
})

describe('lexing', () => {
  it('skips comments, strings, regular expressions and template text in a .ts file', () => {
    const text = lines(
      "import * as m from './loclizr/messages'",
      "const quoted = 'm.nav_home()'",
      'const doubled = "m.nav_home()"',
      '// m.nav_home()',
      '/* m.nav_home() */',
      'const pattern = /m\\.nav_home\\(\\)/',
      'const template = `m.nav_home() ${m.cart_items({ count: 1 })}`',
    )
    expect(idsOf(text)).toEqual(['cart_items'])
  })

  it('keeps scanning after an apostrophe in .tsx JSX text', () => {
    const text = lines(
      "import * as m from './loclizr/messages'",
      'export function Cart() {',
      "  return <p>Don't forget {m.nav_cart()}</p>",
      '}',
    )
    const sites = sitesOf(text, 'src/Cart.tsx')
    expect(sites.map((site) => site.id)).toEqual(['nav_cart'])
    expect(sites[0]?.scope).toBe('Cart')
  })

  it('still strips comments in .tsx', () => {
    const text = lines("import * as m from './loclizr/messages'", '// m.nav_home()')
    expect(idsOf(text, 'src/Cart.tsx')).toEqual([])
  })

  it('does not read the slashes of a URL as a comment in .tsx', () => {
    const text = lines(
      "import * as m from './loclizr/messages'",
      '<a href="https://example.com">{m.nav_home()}</a>',
    )
    expect(idsOf(text, 'src/Cart.tsx')).toEqual(['nav_home'])
  })

  it('keeps scanning after an apostrophe in .jsx JSX text', () => {
    const text = lines(
      "import * as m from './loclizr/messages'",
      'export function Cart() {',
      "  return <p>Don't forget {m.nav_cart()}</p>",
      '}',
    )
    const sites = sitesOf(text, 'src/Cart.jsx')
    expect(sites.map((site) => site.id)).toEqual(['nav_cart'])
    expect(sites[0]?.scope).toBe('Cart')
  })

  it('reads a quoted attribute in .tsx as a string, so a protocol-relative URL costs nothing', () => {
    const text = lines(
      "import * as m from './loclizr/messages'",
      '<img src="//cdn.example.com/a.png" alt={m.nav_home()} />',
    )
    expect(idsOf(text, 'src/Cart.tsx')).toEqual(['nav_home'])
  })

  it('keeps a brace inside a .tsx string out of the scope depth', () => {
    const text = lines(
      "import * as m from './loclizr/messages'",
      'export function Cart() {',
      "  return <code>{'{'}</code>",
      '}',
      'export const top = m.nav_home()',
    )
    expect(sitesOf(text, 'src/Cart.tsx')[0]?.scope).toBeNull()
  })

  it('keeps a closing brace inside a .tsx string from popping the component', () => {
    const text = lines(
      "import * as m from './loclizr/messages'",
      'export function Cart() {',
      "  return <p>{'}'}{m.nav_cart()}</p>",
      '}',
    )
    expect(sitesOf(text, 'src/Cart.tsx')[0]?.scope).toBe('Cart')
  })

  it('ends an unterminated block comment in .tsx with its own line', () => {
    const text = lines(
      "import * as m from './loclizr/messages'",
      'export function Cart() {',
      '  return <p>Use /* to open {m.nav_home()}</p>',
      '}',
      'm.nav_cart()',
    )
    expect(idsOf(text, 'src/Cart.tsx')).toEqual(['nav_cart'])
  })

  it('accepts the documented .tsx false positive that buys the JSX apostrophe', () => {
    const text = lines(
      "import * as m from './loclizr/messages'",
      'const help = `',
      '  m.nav_home()',
      '`',
    )
    expect(idsOf(text, 'src/Cart.tsx')).toEqual(['nav_home'])
    expect(idsOf(text, 'src/Cart.ts')).toEqual([])
  })
})

describe('usage sites', () => {
  it('carries the file, a 1-based position and the trimmed source line', () => {
    const text = lines(
      "import * as m from './loclizr/messages'",
      'export function Cart() {',
      '  return m.nav_cart()',
      '}',
    )
    expect(sitesOf(text, 'src/Cart.tsx')).toEqual([
      {
        id: 'nav_cart',
        file: 'src/Cart.tsx',
        line: 3,
        column: 10,
        scope: 'Cart',
        snippet: 'return m.nav_cart()',
      },
    ])
  })

  it('caps the snippet at 160 characters', () => {
    const text = lines(
      "import * as m from './loclizr/messages'",
      `const long = [m.nav_home(), '${'x'.repeat(300)}']`,
    )
    expect(sitesOf(text)[0]?.snippet).toHaveLength(160)
  })

  it.each([
    ['export function Cart() {', 'Cart'],
    ['const Cart = () => {', 'Cart'],
    ['const Cart = function () {', 'Cart'],
    ['class Cart {', 'Cart'],
  ])('names %s as the enclosing declaration', (declaration, scope) => {
    const text = lines("import * as m from './loclizr/messages'", declaration, '  m.nav_home()', '}')
    expect(sitesOf(text)[0]?.scope).toBe(scope)
  })

  it('names the deepest enclosing declaration', () => {
    const text = lines(
      "import * as m from './loclizr/messages'",
      'class Panel {',
      '  render() {',
      '    return m.nav_home()',
      '  }',
      '}',
    )
    expect(sitesOf(text)[0]?.scope).toBe('render')
  })

  it('keeps the enclosing declaration across a destructured parameter and a callback', () => {
    const text = lines(
      "import * as m from './loclizr/messages'",
      'export function Cart({ count }: { count: number }) {',
      '  useEffect(() => {',
      '    track(m.cart_items({ count }))',
      '  }, [count])',
      '  return m.nav_cart()',
      '}',
    )
    expect(sitesOf(text, 'src/Cart.tsx').map((site) => site.scope)).toEqual(['Cart', 'Cart'])
  })

  it('leaves a top-level usage without a scope', () => {
    const text = lines("import * as m from './loclizr/messages'", 'm.nav_home()')
    expect(sitesOf(text)[0]?.scope).toBeNull()
  })

  it.each([
    ['const flag = true', 'if (flag) {'],
    ['const items = [1]', 'for (const item of items) {'],
  ])('does not let %s name the block that follows it', (declaration, opener) => {
    const text = lines(
      "import * as m from './loclizr/messages'",
      declaration,
      opener,
      '  m.nav_home()',
      '}',
    )
    expect(sitesOf(text)[0]?.scope).toBeNull()
  })

  it('closes a scope with its block', () => {
    const text = lines(
      "import * as m from './loclizr/messages'",
      'function Cart() {',
      '  return 1',
      '}',
      'm.nav_home()',
    )
    expect(sitesOf(text)[0]?.scope).toBeNull()
  })
})

describe('scan', () => {
  let root = ''

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'loclizr-scan-'))
    await mkdir(join(root, 'src', 'loclizr'), { recursive: true })
    await mkdir(join(root, 'node_modules', 'vendored'), { recursive: true })
    await writeFile(join(root, 'src', 'Cart.tsx'), APP_TSX, 'utf8')
    await writeFile(join(root, 'src', 'helper.ts'), HELPER_TS, 'utf8')
    await writeFile(join(root, 'src', 'loclizr', 'legacy.ts'), INSIDE_OUTDIR_TS, 'utf8')
    await writeFile(join(root, 'node_modules', 'vendored', 'index.ts'), VENDORED_TS, 'utf8')
  })

  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('collects usages across the tree, sorted by id', async () => {
    const result = await scan({
      config: testConfig({ root }),
      ids: [...IDS],
      groups: GROUPS,
    })
    expect(result.usages.map((usage) => usage.id)).toEqual([
      'cart_items',
      'errors_forbidden',
      'errors_not_found',
      'errors_rate_limited',
      'nav_cart',
    ])
    expect(result.usages[0]?.sites).toEqual([
      {
        file: 'src/Cart.tsx',
        line: 9,
        column: 11,
        scope: 'Cart',
        snippet: '<p>{m.cart_items({ count: 2 })}</p>',
      },
    ])
  })

  it('excludes outDir and node_modules, and reports what nothing referenced', async () => {
    const result = await scan({
      config: testConfig({ root }),
      ids: [...IDS],
      groups: GROUPS,
    })
    expect(result.usages.map((usage) => usage.id)).not.toContain('nav_home')
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['LZ5005', 'LZ5005'])
    expect(result.diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      'No source file references the message `cart_total`.',
      'No source file references the message `nav_home`.',
    ])
  })

  it('stamps LZ5005 at warn, because its default is off', async () => {
    const result = await scan({ config: testConfig({ root }), ids: ['nav_home'], groups: [] })
    expect(result.diagnostics[0]?.severity).toBe('warn')
    expect(result.diagnostics[0]?.fatal).toBe(false)
  })

  it('reads a bare import of the generated tree as the project reaching it', async () => {
    const switcherRoot = await mkdtemp(join(tmpdir(), 'loclizr-scan-'))
    await mkdir(join(switcherRoot, 'src'), { recursive: true })
    await writeFile(join(switcherRoot, 'src', 'Switcher.ts'), SWITCHER_TS, 'utf8')
    const result = await scan({
      config: testConfig({ root: switcherRoot }),
      ids: ['nav_home'],
      groups: [],
    })
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['LZ5005'])
    await rm(switcherRoot, { recursive: true, force: true })
  })

  it.each([
    ['a barrel re-export', BARREL_TS],
    ['a side-effect import', SIDE_EFFECT_TS],
  ])('reads %s of the generated tree as the project reaching it', async (_name, source) => {
    const reachRoot = await mkdtemp(join(tmpdir(), 'loclizr-scan-'))
    await mkdir(join(reachRoot, 'src'), { recursive: true })
    await writeFile(join(reachRoot, 'src', 'barrel.ts'), source, 'utf8')
    const result = await scan({
      config: testConfig({ root: reachRoot }),
      ids: ['nav_home'],
      groups: [],
    })
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['LZ5005'])
    await rm(reachRoot, { recursive: true, force: true })
  })

  it('raises LZ5004 and suppresses LZ5005 when no file imports the generated tree', async () => {
    const bareRoot = await mkdtemp(join(tmpdir(), 'loclizr-scan-'))
    await mkdir(join(bareRoot, 'src'), { recursive: true })
    await writeFile(join(bareRoot, 'src', 'helper.ts'), HELPER_TS, 'utf8')
    const result = await scan({
      config: testConfig({ root: bareRoot }),
      ids: ['nav_home', 'nav_cart'],
      groups: [],
    })
    expect(result.usages).toEqual([])
    expect(result.diagnostics).toHaveLength(1)
    expect(result.diagnostics[0]?.code).toBe('LZ5004')
    expect(result.diagnostics[0]?.severity).toBe('warn')
    expect(result.diagnostics[0]?.message).toContain('read 1 file')
    await rm(bareRoot, { recursive: true, force: true })
  })

  it('stays silent when the include glob matches nothing', async () => {
    const emptyRoot = await mkdtemp(join(tmpdir(), 'loclizr-scan-'))
    const result = await scan({
      config: testConfig({ root: emptyRoot }),
      ids: ['nav_home'],
      groups: [],
    })
    expect(result.usages).toEqual([])
    expect(result.diagnostics).toEqual([])
    await rm(emptyRoot, { recursive: true, force: true })
  })

  it('is deterministic across runs', async () => {
    const first = await scan({ config: testConfig({ root }), ids: [...IDS], groups: GROUPS })
    const second = await scan({
      config: testConfig({ root }),
      ids: [...IDS].reverse(),
      groups: GROUPS,
    })
    expect(second.usages).toEqual(first.usages)
    expect(second.diagnostics).toEqual(first.diagnostics)
  })
})
