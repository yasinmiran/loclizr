import { describe, expect, test } from 'vitest'
import type { EmittedFile, Message } from '../types'
import { emit } from './index'
import {
  arg,
  body,
  config,
  fellBack,
  inherited,
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

function filesOf(only: Message, locales: readonly string[]): readonly EmittedFile[] {
  return emit(program({ messages: [only], config: config({ locales }) })).files
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

describe('a locale whose body M4 ruled unusable', () => {
  // The translator typed {{nmae}}, so M4 stamped the locale fallback/invalid
  // and kept its Body for M5 to read.
  const typo = message({
    key: 'cart.greeting',
    source: 'Hi {name}',
    args: [{ name: 'name', type: { kind: 'stringish' } }],
    bodies: [
      body('en', [text('Hi '), arg('name')]),
      body('de', [text('Hallo '), arg('nmae')]),
    ],
    origins: [translated('en'), fellBack('de', 'en', 'invalid')],
  })

  test('never reads the argument only that body mentions', () => {
    const module = contentsOf(filesOf(typo, ['en', 'de']), 'messages/cart.js')
    expect(module).not.toContain('nmae')
  })

  test('drops the locale from the switch because it renders the source body', () => {
    const module = contentsOf(filesOf(typo, ['en', 'de']), 'messages/cart.js')
    expect(module).not.toContain("case 'de':")
  })

  test('declares no plural local for a selector only that body used', () => {
    const module = contentsOf(
      filesOf(
        message({
          key: 'cart.items',
          source: 'Items',
          bodies: [
            body('en', [text('Items')]),
            body('de', [
              plural('nmae', {
                branches: [
                  { keyword: 'one', body: [pound(), text(' Artikel')] },
                  { keyword: 'other', body: [pound(), text(' Artikel')] },
                ],
              }),
            ]),
          ],
          origins: [translated('en'), fellBack('de', 'en', 'invalid')],
        }),
        ['en', 'de'],
      ),
      'messages/cart.js',
    )
    expect(module).not.toContain('const n0')
    expect(module).not.toContain('nmae')
  })
})

describe('the resolver call', () => {
  test('happens exactly once per message however many plurals it carries', () => {
    const module = contentsOf(
      filesOf(
        message({
          key: 'cart.counts',
          source: 'counts',
          args: [
            { name: 'files', type: { kind: 'number' } },
            { name: 'folders', type: { kind: 'number' } },
          ],
          bodies: [
            body('en', [
              plural('files', {
                branches: [
                  { keyword: 'one', body: [pound(), text(' file')] },
                  { keyword: 'other', body: [pound(), text(' files')] },
                ],
              }),
              text(' in '),
              plural('folders', {
                branches: [
                  { keyword: 'one', body: [pound(), text(' folder')] },
                  { keyword: 'other', body: [pound(), text(' folders')] },
                ],
              }),
            ]),
          ],
          origins: [translated('en')],
        }),
        ['en'],
      ),
      'messages/cart.js',
    )
    expect(module.split('$l(').length - 1).toBe(1)
  })

  test('happens exactly once in every function of the worked example', () => {
    const files = emit(workedExample()).files
    for (const file of files) {
      if (!file.path.startsWith('messages/') || !file.path.endsWith('.js')) continue
      if (file.path === 'messages/_locale.js' || file.path === 'messages/_formats.js') continue
      for (const chunk of file.contents.split('\n\n')) {
        if (!chunk.startsWith('export function ')) continue
        expect(chunk.split('$l(').length - 1).toBe(1)
      }
    }
  })
})

describe('plural offsets', () => {
  const offsetMessage = message({
    key: 'cart.left',
    source: '{count, plural, offset:1 =1 {# left} other {# more}}',
    args: [{ name: 'count', type: { kind: 'number' } }],
    bodies: [
      body('en', [
        plural('count', {
          offset: 1,
          exact: [{ value: 1, body: [pound(), text(' left')] }],
          branches: [{ keyword: 'other', body: [pound(), text(' more')] }],
        }),
      ]),
    ],
    origins: [translated('en')],
  })

  test('tests the exact branch against the raw value and prints the offset value', () => {
    const module = contentsOf(filesOf(offsetMessage, ['en']), 'messages/cart.js')
    const arm = compileArm(module, 'cart_left', 'en')
    expect(arm({ count: 1 })).toBe('0 left')
    expect(arm({ count: 4 })).toBe('3 more')
  })

  test('emits no arithmetic when the offset is zero', () => {
    const module = contentsOf(
      filesOf(
        message({
          key: 'cart.plain',
          source: '{count, plural, other {# more}}',
          args: [{ name: 'count', type: { kind: 'number' } }],
          bodies: [
            body('en', [
              plural('count', { offset: 0, branches: [{ keyword: 'other', body: [pound(), text(' more')] }] }),
            ]),
          ],
          origins: [translated('en')],
        }),
        ['en'],
      ),
      'messages/cart.js',
    )
    expect(module).not.toContain('- 0')
  })
})

describe('a chain of inherited locales', () => {
  test('renders the ancestor body for a locale two steps from the source', () => {
    const files = filesOf(
      message({
        key: 'nav.home',
        source: 'Home',
        bodies: [body('en', [text('Home')]), body('de', [text('Startseite')])],
        origins: [translated('en'), translated('de'), inherited('de-AT', 'de'), inherited('de-CH', 'de')],
      }),
      ['en', 'de', 'de-AT', 'de-CH'],
    )
    const module = contentsOf(files, 'messages/nav.js')
    expect(module).toContain("    case 'de':\n    case 'de-AT':\n    case 'de-CH':\n      return `Startseite`")
    expect(compileArm(module, 'nav_home', 'de-CH')({})).toBe('Startseite')
  })

  test('emits no case labels when every locale resolves to the source body', () => {
    const module = contentsOf(
      filesOf(
        message({
          key: 'nav.home',
          source: 'Home',
          bodies: [body('en', [text('Home')])],
          origins: [translated('en'), fellBack('de', 'en', 'missing'), fellBack('fr', 'en', 'blank')],
        }),
        ['en', 'de', 'fr'],
      ),
      'messages/nav.js',
    )
    expect(module).not.toContain('case ')
  })
})
