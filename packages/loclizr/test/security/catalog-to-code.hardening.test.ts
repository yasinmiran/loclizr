import { describe, expect, test } from 'vitest'
import { analyze } from '../../src/analyze'
import { flatten, parseJsonWithSpans } from '../../src/catalog'
import { emit } from '../../src/emit'
import type { Diagnostic, EmittedFile, Program } from '../../src/types'
import { escapeIcuLiteral } from '../../src/util'
import { englishConfig } from './__fixtures__/catalog'

// Everything here starts from catalog JSON and runs the real catalog reader,
// analysis and emit, so key mangling, reserved-word guards and namespace
// sanitising are the ones the build uses.

const FILE = 'locales/en.json'

const STRICT_IDENTIFIER = /^[\p{ID_Start}$_][\p{ID_Continue}$]*$/u

const MODULE_PATH = /^messages\/[\p{ID_Start}\p{ID_Continue}$_]+\.js$/u

type MessageFn = (args?: Readonly<Record<string, unknown>>, opts?: unknown) => unknown

interface Compiled {
  readonly program: Program
  readonly diagnostics: readonly Diagnostic[]
  readonly files: readonly EmittedFile[]
}

function compile(catalog: Readonly<Record<string, unknown>>): Compiled {
  const parsed = parseJsonWithSpans(JSON.stringify(catalog), FILE)
  const flat = flatten({ value: parsed.value, file: FILE, locale: 'en', ns: null, spans: parsed.spans })
  const program = analyze({
    config: englishConfig(),
    catalogs: [{ locale: 'en', ns: null, file: FILE, format: 'icu', entries: flat.entries }],
    meta: null,
  })
  const blocked = program.diagnostics.some((diagnostic) => diagnostic.fatal)
  return { program, diagnostics: program.diagnostics, files: blocked ? [] : emit(program).files }
}

function file(compiled: Compiled, path: string): string {
  const found = compiled.files.find((candidate) => candidate.path === path)
  if (found === undefined) throw new Error(`no emitted file ${path}`)
  return found.contents
}

function onlyMessage(compiled: Compiled): Program['messages'][number] {
  const [message, ...rest] = compiled.program.messages
  if (message === undefined || rest.length > 0) throw new Error('expected exactly one message')
  return message
}

function scriptBody(source: string): string {
  return source
    .split('\n')
    .filter((line) => !line.startsWith('import '))
    .map((line) => line.replace(/^export /u, ''))
    .join('\n')
}

