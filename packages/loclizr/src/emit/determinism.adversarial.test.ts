import { describe, expect, test } from 'vitest'
import type { EmittedFile, Message, Program } from '../types'
import { emit, reverseForReplay } from './index'
import {
  body,
  config,
  message,
  plural,
  pound,
  program,
  text,
  translated,
  workedExample,
} from './__fixtures__/program'

type Arm = (args: Readonly<Record<string, unknown>>) => unknown

function contentsOf(files: readonly EmittedFile[], path: string): string {
  const file = files.find((candidate) => candidate.path === path)
  if (file === undefined) throw new Error(`no emitted file at ${path}`)
  return file.contents
}

function tree(files: readonly EmittedFile[]): string {
  return files.map((file) => `===== ${file.path}\n${file.contents}`).join('')
}

function compileArm(module: string, id: string, locale: string): Arm {
  const chunk = module.split('\n\n').find((part) => part.startsWith(`export function ${id}(`))
  if (chunk === undefined) throw new Error(`no function ${id} in the emitted module`)
  const formats = [...new Set(module.match(/\$f[0-9a-f]+/gu) ?? [])]
  const factory = new Function(
    '$l',
    '$plural1',
    '$number1',
    '$dateTime1',
    ...formats,
    `'use strict';\nreturn ${chunk.slice('export '.length)}`,
  ) as (...deps: readonly unknown[]) => Arm
  return factory(
    () => locale,
    (l: string, value: number, ordinal: boolean) =>
      new Intl.PluralRules(l, { type: ordinal ? 'ordinal' : 'cardinal' }).select(value),
    (l: string, value: number) => new Intl.NumberFormat(l).format(value),
    (l: string, value: Date | number) => new Intl.DateTimeFormat(l).format(value),
    ...formats.map(() => ({})),
  )
}

describe('the determinism guard', () => {
  test('raises LZ4005 as a fatal error when the two passes disagree', () => {
    const twin = (id: string, source: string): Message =>
      message({
        key: 'nav.home',
        source,
        identifier: id,
        bodies: [body('en', [text(source)])],
        origins: [translated('en')],
      })
    const result = emit(
      program({
        messages: [twin('nav_first', 'First'), twin('nav_second', 'Second')],
        config: config({ locales: ['en'] }),
      }),
    )
    expect(result.diagnostics).toHaveLength(1)
    expect(result.diagnostics[0]?.code).toBe('LZ4005')
    expect(result.diagnostics[0]?.rule).toBe('nondeterministic-output')
    expect(result.diagnostics[0]?.severity).toBe('error')
    expect(result.diagnostics[0]?.fatal).toBe(true)
    expect(result.diagnostics[0]?.file).toBe('src/loclizr/messages/nav.d.ts')
    expect(result.files.length).toBeGreaterThan(0)
  })

  test('stays silent and identical on a program whose replay set is already reversed', () => {
    const source = workedExample()
    expect(emit(reverseForReplay(source)).diagnostics).toEqual([])
    expect(tree(emit(reverseForReplay(source)).files)).toBe(tree(emit(source).files))
  })
})

describe('the replay set', () => {
  const source = withPlaceholders(workedExample())
  const flipped = reverseForReplay(source)

  test('reverses Message.placeholders', () => {
    const before = source.messages.find((entry) => entry.key === 'cart.items')
    const after = flipped.messages.find((entry) => entry.key === 'cart.items')
    expect(after?.placeholders.map((note) => note.name)).toEqual(
      before?.placeholders.map((note) => note.name).reverse(),
    )
  })

  test('leaves every array outside that set untouched by reference', () => {
    const before = source.messages.find((entry) => entry.key === 'cart.items')
    const after = flipped.messages.find((entry) => entry.key === 'cart.items')
    if (before === undefined || after === undefined) throw new Error('cart.items went missing')
    expect(flipped.diagnostics).toBe(source.diagnostics)
    expect(after.args).toBe(before.args)
    expect(after.markupTags).toBe(before.markupTags)
    const english = before.bodies.find((entry) => entry.locale === 'en')
    if (english === undefined) throw new Error('the source body went missing')
    expect(after.bodies.find((entry) => entry.locale === 'en')).toBe(english)
    const node = english.nodes[0]
    if (node?.kind !== 'plural') throw new Error('cart.items stopped being a plural')
    expect(node.exact.map((branch) => branch.value)).toEqual([0])
    expect(node.branches.map((branch) => branch.keyword)).toEqual(['one', 'other'])
  })

  test('emits the same bytes whatever extras and usages hold', () => {
    const base = workedExample()
    const loaded: Program = {
      ...base,
      extras: [
        { locale: 'de', key: 'LEAKED_EXTRA', file: 'locales/de.json', span: SPAN },
        { locale: 'de', key: 'ALSO_LEAKED', file: 'locales/de.json', span: SPAN },
      ],
      usages: [
        {
          id: 'nav_home',
          sites: [{ file: 'src/a.tsx', line: 1, column: 1, scope: 'LEAKED_SCOPE', snippet: 'LEAKED_SNIPPET' }],
        },
      ],
    }
    const printed = tree(emit(loaded).files)
    expect(printed).toBe(tree(emit(base).files))
    for (const leak of ['LEAKED_EXTRA', 'ALSO_LEAKED', 'LEAKED_SCOPE', 'LEAKED_SNIPPET']) {
      expect(printed).not.toContain(leak)
    }
  })
})

