import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { testConfig } from './__fixtures__/config'
import type { ScanGroup } from './index'
import { scan } from './index'

const NO_GROUPS: readonly ScanGroup[] = []
const IDS: readonly string[] = ['nav_cart', 'nav_home']

const roots: string[] = []

async function project(files: Readonly<Record<string, string>>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'loclizr-scan-adversarial-'))
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

describe('the generated tree is never scanned', () => {
  test('excludes outDir although scan.exclude is empty and outDir carries a trailing slash', async () => {
    const root = await project({
      'src/loclizr/legacy.ts': "import * as m from './messages'\nexport const home = m.nav_home()\n",
      'src/App.ts': "import * as m from './loclizr/messages'\nexport const cart = m.nav_cart()\n",
    })
    const result = await scan({
      config: testConfig({
        root,
        outDir: 'src/loclizr/',
        scan: { include: ['src/**/*.{ts,tsx}'], exclude: [] },
      }),
      ids: IDS,
      groups: NO_GROUPS,
    })
    expect(result.usages.map((usage) => usage.id)).toEqual(['nav_cart'])
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['LZ5005'])
  })

  test('excludes outDir although scan.include names it, leaving no file to scan', async () => {
    const root = await project({
      'src/loclizr/legacy.ts':
        "import * as m from './messages'\nexport const home = m.nav_home()\n",
    })
    const result = await scan({
      config: testConfig({
        root,
        scan: { include: ['src/loclizr/**/*.ts'], exclude: [] },
      }),
      ids: IDS,
      groups: NO_GROUPS,
    })
    expect(result.usages).toEqual([])
    expect(result.diagnostics).toEqual([])
  })
})

describe('LZ5004', () => {
  test('fires when the only import-shaped text in the project is a string literal', async () => {
    const root = await project({
      'src/docs.ts':
        'export const example: string = "import * as m from \'./loclizr/messages\'"\n',
    })
    const result = await scan({
      config: testConfig({ root }),
      ids: IDS,
      groups: NO_GROUPS,
    })
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['LZ5004'])
  })

  test('stays silent when an import was found and no id was given', async () => {
    const root = await project({
      'src/App.ts': "import * as m from './loclizr/messages'\nexport const cart = m.nav_cart()\n",
    })
    const result = await scan({ config: testConfig({ root }), ids: [], groups: NO_GROUPS })
    expect(result.usages).toEqual([])
    expect(result.diagnostics).toEqual([])
  })
})

describe('determinism', () => {
  test('orders the sites of one message by file path, not by directory order', async () => {
    const use = "import * as m from './loclizr/messages'\nexport const home = m.nav_home()\n"
    const root = await project({
      'src/zebra.ts': use,
      'src/alpha.ts': use,
      'src/middle/beta.ts': use,
    })
    const result = await scan({ config: testConfig({ root }), ids: IDS, groups: NO_GROUPS })
    expect(result.usages[0]?.sites.map((site) => site.file)).toEqual([
      'src/alpha.ts',
      'src/middle/beta.ts',
      'src/zebra.ts',
    ])
  })

  test('two concurrent scans of one tree agree', async () => {
    const root = await project({
      'src/App.tsx':
        "import * as m from '@/loclizr/messages'\nexport const Cart = () => <p>{m.nav_cart()}</p>\n",
      'src/helper.ts': "import { nav_home } from '~/loclizr/messages'\nexport const h = nav_home()\n",
    })
    const config = testConfig({ root })
    const [first, second] = await Promise.all([
      scan({ config, ids: IDS, groups: NO_GROUPS }),
      scan({ config, ids: [...IDS].reverse(), groups: NO_GROUPS }),
    ])
    expect(second).toEqual(first)
  })
})

describe('a group property that only the object prototype defines', () => {
  test('does not crash the scan of a project that also has a real usage', async () => {
    const root = await project({
      'src/App.ts': [
        "import { errors } from './loclizr/groups'",
        "import * as m from './loclizr/messages'",
        "export const owned = errors.hasOwnProperty('forbidden')",
        'export const home = m.nav_home()',
        '',
      ].join('\n'),
    })
    const result = await scan({
      config: testConfig({ root }),
      ids: IDS,
      groups: [
        {
          id: 'errors',
          memberIds: ['errors_forbidden'],
          memberProps: { forbidden: 'errors_forbidden' },
        },
      ],
    })
    expect(result.usages.map((usage) => usage.id)).toEqual(['nav_home'])
  })
})
