import { describe, expect, test } from 'vitest'
import type { EmittedFile, Message } from '../types'
import { emit } from './index'
import {
  body,
  choice,
  config,
  message,
  plural,
  pound,
  program,
  text,
  translated,
} from './__fixtures__/program'

type Arm = (args: Readonly<Record<string, unknown>>) => unknown

function contentsOf(files: readonly EmittedFile[], path: string): string {
  const file = files.find((candidate) => candidate.path === path)
  if (file === undefined) throw new Error(`no emitted file at ${path}`)
  return file.contents
}

function compileArm(only: Message, id: string, locale: string): Arm {
  const files = emit(program({ messages: [only], config: config({ locales: [locale] }) })).files
  const module = contentsOf(files, only.module)
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

describe('a select inside a plural inside surrounding text', () => {
  const gendered = message({
    key: 'cart.gendered',
    source: 'Note: {count, plural, one {{who, select, male {he has # item} other {they have # item}}} other {{who, select, male {he has # items} other {they have # items}}}} today',
    args: [
      { name: 'count', type: { kind: 'number' } },
      { name: 'who', type: { kind: 'select', options: ['male'] } },
    ],
    bodies: [
      body('en', [
        text('Note: '),
        plural('count', {
          branches: [
            {
              keyword: 'one',
              body: [
                choice('who', [
                  { option: 'male', body: [text('he has '), pound(), text(' item')] },
                  { option: 'other', body: [text('they have '), pound(), text(' item')] },
                ]),
              ],
            },
            {
              keyword: 'other',
              body: [
                choice('who', [
                  { option: 'male', body: [text('he has '), pound(), text(' items')] },
                  { option: 'other', body: [text('they have '), pound(), text(' items')] },
                ]),
              ],
            },
          ],
        }),
        text(' today'),
      ]),
    ],
    origins: [translated('en')],
  })

  test('picks the plural branch first and the select branch inside it', () => {
    const arm = compileArm(gendered, 'cart_gendered', 'en')
    expect(arm({ count: 1, who: 'male' })).toBe('Note: he has 1 item today')
    expect(arm({ count: 1, who: 'she' })).toBe('Note: they have 1 item today')
    expect(arm({ count: 4, who: 'male' })).toBe('Note: he has 4 items today')
  })

  test('resolves the pound inside the select to the enclosing plural selector', () => {
    const arm = compileArm(gendered, 'cart_gendered', 'en')
    expect(arm({ count: 1000, who: 'male' })).toBe('Note: he has 1,000 items today')
  })
})

describe('nested plurals', () => {
  const nested = message({
    key: 'cart.nested',
    source: 'nested',
    args: [
      { name: 'users', type: { kind: 'number' } },
      { name: 'files', type: { kind: 'number' } },
    ],
    bodies: [
      body('en', [
        plural('users', {
          offset: 2,
          exact: [{ value: 0, body: [text('nobody')] }],
          branches: [
            {
              keyword: 'one',
              body: [
                plural('files', {
                  branches: [
                    { keyword: 'one', body: [text('one user, one file')] },
                    { keyword: 'other', body: [pound(), text(' files for one user')] },
                  ],
                }),
              ],
            },
            {
              keyword: 'other',
              body: [
                pound(),
                text(' users, '),
                plural('files', {
                  branches: [
                    { keyword: 'one', body: [text('one file')] },
                    { keyword: 'other', body: [pound(), text(' files')] },
                  ],
                }),
              ],
            },
          ],
        }),
      ]),
    ],
    origins: [translated('en')],
  })

  test('tests the exact branch before the category and against the raw value', () => {
    const arm = compileArm(nested, 'cart_nested', 'en')
    expect(arm({ users: 0, files: 9 })).toBe('nobody')
  })

  test('gives each pound the number of its own innermost plural', () => {
    const arm = compileArm(nested, 'cart_nested', 'en')
    expect(arm({ users: 3, files: 4 })).toBe('4 files for one user')
    expect(arm({ users: 7, files: 1 })).toBe('5 users, one file')
    expect(arm({ users: 7, files: 3 })).toBe('5 users, 3 files')
  })
})

describe('an ordinal plural', () => {
  test('selects through the ordinal rules rather than the cardinal ones', () => {
    const place = message({
      key: 'race.place',
      source: 'place',
      args: [{ name: 'rank', type: { kind: 'number' } }],
      bodies: [
        body('en', [
          plural('rank', {
            ordinal: true,
            branches: [
              { keyword: 'one', body: [pound(), text('st')] },
              { keyword: 'two', body: [pound(), text('nd')] },
              { keyword: 'few', body: [pound(), text('rd')] },
              { keyword: 'other', body: [pound(), text('th')] },
            ],
          }),
        ]),
      ],
      origins: [translated('en')],
    })
    const arm = compileArm(place, 'race_place', 'en')
    expect([1, 2, 3, 4, 11].map((rank) => arm({ rank }))).toEqual(['1st', '2nd', '3rd', '4th', '11th'])
  })
})
