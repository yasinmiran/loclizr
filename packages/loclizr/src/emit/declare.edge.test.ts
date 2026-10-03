import { describe, expect, test } from 'vitest'
import type { Arg, Message } from '../types'
import { argsParameter, argsShape, declaration, typeOf } from './declare'
import { MAX_LINE } from './shared'
import { body, message, text, translated } from './__fixtures__/program'

function declared(parts: { readonly id: string; readonly args?: readonly Arg[]; readonly kind?: 'text' | 'markup' }): Message {
  return message({
    key: 'x.y',
    identifier: parts.id,
    source: 'Source',
    kind: parts.kind ?? 'text',
    args: parts.args ?? [],
    bodies: [body('en', [text('Source')])],
    origins: [translated('en')],
  })
}

describe('typeOf a select', () => {
  test('sorts options by code point, not by locale collation', () => {
    expect(typeOf({ kind: 'select', options: ['b', 'B', 'ä', 'a'] })).toBe("'B' | 'a' | 'b' | 'ä'")
  })

  test('escapes an option holding a quote, a backslash and a line break', () => {
    const printed = typeOf({ kind: 'select', options: ["it's", 'a\\b', 'x\ny'] })
    expect(printed).toBe("'a\\\\b' | 'it\\'s' | 'x\\ny'")
  })

  test('keeps a numeric-looking option a string literal type', () => {
    expect(typeOf({ kind: 'select', options: ['10', '2'] })).toBe("'10' | '2'")
  })

  test('keeps prototype names as ordinary literal types', () => {
    expect(typeOf({ kind: 'select', options: ['toString', '__proto__', 'constructor'] })).toBe(
      "'__proto__' | 'constructor' | 'toString'",
    )
  })

  test('drops every other entry, wherever it sits', () => {
    expect(typeOf({ kind: 'select', options: ['other', 'a', 'other'] })).toBe("'a'")
  })

  test('falls back to string | number when the options list is empty', () => {
    expect(typeOf({ kind: 'select', options: [] })).toBe('string | number')
  })

  test('does not reorder the options array it was handed', () => {
    const options = ['b', 'a']
    typeOf({ kind: 'select', options })
    expect(options).toEqual(['b', 'a'])
  })
})

describe('typeOf the other kinds', () => {
  test('types a date as a Date or an epoch number', () => {
    expect(typeOf({ kind: 'date' })).toBe('Date | number')
  })

  test('types a bare argument as string | number', () => {
    expect(typeOf({ kind: 'stringish' })).toBe('string | number')
  })
})

describe('argsShape', () => {
  test('keeps the semantic argument order rather than sorting it', () => {
    const shape = argsShape([
      { name: 'z', type: { kind: 'number' } },
      { name: 'a', type: { kind: 'stringish' } },
    ])
    expect(shape).toBe('{ z: number; a: string | number }')
  })

  test('quotes every name that is not an identifier', () => {
    const shape = argsShape([
      { name: '9x', type: { kind: 'stringish' } },
      { name: "it's", type: { kind: 'stringish' } },
    ])
    expect(shape).toBe("{ '9x': string | number; 'it\\'s': string | number }")
  })

  test('leaves a reserved word bare, which is a legal property name in a type literal', () => {
    expect(argsShape([{ name: 'class', type: { kind: 'number' } }])).toBe('{ class: number }')
  })

  test('makes args optional only when there are none', () => {
    expect(argsParameter([])).toBe('args?: EmptyArgs')
    expect(argsParameter([{ name: 'n', type: { kind: 'number' } }])).toBe('args: { n: number }')
  })
})

describe('declaration line budget', () => {
  const head = 'export declare function '
  const tail = '(args?: EmptyArgs, opts?: MessageOptions): string'

  test('keeps a declaration of exactly the budget on one line', () => {
    const id = 'x'.repeat(MAX_LINE - head.length - tail.length)
    const lines = declaration(declared({ id }), 'en')
    expect(lines).toHaveLength(2)
    expect(lines[1]?.length).toBe(MAX_LINE)
  })

  test('wraps a declaration one character over the budget', () => {
    const id = 'x'.repeat(MAX_LINE - head.length - tail.length + 1)
    const lines = declaration(declared({ id }), 'en')
    expect(lines).toEqual([
      '/** en: "Source" */',
      `export declare function ${id}(`,
      '  args?: EmptyArgs,',
      '  opts?: MessageOptions,',
      '): string',
    ])
  })

  test('keeps the type parameter on the opening line of a wrapped markup declaration', () => {
    const id = 'x'.repeat(MAX_LINE)
    const lines = declaration(
      declared({ id, kind: 'markup', args: [{ name: 'b', type: { kind: 'markup' } }] }),
      'en',
    )
    expect(lines[1]).toBe(`export declare function ${id}<T>(`)
    expect(lines[4]).toBe('): readonly (string | T)[]')
  })
})

describe('declaration generics', () => {
  test('binds T for a text message that takes a handler argument', () => {
    const lines = declaration(declared({ id: 'f', args: [{ name: 'b', type: { kind: 'markup' } }] }), 'en')
    expect(lines[1]).toBe(
      'export declare function f<T>(args: { b: (chunks: readonly (string | T)[]) => T }, opts?: MessageOptions): string',
    )
  })

  test('binds T for a markup message with no arguments at all', () => {
    const lines = declaration(declared({ id: 'f', kind: 'markup' }), 'en')
    expect(lines[1]).toBe(
      'export declare function f<T>(args?: EmptyArgs, opts?: MessageOptions): readonly (string | T)[]',
    )
  })

  test('labels the doc comment with the source locale it is handed', () => {
    const lines = declaration(declared({ id: 'f' }), 'pt-BR')
    expect(lines[0]).toBe('/** pt-BR: "Source" */')
  })
})
