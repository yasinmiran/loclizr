import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import type { Arg, EmittedFile, Group, Message, Program, Span } from '../types'
import { emit, reverseForReplay } from './index'
import { HEADER } from './shared'
import { acceptanceProgram } from './__fixtures__/acceptance'
import {
  ERRORS_GROUP,
  arg,
  body,
  choice,
  config,
  fellBack,
  inherited,
  markup,
  message,
  plural,
  pound,
  program,
  text,
  translated,
  workedExample,
} from './__fixtures__/program'

const SPANLESS: Span = { line: 1, column: 1, offset: 0, length: 0 }

const FIXTURES = fileURLToPath(new URL('./__fixtures__/', import.meta.url))
const GENERATED_TREE = fileURLToPath(new URL('../../test/typecheck-fixture/src/loclizr/', import.meta.url))

function contentsOf(files: readonly EmittedFile[], path: string): string {
  const file = files.find((candidate) => candidate.path === path)
  if (file === undefined) throw new Error(`no emitted file at ${path}`)
  return file.contents
}

function tree(files: readonly EmittedFile[]): string {
  return files.map((file) => `===== ${file.path}\n${file.contents}`).join('')
}

function lines(...values: readonly string[]): string {
  return values.join('\n')
}

function only(parts: {
  readonly message: Message
  readonly locales?: readonly string[]
  readonly groups?: readonly Group[]
  readonly augmentLocale?: boolean
}): readonly EmittedFile[] {
  const resolved = config({
    locales: parts.locales ?? ['en', 'de', 'de-AT'],
    ...(parts.augmentLocale === undefined ? {} : { augmentLocale: parts.augmentLocale }),
  })
  const result = emit(
    program({ messages: [parts.message], config: resolved, ...(parts.groups === undefined ? {} : { groups: parts.groups }) }),
  )
  expect(result.diagnostics).toEqual([])
  return result.files
}

function walkFiles(directory: string, prefix = ''): readonly string[] {
  const found: string[] = []
  for (const entry of readdirSync(directory).sort()) {
    const absolute = join(directory, entry)
    const path = prefix === '' ? entry : `${prefix}/${entry}`
    if (statSync(absolute).isDirectory()) found.push(...walkFiles(absolute, path))
    else found.push(path)
  }
  return found
}

describe('the worked example', () => {
  const files = emit(workedExample()).files

  test('emits the worked example tree byte for byte', () => {
    expect(tree(files)).toBe(readFileSync(join(FIXTURES, 'worked-example.txt'), 'utf8'))
  })

  test('raises no diagnostics', () => {
    expect(emit(workedExample()).diagnostics).toEqual([])
  })

  test('writes the self-ignoring .gitignore with no generated header', () => {
    expect(contentsOf(files, '.gitignore')).toBe('*\n!.gitignore\n')
  })

  test('starts every other file with the generated header as line 1', () => {
    for (const file of files) {
      if (file.path === '.gitignore') continue
      expect(file.contents.startsWith(`${HEADER}\n`)).toBe(true)
    }
  })

  test('opts every .js out of checkJs on line 2 and leaves every .d.ts checked', () => {
    for (const file of [...files, ...emit(acceptanceProgram()).files]) {
      if (file.path.endsWith('.js')) expect(file.contents.startsWith(`${HEADER}\n// @ts-nocheck\n`)).toBe(true)
      else expect(file.contents).not.toContain('@ts-nocheck')
    }
  })

  test('names every hoisted format by the hash of its canonical options', () => {
    expect(contentsOf(files, 'messages/_formats.js')).toBe(
      lines(
        HEADER,
        '// @ts-nocheck',
        'export const $f44136fa355b3678a = /*#__PURE__*/ Object.freeze({})',
        "export const $f56d532f63ea89042 = /*#__PURE__*/ Object.freeze({ currency: 'USD', style: 'currency' })",
        "export const $f67d978756bf2d048 = /*#__PURE__*/ Object.freeze({ dateStyle: 'medium' })",
        '',
      ),
    )
  })

  test('declares one const per distinct option set and shares it across namespaces', () => {
    const shared = '$f44136fa355b3678a'
    expect(contentsOf(files, 'messages/_formats.js').split(shared).length - 1).toBe(1)
    expect(contentsOf(files, 'messages/cart.js')).toContain(`import { ${shared},`)
    expect(contentsOf(files, 'messages/errors.js')).toContain(`import { ${shared} } from './_formats.js'`)
  })
})

