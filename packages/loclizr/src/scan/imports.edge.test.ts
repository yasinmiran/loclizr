import { describe, expect, it } from 'vitest'
import { basenameOf, bindsGeneratedTree } from './imports'
import type { ScanGroup } from './index'
import { scanFile } from './index'

const IDS: ReadonlySet<string> = new Set(['errors_forbidden', 'nav_cart', 'nav_home'])

const GROUPS: readonly ScanGroup[] = [
  { id: 'errors', memberIds: ['errors_forbidden'], memberProps: { forbidden: 'errors_forbidden' } },
]

function idsOf(source: readonly string[], outDir = 'src/loclizr', ids = IDS): readonly string[] {
  const text = `${source.join('\n')}\n`
  return scanFile({ text, file: 'src/App.ts', outDir, ids, groups: GROUPS }).map((site) => site.id)
}

describe('import text that is not an import', () => {
  it('does not bind an import written inside a multi-line template literal', () => {
    expect(
      idsOf(['const doc = `', "import * as m from './loclizr/messages'", '`', 'm.nav_home()']),
    ).toEqual([])
  })

  it('does not bind an import written in a trailing line comment', () => {
    expect(
      idsOf(["setup() // import * as m from './loclizr/messages'", 'm.nav_home()']),
    ).toEqual([])
  })

  it('does not bind a namespace imported for its types only', () => {
    expect(idsOf(["import type * as m from './loclizr/messages'", 'm.nav_home()'])).toEqual([])
  })

  it('does not bind a re-exported namespace, since renamed re-exports are not followed', () => {
    expect(idsOf(["export * as m from './loclizr/messages'", 'm.nav_home()'])).toEqual([])
  })

  it('does not bind a specifier written as a template literal', () => {
    expect(idsOf(['import * as m from `./loclizr/messages`', 'm.nav_home()'])).toEqual([])
  })
})

describe('import statements that bind', () => {
  it('binds a namespace beside a default import', () => {
    expect(idsOf(["import fallback, * as m from './loclizr/messages'", 'm.nav_home()'])).toEqual([
      'nav_home',
    ])
  })

  it('binds through an import attribute clause', () => {
    expect(
      idsOf(["import * as m from './loclizr/messages' with { type: 'module' }", 'm.nav_home()']),
    ).toEqual(['nav_home'])
  })

  it('binds a clause whose from and specifier sit on later lines', () => {
    expect(idsOf(['import * as m', '  from', "  './loclizr/messages'", 'm.nav_home()'])).toEqual([
      'nav_home',
    ])
  })

  it('binds an import written below the usage, as hoisting allows', () => {
    expect(idsOf(['m.nav_home()', "import * as m from './loclizr/messages'"])).toEqual([
      'nav_home',
    ])
  })

  it('records each of two namespace aliases for one generated tree', () => {
    expect(
      idsOf([
        "import * as m from './loclizr/messages'",
        "import * as n from '@/loclizr/messages'",
        'm.nav_home()',
        'n.nav_cart()',
      ]),
    ).toEqual(['nav_home', 'nav_cart'])
  })

  it('keeps the generated binding when a later import from elsewhere reuses the local name', () => {
    expect(
      idsOf([
        "import { nav_home as h } from './loclizr/messages'",
        "import { nav_cart as h } from './vendor/messages'",
        'h()',
      ]),
    ).toEqual(['nav_home'])
  })

  it('binds the groups entry through an extension', () => {
    expect(
      idsOf(["import { errors } from './loclizr/groups.js'", 'errors.forbidden()']),
    ).toEqual(['errors_forbidden'])
  })

  it('binds a named entry that is not an id or a group to nothing', () => {
    expect(idsOf(["import { locales, nav_home } from './loclizr/messages'", 'locales()'])).toEqual(
      [],
    )
  })

  it('records an id that shares its name with an Object.prototype member', () => {
    const ids: ReadonlySet<string> = new Set(['toString', 'constructor'])
    expect(
      idsOf(
        [
          "import * as m from './loclizr/messages'",
          'm.toString()',
          'm.constructor()',
          'm.hasOwnProperty()',
        ],
        'src/loclizr',
        ids,
      ),
    ).toEqual(['toString', 'constructor'])
  })

  it('binds a named import that shares its name with an Object.prototype member only when it is an id', () => {
    expect(
      idsOf([
        "import { toString, constructor, hasOwnProperty } from './loclizr/messages'",
        'toString()',
        'constructor()',
        'hasOwnProperty()',
      ]),
    ).toEqual([])
  })
})

describe('outDir spellings', () => {
  it.each(['./loclizr', 'loclizr', 'src/loclizr///', 'app/src/loclizr/'])(
    'binds ./loclizr/messages for an outDir of %j',
    (outDir) => {
      expect(idsOf(["import * as m from './loclizr/messages'", 'm.nav_home()'], outDir)).toEqual([
        'nav_home',
      ])
    },
  )

  it.each(['', '/', '///'])('binds nothing for an outDir of %j, which has no basename', (outDir) => {
    expect(idsOf(["import * as m from './messages'", 'm.nav_home()'], outDir)).toEqual([])
  })
})

describe('basenameOf', () => {
  it.each([
    ['src/loclizr', 'loclizr'],
    ['src/loclizr/', 'loclizr'],
    ['loclizr', 'loclizr'],
    ['a/b.c', 'b.c'],
    ['', ''],
    ['/', ''],
  ])('reads %j as %j', (dir, expected) => {
    expect(basenameOf(dir)).toBe(expected)
  })
})

describe('bindsGeneratedTree', () => {
  it.each([
    ['loclizr/messages', 'src/loclizr'],
    ['/loclizr/messages', 'src/loclizr'],
    ['./loclizr/messages.mjs', 'src/loclizr'],
    ['./loclizr/messages/nav', 'src/loclizr'],
    ['./loclizr/messages/', 'src/loclizr'],
    ['./loclizr.v2/messages', 'src/loclizr.v2'],
    ['./i18n.out/messages.js', 'i18n.out'],
  ])('binds %j under outDir %j', (specifier, outDir) => {
    expect(bindsGeneratedTree(specifier, outDir)).toBe(true)
  })

  it.each([
    ['', 'src/loclizr'],
    ['./loclizr/groups/errors', 'src/loclizr'],
    ['./LOCLIZR/messages', 'src/loclizr'],
    ['./loclizr/Messages', 'src/loclizr'],
    ['./loclizr/messages?raw', 'src/loclizr'],
    ['./x/messages', '/'],
  ])('does not bind %j under outDir %j', (specifier, outDir) => {
    expect(bindsGeneratedTree(specifier, outDir)).toBe(false)
  })
})
