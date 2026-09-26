import { describe, expect, it } from 'vitest'
import type { Config, Program, RawCatalog } from '../types'
import { catalog, codes, config, forRule, run } from './__fixtures__/program'
import { mangle, pascalCase } from './index'

function projection(program: Program): string {
  return JSON.stringify({
    locales: program.locales,
    sourceLocale: program.sourceLocale,
    groups: program.groups,
    messages: program.messages,
  })
}

function deepFreeze(value: unknown): void {
  if (value === null || typeof value !== 'object') return
  Object.freeze(value)
  for (const inner of Object.values(value as Record<string, unknown>)) deepFreeze(inner)
}

describe('keys that try to leave the output directory', () => {
  const hostile = (): Program =>
    run({
      config: config({ locales: ['en'] }),
      catalogs: [
        catalog({
          locale: 'en',
          entries: {
            '../x.y': 'Traversal',
            '.leading': 'Leading dot',
            'a/b.c': 'Slash',
            'nav..double': 'Double dot',
            'C:\\win.x': 'Drive',
            'nav.\u{1F3E0}': 'House',
            'nav.\u{1F3E1}': 'Home with garden',
          },
        }),
      ],
    })

  it('mangles every namespace into one path segment beside the generated modules', () => {
    for (const message of hostile().messages) {
      expect(message.module).toMatch(/^messages\/[^/\\]+\.js$/u)
      expect(message.module.includes('..')).toBe(false)
      expect(message.module).toBe(`messages/${message.namespace}.js`)
    }
  })

  it('refuses two keys that mangle onto one identifier rather than picking a winner', () => {
    const collisions = forRule(hostile(), 'identifier-collision')
    expect(collisions).toHaveLength(1)
    expect(collisions[0]?.fatal).toBe(true)
    expect(collisions[0]?.severity).toBe('error')
    const involved = [collisions[0]?.key, ...(collisions[0]?.related ?? []).map((one) => one.key)]
    expect(involved).toEqual(['nav.\u{1F3E0}', 'nav.\u{1F3E1}'])
  })
})

describe('identifiers the generated tree already owns', () => {
  it('rejects an override that lands on a barrel export', () => {
    const program = run({
      config: config({ locales: ['en'], identifiers: { 'nav.home': 'subscribe' } }),
      catalogs: [catalog({ locale: 'en', entries: { 'nav.home': 'Home' } })],
    })
    expect(codes(program.diagnostics)).toEqual(['LZ4002'])
    expect(program.diagnostics[0]?.fatal).toBe(true)
  })

  it('guards an override that is a reserved word instead of reporting it', () => {
    const program = run({
      config: config({ locales: ['en'], identifiers: { 'nav.home': 'class' } }),
      catalogs: [catalog({ locale: 'en', entries: { 'nav.home': 'Home' } })],
    })
    expect(program.diagnostics).toEqual([])
    expect(program.messages[0]?.id).toBe('$class')
  })

  it('rejects a namespace segment that names a module the compiler writes', () => {
    const program = run({
      config: config({ locales: ['en'] }),
      catalogs: [
        catalog({ locale: 'en', entries: { '_formats.a': 'A', 'cart.title': 'Cart' } }),
      ],
    })
    const reserved = forRule(program, 'identifier-reserved')
    expect(reserved.map((diagnostic) => diagnostic.key)).toEqual(['_formats.a'])
    expect(reserved[0]?.fatal).toBe(true)
  })

  it('moves that segment off the generated module through an identifiers entry', () => {
    const program = run({
      config: config({ locales: ['en'], identifiers: { _locale: 'appLocale' } }),
      catalogs: [catalog({ locale: 'en', entries: { '_locale.a': 'A' } })],
    })
    expect(program.diagnostics).toEqual([])
    expect(program.messages[0]?.namespace).toBe('appLocale')
    expect(program.messages[0]?.module).toBe('messages/appLocale.js')
  })
})

