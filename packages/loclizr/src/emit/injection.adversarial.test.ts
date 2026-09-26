import { describe, expect, test } from 'vitest'
import type { Arg, EmittedFile, Group, Message, Node } from '../types'
import { emit } from './index'
import {
  arg,
  body,
  choice,
  config,
  message,
  num,
  plural,
  program,
  text,
  translated,
} from './__fixtures__/program'

type Arm = (args: Readonly<Record<string, unknown>>) => unknown

const LINE_SEPARATOR = ' '

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
      config: config({ locales: ['en'], groups: groups.length === 0 ? {} : { errors: 'errors' } }),
    }),
  ).files
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

// Generated modules are ESM the app imports, so a module that does not parse is
// a build failure no diagnostic reports.
function parse(source: string): void {
  const script = source
    .split('\n')
    .filter((line) => !line.startsWith('import '))
    .map((line) => line.replace(/^export /u, ''))
    .join('\n')
  new Function(`'use strict';\n${script}`)
}

describe('catalog text reaching generated code', () => {
  const hostile = `Backtick \` and \${args.count} and a backslash \\ and a quote ' and ${LINE_SEPARATOR} a separator`

  test('renders a value carrying template syntax as the literal text the catalog held', () => {
    const files = english(
      message({
        key: 'dev.hostile',
        source: hostile,
        args: [{ name: 'count', type: { kind: 'stringish' } }],
        bodies: [body('en', [text(hostile), arg('count')])],
        origins: [translated('en')],
      }),
    )
    const arm = compileArm(contentsOf(files, 'messages/dev.js'), 'dev_hostile', 'en')
    expect(arm({ count: 7 })).toBe(`${hostile}7`)
  })

  test('keeps a quote and a backslash inside a select option matchable', () => {
    const option = "it's \\ odd"
    const files = english(
      message({
        key: 'order.odd',
        source: 'odd',
        args: [{ name: 'state', type: { kind: 'select', options: [option] } }],
        bodies: [
          body('en', [
            choice('state', [
              { option, body: [text('matched')] },
              { option: 'other', body: [text('fell through')] },
            ]),
          ]),
        ],
        origins: [translated('en')],
      }),
    )
    const arm = compileArm(contentsOf(files, 'messages/order.js'), 'order_odd', 'en')
    expect(arm({ state: option })).toBe('matched')
  })

  test('never writes a carriage return into an emitted file', () => {
    const files = english(
      message({
        key: 'dev.windows',
        source: 'One\r\nTwo',
        bodies: [body('en', [text('One\r\nTwo')])],
        origins: [translated('en')],
      }),
    )
    for (const file of files) expect(file.contents).not.toContain('\r')
  })

  test('renders a value carrying a carriage return unchanged', () => {
    const files = english(
      message({
        key: 'dev.windows',
        source: 'One\r\nTwo',
        bodies: [body('en', [text('One\r\nTwo')])],
        origins: [translated('en')],
      }),
    )
    const arm = compileArm(contentsOf(files, 'messages/dev.js'), 'dev_windows', 'en')
    expect(arm({})).toBe('One\r\nTwo')
  })

  test('keeps a doc comment closed against a source string that would end it', () => {
    const files = english(
      message({
        key: 'dev.snippet',
        source: 'Matches /x*/ then */ again',
        bodies: [body('en', [text('x')])],
        origins: [translated('en')],
      }),
    )
    const declarations = contentsOf(files, 'messages/dev.d.ts')
    const comment = declarations.split('\n').find((line) => line.startsWith('/**')) ?? ''
    expect(comment.indexOf('*/')).toBe(comment.length - 2)
  })
})

// Text nodes are concatenated into one template literal, and a branch whose
// bodies all render alike collapses into the enclosing one with no wrapper, so
// a node ending in `$` meets the next node's `{`. The catalog values these node
// trees come from are `{n, plural, other {$}}'{args.n}'` and its siblings.
describe('a dollar and a brace in two text nodes', () => {
  const COUNT: Arg = { name: 'n', type: { kind: 'number' } }
  const STATE: Arg = { name: 'state', type: { kind: 'select', options: [] } }

  function split(nodes: readonly Node[], args: readonly Arg[]): string {
    const files = english(
      message({
        key: 'dev.split',
        source: 'split',
        args,
        bodies: [body('en', nodes)],
        origins: [translated('en')],
      }),
    )
    return contentsOf(files, 'messages/dev.js')
  }

  function collapsedPlural(value: string): Node {
    return plural('n', { branches: [{ keyword: 'other', body: [text(value)] }] })
  }

  function collapsedSelect(value: string): Node {
    return choice('state', [{ option: 'other', body: [text(value)] }])
  }

  test('renders what a collapsed plural left beside a brace as the text it is', () => {
    const module = split([collapsedPlural('$'), text('{opts}')], [COUNT])
    expect(compileArm(module, 'dev_split', 'en')({ n: 1 })).toBe('${opts}')
  })

  test('renders what a collapsed select left beside a brace as the text it is', () => {
    const module = split([collapsedSelect('$'), text('{opts}')], [STATE])
    expect(compileArm(module, 'dev_split', 'en')({ state: 'any' })).toBe('${opts}')
  })

  test('reads no argument the catalog text was never given', () => {
    const module = split([collapsedPlural('$'), text('{args.n}')], [COUNT])
    expect(compileArm(module, 'dev_split', 'en')({ n: 42 })).toBe('${args.n}')
  })

  test('keeps the module parseable when the brace run never closes', () => {
    expect(() => parse(split([collapsedPlural('$'), text('{')], [COUNT]))).not.toThrow()
  })

  test('escapes a dollar that ends a longer branch body', () => {
    const module = split([collapsedPlural('price: $'), text('{opts}')], [COUNT])
    expect(compileArm(module, 'dev_split', 'en')({ n: 1 })).toBe('price: ${opts}')
  })

  test('escapes a dollar where two collapsed branches meet', () => {
    const module = split([collapsedPlural('$'), collapsedSelect('{args.n}')], [COUNT, STATE])
    expect(compileArm(module, 'dev_split', 'en')({ n: 42, state: 'any' })).toBe('${args.n}')
  })

  test('renders an ordinary dollar in top level text unchanged', () => {
    const module = split([text('Costs $5, or $ if free')], [])
    expect(compileArm(module, 'dev_split', 'en')({})).toBe('Costs $5, or $ if free')
  })
})

