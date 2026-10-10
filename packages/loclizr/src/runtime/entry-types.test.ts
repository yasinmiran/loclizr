import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

// A consumer's declaration emit names an inferred type through the entry it
// imported. A type that reaches an entry's signature without being exported by
// that entry can only be named through the bundler's hashed chunk, which is not
// a public path, so `declaration: true` fails with TS2742.

const PACKAGE = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

const SOURCE_ENTRIES = ['src/index.ts', 'src/react/index.ts', 'src/server/index.ts']
const DECLARATION_ENTRIES = ['dist/index.d.ts', 'dist/react/index.d.ts', 'dist/server/index.d.ts']

function names(list: string, side: 'local' | 'exported'): readonly string[] {
  return list
    .split(',')
    .map((item) => item.trim().replace(/^type\s+/, ''))
    .filter((item) => item !== '')
    .map((item) => {
      const [name, alias] = item.split(/\s+as\s+/)
      return (side === 'local' ? (alias ?? name) : name) ?? ''
    })
}

function imported(text: string, from: RegExp): readonly string[] {
  const found: string[] = []
  for (const match of text.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    if (from.test(match[2] ?? '')) found.push(...names(match[1] ?? '', 'local'))
  }
  return found
}

function exported(text: string): readonly string[] {
  const found: string[] = []
  for (const match of text.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)) {
    found.push(...names(match[1] ?? '', 'exported'))
  }
  return found
}

function missing(file: string, from: RegExp): readonly string[] {
  const text = readFileSync(resolve(PACKAGE, file), 'utf8')
  const exports = exported(text)
  return imported(text, from).filter((name) => !exports.includes(name))
}

describe('the type exports of the public entries', () => {
  test.each(SOURCE_ENTRIES)('%s exports every shared type it imports', (file) => {
    expect(missing(file, /^\.\.?\/types$/)).toEqual([])
  })
})

const built = DECLARATION_ENTRIES.every((file) => existsSync(resolve(PACKAGE, file)))

describe.skipIf(!built)('the published declaration entries', () => {
  test.each(DECLARATION_ENTRIES)('%s exports every type it takes from a shared chunk', (file) => {
    expect(missing(file, /^\.\.?\/types-[^/]+\.js$/)).toEqual([])
  })
})