describe('locale arms', () => {
  test('gives one arm per distinct body, with the source locale under default', () => {
    const files = only({
      message: message({
        key: 'nav.home',
        source: 'Home',
        bodies: [body('en', [text('Home')]), body('de', [text('Startseite')])],
        origins: [translated('en'), translated('de'), inherited('de-AT', 'de')],
      }),
    })
    expect(contentsOf(files, 'messages/nav.js')).toContain(
      lines(
        'export function nav_home(args, opts) {',
        '  switch ($l(opts)) {',
        "    case 'de':",
        "    case 'de-AT':",
        '      return `Startseite`',
        '    default:',
        '      return `Home`',
        '  }',
        '}',
      ),
    )
  })

  test('folds a locale whose body equals the source body into default', () => {
    const files = only({
      message: message({
        key: 'nav.home',
        source: 'Home',
        bodies: [body('en', [text('Home')]), body('de', [text('Home')])],
        origins: [translated('en'), translated('de'), inherited('de-AT', 'de')],
      }),
    })
    expect(contentsOf(files, 'messages/nav.js')).toContain(
      lines('  switch ($l(opts)) {', '    default:', '      return `Home`', '  }'),
    )
  })

  test('emits arm N from bodies[origin.from] and never from the locale own body', () => {
    const files = only({
      message: message({
        key: 'nav.home',
        source: 'Home',
        bodies: [
          body('en', [text('Home')]),
          body('de', [text('Startseite')]),
          // Present, lowered, and unusable: M4 stamped this locale `invalid`.
          body('de-AT', [text('NEVER RENDERED')]),
        ],
        origins: [translated('en'), translated('de'), fellBack('de-AT', 'en', 'invalid')],
      }),
    })
    const module = contentsOf(files, 'messages/nav.js')
    expect(module).not.toContain('NEVER RENDERED')
    expect(module).toContain(lines("    case 'de':", '      return `Startseite`', '    default:'))
  })

  test('sorts case labels by locale tag', () => {
    const files = only({
      message: message({
        key: 'nav.home',
        source: 'Home',
        bodies: [body('en', [text('Home')]), body('de', [text('D')]), body('ar', [text('A')])],
        origins: [translated('en'), translated('de'), translated('ar')],
      }),
      locales: ['en', 'de', 'ar'],
    })
    const module = contentsOf(files, 'messages/nav.js')
    expect(module.indexOf("case 'ar':")).toBeLessThan(module.indexOf("case 'de':"))
  })

  test('emits an empty template for a source body with no nodes', () => {
    const files = only({
      message: message({
        key: 'nav.blank',
        source: '',
        bodies: [body('en', [])],
        origins: [translated('en'), fellBack('de', 'en', 'missing'), fellBack('de-AT', 'en', 'missing')],
      }),
      locales: ['en', 'de', 'de-AT'],
    })
    expect(contentsOf(files, 'messages/nav.js')).toContain('      return ``')
  })
})

