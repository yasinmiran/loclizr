import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { emit } from './index'
import { acceptanceProgram } from './__fixtures__/acceptance'

const TYPESCRIPT = dirname(createRequire(import.meta.url).resolve('typescript/package.json'))
const TSC = join(TYPESCRIPT, 'bin/tsc')

// The emitted declarations import only these two types, so a stub stands in
// for the runtime package and keeps the check to the declarations alone.
const STUB = [
  'export type MessageOptions = { readonly locale?: string }',
  'export type EmptyArgs = { readonly [key: symbol]: never }',
  '',
].join('\n')

const HEADER = [
  "import * as m from './loclizr/messages/terms.js'",
  "import { terms } from './loclizr/groups.js'",
  'type Equal<X, Y> = (<V>() => V extends X ? 1 : 2) extends <V>() => V extends Y ? 1 : 2 ? true : false',
  'declare function assert<_ extends true>(): void',
  '',
]

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function typecheck(app: readonly string[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'loclizr-infer-'))
  roots.push(root)
  for (const file of emit(acceptanceProgram()).files) {
    const path = join(root, 'loclizr', file.path)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, file.contents, 'utf8')
  }
  await mkdir(join(root, 'node_modules', 'loclizr'), { recursive: true })
  await writeFile(join(root, 'node_modules', 'loclizr', 'index.d.ts'), STUB, 'utf8')
  await writeFile(join(root, 'app.ts'), [...HEADER, ...app, ''].join('\n'), 'utf8')
  const compilerOptions = {
    strict: true,
    exactOptionalPropertyTypes: true,
    module: 'esnext',
    moduleResolution: 'bundler',
    noEmit: true,
    types: [],
  }
  await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions, files: ['app.ts'] }), 'utf8')
  const run = spawnSync(process.execPath, [TSC, '-p', 'tsconfig.json'], { cwd: root, encoding: 'utf8' })
  return run.stdout + run.stderr
}

describe('a markup call with no contextual type', () => {
  test('infers the part type from the handler a hoisted call passes', { timeout: 30_000 }, async () => {
    const output = await typecheck([
      "const text = m.terms_accept({ link: (chunks) => `<a>${chunks.join('')}</a>` })",
      'assert<Equal<typeof text, readonly string[]>>()',
      'const node = m.terms_accept({ link: (chunks) => ({ a: chunks }) })',
      'assert<Equal<typeof node, readonly (string | { a: readonly unknown[] })[]>>()',
      "const counted = m.terms_notice({ count: 2, b: (chunks) => chunks.join('') })",
      'assert<Equal<typeof counted, readonly string[]>>()',
      "const grouped = terms.accept({ link: (chunks) => chunks.join('') })",
      'assert<Equal<typeof grouped, readonly string[]>>()',
      'export { text, node, counted, grouped }',
    ])
    expect(output).toBe('')
  })

  test('keeps an explicit part type and the nesting check', { timeout: 30_000 }, async () => {
    const output = await typecheck([
      "const parts = m.terms_accept<string>({ link: (chunks) => chunks.join('') })",
      'assert<Equal<typeof parts, readonly string[]>>()',
      "const grouped = terms.notice<string>({ count: 1, b: (chunks) => chunks.join('') })",
      'assert<Equal<typeof grouped, readonly string[]>>()',
      '// @ts-expect-error a handler result must fit the chunks it is nested into',
      "m.terms_accept<string, number>({ link: (chunks) => chunks.join('') })",
      '// @ts-expect-error a handler result must fit the chunks it is nested into',
      "terms.accept<string, number>({ link: (chunks) => chunks.join('') })",
      'export { parts, grouped }',
    ])
    expect(output).toBe('')
  })
})
