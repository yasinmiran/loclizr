import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { testConfig } from './__fixtures__/config'
import type { ScanGroup } from './index'
import { scan, scanFile } from './index'

const IDS: ReadonlySet<string> = new Set(['nav_cart', 'nav_home'])
const NO_GROUPS: readonly ScanGroup[] = []
const IMPORT = "import * as m from './loclizr/messages'"

function sitesOf(
  source: readonly string[],
  file: string,
): readonly (readonly [string, string | null])[] {
  const text = `${[IMPORT, ...source].join('\n')}\n`
  return scanFile({ text, file, outDir: 'src/loclizr', ids: IDS, groups: NO_GROUPS }).map(
    (site) => [site.id, site.scope] as const,
  )
}

const roots: string[] = []

async function project(files: Readonly<Record<string, string>>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'loclizr-scan-mutants-'))
  roots.push(root)
  for (const [path, contents] of Object.entries(files)) {
    const at = join(root, path)
    await mkdir(join(at, '..'), { recursive: true })
    await writeFile(at, contents, 'utf8')
  }
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('narrowed string lexing in a component file', () => {
  test('a URL in JSX text does not blank the usage beside it', () => {
    expect(
      sitesOf(
        ['export function Cart() {', '  return <p>See https://example.com for {m.nav_home()}</p>', '}'],
        'src/Cart.tsx',
      ),
    ).toEqual([['nav_home', 'Cart']])
  })

  test('a string after an arrow is a literal, so a call quoted in it is no usage', () => {
    expect(sitesOf(['const example = () => "m.nav_home()"'], 'src/Docs.tsx')).toEqual([])
  })

  test('a string after return is a literal, so a call quoted in it is no usage', () => {
    expect(
      sitesOf(['function example() {', '  return "m.nav_home()"', '}'], 'src/Docs.tsx'),
    ).toEqual([])
  })
})

describe('full string lexing in a module file', () => {
  // ECMAScript ends a line at a lone CR, so a file saved with CR line endings
  // must recover from a broken quote exactly as an LF file does.
  test('an unterminated quote ends at a lone CR and costs no more than its line', () => {
    const text = [IMPORT, "const label = 'unterminated", 'export const home = m.nav_home()', ''].join(
      '\r',
    )
    const sites = scanFile({ text, file: 'src/App.ts', outDir: 'src/loclizr', ids: IDS, groups: NO_GROUPS })
    expect(sites.map((site) => [site.id, site.line])).toEqual([['nav_home', 3]])
  })
})

describe('computed access on a plain namespace', () => {
  // The key is a runtime value, so a local that happens to share a message's
  // name says nothing about which message is called.
  test('is not resolved even when the key variable shares a message name', () => {
    expect(
      sitesOf(["const nav_home = 'nav_cart'", 'export const label = m[nav_home]()'], 'src/App.ts'),
    ).toEqual([])
  })
})

describe('the enclosing declaration', () => {
  test('an arrow on the line after its `=` keeps the variable name', () => {
    expect(
      sitesOf(['const Cart =', '  () => {', '    return m.nav_home()', '  }'], 'src/Cart.tsx'),
    ).toEqual([['nav_home', 'Cart']])
  })

  test('a comparison in one declarator does not hide the name of the next', () => {
    expect(
      sitesOf(['const wide = a < b, Cart = () => m.nav_home()'], 'src/Cart.tsx'),
    ).toEqual([['nav_home', 'Cart']])
  })

  test('an arrow body on the line after `=>` keeps the next declarator named', () => {
    expect(
      sitesOf(
        ['const Title = () =>', '    m.nav_home(),', '  Body = () => m.nav_cart()'],
        'src/Cart.tsx',
      ),
    ).toEqual([
      ['nav_home', 'Title'],
      ['nav_cart', 'Body'],
    ])
  })

  test('an object type after readonly in a return type is not the body', () => {
    expect(
      sitesOf(
        ['function list(): readonly { id: string }[] {', '  return [{ id: m.nav_home() }]', '}'],
        'src/list.ts',
      ),
    ).toEqual([['nav_home', 'list']])
  })

  test('an expression-bodied arrow above a function does not claim its usages', () => {
    expect(
      sitesOf(
        ['const Row = () => <li />', 'function Cart() {', '  return <p>{m.nav_home()}</p>', '}'],
        'src/Cart.tsx',
      ),
    ).toEqual([['nav_home', 'Cart']])
  })

  test('a parenthesized arrow body ends with its parenthesis, leaving the next line top level', () => {
    expect(
      sitesOf(
        [
          'const Row = () => (',
          '  <li>{m.nav_cart()}</li>',
          ')',
          'export const title = m.nav_home()',
        ],
        'src/Row.tsx',
      ),
    ).toEqual([
      ['nav_cart', 'Row'],
      ['nav_home', null],
    ])
  })

  test('a stray parenthesis in JSX text does not cost the enclosing component', () => {
    expect(
      sitesOf(['export function Cart() {', '  return <p>Thanks :) {m.nav_home()}</p>', '}'], 'src/Cart.tsx'),
    ).toEqual([['nav_home', 'Cart']])
  })

  test('a ternary branch on the next line is not read as a return type annotation', () => {
    expect(
      sitesOf(
        [
          'const label = wide',
          '  ? pick(a)',
          '  : narrow',
          'export default {',
          '  title: m.nav_home(),',
          '}',
        ],
        'src/options.ts',
      ),
    ).toEqual([['nav_home', null]])
  })
})

describe('LZ5004 and quoted imports', () => {
  test('a side-effect import quoted inside a string does not reach the generated tree', async () => {
    const root = await project({
      'src/docs.ts': `export const example = "import './loclizr/messages'"\n`,
    })
    const result = await scan({
      config: testConfig({ root, scan: { include: ['src/**/*.ts'], exclude: [] } }),
      ids: [...IDS],
      groups: NO_GROUPS,
    })
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['LZ5004'])
  })
})
