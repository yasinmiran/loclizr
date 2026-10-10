import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { EmittedFile, Group, Message, Node, Program } from '../types'
import { emit } from './index'
import {
  arg,
  body,
  choice,
  config,
  fellBack,
  inherited,
  markup,
  message,
  num,
  plural,
  pound,
  program,
  text,
  translated,
} from './__fixtures__/program'

const RUNTIME = new URL('../index.ts', import.meta.url).href

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u

const RAW_TERMINATOR = /[\r\u2028\u2029]/u

const LOCALES: readonly string[] = ['en', 'de', 'de-u-co-phonebk', 'zh-Hant-TW', 'ar']

const HOSTILE =
  'CRLF\r\nCR\rLS\u2028PS\u2029BOM\uFEFFRLM\u200FRLO\u202Eabc\u202C' +
  'combining e\u0301 emoji \u{1F468}\u200D\u{1F469}\u200D\u{1F467} lone \uD800 low \uDC00 ' +
  'nul \u0000 1 backslash \\ quote \' backtick ` dollar $ brace ${args.x} end $'

const LONG = `${'0123456789'.repeat(10_000)}!`

const DEPTH = 8

function contentsOf(files: readonly EmittedFile[], path: string): string {
  const file = files.find((candidate) => candidate.path === path)
  if (file === undefined) throw new Error(`no emitted file at ${path}`)
  return file.contents
}

function everyLocale(): ReturnType<typeof translated>[] {
  return [translated('en'), ...LOCALES.filter((locale) => locale !== 'en').map((locale) => fellBack(locale, 'en', 'missing'))]
}

function simple(key: string, id: string, value: string): Message {
  return message({ key, identifier: id, source: value, bodies: [body('en', [text(value)])], origins: everyLocale() })
}

function nestedSelect(level: number): readonly Node[] {
  if (level === DEPTH) return [text('bottom')]
  return [
    choice('s', [
      { option: 'x', body: [text(`${level}>`), ...nestedSelect(level + 1)] },
      { option: 'other', body: [text(`stop at ${level}`)] },
    ]),
  ]
}