describe('plurals', () => {
  test('tests exact branches against the un-offset value and offsets the category lookup', () => {
    const files = only({
      message: message({
        key: 'cart.items',
        source: 'items',
        args: [{ name: 'count', type: { kind: 'number' } }],
        bodies: [
          body('en', [
            plural('count', {
              offset: 2,
              exact: [{ value: 0, body: [text('none')] }],
              branches: [
                { keyword: 'one', body: [pound(), text(' left')] },
                { keyword: 'other', body: [pound(), text(' left over')] },
              ],
            }),
          ]),
        ],
        origins: [translated('en')],
      }),
      locales: ['en'],
    })
    expect(contentsOf(files, 'messages/cart.js')).toContain(
      lines(
        '  const l = $l(opts)',
        '  const n0 = args.count',
        '  switch (l) {',
        '    default:',
        '      if (n0 === 0) return `none`',
        "      switch ($plural1('en', n0 - 2, false)) {",
        "        case 'one':",
        '          return `${$number1(l, n0 - 2, $f44136fa355b3678a)} left`',
        '        default:',
        '          return `${$number1(l, n0 - 2, $f44136fa355b3678a)} left over`',
        '      }',
        '  }',
      ),
    )
  })

  test('selects the ordinal rules for a selectordinal node', () => {
    const files = only({
      message: message({
        key: 'race.place',
        source: 'place',
        args: [{ name: 'rank', type: { kind: 'number' } }],
        bodies: [
          body('en', [
            plural('rank', {
              ordinal: true,
              branches: [
                { keyword: 'two', body: [pound(), text('nd')] },
                { keyword: 'other', body: [pound(), text('th')] },
              ],
            }),
          ]),
        ],
        origins: [translated('en')],
      }),
      locales: ['en'],
    })
    expect(contentsOf(files, 'messages/race.js')).toContain("switch ($plural1('en', n0, true)) {")
  })

  test('collapses the category lookup when every keyword branch renders the same', () => {
    const files = only({
      message: message({
        key: 'cart.items',
        source: 'items',
        args: [{ name: 'count', type: { kind: 'number' } }],
        bodies: [
          body('en', [
            plural('count', {
              exact: [{ value: 0, body: [text('empty')] }],
              branches: [
                { keyword: 'one', body: [arg('count'), text(' Artikel')] },
                { keyword: 'other', body: [arg('count'), text(' Artikel')] },
              ],
            }),
          ]),
        ],
        origins: [translated('en')],
      }),
      locales: ['en'],
    })
    const module = contentsOf(files, 'messages/cart.js')
    expect(module).not.toContain('$plural1')
    expect(module).toContain(
      lines('      if (n0 === 0) return `empty`', '      return `${args.count} Artikel`'),
    )
  })

  test('keeps an exact branch that differs from the collapsed body', () => {
    const files = only({
      message: message({
        key: 'cart.items',
        source: 'items',
        args: [{ name: 'count', type: { kind: 'number' } }],
        bodies: [
          body('en', [
            plural('count', {
              exact: [{ value: 0, body: [text('same')] }],
              branches: [
                { keyword: 'one', body: [text('same')] },
                { keyword: 'other', body: [text('same')] },
              ],
            }),
          ]),
        ],
        origins: [translated('en')],
      }),
      locales: ['en'],
    })
    const module = contentsOf(files, 'messages/cart.js')
    expect(module).not.toContain('if (n0 === 0)')
    expect(module).not.toContain('const n0')
  })

  test('numbers one local per plural selector and never reuses one name', () => {
    const files = only({ message: siblingPlurals(), locales: ['en'] })
    expect(contentsOf(files, 'messages/cart.js')).toBe(
      lines(
        HEADER,
        '// @ts-nocheck',
        "import { $number1, $plural1 } from 'loclizr'",
        "import { $f44136fa355b3678a } from './_formats.js'",
        "import { $l } from './_locale.js'",
        '',
        'export function cart_counts(args, opts) {',
        '  const l = $l(opts)',
        '  const n0 = args.files',
        '  const n1 = args.folders',
        '  switch (l) {',
        '    default:',
        '      return `${',
        "        $plural1('en', n0, false) === 'one'",
        '          ? `${$number1(l, n0, $f44136fa355b3678a)} file`',
        '          : `${$number1(l, n0, $f44136fa355b3678a)} files`',
        '      } in ${',
        "        $plural1('en', n1, false) === 'one'",
        '          ? `${$number1(l, n1, $f44136fa355b3678a)} folder`',
        '          : `${$number1(l, n1, $f44136fa355b3678a)} folders`',
        '      }`',
        '  }',
        '}',
        '',
      ),
    )
  })

  test('opens a block for an exact branch that is itself a plural', () => {
    const files = only({
      message: message({
        key: 'cart.items',
        source: 'items',
        args: [
          { name: 'count', type: { kind: 'number' } },
          { name: 'boxes', type: { kind: 'number' } },
        ],
        bodies: [
          body('en', [
            plural('count', {
              exact: [
                {
                  value: 0,
                  body: [
                    plural('boxes', {
                      branches: [
                        { keyword: 'one', body: [text('one empty box')] },
                        { keyword: 'other', body: [text('empty boxes')] },
                      ],
                    }),
                  ],
                },
              ],
              branches: [{ keyword: 'other', body: [text('full')] }],
            }),
          ]),
        ],
        origins: [translated('en')],
      }),
      locales: ['en'],
    })
    expect(contentsOf(files, 'messages/cart.js')).toContain(
      lines(
        '      if (n0 === 0) {',
        "        switch ($plural1('en', n1, false)) {",
        "          case 'one':",
        '            return `one empty box`',
        '          default:',
        '            return `empty boxes`',
        '        }',
        '      }',
        '      return `full`',
      ),
    )
  })

  test('resolves # to the innermost enclosing plural', () => {
    const files = only({ message: nestedPlurals(), locales: ['en'] })
    expect(contentsOf(files, 'messages/cart.js')).toContain(
      lines(
        "      switch ($plural1('en', n0 - 2, false)) {",
        "        case 'one':",
        "          switch ($plural1('en', n1, false)) {",
        "            case 'one':",
        '              return `one user, one file`',
        '            default:',
        '              return `${$number1(l, n1, $f44136fa355b3678a)} files for one user`',
        '          }',
        '        default:',
        '          return `${$number1(l, n0 - 2, $f44136fa355b3678a)} users, ${',
        "            $plural1('en', n1, false) === 'one'",
        '              ? `one file`',
        '              : `${$number1(l, n1, $f44136fa355b3678a)} files`',
        '          }`',
        '      }',
      ),
    )
  })
})