// UTF-8 cannot encode half a surrogate pair, so a raw one lands as U+FFFD and
// the tree never settles: every build rewrites it and check calls it stale.
describe('text the filesystem cannot carry back', () => {
  const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u
  const half = 'half a surrogate: \uD800 and a lone low \uDC00'

  function oddMessage(): Message {
    return message({
      key: 'dev.odd',
      source: half,
      args: [{ name: 'state', type: { kind: 'select', options: [half] } }],
      bodies: [
        body('en', [
          text(half),
          choice('state', [
            { option: half, body: [text(half)] },
            { option: 'other', body: [text('fell through')] },
          ]),
        ]),
      ],
      origins: [translated('en')],
    })
  }

  test('writes no unpaired surrogate into any emitted file', () => {
    for (const file of english(oddMessage())) expect(file.contents).not.toMatch(LONE_SURROGATE)
  })

  test('escapes it in the doc comment the declaration carries', () => {
    const declarations = contentsOf(english(oddMessage()), 'messages/dev.d.ts')
    expect(declarations).toContain('\\ud800')
    expect(declarations).not.toMatch(LONE_SURROGATE)
  })

  test('renders the unpaired surrogate the catalog held, unchanged', () => {
    const arm = compileArm(contentsOf(english(oddMessage()), 'messages/dev.js'), 'dev_odd', 'en')
    expect(arm({ state: half })).toBe(`${half}${half}`)
  })

  test('leaves a whole astral character alone rather than splitting it', () => {
    const emoji = 'a whole emoji: \u{1F600}'
    const files = english(
      message({
        key: 'dev.emoji',
        source: emoji,
        bodies: [body('en', [text(emoji)])],
        origins: [translated('en')],
      }),
    )
    expect(contentsOf(files, 'messages/dev.js')).toContain(emoji)
    expect(compileArm(contentsOf(files, 'messages/dev.js'), 'dev_emoji', 'en')({})).toBe(emoji)
  })
})

describe('names the compiler did not choose', () => {
  test('emits a parseable group record for a member property named __proto__', () => {
    const group: Group = {
      name: 'errors',
      id: 'errors',
      typeBase: 'Errors',
      prefix: 'errors',
      members: [{ key: 'errors.__proto__', id: 'errors___proto__', member: '__proto__' }],
    }
    const files = english(
      message({
        key: 'errors.__proto__',
        source: 'Denied',
        identifier: 'errors___proto__',
        bodies: [body('en', [text('Denied')])],
        origins: [translated('en')],
      }),
      [group],
    )
    expect(() => parse(contentsOf(files, 'groups.js'))).not.toThrow()
  })

  test('emits a parseable format module for an option key that is not an identifier', () => {
    const files = english(
      message({
        key: 'cart.total',
        source: 'Total: {amount, number, odd}',
        args: [{ name: 'amount', type: { kind: 'number' } }],
        bodies: [
          body('en', [text('Total: '), num('amount', 'odd', { 'maximum-fraction-digits': 1 })]),
        ],
        origins: [translated('en')],
      }),
    )
    expect(() => parse(contentsOf(files, 'messages/_formats.js'))).not.toThrow()
  })

  test('reaches an argument name carrying a quote through a subscript', () => {
    const name = "it's"
    const files = english(
      message({
        key: 'dev.odd',
        source: 'odd',
        args: [{ name, type: { kind: 'stringish' } }],
        bodies: [body('en', [arg(name)])],
        origins: [translated('en')],
      }),
    )
    const arm = compileArm(contentsOf(files, 'messages/dev.js'), 'dev_odd', 'en')
    expect(arm({ [name]: 'ok' })).toBe('ok')
  })
})