function messages(): readonly Message[] {
  return [
    message({
      key: 'edge.hostile',
      source: 'hostile',
      bodies: [
        body('en', [text(HOSTILE)]),
        body('de-u-co-phonebk', [text(`phonebook ${HOSTILE}`)]),
      ],
      origins: [
        translated('en'),
        fellBack('de', 'en', 'missing'),
        translated('de-u-co-phonebk'),
        inherited('zh-Hant-TW', 'de-u-co-phonebk'),
        fellBack('ar', 'en', 'missing'),
      ],
    }),
    simple('edge.long', 'edge_long', LONG),
    message({
      key: 'edge.deep',
      source: 'deep',
      args: [{ name: 's', type: { kind: 'select', options: ['x'] } }],
      bodies: [body('en', nestedSelect(0))],
      origins: everyLocale(),
    }),
    message({
      key: 'edge.count',
      source: 'count',
      args: [{ name: 'count', type: { kind: 'number' } }],
      bodies: [
        body('en', [
          plural('count', {
            exact: [
              { value: 1e21, body: [text('sextillion')] },
              { value: -1, body: [text('minus one')] },
              { value: 0, body: [text('none')] },
            ],
            branches: [
              { keyword: 'one', body: [pound(), text(' item')] },
              { keyword: 'other', body: [pound(), text(' items')] },
            ],
          }),
        ]),
      ],
      origins: everyLocale(),
    }),
    message({
      key: 'edge.offset',
      source: 'offset',
      args: [{ name: 'count', type: { kind: 'number' } }],
      bodies: [
        body('en', [
          plural('count', {
            offset: 2,
            exact: [{ value: 2, body: [text('exactly two')] }],
            branches: [
              { keyword: 'one', body: [text('one more: '), pound()] },
              { keyword: 'other', body: [text('more: '), pound()] },
            ],
          }),
        ]),
      ],
      origins: everyLocale(),
    }),
    message({
      key: 'edge.names',
      source: 'names',
      args: [
        { name: '9x', type: { kind: 'stringish' } },
        { name: 'class', type: { kind: 'stringish' } },
        { name: 'constructor', type: { kind: 'stringish' } },
        { name: 'toString', type: { kind: 'stringish' } },
        { name: '\u00E4', type: { kind: 'stringish' } },
      ],
      bodies: [
        body('en', [
          arg('9x'),
          text('|'),
          arg('class'),
          text('|'),
          arg('constructor'),
          text('|'),
          arg('toString'),
          text('|'),
          arg('\u00E4'),
        ]),
      ],
      origins: everyLocale(),
    }),
    message({
      key: 'edge.pick',
      source: 'pick',
      args: [
        {
          name: 'v',
          type: { kind: 'select', options: ['__proto__', 'constructor', 'toString', "it's", '1', 'cafe\u0301'] },
        },
      ],
      bodies: [
        body('en', [
          choice('v', [
            { option: '__proto__', body: [text('proto')] },
            { option: 'constructor', body: [text('ctor')] },
            { option: 'toString', body: [text('tostring')] },
            { option: "it's", body: [text('quote')] },
            { option: '1', body: [text('one')] },
            { option: 'cafe\u0301', body: [text('decomposed')] },
            { option: 'other', body: [text('other')] },
          ]),
        ]),
      ],
      origins: everyLocale(),
    }),
    message({
      key: 'edge.money',
      source: 'money',
      args: [{ name: 'n', type: { kind: 'number' } }],
      bodies: [body('en', [num('n', '::currency/EUR', { style: 'currency', currency: 'EUR' })])],
      origins: everyLocale(),
    }),
    message({
      key: 'edge.cash',
      source: 'cash',
      args: [{ name: 'n', type: { kind: 'number' } }],
      bodies: [body('en', [num('n', 'cash', { currency: 'EUR', style: 'currency' })])],
      origins: everyLocale(),
    }),
    message({
      key: 'edge.tags',
      source: 'tags',
      kind: 'markup',
      args: [
        { name: '9b', type: { kind: 'markup' } },
        { name: 'class', type: { kind: 'markup' } },
        { name: 'empty', type: { kind: 'markup' } },
      ],
      bodies: [
        body('en', [
          text('a'),
          markup('9b', [text('b'), markup('class', [text('c')])]),
          markup('empty', []),
          text('d'),
        ]),
      ],
      origins: everyLocale(),
    }),
    message({
      key: 'edge.blank',
      source: '',
      kind: 'markup',
      args: [{ name: 'b', type: { kind: 'markup' } }],
      bodies: [body('en', [])],
      origins: everyLocale(),
    }),
    simple('edge.constructor', 'edge_constructor', 'ctor member'),
    simple('edge.toString', 'edge_toString', 'tostring member'),
    simple('edge.__proto__', 'edge___proto__', 'proto member'),
    simple('edge.hasOwnProperty', 'edge_hasOwnProperty', 'own member'),
    simple('edge.1st', 'edge_1st', 'first member'),
    simple('edge.class', 'edge_class', 'class member'),
  ]
}

const PROTO_GROUP: Group = {
  name: 'edge',
  id: 'edge',
  typeBase: 'Edge',
  prefix: 'edge',
  members: [
    { key: 'edge.toString', id: 'edge_toString', member: 'toString' },
    { key: 'edge.__proto__', id: 'edge___proto__', member: '__proto__' },
    { key: 'edge.constructor', id: 'edge_constructor', member: 'constructor' },
    { key: 'edge.hasOwnProperty', id: 'edge_hasOwnProperty', member: 'hasOwnProperty' },
    { key: 'edge.1st', id: 'edge_1st', member: '1st' },
    { key: 'edge.class', id: 'edge_class', member: 'class' },
  ],
}

