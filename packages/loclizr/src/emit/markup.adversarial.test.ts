import { describe, expect, test } from 'vitest'
import type { EmittedFile, Group, Message } from '../types'
import { emit } from './index'
import {
  arg,
  body,
  choice,
  config,
  markup,
  message,
  plural,
  program,
  text,
  translated,
} from './__fixtures__/program'

type Arm = (args: Readonly<Record<string, unknown>>) => unknown

interface Handled {
  readonly tag: string
  readonly chunks: readonly unknown[]
}

function handler(tag: string): (chunks: readonly unknown[]) => Handled {
  return (chunks) => ({ tag, chunks })
}

function contentsOf(files: readonly EmittedFile[], path: string): string {
  const file = files.find((candidate) => candidate.path === path)
  if (file === undefined) throw new Error(`no emitted file at ${path}`)
  return file.contents
}

function english(only: Message, groups: readonly Group[] = []): readonly EmittedFile[] {
  return emit(
    program({
      messages: [only],
      groups,
      config: config({ locales: ['en'], groups: groups.length === 0 ? {} : { terms: 'terms' } }),
    }),
  ).files
}

// Runs the emitted arm so the assertion is about what a caller receives rather
// than about the text emit printed.
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

function handlers(parts: unknown): readonly Handled[] {
  if (!Array.isArray(parts)) throw new Error(`a markup arm returned ${typeof parts}, not an array`)
  return parts.filter((part): part is Handled => typeof part === 'object' && part !== null)
}

describe('a markup message whose tag sits inside a branch', () => {
  test('keeps the handler result reachable when the plural has surrounding text', () => {
    const files = english(
      message({
        key: 'cart.notice',
        source: 'You have {count, plural, one {<b>one file</b>} other {<b>many files</b>}} waiting',
        kind: 'markup',
        args: [
          { name: 'count', type: { kind: 'number' } },
          { name: 'b', type: { kind: 'markup' } },
        ],
        bodies: [
          body('en', [
            text('You have '),
            plural('count', {
              branches: [
                { keyword: 'one', body: [markup('b', [text('one file')])] },
                { keyword: 'other', body: [markup('b', [text('many files')])] },
              ],
            }),
            text(' waiting'),
          ]),
        ],
        origins: [translated('en')],
      }),
    )
    const arm = compileArm(contentsOf(files, 'messages/cart.js'), 'cart_notice', 'en')
    const parts = arm({ count: 3, b: handler('b') })
    expect(handlers(parts)).toHaveLength(1)
  })

  test('keeps the handler result reachable when the select has surrounding text', () => {
    const files = english(
      message({
        key: 'order.hint',
        source: 'Status: {state, select, shipped {<link>track it</link>} other {<link>orders</link>}}.',
        kind: 'markup',
        args: [
          { name: 'state', type: { kind: 'select', options: ['shipped'] } },
          { name: 'link', type: { kind: 'markup' } },
        ],
        bodies: [
          body('en', [
            text('Status: '),
            choice('state', [
              { option: 'shipped', body: [markup('link', [text('track it')])] },
              { option: 'other', body: [markup('link', [text('orders')])] },
            ]),
            text('.'),
          ]),
        ],
        origins: [translated('en')],
      }),
    )
    const arm = compileArm(contentsOf(files, 'messages/order.js'), 'order_hint', 'en')
    const parts = arm({ state: 'shipped', link: handler('link') })
    expect(handlers(parts)).toHaveLength(1)
  })

  test('keeps both handler results when a tag precedes a branch', () => {
    const files = english(
      message({
        key: 'cart.mixed',
        source: '<i>Note</i>: {count, plural, one {<b>one</b>} other {<b>many</b>}}',
        kind: 'markup',
        args: [
          { name: 'count', type: { kind: 'number' } },
          { name: 'b', type: { kind: 'markup' } },
          { name: 'i', type: { kind: 'markup' } },
        ],
        bodies: [
          body('en', [
            markup('i', [text('Note')]),
            text(': '),
            plural('count', {
              branches: [
                { keyword: 'one', body: [markup('b', [text('one')])] },
                { keyword: 'other', body: [markup('b', [text('many')])] },
              ],
            }),
          ]),
        ],
        origins: [translated('en')],
      }),
    )
    const arm = compileArm(contentsOf(files, 'messages/cart.js'), 'cart_mixed', 'en')
    const parts = arm({ count: 2, b: handler('b'), i: handler('i') })
    expect(handlers(parts).map((part) => part.tag)).toEqual(['i', 'b'])
  })

  test('keeps a handler inside another handler reachable through a branch', () => {
    const files = english(
      message({
        key: 'cart.deep',
        source: '<b>You have {count, plural, one {<i>one file</i>} other {<i>many files</i>}}</b> left',
        kind: 'markup',
        args: [
          { name: 'count', type: { kind: 'number' } },
          { name: 'b', type: { kind: 'markup' } },
          { name: 'i', type: { kind: 'markup' } },
        ],
        bodies: [
          body('en', [
            markup('b', [
              text('You have '),
              plural('count', {
                branches: [
                  { keyword: 'one', body: [markup('i', [text('one file')])] },
                  { keyword: 'other', body: [markup('i', [text('many files')])] },
                ],
              }),
            ]),
            text(' left'),
          ]),
        ],
        origins: [translated('en')],
      }),
    )
    const arm = compileArm(contentsOf(files, 'messages/cart.js'), 'cart_deep', 'en')
    const outer = handlers(arm({ count: 4, b: handler('b'), i: handler('i') }))
    expect(outer.map((part) => part.tag)).toEqual(['b'])
    expect(handlers(outer[0]?.chunks).map((part) => part.tag)).toEqual(['i'])
  })

  test('keeps the handler result reachable when the plural is the whole message', () => {
    const files = english(
      message({
        key: 'cart.only',
        source: '{count, plural, one {<b>one file</b>} other {<b>many files</b>}}',
        kind: 'markup',
        args: [
          { name: 'count', type: { kind: 'number' } },
          { name: 'b', type: { kind: 'markup' } },
        ],
        bodies: [
          body('en', [
            plural('count', {
              branches: [
                { keyword: 'one', body: [markup('b', [text('one file')])] },
                { keyword: 'other', body: [markup('b', [text('many files')])] },
              ],
            }),
          ]),
        ],
        origins: [translated('en')],
      }),
    )
    const arm = compileArm(contentsOf(files, 'messages/cart.js'), 'cart_only', 'en')
    const parts = arm({ count: 3, b: handler('b') })
    expect(handlers(parts)).toHaveLength(1)
  })

  test('coerces a tagless arm to a one element array holding the whole sentence', () => {
    const files = emit(
      program({
        messages: [
          message({
            key: 'terms.accept',
            source: 'Read our <link>terms</link> now.',
            kind: 'markup',
            args: [
              { name: 'name', type: { kind: 'stringish' } },
              { name: 'link', type: { kind: 'markup' } },
            ],
            bodies: [
              body('en', [
                text('Read our '),
                markup('link', [text('terms')]),
                text(' now, '),
                arg('name'),
                text('.'),
              ]),
              body('de', [text('Lies unsere AGB jetzt, '), arg('name'), text('.')]),
            ],
            origins: [translated('en'), translated('de')],
          }),
        ],
        config: config({ locales: ['en', 'de'] }),
      }),
    ).files
    const module = contentsOf(files, 'messages/terms.js')
    const german = compileArm(module, 'terms_accept', 'de')({ name: 'Ada', link: handler('link') })
    expect(german).toEqual(['Lies unsere AGB jetzt, Ada.'])
  })
})