describe('selects and markup', () => {
  test('sorts select cases and puts other under default', () => {
    const files = only({
      message: message({
        key: 'order.status',
        source: 'status',
        args: [{ name: 'state', type: { kind: 'select', options: ['shipped', 'delivered'] } }],
        bodies: [
          body('en', [
            choice('state', [
              { option: 'shipped', body: [text('On its way')] },
              { option: 'delivered', body: [text('Delivered')] },
              { option: 'other', body: [text('Processing')] },
            ]),
          ]),
        ],
        origins: [translated('en')],
      }),
      locales: ['en'],
    })
    expect(contentsOf(files, 'messages/order.js')).toContain(
      lines(
        '      switch (args.state) {',
        "        case 'delivered':",
        '          return `Delivered`',
        "        case 'shipped':",
        '          return `On its way`',
        '        default:',
        '          return `Processing`',
        '      }',
      ),
    )
  })

  test('types a select as the sorted union of the source non-other options', () => {
    const files = only({
      message: message({
        key: 'order.status',
        source: 'status',
        args: [{ name: 'state', type: { kind: 'select', options: ['shipped', 'delivered', 'other'] } }],
        bodies: [body('en', [text('x')])],
        origins: [translated('en')],
      }),
      locales: ['en'],
    })
    expect(contentsOf(files, 'messages/order.d.ts')).toContain(
      "args: { state: 'delivered' | 'shipped' }",
    )
  })

  test('types a select with only an other branch as string | number', () => {
    const files = only({
      message: message({
        key: 'order.status',
        source: 'status',
        args: [{ name: 'state', type: { kind: 'select', options: ['other'] } }],
        bodies: [body('en', [text('x')])],
        origins: [translated('en')],
      }),
      locales: ['en'],
    })
    expect(contentsOf(files, 'messages/order.d.ts')).toContain('args: { state: string | number }')
  })

  test('coerces a tagless arm of a markup message to a one-element array', () => {
    const files = only({
      message: message({
        key: 'terms.accept',
        source: 'Read our <link>terms</link> before you continue.',
        kind: 'markup',
        args: [{ name: 'link', type: { kind: 'markup' } }],
        bodies: [
          body('en', [text('Read our '), markup('link', [text('terms')]), text(' before you continue.')]),
          body('de', [text('Lies unsere AGB, bevor du fortfährst.')]),
        ],
        origins: [translated('en'), translated('de'), inherited('de-AT', 'de')],
      }),
    })
    expect(contentsOf(files, 'messages/terms.js')).toContain(
      lines(
        "    case 'de':",
        "    case 'de-AT':",
        '      return [`Lies unsere AGB, bevor du fortfährst.`]',
        '    default:',
        "      return ['Read our ', args.link(['terms']), ' before you continue.']",
      ),
    )
  })

  test('renders a tag inside a text message as its children, never as a handler call', () => {
    const files = only({
      message: message({
        key: 'nav.home',
        source: 'Home',
        bodies: [body('en', [text('Go '), markup('b', [text('home')])])],
        origins: [translated('en')],
      }),
      locales: ['en'],
    })
    expect(contentsOf(files, 'messages/nav.js')).toContain('      return `Go home`')
  })

  test('keeps an interpolated run out of its own array element', () => {
    const files = only({
      message: message({
        key: 'terms.hello',
        source: 'Hi {name} <b>there</b>',
        kind: 'markup',
        args: [
          { name: 'name', type: { kind: 'stringish' } },
          { name: 'b', type: { kind: 'markup' } },
        ],
        bodies: [body('en', [text('Hi '), arg('name'), text(' '), markup('b', [text('there')])])],
        origins: [translated('en')],
      }),
      locales: ['en'],
    })
    expect(contentsOf(files, 'messages/terms.js')).toContain(
      "      return [`Hi ${args.name} `, args.b(['there'])]",
    )
  })

  test('spreads a branch that reaches a tag into the enclosing array', () => {
    const files = only({
      message: message({
        key: 'cart.notice',
        source: 'notice',
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
                { keyword: 'other', body: [markup('b', [pound(), text(' files')])] },
              ],
            }),
            text(' to read'),
          ]),
        ],
        origins: [translated('en')],
      }),
      locales: ['en'],
    })
    expect(contentsOf(files, 'messages/cart.js')).toContain(
      lines(
        '      return [',
        "        'You have ',",
        "        ...($plural1('en', n0, false) === 'one'",
        "          ? [args.b(['one file'])]",
        '          : [args.b([`${$number1(l, n0, $f44136fa355b3678a)} files`])]),',
        "        ' to read',",
        '      ]',
      ),
    )
  })

  test('inlines a branch that reaches a tag when every branch renders the same', () => {
    const files = only({
      message: message({
        key: 'cart.notice',
        source: 'notice',
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
                { keyword: 'one', body: [markup('b', [text('files')])] },
                { keyword: 'other', body: [markup('b', [text('files')])] },
              ],
            }),
            text(' to read'),
          ]),
        ],
        origins: [translated('en')],
      }),
      locales: ['en'],
    })
    const module = contentsOf(files, 'messages/cart.js')
    expect(module).not.toContain('$plural1')
    expect(module).toContain("      return ['You have ', args.b(['files']), ' to read']")
  })

  test('keeps a tagless branch inside the template of a one element array', () => {
    const files = only({
      message: message({
        key: 'cart.notice',
        source: 'notice',
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
                { keyword: 'one', body: [text('one file')] },
                { keyword: 'other', body: [text('many files')] },
              ],
            }),
            text(' to read'),
          ]),
        ],
        origins: [translated('en')],
      }),
      locales: ['en'],
    })
    expect(contentsOf(files, 'messages/cart.js')).toContain(
      lines(
        '      return [`You have ${',
        "        $plural1('en', n0, false) === 'one'",
        '          ? `one file`',
        '          : `many files`',
        '      } to read`]',
      ),
    )
  })

  test('wraps a declaration that would run past the line budget', () => {
    const files = only({
      message: message({
        key: 'terms.accept',
        source: 'Read our <link>terms</link> before you continue.',
        kind: 'markup',
        args: [{ name: 'link', type: { kind: 'markup' } }],
        bodies: [body('en', [markup('link', [text('terms')])])],
        origins: [translated('en')],
      }),
      locales: ['en'],
    })
    expect(contentsOf(files, 'messages/terms.d.ts')).toContain(
      lines(
        'export declare function terms_accept<T>(',
        '  args: { link: (chunks: readonly (string | T)[]) => T },',
        '  opts?: MessageOptions,',
        '): readonly (string | T)[]',
      ),
    )
  })
})