describe('namespace filenames a case-insensitive filesystem merges', () => {
  const cased = (overrides: Partial<Config> = {}): Program =>
    run({
      config: config({ locales: ['en'], ...overrides }),
      catalogs: [catalog({ locale: 'en', entries: { 'Nav.home': 'Upper', 'nav.home': 'Lower' } })],
    })

  it('refuses two top-level segments whose modules differ only in case', () => {
    const program = cased()
    expect(codes(program.diagnostics)).toEqual(['LZ4001'])
    const [collision] = forRule(program, 'identifier-collision')
    expect(collision?.fatal).toBe(true)
    expect(collision?.severity).toBe('error')
    expect(collision?.message).toContain('"messages/Nav.js" and "messages/nav.js"')
    expect(collision?.key).toBe('Nav.home')
    expect(collision?.related.map((related) => related.key)).toEqual(['nav.home'])
  })

  it('offers the identifiers entry that separates the two modules', () => {
    expect(cased().diagnostics[0]?.hint).toContain("identifiers: { 'nav': 'nav2' }")
  })

  it('clears once an identifiers entry moves one segment off the other', () => {
    const program = cased({ identifiers: { nav: 'nav2' } })
    expect(program.diagnostics).toEqual([])
    expect(program.messages.map((message) => message.module)).toEqual([
      'messages/Nav.js',
      'messages/nav2.js',
    ])
  })

  it('fires where the collision is the identifiers entries own doing', () => {
    const program = run({
      config: config({ locales: ['en'], identifiers: { alpha: 'Shared', beta: 'shared' } }),
      catalogs: [catalog({ locale: 'en', entries: { 'alpha.a': 'A', 'beta.b': 'B' } })],
    })
    expect(codes(program.diagnostics)).toEqual(['LZ4001'])
    expect(program.diagnostics[0]?.message).toContain('"messages/Shared.js" and "messages/shared.js"')
  })

  it('leaves two keys that differ only in case inside one namespace alone', () => {
    const program = run({
      config: config({ locales: ['en'] }),
      catalogs: [catalog({ locale: 'en', entries: { 'nav.Home': 'Upper', 'nav.home': 'Lower' } })],
    })
    expect(program.diagnostics).toEqual([])
    expect(program.messages.map((message) => message.id)).toEqual(['nav_Home', 'nav_home'])
  })

  it('leaves two segments that mangle onto one filename alone, since one module holds both', () => {
    const program = run({
      config: config({ locales: ['en'] }),
      catalogs: [catalog({ locale: 'en', entries: { 'a-b.x': 'X', 'a_b.y': 'Y' } })],
    })
    expect(program.diagnostics).toEqual([])
    expect(program.messages.map((message) => message.module)).toEqual([
      'messages/a_b.js',
      'messages/a_b.js',
    ])
    expect(program.messages.map((message) => message.id)).toEqual(['a_b_x', 'a_b_y'])
  })

  it('reports a segment folding onto a generated module as reserved rather than as a pair', () => {
    const program = run({
      config: config({ locales: ['en'] }),
      catalogs: [catalog({ locale: 'en', entries: { '_Locale.a': 'A' } })],
    })
    expect(codes(program.diagnostics)).toEqual(['LZ4002'])
    expect(program.diagnostics[0]?.fatal).toBe(true)
    expect(program.diagnostics[0]?.message).toContain('"messages/_locale.js"')
    expect(program.diagnostics[0]?.hint).toContain("identifiers: { '_Locale': 'appLocale' }")
  })

  it('reports each segment once where a generated module name is written both ways', () => {
    const program = run({
      config: config({ locales: ['en'] }),
      catalogs: [catalog({ locale: 'en', entries: { '_Locale.a': 'A', '_locale.b': 'B' } })],
    })
    expect(codes(program.diagnostics)).toEqual(['LZ4002', 'LZ4002'])
    expect(program.diagnostics.map((diagnostic) => diagnostic.key)).toEqual([
      '_Locale.a',
      '_locale.b',
    ])
  })
})

describe('confusable keys', () => {
  it('fires on a fullwidth homoglyph pair after compatibility folding', () => {
    const program = run({
      config: config({ locales: ['en'] }),
      catalogs: [
        catalog({ locale: 'en', entries: { 'a.pay': 'Pay', 'a.\uFF50\uFF41\uFF59': 'Pay' } }),
      ],
    })
    const confusable = forRule(program, 'confusable-key')
    expect(confusable).toHaveLength(1)
    expect(confusable[0]?.fatal).toBe(false)
    expect(confusable[0]?.severity).toBe('error')
    expect(confusable[0]?.related).toHaveLength(1)
  })

  it('stays quiet on a catalog written wholly in one non-Latin script', () => {
    const program = run({
      config: config({ locales: ['en'] }),
      catalogs: [
        catalog({ locale: 'en', entries: { 'заказ.статус': 'Статус', 'заказ.дата': 'Дата' } }),
      ],
    })
    expect(program.diagnostics).toEqual([])
  })
})