function edgeProgram(): Program {
  return program({
    messages: messages(),
    groups: [PROTO_GROUP],
    config: config({ locales: LOCALES, groups: { edge: 'edge' }, cookie: "lang'\n\u2028" }),
  })
}

function interleaved<T>(values: readonly T[]): readonly T[] {
  const even = values.filter((_, index) => index % 2 === 0)
  const odd = values.filter((_, index) => index % 2 === 1)
  return [...odd, ...even.reverse()]
}

function shuffled(source: Program): Program {
  return {
    ...source,
    locales: interleaved(source.locales),
    messages: interleaved(
      source.messages.map((entry) => ({
        ...entry,
        bodies: interleaved(entry.bodies),
        origins: interleaved(entry.origins),
        spans: interleaved(entry.spans),
      })),
    ),
    groups: source.groups.map((group) => ({ ...group, members: interleaved(group.members) })),
  }
}

type Generated = Record<string, (args?: Record<string, unknown>, opts?: { locale?: string }) => unknown>

describe('the edge tree, executed', () => {
  let root = ''
  let generated: Generated = {}
  let groups: Record<string, Generated> = {}

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'loclizr-emit-edge-'))
    const emitted = emit(edgeProgram())
    expect(emitted.diagnostics).toEqual([])
    await writeFile(join(root, 'package.json'), '{ "type": "module" }\n', 'utf8')
    for (const file of emitted.files) {
      const absolute = join(root, file.path)
      await mkdir(dirname(absolute), { recursive: true })
      await writeFile(absolute, file.contents.replaceAll("from 'loclizr'", `from '${RUNTIME}'`), 'utf8')
    }
    generated = (await import(pathToFileURL(join(root, 'messages/edge.js')).href)) as Generated
    groups = (await import(pathToFileURL(join(root, 'groups.js')).href)) as Record<string, Generated>
  })

  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  const render = (id: string, args: Record<string, unknown> = {}, tag = 'en'): unknown =>
    generated[id]?.(args, { locale: tag })

  describe('catalog text', () => {
    test('renders every hostile character exactly as the catalog held it', () => {
      expect(render('edge_hostile')).toBe(HOSTILE)
    })

    test('renders the translated arm of a locale carrying an extension subtag', () => {
      expect(render('edge_hostile', {}, 'de-u-co-phonebk')).toBe(`phonebook ${HOSTILE}`)
    })

    test('renders the inherited arm for a request in odd casing', () => {
      expect(render('edge_hostile', {}, 'ZH-hant-tw')).toBe(`phonebook ${HOSTILE}`)
    })

    test('renders the source arm for a locale that fell back', () => {
      expect(render('edge_hostile', {}, 'ar')).toBe(HOSTILE)
    })

    test('renders a hundred thousand characters intact', () => {
      expect(render('edge_long')).toBe(LONG)
    })
  })

  describe('deep nesting', () => {
    test('reaches the innermost of eight nested selects', () => {
      const expected = `${Array.from({ length: DEPTH }, (_, level) => `${level}>`).join('')}bottom`
      expect(render('edge_deep', { s: 'x' })).toBe(expected)
    })

    test('stops at the outermost level when the first select misses', () => {
      expect(render('edge_deep', { s: 'y' })).toBe('stop at 0')
    })
  })

  describe('numbers at the limits', () => {
    test('matches an exact branch for zero and for negative zero', () => {
      expect(render('edge_count', { count: 0 })).toBe('none')
      expect(render('edge_count', { count: -0 })).toBe('none')
    })

    test('matches a negative exact branch', () => {
      expect(render('edge_count', { count: -1 })).toBe('minus one')
    })

    test('matches an exact branch whose value prints in exponent form', () => {
      expect(render('edge_count', { count: 1e21 })).toBe('sextillion')
    })

    test('formats the largest safe integer through the keyword branch', () => {
      expect(render('edge_count', { count: Number.MAX_SAFE_INTEGER })).toBe('9,007,199,254,740,991 items')
    })

    test('renders NaN and Infinity through the other branch without throwing', () => {
      expect(render('edge_count', { count: Number.NaN })).toBe('NaN items')
      expect(render('edge_count', { count: Infinity })).toBe('\u221E items')
    })

    test('formats the pound with the requesting locale in a fallback arm', () => {
      expect(render('edge_count', { count: 1234.5 }, 'de')).toBe('1.234,5 items')
    })

    test('tests the exact branch before applying the offset', () => {
      expect(render('edge_offset', { count: 2 })).toBe('exactly two')
    })

    test('renders a negative pound when the value sits below the offset', () => {
      expect(render('edge_offset', { count: 1 })).toBe('one more: -1')
    })

    test('selects the category from the offset value', () => {
      expect(render('edge_offset', { count: 3 })).toBe('one more: 1')
      expect(render('edge_offset', { count: 7 })).toBe('more: 5')
    })
  })

  describe('argument and option names', () => {
    test('reads reserved, prototype, non-Latin and digit-led argument names', () => {
      const args = { '9x': 'nine', class: 'klass', constructor: 'ctor', toString: 'ts', '\u00E4': 'umlaut' }
      expect(render('edge_names', args)).toBe('nine|klass|ctor|ts|umlaut')
    })

    test('matches select options named after Object.prototype members', () => {
      expect(render('edge_pick', { v: '__proto__' })).toBe('proto')
      expect(render('edge_pick', { v: 'constructor' })).toBe('ctor')
      expect(render('edge_pick', { v: 'toString' })).toBe('tostring')
    })

    test('matches options holding a quote or a decomposed accent', () => {
      expect(render('edge_pick', { v: "it's" })).toBe('quote')
      expect(render('edge_pick', { v: 'cafe\u0301' })).toBe('decomposed')
    })

    test('treats the composed spelling of a decomposed option as a different option', () => {
      expect(render('edge_pick', { v: 'caf\u00E9' })).toBe('other')
    })

    test('matches a numeric-looking option only by its string', () => {
      expect(render('edge_pick', { v: '1' })).toBe('one')
      expect(render('edge_pick', { v: 1 })).toBe('other')
    })

    test('falls through to other for a prototype name no branch declared', () => {
      expect(render('edge_pick', { v: 'hasOwnProperty' })).toBe('other')
    })
  })

  describe('formats', () => {
    test('two option sets written in different key orders format the same', () => {
      expect(render('edge_money', { n: 3.5 })).toBe(render('edge_cash', { n: 3.5 }))
      expect(render('edge_money', { n: 3.5 })).toBe('\u20AC3.50')
    })
  })

  describe('markup', () => {
    test('calls handlers named by non-identifiers and reserved words, nested and empty', () => {
      const tag =
        (name: string) =>
        (chunks: readonly unknown[]): unknown => ({ name, chunks })
      const parts = render('edge_tags', { '9b': tag('9b'), class: tag('class'), empty: tag('empty') })
      expect(parts).toEqual([
        'a',
        { name: '9b', chunks: ['b', { name: 'class', chunks: ['c'] }] },
        { name: 'empty', chunks: [] },
        'd',
      ])
    })

    test('returns a one element array holding the empty string for a blank markup body', () => {
      expect(render('edge_blank', { b: () => null })).toEqual([''])
    })
  })

  describe('the group record', () => {
    test('holds exactly the members, in code point order, as own keys', () => {
      expect(Reflect.ownKeys(groups['edge'] ?? {})).toEqual([
        '1st',
        '__proto__',
        'class',
        'constructor',
        'hasOwnProperty',
        'toString',
      ])
    })

    test('has no prototype and is frozen', () => {
      const record = groups['edge'] ?? {}
      expect(Object.getPrototypeOf(record)).toBeNull()
      expect(Object.isFrozen(record)).toBe(true)
    })

    test('calls each prototype-named member as its own message', () => {
      const record = groups['edge'] ?? {}
      expect(record['__proto__']?.()).toBe('proto member')
      expect(record['constructor']?.()).toBe('ctor member')
      expect(record['toString']?.()).toBe('tostring member')
      expect(record['hasOwnProperty']?.()).toBe('own member')
      expect(record['1st']?.()).toBe('first member')
    })
  })

  describe('the locale module', () => {
    test('exports the locale list sorted by code point', async () => {
      const module = (await import(pathToFileURL(join(root, 'messages/_locale.js')).href)) as {
        locales: readonly string[]
      }
      expect(module.locales).toEqual(['ar', 'de', 'de-u-co-phonebk', 'en', 'zh-Hant-TW'])
    })
  })
})