describe('declarations', () => {
  test('escapes a source string that would close the doc comment early', () => {
    const files = only({
      message: message({
        key: 'dev.snippet',
        source: 'Matches /x*/ in a\ncomment',
        bodies: [body('en', [text('x')])],
        origins: [translated('en')],
      }),
      locales: ['en'],
    })
    expect(contentsOf(files, 'messages/dev.d.ts')).toContain(
      '/** en: "Matches /x*\\/ in a comment" */',
    )
  })

  test('types a message with no arguments as optional EmptyArgs', () => {
    const files = only({
      message: message({
        key: 'nav.home',
        source: 'Home',
        bodies: [body('en', [text('Home')])],
        origins: [translated('en')],
      }),
      locales: ['en'],
    })
    expect(contentsOf(files, 'messages/nav.d.ts')).toBe(
      lines(
        HEADER,
        "import type { EmptyArgs, MessageOptions } from 'loclizr'",
        '/** en: "Home" */',
        'export declare function nav_home(args?: EmptyArgs, opts?: MessageOptions): string',
        '',
      ),
    )
  })

  test('reaches an argument name that is not an identifier by subscript', () => {
    const weird: Arg = { name: '9x', type: { kind: 'stringish' } }
    const files = only({
      message: message({
        key: 'nav.odd',
        source: 'odd',
        args: [weird],
        bodies: [body('en', [text('n '), arg('9x')])],
        origins: [translated('en')],
      }),
      locales: ['en'],
    })
    expect(contentsOf(files, 'messages/nav.js')).toContain("return `n ${args['9x']}`")
    expect(contentsOf(files, 'messages/nav.d.ts')).toContain("args: { '9x': string | number }")
  })

  test('reaches an argument named __proto__ by subscript, since LZ2007 rejects it too', () => {
    const proto: Arg = { name: '__proto__', type: { kind: 'stringish' } }
    const files = only({
      message: message({
        key: 'nav.proto',
        source: 'proto',
        args: [proto],
        bodies: [body('en', [text('p '), arg('__proto__')])],
        origins: [translated('en')],
      }),
      locales: ['en'],
    })
    expect(contentsOf(files, 'messages/nav.js')).toContain("return `p ${args['__proto__']}`")
    expect(contentsOf(files, 'messages/nav.d.ts')).toContain("args: { '__proto__': string | number }")
  })
})

