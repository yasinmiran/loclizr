import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Diagnostic, DiscoveredCatalog, LoclizrConfig } from '../types'
import { toPosix } from '../util'
import { loadConfig } from './index'
import { catalogMatcher, withNamespaceToken } from './pattern'
import { resolveConfig } from './resolve'
import type { LoadConfigResult } from './resolve'

const ROOT = '/project'

function catalog(locale: string, file = `locales/${locale}.json`): DiscoveredCatalog {
  return { locale, ns: null, file }
}

function run(user: LoclizrConfig, discovered: readonly DiscoveredCatalog[]): LoadConfigResult {
  return resolveConfig({ user, root: ROOT, discovered })
}

function codes(diagnostics: readonly Diagnostic[]): readonly string[] {
  return diagnostics.map((diagnostic) => diagnostic.code)
}

describe('patterns the matcher refuses', () => {
  it('refuses a pattern carrying {sourceLocale} beside its {locale}', () => {
    expect(catalogMatcher('{sourceLocale}/{locale}.json')).toBeNull()
  })

  it('offers no namespace split for a directory layout that is not JSON', () => {
    expect(withNamespaceToken('i18n/{locale}/strings.yaml')).toBeNull()
  })
})

describe('outDir against the catalogs pattern', () => {
  // The odd directory name is the only one at catalog depth the pattern can
  // spell, which is what separates beside from inside.
  it('accepts an outDir beside the catalogs at their own depth', () => {
    const result = run({ outDir: 'locales/generated.json' }, [catalog('en')])
    expect(codes(result.diagnostics)).not.toContain('LZ1001')
    expect(result.config?.outDir).toBe('locales/generated.json')
  })

  it('compares a meta path with the catalogs pattern without case, whatever case the pattern is in', () => {
    const result = run(
      { catalogs: 'Locales/{locale}.json', meta: 'Locales/{sourceLocale}.json', sourceLocale: 'en' },
      [catalog('en', 'Locales/en.json')],
    )
    expect(result.config).toBeNull()
    const conflict = result.diagnostics.find((diagnostic) => diagnostic.code === 'LZ1001')
    expect(conflict?.message).toContain('`meta`')
  })
})

describe('the hint on a stray catalog', () => {
  let root = ''

  beforeEach(async () => {
    root = toPosix(await realpath(await mkdtemp(join(tmpdir(), 'loclizr-config-mutants-'))))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  async function catalogs(...relatives: readonly string[]): Promise<void> {
    for (const relative of relatives) {
      const absolute = join(root, relative)
      await mkdir(dirname(absolute), { recursive: true })
      await writeFile(absolute, '{"nav":{"home":"Home"}}', 'utf8')
    }
  }

  async function strayHint(): Promise<string | null> {
    const result = await loadConfig({ cwd: root })
    const stray = result.diagnostics.find((diagnostic) => diagnostic.code === 'LZ1006')
    expect(stray).toBeDefined()
    return stray?.hint ?? null
  }

  it('names the {ns} pattern when adding the token would read the stray', async () => {
    await catalogs('locales/en.json', 'locales/fr/common.json')
    expect(await strayHint()).toContain('locales/{locale}/{ns}.json')
  })

  it('does not name the {ns} pattern when the stray sits deeper than it reaches', async () => {
    await catalogs('locales/en.json', 'locales/fr/a/b.json')
    expect(await strayHint()).not.toContain('{ns}')
  })
})