describe('the edge tree, as text', () => {
  const files = emit(edgeProgram()).files

  test('writes no raw CR, line separator or paragraph separator into any file', () => {
    for (const file of files) expect(file.contents, file.path).not.toMatch(RAW_TERMINATOR)
  })

  test('writes no unpaired surrogate into any file', () => {
    for (const file of files) expect(file.contents, file.path).not.toMatch(LONE_SURROGATE)
  })

  test('hoists one format const for two option sets that differ only in key order', () => {
    const formats = contentsOf(files, 'messages/_formats.js')
    expect(formats.match(/'EUR'/gu)).toHaveLength(1)
    expect(formats).toContain("Object.freeze({ currency: 'EUR', style: 'currency' })")
  })

  test('escapes a cookie name holding a quote and line terminators', () => {
    expect(contentsOf(files, 'messages/_locale.js')).toContain("export const cookie = 'lang\\'\\n\\u2028'")
  })

  test('labels cases with the declared tag verbatim, extension subtag included', () => {
    const module = contentsOf(files, 'messages/edge.js')
    expect(module).toContain("    case 'de-u-co-phonebk':\n    case 'zh-Hant-TW':\n")
  })

  test('emits no case label at all for a message every locale fell back on', () => {
    const module = contentsOf(files, 'messages/edge.js')
    const chunk = module.split('\n\n').find((part) => part.startsWith('export function edge_long('))
    expect(chunk).toBeDefined()
    expect(chunk).not.toContain('case ')
  })

  test('reaches a digit-led handler by subscript and calls an empty tag with no chunks', () => {
    const module = contentsOf(files, 'messages/edge.js')
    expect(module).toContain("args['9b'](['b', args.class(['c'])])")
    expect(module).toContain('args.empty([])')
  })

  test('declares the digit-led member of the lookup tier as a quoted property', () => {
    const types = contentsOf(files, 'groups.d.ts')
    expect(types).toContain("export type EdgeKey = '1st' | '__proto__' | 'class' | 'constructor' | 'hasOwnProperty' | 'toString'")
    expect(types).toContain("  '1st': EmptyArgs")
  })
})

