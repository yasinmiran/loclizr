import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { buildRecord, serializeRecord } from '../../src/record'
import { scan, scanFile } from '../../src/scan'
import type { Config, MessageUsage } from '../../src/types'
import { englishConfig, singleMessageProgram } from './__fixtures__/catalog'

const IDS: readonly string[] = ['nav_home']
const ID_SET: ReadonlySet<string> = new Set(IDS)
const NAMESPACE = "import * as m from './loclizr/messages'"
const USE = `${NAMESPACE}\nexport function Cart() {\n  return m.nav_home()\n}\n`

// Everything a terminal or a diff viewer reads as a command or a reordering
// rather than as text: C0 without tab and newline, DEL, C1, and the bidi controls.
const UNSAFE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f‪-‮⁦-⁩]/u

let base = ''
let root = ''

beforeEach(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'loclizr-security-scan-')))
  root = join(base, 'project')
  await mkdir(join(root, 'src'), { recursive: true })
})

afterEach(async () => {
  await rm(base, { recursive: true, force: true })
})

function config(): Config {
  return { ...englishConfig(), root, scan: { include: ['src/**/*.{ts,tsx}'], exclude: [] } }
}

async function usages(): Promise<readonly MessageUsage[]> {
  return (await scan({ config: config(), ids: IDS, groups: [] })).usages
}

function filesOf(found: readonly MessageUsage[]): readonly string[] {
  return found.flatMap((usage) => usage.sites.map((site) => site.file))
}

function sitesIn(text: string, file = 'src/App.ts') {
  return scanFile({ text, file, outDir: 'src/loclizr', ids: ID_SET, groups: [] })
}

function recordOf(found: readonly MessageUsage[]): string {
  const program = { ...singleMessageProgram('nav.home', 'Home'), usages: found }
  return serializeRecord(buildRecord(program))
}

// A symlink is committable, so a cycle in the source tree is a checkout away.
// The walk has to end, and end the same way every time.
describe('a symlink cycle under the scanned tree', () => {
  test('terminates and yields the same sorted usage list on every run', async () => {
    await writeFile(join(root, 'src', 'App.ts'), USE, 'utf8')
    await symlink(join(root, 'src'), join(root, 'src', 'loop'), 'dir')
    await symlink(join(root, 'src', 'self'), join(root, 'src', 'self'))
    const first = await usages()
    const second = await usages()
    expect(filesOf(first)).toContain('src/App.ts')
    expect(second).toEqual(first)
    const files = filesOf(first)
    expect(files).toEqual([...files].sort())
  }, 10_000)
})

describe('files that are not text', () => {
  test('a binary file with invalid UTF-8 and raw escapes neither throws nor masks a real usage', async () => {
    const binary = Buffer.from([0xff, 0xfe, 0x00, 0xc3, 0x28, 0x1b, 0x5b, 0x32, 0x4a, 0x60, 0x2f, 0x2a, 0x27])
    await writeFile(join(root, 'src', 'blob.ts'), binary)
    await writeFile(join(root, 'src', 'App.ts'), USE, 'utf8')
    const result = await scan({ config: config(), ids: IDS, groups: [] })
    expect(filesOf(result.usages)).toEqual(['src/App.ts'])
    for (const diagnostic of result.diagnostics) expect(diagnostic.message).not.toMatch(UNSAFE)
  })

  test('a lone surrogate or a NUL in source reaches no site field', () => {
    const sites = sitesIn(`${NAMESPACE}\nconst a = '\ud800\u0000'; m.nav_home()\n`)
    expect(sites.map((site) => site.id)).toEqual(['nav_home'])
    expect(sites[0]?.scope).toBeNull()
  })
})

describe('pathological shapes stay bounded', () => {
  test('a two megabyte minified line with no newline scans well inside the budget', () => {
    const line = `${NAMESPACE};${'a=b+c(d,[e],{f:g});'.repeat(100_000)}m.nav_home()`
    const started = performance.now()
    expect(sitesIn(line).map((site) => site.id)).toEqual(['nav_home'])
    expect(performance.now() - started).toBeLessThan(5_000)
  }, 10_000)

  test('a long whitespace run after a keyword does not stall the import pass', () => {
    const text = `import${' '.repeat(200_000)}\n${NAMESPACE}\nm.nav_home()\n`
    const started = performance.now()
    expect(sitesIn(text).map((site) => site.id)).toEqual(['nav_home'])
    expect(performance.now() - started).toBeLessThan(5_000)
  }, 10_000)

  test('an unterminated block comment in a component file costs its own line only', () => {
    const text = `${NAMESPACE}\nconst a = <p>/* not closed</p>\nconst b = m.nav_home()\n`
    expect(sitesIn(text, 'src/App.tsx').map((site) => site.line)).toEqual([3])
  })

  test('an unterminated string in a module file costs its own line only', () => {
    const text = `${NAMESPACE}\nconst a = "not closed\nconst b = m.nav_home()\n`
    expect(sitesIn(text).map((site) => site.line)).toEqual([3])
  })

  test('stray closers do not unwind the scope a usage sits in', () => {
    const text = `${NAMESPACE}\nfunction Cart() {\n  ]]]))) \n  return m.nav_home()\n}\n`
    expect(sitesIn(text).map((site) => site.scope)).toEqual(['Cart'])
  })
})

// The record is committed and reviewed in a diff, so what a source file can put
// into it is limited to a project relative path and an identifier.
describe('what a scanned file can carry into the record', () => {
  test('a usage entry holds only file and scope, never the line text', async () => {
    const hostile = `${NAMESPACE}\nexport function Cart() {\n  return [m.nav_home(), '\u001b[2J‮secret']\n}\n`
    await writeFile(join(root, 'src', 'App.ts'), hostile, 'utf8')
    const found = await usages()
    expect(found[0]?.sites[0]?.snippet).toContain('\u001b[2J')
    const record = JSON.parse(recordOf(found)) as { messages: { usage: object[] }[] }
    const usage = record.messages[0]?.usage ?? []
    expect(usage).toEqual([{ file: 'src/App.ts', scope: 'Cart' }])
    expect(recordOf(found)).not.toContain('secret')
  })

  test('a scope name never carries a control or bidi character from the source', () => {
    const text = `${NAMESPACE}\nfunction Ca‮rt\u001b() {\n  return m.nav_home()\n}\nconst x⁦ = () => m.nav_home()\n`
    for (const site of sitesIn(text)) {
      if (site.scope !== null) expect(site.scope).not.toMatch(UNSAFE)
    }
  })

  test('the record is byte identical when the scan runs twice over the same tree', async () => {
    await mkdir(join(root, 'src', 'b'), { recursive: true })
    await writeFile(join(root, 'src', 'b', 'Z.ts'), USE.replace('./loclizr', '../loclizr'), 'utf8')
    await writeFile(join(root, 'src', 'A.tsx'), USE, 'utf8')
    await writeFile(join(root, 'src', 'a.ts'), USE, 'utf8')
    const first = recordOf(await usages())
    expect(recordOf(await usages())).toBe(first)
    expect(first).not.toContain(root)
    expect(first).not.toContain(base)
  })
})
