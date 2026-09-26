import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { BuildResult, Diagnostic } from '../types'
import { build } from './index'

const CONFIG = "export default { catalogs: 'locales/{locale}/{ns}.json', sourceLocale: 'en' }\n"

const ENGLISH = catalog('{c, plural, one {# item} other {# items}}')
// Russian requires few and many, so this one is genuinely incomplete and the
// claim about it comes from data the tag itself names.
const RUSSIAN = catalog('{c, plural, one {# товар} other {# товаров}}')
const SHARED = catalog('{c, plural, other {# items}}')

let roots: string[] = []

beforeEach(() => {
  roots = []
})

afterEach(async () => {
  for (const directory of roots) await rm(directory, { recursive: true, force: true })
})

function catalog(items: string): string {
  return `${JSON.stringify({ items })}\n`
}

async function tree(files: Readonly<Record<string, string>>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'loclizr-host-'))
  roots.push(root)
  for (const [path, contents] of Object.entries(files)) {
    const absolute = join(root, path)
    await mkdir(dirname(absolute), { recursive: true })
    await writeFile(absolute, contents, 'utf8')
  }
  return root
}

function withCode(result: BuildResult, code: string): readonly Diagnostic[] {
  return result.diagnostics.filter((diagnostic) => diagnostic.code === code)
}

// With `locales` unset under a {ns} pattern the discovered directories are the
// locale set, and `Intl.getCanonicalLocales('shared')` does not throw. Intl then
// answers every plural question about it out of the build machine's own data,
// so the same catalogs printed different diagnostic text on a laptop and in CI.
describe('a discovered directory that is a well formed tag Intl has never heard of', () => {
  it('makes no category claim about it and names it instead', async () => {
    const root = await tree({
      'loclizr.config.ts': CONFIG,
      'locales/en/common.json': ENGLISH,
      'locales/shared/common.json': SHARED,
    })

    const result = await build({ cwd: root })

    expect(result.program?.locales).toContain('shared')
    expect(withCode(result, 'LZ3007')).toEqual([])
    expect(withCode(result, 'LZ3013')).toEqual([])
    expect(withCode(result, 'LZ1019').map((entry) => entry.locale)).toEqual(['shared'])
  })

  it('leaves the real locales their category claims', async () => {
    const root = await tree({
      'loclizr.config.ts': CONFIG,
      'locales/en/common.json': ENGLISH,
      'locales/ru/common.json': RUSSIAN,
      'locales/shared/common.json': SHARED,
    })

    const result = await build({ cwd: root })

    expect(withCode(result, 'LZ3007').map((entry) => entry.locale)).toEqual(['ru'])
    expect(withCode(result, 'LZ1019').map((entry) => entry.locale)).toEqual(['shared'])
  })

  it('emits the tree anyway, because the rule blocks nothing', async () => {
    const root = await tree({
      'loclizr.config.ts': CONFIG,
      'locales/en/common.json': ENGLISH,
      'locales/shared/common.json': SHARED,
    })

    const result = await build({ cwd: root })

    expect(withCode(result, 'LZ1019')[0]?.severity).toBe('warn')
    expect(result.files.map((file) => file.path)).toContain('messages/common.js')
    expect(result.written).toContain('src/loclizr/messages/common.js')
  })
})