// A handler in the printed argument set names T, whatever kind the source body
// carries, so the declaration has to bind it and no arm may treat the handler
// as a value. The `.d.ts` is printed text, so an unbound T compiles silently
// under skipLibCheck and the arm ships the function's own source to users.
describe('a handler argument the source body uses bare', () => {
  function bare(): Message {
    return message({
      key: 'terms.accept',
      source: 'Click {link} now',
      args: [{ name: 'link', type: { kind: 'markup' } }],
      bodies: [
        body('en', [text('Click '), arg('link'), text(' now')]),
        body('de', [text('Klick '), markup('link', [text('hier')]), text(' jetzt')]),
      ],
      origins: [translated('en'), translated('de')],
    })
  }

  function both(): readonly EmittedFile[] {
    return emit(program({ messages: [bare()], config: config({ locales: ['en', 'de'] }) })).files
  }

  test('binds the type parameter the handler names', () => {
    expect(contentsOf(both(), 'messages/terms.d.ts')).toContain('export declare function terms_accept<T>(')
  })

  test('keeps the return type the source kind decides', () => {
    const declarations = contentsOf(both(), 'messages/terms.d.ts')
    expect(declarations).toContain('): string')
    expect(declarations).not.toContain('readonly (string | T)[]>')
  })

  test('never interpolates the handler into a template literal', () => {
    expect(contentsOf(both(), 'messages/terms.js')).not.toContain('${args.link}')
  })

  test('renders both arms as strings a caller can use', () => {
    const module = contentsOf(both(), 'messages/terms.js')
    expect(compileArm(module, 'terms_accept', 'en')({ link: handler('link') })).toBe('Click  now')
    expect(compileArm(module, 'terms_accept', 'de')({ link: handler('link') })).toBe('Klick hier jetzt')
  })

  test('calls the handler with no chunks where the message returns parts', () => {
    const files = english(
      message({
        key: 'terms.mixed',
        source: 'Read <link>terms</link> or {link}',
        kind: 'markup',
        args: [{ name: 'link', type: { kind: 'markup' } }],
        bodies: [body('en', [markup('link', [text('terms')]), text(' or '), arg('link')])],
        origins: [translated('en')],
      }),
    )
    const arm = compileArm(contentsOf(files, 'messages/terms.js'), 'terms_mixed', 'en')
    expect(handlers(arm({ link: handler('link') })).map((part) => part.chunks)).toEqual([['terms'], []])
  })

  test('makes the lookup tier generic for a member that returns a string', () => {
    const group: Group = {
      name: 'terms',
      id: 'terms',
      typeBase: 'Terms',
      prefix: 'terms',
      members: [{ key: 'terms.accept', id: 'terms_accept', member: 'accept' }],
    }
    const declarations = contentsOf(english(bare(), [group]), 'groups.d.ts')
    expect(declarations).toContain('export interface TermsArgs<T> {')
    expect(declarations).toContain('[K in TermsKey]: <T>(args: TermsArgs<T>[K], opts?: MessageOptions) => TermsReturn<T>[K]')
  })
})