describe('emit as a pure function', () => {
  test('leaves the program it was handed byte for byte intact', () => {
    const source = workedExample()
    const before = JSON.stringify(source)
    emit(source)
    expect(JSON.stringify(source)).toBe(before)
  })

  test('returns the same bytes on a second call', () => {
    const source = workedExample()
    expect(tree(emit(source).files)).toBe(tree(emit(source).files))
  })
})

describe('the tree shape under an empty catalog', () => {
  const files = emit(program({ messages: [], config: config({ locales: ['en'] }) })).files

  test('still writes the seven files the layout names', () => {
    expect([...files.map((file) => file.path)].sort()).toEqual([
      '.gitignore',
      'messages.d.ts',
      'messages.js',
      'messages/_formats.d.ts',
      'messages/_formats.js',
      'messages/_locale.d.ts',
      'messages/_locale.js',
    ])
  })

  test('ends every file with exactly one newline', () => {
    for (const file of files) {
      expect(file.contents.endsWith('\n')).toBe(true)
      expect(file.contents.endsWith('\n\n')).toBe(false)
    }
  })

  test('carries the header on every file but the .gitignore', () => {
    for (const file of files) {
      const headed = file.contents.startsWith('// @generated by loclizr abi=1.')
      expect(headed).toBe(file.path !== '.gitignore')
    }
  })
})

describe('the barrel', () => {
  test('never re-exports the typed lookup tier', () => {
    const files = emit(workedExample()).files
    expect(contentsOf(files, 'messages.js')).not.toContain('groups')
    expect(contentsOf(files, 'messages.d.ts')).not.toContain('groups')
  })
})

describe('two locales that order their plurals differently', () => {
  const files = emit(
    program({
      messages: [
        message({
          key: 'cart.counts',
          source: '{files, plural, other {# files}} in {folders, plural, other {# folders}}',
          args: [
            { name: 'files', type: { kind: 'number' } },
            { name: 'folders', type: { kind: 'number' } },
          ],
          bodies: [
            body('en', [
              plural('files', { branches: [{ keyword: 'other', body: [pound(), text(' files')] }] }),
              text(' in '),
              plural('folders', { branches: [{ keyword: 'other', body: [pound(), text(' folders')] }] }),
            ]),
            body('de', [
              plural('folders', { branches: [{ keyword: 'other', body: [pound(), text(' Ordner')] }] }),
              text(' mit '),
              plural('files', { branches: [{ keyword: 'other', body: [pound(), text(' Dateien')] }] }),
            ]),
          ],
          origins: [translated('en'), translated('de')],
        }),
      ],
      config: config({ locales: ['en', 'de'] }),
    }),
  ).files
  const module = contentsOf(files, 'messages/cart.js')

  test('declares each plural local exactly once', () => {
    const declared = [...module.matchAll(/^ {2}const (n\d+) = (.+)$/gmu)].map((match) => match[1])
    expect(new Set(declared).size).toBe(declared.length)
  })

  test('binds every arm to the argument its own plural selects', () => {
    const args = { files: 1, folders: 5 }
    expect(compileArm(module, 'cart_counts', 'en')(args)).toBe('1 files in 5 folders')
    expect(compileArm(module, 'cart_counts', 'de')(args)).toBe('5 Ordner mit 1 Dateien')
  })
})

const SPAN = { line: 1, column: 1, offset: 0, length: 1 }

function withPlaceholders(source: Program): Program {
  return {
    ...source,
    messages: source.messages.map((entry) =>
      entry.key === 'cart.items'
        ? {
            ...entry,
            placeholders: [
              { name: 'count', note: 'Number of line items' },
              { name: 'other', note: 'Never read' },
            ],
          }
        : entry,
    ),
  }
}
