import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { testConfig } from './__fixtures__/config'
import type { ScanGroup } from './index'
import { scan } from './index'

const NO_GROUPS: readonly ScanGroup[] = []
const USES_HOME = "import * as m from './loclizr/messages'\nexport const home = m.nav_home()\n"
const PLAIN = 'export const answer = 42\n'

const roots: string[] = []

async function project(files: Readonly<Record<string, string>>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'loclizr-scan-edge-'))
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

describe('LZ5004 wording', () => {
  it('counts more than one file in the plural', async () => {
    const root = await project({ 'src/a.ts': PLAIN, 'src/b.ts': PLAIN })
    const result = await scan({ config: testConfig({ root }), ids: ['nav_home'], groups: NO_GROUPS })
    expect(result.diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      'The scan read 2 files and found no import of the generated messages.',
    ])
  })

  it('names the basename of a custom outDir in its hint', async () => {
    const root = await project({ 'src/a.ts': PLAIN })
    const result = await scan({
      config: testConfig({ root, outDir: 'app/generated/i18n/' }),
      ids: ['nav_home'],
      groups: NO_GROUPS,
    })
    expect(result.diagnostics[0]?.hint).toContain("from './i18n/messages'")
  })
})

describe('ordering', () => {
  it('sorts usages by code point, upper case before lower case', async () => {
    const root = await project({
      'src/a.ts': [
        "import * as m from './loclizr/messages'",
        'm.beta()',
        'm.Alpha()',
        'm.alpha()',
        'm.été()',
        '',
      ].join('\n'),
    })
    const result = await scan({
      config: testConfig({ root }),
      ids: ['beta', 'alpha', 'été', 'Alpha'],
      groups: NO_GROUPS,
    })
    expect(result.usages.map((usage) => usage.id)).toEqual(['Alpha', 'alpha', 'beta', 'été'])
  })

  it('sorts LZ5005 by code point too', async () => {
    const root = await project({ 'src/a.ts': "import * as m from './loclizr/messages'\n" })
    const result = await scan({
      config: testConfig({ root }),
      ids: ['beta', 'alpha', 'Alpha'],
      groups: NO_GROUPS,
    })
    expect(result.diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      'No source file references the message `Alpha`.',
      'No source file references the message `alpha`.',
      'No source file references the message `beta`.',
    ])
  })

  it('keeps several sites in one file in source order', async () => {
    const root = await project({
      'src/a.ts': "import * as m from './loclizr/messages'\nm.nav_home()\nm.nav_cart()\nm.nav_home()\n",
    })
    const result = await scan({
      config: testConfig({ root }),
      ids: ['nav_cart', 'nav_home'],
      groups: NO_GROUPS,
    })
    expect(
      result.usages.map((usage) => [usage.id, usage.sites.map((site) => site.line)]),
    ).toEqual([
      ['nav_cart', [3]],
      ['nav_home', [2, 4]],
    ])
  })
})

describe('the id list', () => {
  it('reports a duplicated unused id once', async () => {
    const root = await project({ 'src/a.ts': "import * as m from './loclizr/messages'\n" })
    const result = await scan({
      config: testConfig({ root }),
      ids: ['nav_home', 'nav_home'],
      groups: NO_GROUPS,
    })
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['LZ5005'])
  })

  it('does not report a group member reached only through a computed access as unused', async () => {
    const root = await project({
      'src/a.ts': "import { errors } from './loclizr/groups'\nexport const pick = errors[code]()\n",
    })
    const result = await scan({
      config: testConfig({ root }),
      ids: ['errors_forbidden', 'errors_not_found', 'nav_home'],
      groups: [
        {
          id: 'errors',
          memberIds: ['errors_forbidden', 'errors_not_found'],
          memberProps: { forbidden: 'errors_forbidden', not_found: 'errors_not_found' },
        },
      ],
    })
    expect(result.diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      'No source file references the message `nav_home`.',
    ])
  })
})

describe('file matching', () => {
  it('skips a dotfile the include glob would otherwise match', async () => {
    const root = await project({ 'src/.hidden.ts': USES_HOME, 'src/App.ts': PLAIN })
    const result = await scan({ config: testConfig({ root }), ids: ['nav_home'], groups: NO_GROUPS })
    expect(result.usages).toEqual([])
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['LZ5004'])
  })

  it('returns an empty result for an include pattern the glob cannot use', async () => {
    const root = await project({ 'src/App.ts': USES_HOME })
    const result = await scan({
      config: testConfig({ root, scan: { include: [''], exclude: [] } }),
      ids: ['nav_home'],
      groups: NO_GROUPS,
    })
    expect(result).toEqual({ usages: [], diagnostics: [] })
  })

  it('reports relative POSIX paths when root carries a trailing slash', async () => {
    const root = await project({ 'src/deep/er/App.ts': USES_HOME.replace('./loclizr', '../../loclizr') })
    const result = await scan({
      config: testConfig({ root: `${root}/` }),
      ids: ['nav_home'],
      groups: NO_GROUPS,
    })
    expect(result.usages[0]?.sites.map((site) => site.file)).toEqual(['src/deep/er/App.ts'])
  })

  it('honours a custom exclude beside the default outDir exclusion', async () => {
    const root = await project({ 'src/App.ts': USES_HOME, 'src/App.test.ts': USES_HOME })
    const result = await scan({
      config: testConfig({ root, scan: { include: ['src/**/*.ts'], exclude: ['**/*.test.ts'] } }),
      ids: ['nav_home'],
      groups: NO_GROUPS,
    })
    expect(result.usages[0]?.sites.map((site) => site.file)).toEqual(['src/App.ts'])
  })

  it('scans a file with CRLF endings and a byte order mark through the filesystem', async () => {
    const root = await project({
      'src/App.ts': "\ufeffimport * as m from './loclizr/messages'\r\nexport function Cart() {\r\n  return m.nav_home()\r\n}\r\n",
    })
    const result = await scan({ config: testConfig({ root }), ids: ['nav_home'], groups: NO_GROUPS })
    expect(result.usages[0]?.sites).toEqual([
      { file: 'src/App.ts', line: 3, column: 10, scope: 'Cart', snippet: 'return m.nav_home()' },
    ])
  })
})