// Script grammar, not module grammar: the import lines are fixed text and the
// runtime helpers are stubbed, so what is checked is everything catalog text
// can reach.
function load(compiled: Compiled): Readonly<Record<string, MessageFn>> {
  const message = onlyMessage(compiled)
  const body = [
    scriptBody(file(compiled, 'messages/_formats.js')),
    scriptBody(file(compiled, message.module)),
    `return { ${compiled.program.messages.map((entry) => entry.id).join(', ')} }`,
  ].join('\n')
  const factory = new Function(
    '$l',
    '$plural1',
    '$number1',
    '$dateTime1',
    `'use strict';\n${body}`,
  ) as (...deps: readonly unknown[]) => Readonly<Record<string, MessageFn>>
  return factory(
    () => 'en',
    (locale: string, value: number, ordinal: boolean) =>
      new Intl.PluralRules(locale, { type: ordinal ? 'ordinal' : 'cardinal' }).select(value),
    (locale: string, value: number, options: Intl.NumberFormatOptions) =>
      new Intl.NumberFormat(locale, options).format(value),
    (locale: string, value: number, options: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(value),
  )
}

function call(compiled: Compiled, args?: Readonly<Record<string, unknown>>): unknown {
  const message = onlyMessage(compiled)
  const fn = load(compiled)[message.id]
  if (fn === undefined) throw new Error(`no function ${message.id}`)
  return fn(args)
}

function docLine(compiled: Compiled): string {
  const message = onlyMessage(compiled)
  const types = file(compiled, message.module.replace(/\.js$/u, '.d.ts'))
  const line = types.split('\n').find((candidate) => candidate.startsWith('/** en: '))
  if (line === undefined) throw new Error('no doc comment')
  return line
}

function blockedBy(compiled: Compiled, rule: Diagnostic['rule']): boolean {
  return compiled.diagnostics.some((diagnostic) => diagnostic.rule === rule && diagnostic.fatal)
}

// Lexical shapes that close or open something in JavaScript, in a comment, in
// a template literal or in an HTML host page.
const TEXTS: readonly (readonly [string, string])[] = [
  ['a backtick', 'before ` after'],
  ['a template hole', 'cost ${process.exit(1)} here'],
  ['a dollar ending one line and a brace run after it', 'pay $\n{x}'],
  ['a backslash before a backtick', 'a \\` b \\'],
  ['a trailing backslash', 'ends with \\'],
  ['a block comment terminator', 'a */ b /* c'],
  ['a line comment opener', 'a // b'],
  ['CRLF and a bare CR', 'one\r\ntwo\rthree\nfour'],
  ['line and paragraph separators', 'one\u2028two\u2029three'],
  ['NUL and other C0 controls', 'a\u0000b\u0001c\u000bd\u000ce\u001bf'],
  ['NUL followed by digits', 'x\u00001y\u000012'],
  ['a lone high surrogate', 'a\ud800b'],
  ['a lone low surrogate', 'a\udc00b'],
  ['a paired surrogate', 'emoji \ud83d\ude00'],
  ['script and HTML comment markers', '</script><!-- --><script>'],
  ['quotes of every kind', `'single' "double" \u2018curly\u2019`],
  ['a byte order mark and a next line', 'a\ufeffb\u0085c'],
  ['an octal-looking escape', '\\0 \\08 \\x41 \\u0041 \\u{41}'],
]

describe('catalog text reaches generated code only as text', () => {
  test.each(TEXTS)('returns %s byte for byte', (_label, text) => {
    const compiled = compile({ probe: { value: escapeIcuLiteral(text) } })
    expect(compiled.files.length).toBeGreaterThan(0)
    expect(call(compiled)).toBe(text)
  })

  test.each(TEXTS)('never lets %s close the .d.ts doc comment or carry CR or LF into it', (_label, text) => {
    const line = docLine(compile({ probe: { value: escapeIcuLiteral(text) } }))
    const inner = line.slice('/** '.length, -' */'.length)
    expect(line.endsWith(' */')).toBe(true)
    expect(inner).not.toContain('*/')
    expect(inner).not.toMatch(/[\r\n\u2028\u2029]/u)
  })

  test('returns a 1 MiB value intact', () => {
    const text = 'abc`$\\'.repeat(Math.ceil((1 << 20) / 6))
    const compiled = compile({ probe: { value: escapeIcuLiteral(text) } })
    expect(call(compiled)).toBe(text)
  })

  test('never lets a split dollar and brace across nested branches interpolate', () => {
    const compiled = compile({
      probe: { value: "{n, plural, one {$} other {$}}'{'n'}'{s, select, a {$} other {$}}'{'s'}'" },
    })
    expect(call(compiled, { n: 1, s: 'z' })).toBe('${n}${s}')
  })
})

describe('catalog keys reach generated code only as identifiers', () => {
  const STRICT_WORDS = ['await', 'yield', 'let', 'static', 'implements', 'eval', 'arguments', 'default', 'then']

  test.each(STRICT_WORDS)('guards the key %s into a non-reserved identifier', (word) => {
    const compiled = compile({ [word]: 'x' })
    const message = onlyMessage(compiled)
    expect(message.id).toBe(`$${word}`)
    expect(compiled.files.length).toBeGreaterThan(0)
    expect(call(compiled)).toBe('x')
  })

  test('never exports a function named then, which would make the namespace thenable', () => {
    const compiled = compile({ ns: { then: 'x' }, then: 'y' })
    expect(compiled.program.messages.map((message) => message.id)).not.toContain('then')
  })

  test.each(['__proto__', 'constructor', 'prototype', 'locales', 'sourceLocale', 'setLocale'])(
    'refuses to write a tree for the key %s',
    (key) => {
      const compiled = compile({ [key]: 'x' })
      expect(blockedBy(compiled, 'identifier-reserved')).toBe(true)
      expect(compiled.files).toEqual([])
    },
  )

  test.each(['$l', '$plural1', '$number1', '$dateTime1', '$f0123456789abcdef', '$configure1'])(
    'refuses to write a tree for the key %s, which names a generated internal',
    (key) => {
      const compiled = compile({ [key]: 'x' })
      expect(blockedBy(compiled, 'identifier-reserved')).toBe(true)
      expect(compiled.files).toEqual([])
    },
  )

  test.each(['_locale', '_formats', '_root', '_LOCALE'])(
    'refuses to write a tree for the namespace %s',
    (segment) => {
      const compiled = compile({ [segment]: { a: 'x' } })
      expect(blockedBy(compiled, 'identifier-reserved')).toBe(true)
    },
  )

  const HOSTILE_KEYS: readonly string[] = [
    "a'b",
    'a`b',
    'a"b',
    'a\nb',
    'a\u2028b',
    'a*/b',
    'a/*b',
    'a${b}',
    'a\u0000b',
    'a b',
    '1abc',
    '-',
    '',
    '\ud800',
    'a\u200db',
  ]

  test.each(HOSTILE_KEYS)('mangles the key %j into one strict identifier', (key) => {
    const compiled = compile({ [key]: 'x' })
    const message = onlyMessage(compiled)
    expect(message.id).toMatch(STRICT_IDENTIFIER)
    expect(call(compiled)).toBe('x')
  })

  test.each([
    ['../..', 'up'],
    ['..\\..', 'up'],
    ['/etc', 'passwd'],
    ['C:', 'x'],
    ['a/b', 'c'],
    ['a\u0000b', 'c'],
    ["a'b", 'c'],
  ])('keeps the namespace of %j inside messages/ with no separator', (segment, leaf) => {
    const compiled = compile({ [segment]: { [leaf]: 'x' } })
    const message = onlyMessage(compiled)
    expect(message.module).toMatch(MODULE_PATH)
    expect(compiled.files.map((entry) => entry.path)).toContain(message.module)
    expect(file(compiled, 'messages.js')).toContain(`export * from './${message.module}'`)
    expect(call(compiled)).toBe('x')
  })

  test('refuses two keys that mangle to one identifier', () => {
    const compiled = compile({ 'a.b': 'x', a_b: 'y' })
    expect(blockedBy(compiled, 'identifier-collision')).toBe(true)
    expect(compiled.files).toEqual([])
  })
})

describe('catalog argument, option and tag names reach generated code only as data', () => {
  test.each(['__proto__', 'constructor', 'toString', '0', '\u00e9'])(
    'reads the argument %s as a property and never as code',
    (name) => {
      const compiled = compile({ probe: `[{${name}}]` })
      const message = onlyMessage(compiled)
      expect(compiled.files.length).toBeGreaterThan(0)
      const subscript = name === '__proto__' || !STRICT_IDENTIFIER.test(name)
      const js = file(compiled, message.module)
      expect(js).toContain(subscript ? `\${args['${name}']}` : `\${args.${name}}`)
      const types = file(compiled, message.module.replace(/\.js$/u, '.d.ts'))
      expect(types).toContain(subscript ? `{ '${name}': string | number }` : `{ ${name}: string | number }`)
      if (name !== '__proto__') expect(call(compiled, { [name]: 'v' })).toBe('[v]')
    },
  )

  test.each(['a-b', 'a.b'])('calls the markup handler %s by subscript', (tag) => {
    const compiled = compile({ probe: `<${tag}>x</${tag}>` })
    const message = onlyMessage(compiled)
    expect(file(compiled, message.module)).toContain(`args['${tag}'](['x'])`)
    const fn = load(compiled)[message.id]
    expect(fn?.({ [tag]: (chunks: readonly unknown[]) => chunks.join('') })).toEqual(['x'])
  })

  test('quotes select options in the case labels and in the union type', () => {
    const compiled = compile({ probe: "{s, select, __proto__ {p} constructor {c} other {o}}" })
    const message = onlyMessage(compiled)
    const js = file(compiled, message.module)
    expect(js).toContain("case '__proto__':")
    expect(js).toContain("case 'constructor':")
    const types = file(compiled, message.module.replace(/\.js$/u, '.d.ts'))
    expect(types).toMatch(/s: '__proto__' \| 'constructor'/u)
    const fn = load(compiled)[message.id]
    expect(fn?.({ s: '__proto__' })).toBe('p')
    expect(fn?.({ s: 'toString' })).toBe('o')
  })

  test('calls a markup handler by property access and passes catalog text as data', () => {
    const compiled = compile({ probe: "<b>$'{'x'}'`</b>" })
    const message = onlyMessage(compiled)
    expect(message.kind).toBe('markup')
    const fn = load(compiled)[message.id]
    const parts = fn?.({ b: (chunks: readonly unknown[]) => ({ tag: 'b', chunks }) })
    expect(parts).toEqual([{ tag: 'b', chunks: ['${x}`'] }])
  })

  test('prints exact plural values as numeric literals', () => {
    const compiled = compile({ probe: '{n, plural, =-1 {minus} =007 {seven} other {small}}' })
    const message = onlyMessage(compiled)
    const js = file(compiled, message.module)
    expect(js).toMatch(/=== -1\b/u)
    expect(js).toMatch(/=== 7\b/u)
    const fn = load(compiled)[message.id]
    expect(fn?.({ n: -1 })).toBe('minus')
    expect(fn?.({ n: 7 })).toBe('seven')
    expect(fn?.({ n: 1 })).toBe('small')
  })

  test('prints a skeleton currency code as a quoted string in the formats module', () => {
    const compiled = compile({ probe: '{n, number, ::currency/EUR}' })
    const formats = file(compiled, 'messages/_formats.js')
    expect(formats).toMatch(/currency: 'EUR'/u)
    expect(call(compiled, { n: 1 })).toContain('1')
  })
})