describe('determinism over the edge tree', () => {
  test('emits the same bytes from an interleaved rather than reversed input', () => {
    const plain = emit(edgeProgram())
    const mixed = emit(shuffled(edgeProgram()))
    expect(mixed.diagnostics).toEqual([])
    expect(mixed.files).toEqual(plain.files)
  })

  test('emits the same bytes twice in a row', () => {
    expect(emit(edgeProgram()).files).toEqual(emit(edgeProgram()).files)
  })
})

describe('code point ordering', () => {
  const at = (key: string, id: string): Message => simple(key, id, id)

  test('orders a BMP key above the surrogate range before an astral key', () => {
    const files = emit(
      program({
        messages: [at('x.\u{1F600}', 'x_astral'), at('x.\uFFFD', 'x_bmp')],
        config: config({ locales: ['en'] }),
      }),
    ).files
    const module = contentsOf(files, 'messages/x.js')
    expect(module.indexOf('function x_bmp(')).toBeLessThan(module.indexOf('function x_astral('))
  })

  test('orders namespaces in the barrel by module path, upper case first', () => {
    const files = emit(
      program({
        messages: [at('b.k', 'b_k'), at('root', 'root'), at('Z.k', 'Z_k'), at('a.k', 'a_k')],
        config: config({ locales: ['en'] }),
      }),
    ).files
    const exports = contentsOf(files, 'messages.js')
      .split('\n')
      .filter((line) => line.startsWith('export * from'))
    expect(exports).toEqual([
      "export * from './messages/Z.js'",
      "export * from './messages/_root.js'",
      "export * from './messages/a.js'",
      "export * from './messages/b.js'",
    ])
  })

  test('keeps the source locale under default even when it sorts first', () => {
    const greeting = message({
      key: 'x.hi',
      source: 'a',
      bodies: [body('aa', [text('source')]), body('zz', [text('target')])],
      origins: [translated('aa'), translated('zz')],
    })
    const files = emit(
      program({
        messages: [greeting],
        config: config({ locales: ['zz', 'aa'], sourceLocale: 'aa' }),
      }),
    ).files
    expect(contentsOf(files, 'messages/x.js')).toContain(
      "    case 'zz':\n      return `target`\n    default:\n      return `source`\n",
    )
  })
})

