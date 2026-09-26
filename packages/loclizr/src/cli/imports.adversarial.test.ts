import { readFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// M1 and M10 are this module's only dependencies in the ownership map, so
// `../diagnostics`, `../types`, `../util` and `../compiler` are the whole set
// of parent-directory imports the source may carry.
const ALLOWED_PARENT_IMPORTS: ReadonlySet<string> = new Set([
  '../compiler',
  '../diagnostics',
  '../types',
  '../util',
])

const here = dirname(fileURLToPath(import.meta.url))

async function sourceFiles(): Promise<readonly string[]> {
  const entries = await readdir(here, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts') && !entry.name.includes('.test.'))
    .map((entry) => entry.name)
    .sort()
}

function parentImportsOf(text: string): readonly string[] {
  return [...text.matchAll(/from '(\.\.\/[^']+)'/g)].map((match) => match[1] ?? '')
}

describe('cli source dependencies', () => {
  it('has source files to inspect', async () => {
    expect(await sourceFiles()).toEqual(
      expect.arrayContaining(['args.ts', 'bin.ts', 'index.ts', 'init.ts', 'templates.ts']),
    )
  })

  it('reaches only into M1 and M10', async () => {
    const offenders: string[] = []
    for (const name of await sourceFiles()) {
      const text = await readFile(join(here, name), 'utf8')
      for (const specifier of parentImportsOf(text)) {
        if (!ALLOWED_PARENT_IMPORTS.has(specifier)) offenders.push(`${name}: ${specifier}`)
      }
    }

    expect(offenders).toEqual([])
  })

  it('imports relative paths without a file extension', async () => {
    const offenders: string[] = []
    for (const name of await sourceFiles()) {
      const text = await readFile(join(here, name), 'utf8')
      for (const match of text.matchAll(/from '(\.[^']*)'/g)) {
        const specifier = match[1] ?? ''
        if (/\.(?:js|ts|mjs|mts)$/.test(specifier)) offenders.push(`${name}: ${specifier}`)
      }
    }

    expect(offenders).toEqual([])
  })
})