describe('key order', () => {
  it('sorts by code point rather than by UTF-16 code unit', () => {
    const program = run({
      config: config({ locales: ['en'] }),
      catalogs: [
        catalog({ locale: 'en', entries: { 'a\u{1F600}2': 'Astral', 'a\uFFFD1': 'Replacement' } }),
      ],
    })
    expect(program.messages.map((message) => message.key)).toEqual(['a\uFFFD1', 'a\u{1F600}2'])
  })
})

describe('the severity every diagnostic carries', () => {
  it('ignores a severity override and reports every rule at its own default', () => {
    const overridden = config({
      locales: ['en'],
      groups: { errors: 'errors' },
      severity: {
        'identifier-collision': 'off',
        'group-args-heterogeneous': 'error',
        'confusable-key': 'off',
      },
    })
    const program = run({
      config: overridden,
      catalogs: [
        catalog({
          locale: 'en',
          entries: {
            'errors.a-b': 'One',
            'errors.a_b': 'Two',
            'errors.late': 'Late {seconds, number}',
          },
        }),
      ],
    })
    const collision = forRule(program, 'identifier-collision')
    expect(collision).toHaveLength(1)
    expect(collision[0]?.severity).toBe('error')
    const heterogeneous = forRule(program, 'group-args-heterogeneous')
    expect(heterogeneous).toHaveLength(1)
    expect(heterogeneous[0]?.severity).toBe('warn')
    expect(heterogeneous[0]?.fatal).toBe(false)
  })
})

describe('groups', () => {
  it('upper-cases the type base the same way in every host locale', () => {
    const program = run({
      config: config({ locales: ['en'], groups: { istanbul: 'city' } }),
      catalogs: [catalog({ locale: 'en', entries: { 'city.name': 'Istanbul' } })],
    })
    expect(program.groups[0]?.typeBase).toBe('Istanbul')
    expect(pascalCase(mangle('istanbul', {}))).toBe('Istanbul')
  })

  it('matches a prefix on a dot boundary and strips only that separator', () => {
    const program = run({
      config: config({ locales: ['en'], groups: { nav: 'nav' } }),
      catalogs: [
        catalog({
          locale: 'en',
          entries: {
            'nav.home': 'Home',
            'nav.footer.legal': 'Legal',
            'navbar.home': 'Bar',
          },
        }),
      ],
    })
    expect(program.groups[0]?.members).toEqual([
      { key: 'nav.footer.legal', id: 'nav_footer_legal', member: 'footer_legal' },
      { key: 'nav.home', id: 'nav_home', member: 'home' },
    ])
  })
})

describe('determinism', () => {
  const catalogs: readonly RawCatalog[] = [
    catalog({
      locale: 'en',
      line: 1,
      entries: { 'cart.items': 'Items {count, number}', 'nav.home': 'Home' },
    }),
    catalog({
      locale: 'de',
      line: 1,
      entries: { 'cart.items': 'Artikel {count}', 'nav.home': 'Startseite' },
    }),
    catalog({ locale: 'de-AT', line: 1, entries: { 'nav.home': 'Startseitn' } }),
  ]
  const resolved = config({ locales: ['en', 'de', 'de-AT'], groups: { cart: 'cart' } })

  it('returns the same program for the same input', () => {
    expect(projection(run({ config: resolved, catalogs }))).toBe(
      projection(run({ config: resolved, catalogs })),
    )
  })

  it('does not depend on the order the catalogs arrive in', () => {
    expect(projection(run({ config: resolved, catalogs: [...catalogs].reverse() }))).toBe(
      projection(run({ config: resolved, catalogs })),
    )
  })

  it('does not depend on the order of one locale namespace files', () => {
    const split: readonly RawCatalog[] = [
      catalog({
        locale: 'en',
        ns: 'cart',
        file: 'locales/en/cart.json',
        line: 10,
        entries: { 'cart.title': 'Cart' },
      }),
      catalog({
        locale: 'en',
        ns: 'nav',
        file: 'locales/en/nav.json',
        line: 20,
        entries: { 'nav.home': 'Home' },
      }),
    ]
    const plain = config({ locales: ['en'] })
    expect(projection(run({ config: plain, catalogs: [...split].reverse() }))).toBe(
      projection(run({ config: plain, catalogs: split })),
    )
  })

  it('treats every input it is handed as read only', () => {
    const frozen = [...catalogs]
    deepFreeze(frozen)
    deepFreeze(resolved)
    expect(() => run({ config: resolved, catalogs: frozen })).not.toThrow()
  })
})