describe('the tree', () => {
  test('sorts messages by key and namespaces by module', () => {
    const files = emit(
      program({
        messages: [
          message({
            key: 'zeta.one',
            source: 'z',
            bodies: [body('en', [text('z')])],
            origins: [translated('en')],
          }),
          message({
            key: 'alpha.two',
            source: 'b',
            bodies: [body('en', [text('b')])],
            origins: [translated('en')],
          }),
          message({
            key: 'alpha.one',
            source: 'a',
            bodies: [body('en', [text('a')])],
            origins: [translated('en')],
          }),
        ],
        config: config({ locales: ['en'] }),
      }),
    ).files
    const alpha = contentsOf(files, 'messages/alpha.js')
    expect(alpha.indexOf('alpha_one')).toBeLessThan(alpha.indexOf('alpha_two'))
    expect(contentsOf(files, 'messages.js')).toBe(
      lines(
        HEADER,
        '// @ts-nocheck',
        "export { getLocale, setLocale, subscribe } from 'loclizr'",
        "export { cookie, locales, sourceLocale } from './messages/_locale.js'",
        "export * from './messages/alpha.js'",
        "export * from './messages/zeta.js'",
        '',
      ),
    )
  })

  test('puts a root-level key in the _root namespace', () => {
    const files = only({
      message: message({
        key: 'home',
        source: 'Home',
        bodies: [body('en', [text('Home')])],
        origins: [translated('en')],
      }),
      locales: ['en'],
    })
    expect(contentsOf(files, 'messages/_root.js')).toContain('export function home(args, opts) {')
    expect(contentsOf(files, 'messages.js')).toContain("export * from './messages/_root.js'")
  })

  test('emits no groups files when the config declares no group', () => {
    const files = only({
      message: message({
        key: 'nav.home',
        source: 'Home',
        bodies: [body('en', [text('Home')])],
        origins: [translated('en')],
      }),
      locales: ['en'],
    })
    expect(files.map((file) => file.path)).not.toContain('groups.js')
    expect(files.map((file) => file.path)).not.toContain('groups.d.ts')
  })

  test('omits only the module augmentation under augmentLocale false', () => {
    const files = only({
      message: message({
        key: 'nav.home',
        source: 'Home',
        bodies: [body('en', [text('Home')])],
        origins: [translated('en')],
      }),
      locales: ['en'],
      augmentLocale: false,
    })
    expect(contentsOf(files, 'messages.d.ts')).toBe(
      lines(
        HEADER,
        "import type { SetLocaleOptions } from 'loclizr'",
        '',
        "export type AppLocale = 'en'",
        '',
        'export declare function getLocale(): AppLocale',
        'export declare function setLocale(locale: AppLocale, options?: SetLocaleOptions): void',
        'export declare function subscribe(listener: () => void): () => void',
        "export { cookie, locales, sourceLocale } from './messages/_locale.js'",
        "export * from './messages/nav.js'",
        '',
      ),
    )
  })

  test('reads the configured cookie into the resolver', () => {
    const files = emit(
      program({
        messages: [],
        config: config({ locales: ['en'], cookie: 'lang' }),
      }),
    ).files
    expect(contentsOf(files, 'messages/_locale.js')).toContain(
      "export const $l = $configure1({ locales, sourceLocale, cookie })",
    )
  })

  test('exports the configured cookie name for server negotiation', () => {
    const files = emit(
      program({
        messages: [],
        config: config({ locales: ['en'], cookie: 'lang' }),
      }),
    ).files
    expect(contentsOf(files, 'messages/_locale.js')).toContain("export const cookie = 'lang'")
    expect(contentsOf(files, 'messages/_locale.d.ts')).toContain("export declare const cookie: 'lang'")
    for (const barrel of ['messages.js', 'messages.d.ts']) {
      expect(contentsOf(files, barrel)).toContain(
        "export { cookie, locales, sourceLocale } from './messages/_locale.js'",
      )
    }
  })
})

