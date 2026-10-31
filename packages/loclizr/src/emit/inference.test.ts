import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { emit } from './index'
import { TERMS_GROUP, extraMessages } from './__fixtures__/acceptance'
import {
  ERRORS_GROUP,
  body,
  fellBack,
  markup,
  message,
  program,
  text,
  translated,
  workedMessages,
} from './__fixtures__/program'

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

// Two tags in one message, so two handlers share one part type. It stays out
// of the acceptance program to leave the fixture trees and group output as they are.
const NOTE = message({
  key: 'terms.note',
  source: '<b>Note:</b> read <i>the terms</i>.',
  kind: 'markup',
  args: [
    { name: 'b', type: { kind: 'markup' } },
    { name: 'i', type: { kind: 'markup' } },
  ],
  bodies: [body('en', [markup('b', [text('Note:')]), text(' read '), markup('i', [text('the terms')]), text('.')])],
  origins: [translated('en'), fellBack('de', 'en', 'missing'), fellBack('de-AT', 'en', 'missing')],
})

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function typecheck(app: readonly string[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'loclizr-infer-'))
  roots.push(root)
  const messages = [...workedMessages(), ...extraMessages(), NOTE]
  for (const file of emit(program({ messages, groups: [ERRORS_GROUP, TERMS_GROUP] })).files) {
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

describe('the chunks a handler receives', () => {
  test('take the part type the result is assigned to, and unknown with none', { timeout: 30_000 }, async () => {
    const output = await typecheck([
      'type Tag = { readonly tag: string }',
      'const assigned: readonly (string | Tag)[] = m.terms_accept({',
      '  link: (chunks) => {',
      '    assert<Equal<typeof chunks, readonly (string | Tag)[]>>()',
      "    return { tag: chunks.join('') }",
      '  },',
      '})',
      'const bare = m.terms_accept({',
      '  link: (chunks) => {',
      '    assert<Equal<typeof chunks, readonly unknown[]>>()',
      "    return { tag: 'terms' }",
      '  },',
      '})',
      'assert<Equal<typeof bare, readonly (string | { tag: string })[]>>()',
      'export { assigned, bare }',
    ])
    expect(output).toBe('')
  })
})

describe('a markup call with two handlers', () => {
  test('needs the part type when the handlers return different types', { timeout: 30_000 }, async () => {
    const output = await typecheck([
      "const same = m.terms_note({ b: (chunks) => chunks.join(''), i: (chunks) => chunks.join('') })",
      'assert<Equal<typeof same, readonly string[]>>()',
      '// @ts-expect-error both handlers return the one part type, and string and number are two',
      "m.terms_note({ b: (chunks) => chunks.join(''), i: (chunks) => chunks.length })",
      '// @ts-expect-error the type the result is assigned to does not widen the part type',
      "const assigned: readonly unknown[] = m.terms_note({ b: (chunks) => ({ b: chunks }), i: (chunks) => chunks.join('') })",
      '// @ts-expect-error annotated chunks do not widen the part type',
      "m.terms_note({ b: (chunks: readonly unknown[]) => chunks.length, i: (chunks: readonly unknown[]) => chunks.join('') })",
      "const mixed = m.terms_note<string | number>({ b: (chunks) => chunks.join(''), i: (chunks) => chunks.length })",
      'assert<Equal<typeof mixed, readonly (string | number)[]>>()',
      'export { same, assigned, mixed }',
    ])
    expect(output).toBe('')
  })

  test('takes the return that accepts the others, and the chunks one handler annotates', { timeout: 30_000 }, async () => {
    const output = await typecheck([
      'const wider = m.terms_note({ b: (chunks) => ({ b: chunks }), i: (chunks) => ({ b: chunks, i: chunks.length }) })',
      'assert<Equal<typeof wider, readonly (string | { b: readonly unknown[] })[]>>()',
      'type Tag = { readonly tag: string }',
      'const sibling = m.terms_note({',
      '  b: (chunks: readonly (string | Tag)[]) => ({ tag: String(chunks.length) }),',
      '  i: (chunks) => {',
      '    assert<Equal<typeof chunks, readonly (string | Tag)[]>>()',
      "    return { tag: 'i' }",
      '  },',
      '})',
      'export { wider, sibling }',
    ])
    expect(output).toBe('')
  })
})
