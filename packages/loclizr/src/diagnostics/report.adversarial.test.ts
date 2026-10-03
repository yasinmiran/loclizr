import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Config, Diagnostic, RuleName, Severity, Summary } from '../types'
import {
  applySeverity,
  diag,
  exitCodeFor,
  hasError,
  hasFatal,
  renderHuman,
  renderJson,
  RULES,
  sortDiagnostics,
} from './index'

const NOT_RELEVELABLE: ReadonlySet<string> = new Set(['LZ1001', 'LZ1007', 'LZ5001'])

const SUMMARY: Summary = {
  errors: 0,
  warnings: 0,
  messages: 0,
  locales: 0,
  fellBack: [],
}

function only(rule: RuleName, severity: Severity): Config['severity'] {
  return { [rule]: severity }
}

function warnings(count: number): readonly Diagnostic[] {
  return Array.from({ length: count }, (_unused, index) =>
    diag('ambiguous-source', { message: `Open ${index}` }),
  )
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('applySeverity over every rule in the catalog', () => {
  test('turns off every rule the user is allowed to turn off, and no other', () => {
    for (const rule of Object.values(RULES)) {
      const produced = diag(rule.name, { message: rule.name, fatal: false })
      const kept = applySeverity([produced], only(rule.name, 'off'))
      expect(kept.length === 0).toBe(!NOT_RELEVELABLE.has(rule.code) && !produced.fatal)
    }
  })

  test('raises every rule the user is allowed to raise, whatever its default was', () => {
    for (const rule of Object.values(RULES)) {
      if (NOT_RELEVELABLE.has(rule.code)) continue
      const kept = applySeverity([diag(rule.name, { message: rule.name })], only(rule.name, 'error'))
      expect(kept[0]?.severity).toBe('error')
    }
  })

  test('resolves from the rule default and the override alone, so applying it twice changes nothing', () => {
    const produced = Object.values(RULES).map((rule) => diag(rule.name, { message: rule.name }))
    const overrides: Config['severity'] = {
      'ambiguous-source': 'error',
      'missing-translation': 'warn',
      'unused-message': 'error',
      'extra-translation': 'off',
    }
    const once = applySeverity(produced, overrides)
    expect(applySeverity(once, overrides)).toEqual(once)
  })

  test('raising a rule to error never makes it fatal', () => {
    const raised = applySeverity(
      [diag('icu-syntax', { message: 'unclosed brace' }), diag('ambiguous-source', { message: 'Open' })],
      { 'icu-syntax': 'error', 'ambiguous-source': 'error' },
    )
    expect(raised.map((diagnostic) => diagnostic.fatal)).toEqual([false, false])
    expect(hasFatal(raised)).toBe(false)
    expect(hasError(raised)).toBe(true)
  })

  test('drops the two category rules when a truncated ICU build forces them off', () => {
    const produced = [
      diag('plural-category-incomplete', { message: 'ru needs many', locale: 'ru' }),
      diag('plural-category-unreachable', { message: 'de never selects zero', locale: 'de' }),
      diag('icu-data-incomplete', { message: 'small-icu' }),
    ]
    const kept = applySeverity(produced, {
      'plural-category-incomplete': 'off',
      'plural-category-unreachable': 'off',
    })
    expect(kept.map((diagnostic) => diagnostic.code)).toEqual(['LZ1019'])
  })

  test('keeps the three un-relevelable rules fatal even when every rule is turned off at once', () => {
    const produced = Object.values(RULES).map((rule) => diag(rule.name, { message: rule.name }))
    const overrides = Object.fromEntries(
      Object.values(RULES).map((rule) => [rule.name, 'off']),
    ) as Config['severity']
    const kept = applySeverity(produced, overrides)
    expect(kept.map((diagnostic) => diagnostic.code)).toEqual(
      produced.filter((diagnostic) => diagnostic.fatal).map((diagnostic) => diagnostic.code),
    )
    expect(kept.filter((diagnostic) => diagnostic.severity === 'error').map((diagnostic) => diagnostic.code)).toEqual([
      'LZ1001',
      'LZ1007',
      'LZ5001',
    ])
    expect(hasFatal(kept)).toBe(true)
    expect(exitCodeFor(kept, Number.POSITIVE_INFINITY)).toBe(2)
  })
})

describe('exitCodeFor under hostile orderings', () => {
  test('reports two wherever the un-runnable diagnostic sits in the list', () => {
    const blocker = diag('outdir-unsafe', { message: 'outDir escapes the project root' })
    const noise = warnings(200)
    expect(exitCodeFor([blocker, ...noise], 0)).toBe(2)
    expect(exitCodeFor([...noise, blocker], 0)).toBe(2)
    expect(exitCodeFor([...noise, blocker, ...noise], Number.POSITIVE_INFINITY)).toBe(2)
  })

  test('never lowers two, however generous the warning cap is', () => {
    const diagnostics = [diag('output-unwritable', { message: 'EROFS' })]
    expect(exitCodeFor(diagnostics, Number.POSITIVE_INFINITY)).toBe(2)
    expect(exitCodeFor(diagnostics, 0)).toBe(2)
  })

  test('reports one, not two, for a fatal rule that still let the tool run', () => {
    for (const name of [
      'locale-tag-invalid',
      'no-catalogs-found',
      'source-catalog-missing',
      'identifier-collision',
      'identifier-reserved',
      'nondeterministic-output',
    ] as const) {
      const diagnostics = [diag(name, { message: name })]
      expect(hasFatal(diagnostics)).toBe(true)
      expect(exitCodeFor(diagnostics, Number.POSITIVE_INFINITY)).toBe(1)
    }
  })

  test('treats the cap as a limit that is reached, not exceeded', () => {
    expect(exitCodeFor(warnings(3), 3)).toBe(0)
    expect(exitCodeFor(warnings(4), 3)).toBe(1)
    expect(exitCodeFor(warnings(500), Number.POSITIVE_INFINITY)).toBe(0)
  })

  test('counts a warning that was an error by default towards the cap', () => {
    const relevelled = applySeverity(
      [diag('missing-translation', { message: 'no German' })],
      only('missing-translation', 'warn'),
    )
    expect(exitCodeFor(relevelled, 0)).toBe(1)
    expect(exitCodeFor(relevelled, 1)).toBe(0)
  })

  test('fails on a default-off rule the user asked to enforce', () => {
    const kept = applySeverity(
      [diag('unused-message', { message: 'nav.legacy is never referenced' })],
      only('unused-message', 'error'),
    )
    expect(exitCodeFor(kept, Number.POSITIVE_INFINITY)).toBe(1)
  })
})

describe('reporter determinism', () => {
  const spread: readonly Diagnostic[] = [
    diag('arg-missing', { message: 'a', file: 'locales/en-GB.json', locale: 'en-GB', key: 'a.one' }),
    diag('arg-missing', { message: 'b', file: 'locales/en.json', locale: 'en', key: 'a.one' }),
    diag('arg-missing', { message: 'c', file: 'locales/en_US.json', locale: 'en-US', key: 'a.one' }),
    diag('arg-extra', { message: 'd', file: 'locales/de.json', locale: 'de', key: 'Zebra' }),
    diag('arg-extra', { message: 'e', file: 'locales/de.json', locale: 'de', key: 'apple' }),
    diag('ambiguous-source', { message: 'f', file: 'locales/en.json', key: 'open' }),
    diag('missing-translation', {
      message: 'g',
      file: 'locales/de.json',
      locale: 'de',
      key: 'a.two',
      span: { line: 9, column: 1, offset: 90, length: 2 },
    }),
    diag('missing-translation', {
      message: 'h',
      file: 'locales/de.json',
      locale: 'de',
      key: 'a.two',
      span: { line: 2, column: 1, offset: 20, length: 2 },
    }),
  ]

  test('prints the same bytes whatever order the modules produced the diagnostics in', () => {
    expect(renderJson([...spread].reverse(), SUMMARY)).toBe(renderJson(spread, SUMMARY))
  })

  test('orders by severity before code, so a re-levelled warning never jumps an error', () => {
    const mixed = [
      diag('catalog-undeclared', { message: 'fr.json is not declared' }),
      diag('record-stale', { message: 'the committed record differs' }),
    ]
    expect(sortDiagnostics(mixed).map((diagnostic) => diagnostic.code)).toEqual(['LZ5003', 'LZ1006'])
  })

  test('orders paths and keys by code point rather than by collation', () => {
    const sorted = sortDiagnostics(spread)
    const files = sorted
      .filter((diagnostic) => diagnostic.code === 'LZ3004')
      .map((diagnostic) => diagnostic.file)
    expect(files).toEqual(['locales/en-GB.json', 'locales/en.json', 'locales/en_US.json'])
    const keys = sorted
      .filter((diagnostic) => diagnostic.code === 'LZ3005')
      .map((diagnostic) => diagnostic.key)
    expect(keys).toEqual(['Zebra', 'apple'])
    expect([...keys].sort((a, b) => String(a).localeCompare(String(b)))).toEqual(['apple', 'Zebra'])
  })

  test('keeps the lower offset first for two diagnostics that agree on everything else', () => {
    const offsets = sortDiagnostics(spread)
      .filter((diagnostic) => diagnostic.code === 'LZ3001')
      .map((diagnostic) => diagnostic.span?.offset)
    expect(offsets).toEqual([20, 90])
  })
})

describe('reporters against hostile catalog text', () => {
  const nasty = 'Open then\u0000then\uD800then"quoted"then\\slash'

  test('survives a round trip through the json reporter', () => {
    const parsed = JSON.parse(renderJson([diag('ambiguous-source', { message: nasty })], SUMMARY)) as {
      readonly diagnostics: readonly Diagnostic[]
    }
    expect(parsed.diagnostics[0]?.message).toBe(nasty)
  })

  test('indents every line of a message that spans several lines', () => {
    const lines = renderHuman([diag('ambiguous-source', { message: 'first\nsecond\nthird' })], {
      color: false,
    }).split('\n')
    expect(lines.slice(2)).toEqual(['  first', '  second', '  third'])
  })

  test('keeps a key carrying a newline from printing what reads as a second diagnostic', () => {
    const lines = renderHuman(
      [
        diag('missing-translation', {
          message: 'no German',
          file: 'locales/de.json',
          locale: 'de\r\nen',
          key: 'nav.home\nerror  LZ9999  forged',
        }),
      ],
      { color: false },
    ).split('\n')
    expect(lines[0]).toBe(
      'error  LZ3001  missing-translation  locales/de.json  de en  nav.home error  LZ9999  forged',
    )
    expect(lines).toHaveLength(3)
  })

  test('keeps a related row carrying a newline inside its own three columns', () => {
    const lines = renderHuman(
      [
        diag('ambiguous-source', {
          message: 'Open',
          related: [
            {
              file: 'locales/en.json',
              locale: null,
              key: 'dialog.open',
              span: null,
              message: 'described as\n"a verb"',
            },
            { file: null, locale: null, key: 'file.open', span: null, message: 'no description' },
          ],
        }),
      ],
      { color: false },
    ).split('\n')
    expect(lines.slice(4)).toEqual([
      '    dialog.open    locales/en.json     described as "a verb"',
      '    file.open                          no description',
    ])
  })

  test('honours a NO_COLOR of any non-empty value, not only of one', () => {
    for (const value of ['0', 'false', 'no', '1']) {
      vi.stubEnv('NO_COLOR', value)
      expect(renderHuman([diag('arg-missing', { message: 'name' })], { color: true })).not.toContain(
        '\u001b[',
      )
    }
  })
})