describe('the replay', () => {
  test('reverses exactly the arrays the replay set names', () => {
    const source = workedExample()
    const flipped = reverseForReplay(source)
    expect(flipped.locales).toEqual([...source.locales].reverse())
    expect(flipped.messages.map((entry) => entry.key)).toEqual(
      source.messages.map((entry) => entry.key).reverse(),
    )
    expect(flipped.groups.map((entry) => entry.id)).toEqual(source.groups.map((entry) => entry.id).reverse())
    const items = flipped.messages.find((entry) => entry.key === 'cart.items')
    const original = source.messages.find((entry) => entry.key === 'cart.items')
    expect(items?.bodies.map((entry) => entry.locale)).toEqual(
      original?.bodies.map((entry) => entry.locale).reverse(),
    )
    expect(items?.origins.map((entry) => entry.locale)).toEqual(
      original?.origins.map((entry) => entry.locale).reverse(),
    )
    expect(items?.spans.map((entry) => entry.locale)).toEqual(
      original?.spans.map((entry) => entry.locale).reverse(),
    )
  })

  test('reverses group members, usages and extras', () => {
    const base = workedExample()
    const source: Program = {
      ...base,
      extras: [
        { locale: 'de', key: 'a', file: 'locales/de.json', span: base.messages[0]?.spans[0]?.span ?? SPANLESS },
        { locale: 'de', key: 'b', file: 'locales/de.json', span: base.messages[0]?.spans[0]?.span ?? SPANLESS },
      ],
      usages: [
        {
          id: 'nav_home',
          sites: [
            { file: 'src/a.tsx', line: 1, column: 1, scope: 'A', snippet: 'a' },
            { file: 'src/b.tsx', line: 2, column: 2, scope: 'B', snippet: 'b' },
          ],
        },
      ],
    }
    const flipped = reverseForReplay(source)
    expect(flipped.extras.map((entry) => entry.key)).toEqual(['b', 'a'])
    expect(flipped.usages[0]?.sites.map((site) => site.file)).toEqual(['src/b.tsx', 'src/a.tsx'])
    expect(flipped.groups[0]?.members.map((member) => member.member)).toEqual([
      'rate_limited',
      'not_found',
      'forbidden',
    ])
  })

  test('leaves every array whose order carries meaning alone', () => {
    const source = workedExample()
    const flipped = reverseForReplay(source)
    const key = 'cart.items'
    const before = source.messages.find((entry) => entry.key === key)
    const after = flipped.messages.find((entry) => entry.key === key)
    expect(after?.args).toEqual(before?.args)
    const englishBefore = before?.bodies.find((entry) => entry.locale === 'en')
    const englishAfter = after?.bodies.find((entry) => entry.locale === 'en')
    expect(englishAfter?.nodes).toEqual(englishBefore?.nodes)
    expect(englishAfter?.args).toEqual(englishBefore?.args)
  })

  test('does not mutate the program it was handed', () => {
    const source = workedExample()
    const before = JSON.stringify(source)
    reverseForReplay(source)
    expect(JSON.stringify(source)).toBe(before)
  })

  test('emits the same bytes from the replayed program', () => {
    expect(tree(emit(reverseForReplay(workedExample())).files)).toBe(tree(emit(workedExample()).files))
  })

  test('emits the same bytes from a program rotated rather than reversed', () => {
    expect(tree(emit(rotate(workedExample())).files)).toBe(tree(emit(workedExample()).files))
  })
})