describe('the determinism diagnostic', () => {
  const twins = (outDir: string): Program => {
    const twin = (id: string, value: string): Message =>
      message({
        key: 'nav.home',
        identifier: id,
        source: value,
        bodies: [body('en', [text(value)])],
        origins: [translated('en')],
      })
    return program({
      messages: [twin('nav_first', 'First'), twin('nav_second', 'Second')],
      config: config({ locales: ['en'], outDir }),
    })
  }

  test('names the bare path when outDir is empty', () => {
    expect(emit(twins('')).diagnostics[0]?.file).toBe('messages/nav.d.ts')
  })

  test('joins with one slash however many trail outDir', () => {
    expect(emit(twins('out///')).diagnostics[0]?.file).toBe('out/messages/nav.d.ts')
  })
})

describe('a message whose only number is a pound', () => {
  const files = emit(
    program({
      messages: [
        message({
          key: 'x.n',
          source: 'n',
          args: [{ name: 'n', type: { kind: 'number' } }],
          bodies: [
            body('en', [
              plural('n', {
                branches: [
                  { keyword: 'one', body: [pound(), text(' thing')] },
                  { keyword: 'other', body: [pound(), text(' things')] },
                ],
              }),
            ]),
          ],
          origins: [translated('en')],
        }),
      ],
      config: config({ locales: ['en'] }),
    }),
  ).files

  test('hoists the empty option set once and imports it', () => {
    const formats = contentsOf(files, 'messages/_formats.js')
    expect(formats).toMatch(/^export const \$f[0-9a-f]{16} = \/\*#__PURE__\*\/ Object\.freeze\(\{\}\)$/mu)
    expect(contentsOf(files, 'messages/x.js')).toMatch(/^import \{ \$f[0-9a-f]{16} \} from '\.\/_formats\.js'$/mu)
  })

  test('imports both runtime helpers it calls and nothing else', () => {
    expect(contentsOf(files, 'messages/x.js')).toContain("import { $number1, $plural1 } from 'loclizr'")
  })
})

describe('a plural with exact branches only', () => {
  const files = emit(
    program({
      messages: [
        message({
          key: 'x.e',
          source: 'e',
          args: [{ name: 'n', type: { kind: 'number' } }],
          bodies: [
            body('en', [
              plural('n', {
                exact: [{ value: 0, body: [text('zero')] }],
                branches: [{ keyword: 'other', body: [text('some')] }],
              }),
            ]),
          ],
          origins: [translated('en')],
        }),
      ],
      config: config({ locales: ['en'] }),
    }),
  ).files

  test('calls no plural rules and imports no runtime helper', () => {
    const module = contentsOf(files, 'messages/x.js')
    expect(module).not.toContain('$plural1')
    expect(module).not.toContain("from 'loclizr'")
  })

  test('tests the exact value through the selector local', () => {
    expect(contentsOf(files, 'messages/x.js')).toContain('if (n0 === 0) return `zero`')
  })
})