describe('groups', () => {
  test('emits a null-prototype record with sorted members', () => {
    const files = emit(
      program({ messages: [...workedExample().messages], groups: [reversedMembers(ERRORS_GROUP)] }),
    ).files
    expect(contentsOf(files, 'groups.js')).toBe(
      lines(
        HEADER,
        '// @ts-nocheck',
        "import { errors_forbidden, errors_not_found, errors_rate_limited } from './messages/errors.js'",
        '',
        'export const errors = /*#__PURE__*/ Object.freeze({',
        '  __proto__: null,',
        '  forbidden: errors_forbidden,',
        '  not_found: errors_not_found,',
        '  rate_limited: errors_rate_limited,',
        '})',
        '',
      ),
    )
  })

  test('carries the type parameter into a tier holding a markup member', () => {
    const group: Group = {
      name: 'terms',
      id: 'terms',
      typeBase: 'Terms',
      prefix: 'terms',
      members: [
        { key: 'terms.accept', id: 'terms_accept', member: 'accept' },
        { key: 'terms.title', id: 'terms_title', member: 'title' },
      ],
    }
    const files = emit(
      program({
        messages: [
          message({
            key: 'terms.accept',
            source: 'Read our <link>terms</link> now.',
            kind: 'markup',
            args: [{ name: 'link', type: { kind: 'markup' } }],
            bodies: [body('en', [text('Read our '), markup('link', [text('terms')]), text(' now.')])],
            origins: [translated('en')],
          }),
          message({
            key: 'terms.title',
            source: 'Terms',
            bodies: [body('en', [text('Terms')])],
            origins: [translated('en')],
          }),
        ],
        groups: [group],
        config: config({ locales: ['en'], groups: { terms: 'terms' } }),
      }),
    ).files
    expect(contentsOf(files, 'groups.d.ts')).toBe(
      lines(
        HEADER,
        "import type { EmptyArgs, MessageOptions } from 'loclizr'",
        '',
        "export type TermsKey = 'accept' | 'title'",
        'export interface TermsArgs<T> {',
        '  accept: { link: (chunks: readonly (string | T)[]) => T }',
        '  title: EmptyArgs',
        '}',
        'export interface TermsReturn<T> {',
        '  accept: readonly (string | T)[]',
        '  title: string',
        '}',
        'export declare const terms: Readonly<{',
        '  [K in TermsKey]: <T>(args: TermsArgs<T>[K], opts?: MessageOptions) => TermsReturn<T>[K]',
        '}>',
        '',
      ),
    )
  })

  test('defines a member property named __proto__ with a computed key', () => {
    const group: Group = {
      name: 'errors',
      id: 'errors',
      typeBase: 'Errors',
      prefix: 'errors',
      members: [{ key: 'errors.__proto__', id: 'errors___proto__', member: '__proto__' }],
    }
    const files = emit(
      program({
        messages: [
          message({
            key: 'errors.__proto__',
            source: 'Denied',
            identifier: 'errors___proto__',
            bodies: [body('en', [text('Denied')])],
            origins: [translated('en')],
          }),
        ],
        groups: [group],
        config: config({ locales: ['en'], groups: { errors: 'errors' } }),
      }),
    ).files
    expect(contentsOf(files, 'groups.js')).toContain(
      lines('  __proto__: null,', "  ['__proto__']: errors___proto__,"),
    )
    const declarations = contentsOf(files, 'groups.d.ts')
    expect(declarations).toContain("export type ErrorsKey = '__proto__'")
    expect(declarations).toContain('  __proto__: EmptyArgs')
  })

  test('leaves out a member whose key carries no message', () => {
    const group: Group = {
      name: 'errors',
      id: 'errors',
      typeBase: 'Errors',
      prefix: 'errors',
      members: [
        { key: 'errors.forbidden', id: 'errors_forbidden', member: 'forbidden' },
        { key: 'errors.gone', id: 'errors_gone', member: 'gone' },
      ],
    }
    const files = emit(
      program({
        messages: [
          message({
            key: 'errors.forbidden',
            source: 'Denied',
            bodies: [body('en', [text('Denied')])],
            origins: [translated('en')],
          }),
        ],
        groups: [group],
        config: config({ locales: ['en'], groups: { errors: 'errors' } }),
      }),
    ).files
    expect(contentsOf(files, 'groups.js')).not.toContain('errors_gone')
    expect(contentsOf(files, 'groups.d.ts')).toBe(
      lines(
        HEADER,
        "import type { EmptyArgs, MessageOptions } from 'loclizr'",
        '',
        "export type ErrorsKey = 'forbidden'",
        'export interface ErrorsArgs {',
        '  forbidden: EmptyArgs',
        '}',
        'export declare const errors: Readonly<{',
        '  [K in ErrorsKey]: (args: ErrorsArgs[K], opts?: MessageOptions) => string',
        '}>',
        '',
      ),
    )
  })

  test('types an empty group as a never key set', () => {
    const empty: Group = { name: 'gone', id: 'gone', typeBase: 'Gone', prefix: 'gone', members: [] }
    const files = emit(
      program({
        messages: [
          message({
            key: 'nav.home',
            source: 'Home',
            bodies: [body('en', [text('Home')])],
            origins: [translated('en')],
          }),
        ],
        groups: [empty],
        config: config({ locales: ['en'] }),
      }),
    ).files
    expect(contentsOf(files, 'groups.d.ts')).toContain('export type GoneKey = never')
  })
})

describe('the acceptance fixture', () => {
  test('matches the committed typecheck tree', () => {
    const emitted = emit(acceptanceProgram()).files.filter((file) => file.path !== '.gitignore')
    expect([...walkFiles(GENERATED_TREE)].sort()).toEqual(emitted.map((file) => file.path).sort())
    for (const file of emitted) {
      expect(readFileSync(join(GENERATED_TREE, file.path), 'utf8')).toBe(file.contents)
    }
  })
})

function rotate(source: Program): Program {
  const shift = <T,>(values: readonly T[], by: number): readonly T[] => [
    ...values.slice(by % Math.max(values.length, 1)),
    ...values.slice(0, by % Math.max(values.length, 1)),
  ]
  return {
    ...source,
    locales: shift(source.locales, 1),
    messages: shift(
      source.messages.map((entry) => ({
        ...entry,
        bodies: shift(entry.bodies, 1),
        origins: shift(entry.origins, 2),
      })),
      3,
    ),
    groups: source.groups.map((group) => ({ ...group, members: shift(group.members, 1) })),
  }
}

function reversedMembers(group: Group): Group {
  return { ...group, members: [...group.members].reverse() }
}

function siblingPlurals(): Message {
  return message({
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
  })
}

function nestedPlurals(): Message {
  return message({
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
}
