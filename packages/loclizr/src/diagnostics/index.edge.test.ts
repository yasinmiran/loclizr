import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Diagnostic, Related, RuleName, Span, Summary } from '../types'
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

const SUMMARY: Summary = { errors: 0, warnings: 0, messages: 0, locales: 0, fellBack: [] }

const ALL_RULES: readonly RuleName[] = Object.keys(RULES) as RuleName[]

function span(line: number, column: number, offset: number): Span {
  return { line, column, offset, length: 1 }
}

function related(fields: Partial<Related> & { readonly message: string }): Related {
  return { file: null, locale: null, key: null, span: null, ...fields }
}

function human(diagnostic: Diagnostic): readonly string[] {
  return renderHuman([diagnostic], { color: false }).split('\n')
}

function parsedJson(diagnostics: readonly Diagnostic[]): readonly Diagnostic[] {
  return (JSON.parse(renderJson(diagnostics, SUMMARY)) as { readonly diagnostics: readonly Diagnostic[] })
    .diagnostics
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('RULES ranges', () => {
  test('files every code under the thousand its owner range names', () => {
    const range: Record<string, string> = { '1': 'LZ1', '2': 'LZ2', '3': 'LZ3', '4': 'LZ4', '5': 'LZ5' }
    for (const rule of Object.values(RULES)) {
      expect(Object.values(range)).toContain(rule.code.slice(0, 3))
    }
  })

  test('numbers each range from 001 with no gap, so a removed rule cannot hide', () => {
    const byRange = new Map<string, number[]>()
    for (const rule of Object.values(RULES)) {
      const prefix = rule.code.slice(0, 3)
      byRange.set(prefix, [...(byRange.get(prefix) ?? []), Number(rule.code.slice(3))])
    }
    for (const numbers of byRange.values()) {
      expect(numbers).toEqual(numbers.map((_unused, index) => index + 1))
    }
  })

  test('holds no rule under a prototype name, so a lookup by name never reaches Object.prototype', () => {
    for (const name of ['__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty']) {
      expect(Object.hasOwn(RULES, name)).toBe(false)
    }
  })

  test('names every rule in lower kebab case', () => {
    for (const name of ALL_RULES) expect(name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  })
})

describe('diag over every rule', () => {
  test('stamps every rule at its default, with warn standing in for off', () => {
    for (const name of ALL_RULES) {
      const expected = RULES[name].severity === 'off' ? 'warn' : RULES[name].severity
      expect(diag(name, { message: name }).severity).toBe(expected)
    }
  })

  test('resolves fatal from the scope alone for every rule when no fatal is declared', () => {
    for (const name of ALL_RULES) {
      const scope = RULES[name].fatal
      expect(diag(name, { message: name }).fatal).toBe(scope === 'always' || scope === 'ifSource')
    }
  })

  test('lets a declared false clear only an ifSource rule', () => {
    for (const name of ALL_RULES) {
      expect(diag(name, { message: name, fatal: false }).fatal).toBe(RULES[name].fatal === 'always')
    }
  })

  test('keeps an always-fatal rule fatal when its producer declares false', () => {
    expect(diag('identifier-collision', { message: 'x', fatal: false }).fatal).toBe(true)
  })

  test('keeps a message-scoped rule non-fatal when its producer declares true', () => {
    expect(diag('icu-syntax', { message: 'x', fatal: true }).fatal).toBe(false)
  })
})

describe('diag on absent versus explicitly undefined fields', () => {
  test('treats an explicit undefined exactly as an absent field', () => {
    expect(
      diag('arg-missing', {
        message: 'name',
        hint: undefined,
        file: undefined,
        locale: undefined,
        key: undefined,
        span: undefined,
        related: undefined,
        fatal: undefined,
      }),
    ).toEqual(diag('arg-missing', { message: 'name' }))
  })

  test('defaults an ifSource rule to fatal when the declared fatal is explicitly undefined', () => {
    expect(diag('catalog-unreadable', { message: 'EACCES', fatal: undefined }).fatal).toBe(true)
  })

  test('keeps an empty string field rather than turning it into null', () => {
    const diagnostic = diag('arg-missing', { message: '', hint: '', file: '', locale: '', key: '' })
    expect([diagnostic.message, diagnostic.hint, diagnostic.file, diagnostic.locale, diagnostic.key]).toEqual([
      '',
      '',
      '',
      '',
      '',
    ])
  })

  test('never leaks the declared fatal field onto the diagnostic as an extra key', () => {
    const diagnostic = diag('catalog-json-syntax', { message: 'x', fatal: false })
    expect(Object.keys(diagnostic)).toEqual([
      'code',
      'rule',
      'severity',
      'fatal',
      'message',
      'hint',
      'file',
      'locale',
      'key',
      'span',
      'related',
    ])
  })

  test('returns a fresh object on every call, so one consumer cannot edit another', () => {
    expect(diag('arg-missing', { message: 'x' })).not.toBe(diag('arg-missing', { message: 'x' }))
  })
})

describe('applySeverity at the edges', () => {
  test('answers an empty list with an empty list', () => {
    expect(applySeverity([], { 'missing-translation': 'off' })).toEqual([])
  })

  test('lowers a default-off rule the user asked for to warn, not error', () => {
    const kept = applySeverity([diag('missing-description', { message: 'no description' })], {
      'missing-description': 'warn',
    })
    expect(kept.map((diagnostic) => diagnostic.severity)).toEqual(['warn'])
  })

  test('leaves an override for an unrelated rule without effect', () => {
    const produced = [diag('missing-translation', { message: 'no German' })]
    expect(applySeverity(produced, { 'extra-translation': 'off' })).toEqual(produced)
  })

  test('keeps every field but severity when it rewrites one', () => {
    const produced = diag('missing-translation', {
      message: 'no German',
      hint: 'translate it',
      file: 'locales/de.json',
      locale: 'de',
      key: 'cart.items',
      span: span(3, 5, 40),
      related: [related({ message: 'source' })],
    })
    const [kept] = applySeverity([produced], { 'missing-translation': 'warn' })
    expect(kept).toEqual({ ...produced, severity: 'warn' })
  })

  test('drops every copy of a turned-off rule and keeps every copy of the rest', () => {
    const produced = [
      diag('extra-translation', { message: '1' }),
      diag('arg-missing', { message: '2' }),
      diag('extra-translation', { message: '3' }),
      diag('arg-missing', { message: '4' }),
    ]
    expect(applySeverity(produced, { 'extra-translation': 'off' }).map((diagnostic) => diagnostic.message)).toEqual([
      '2',
      '4',
    ])
  })
})

describe('hasError and hasFatal at the edges', () => {
  test('answers false for an empty list', () => {
    expect(hasError([])).toBe(false)
    expect(hasFatal([])).toBe(false)
  })

  test('answers false for warnings alone, however many', () => {
    const warnings = Array.from({ length: 50 }, () => diag('ambiguous-source', { message: 'Open' }))
    expect(hasError(warnings)).toBe(false)
    expect(hasFatal(warnings)).toBe(false)
  })

  test('separates an error that blocks from one that does not', () => {
    const target = diag('catalog-json-syntax', { message: 'de.json', fatal: false })
    expect(hasError([target])).toBe(true)
    expect(hasFatal([target])).toBe(false)
    expect(hasFatal([target, diag('catalog-json-syntax', { message: 'en.json' })])).toBe(true)
  })
})

describe('exitCodeFor at the limits of the cap', () => {
  const one = [diag('ambiguous-source', { message: 'Open' })]

  test('is clean with nothing to report under a zero cap', () => {
    expect(exitCodeFor([], 0)).toBe(0)
  })

  test('treats the largest safe integer as a cap nobody reaches', () => {
    expect(exitCodeFor(one, Number.MAX_SAFE_INTEGER)).toBe(0)
  })

  test('fails one warning against a fractional cap below it', () => {
    expect(exitCodeFor(one, 0.5)).toBe(1)
  })

  test('reports one for an error even under no cap', () => {
    expect(exitCodeFor([diag('arg-missing', { message: 'x' })], Number.POSITIVE_INFINITY)).toBe(1)
  })

  test('counts a default-off rule stamped warn towards the cap when it reaches the counter', () => {
    expect(exitCodeFor([diag('unused-message', { message: 'never seen' })], 0)).toBe(1)
  })
})

describe('sortDiagnostics at the edges', () => {
  test('answers an empty list with an empty list', () => {
    expect(sortDiagnostics([])).toEqual([])
  })

  test('puts a diagnostic with no span before one at offset zero', () => {
    const atZero = diag('arg-missing', { message: 'x', file: 'a', span: span(1, 1, 0) })
    const spanless = diag('arg-missing', { message: 'x', file: 'a' })
    expect(sortDiagnostics([atZero, spanless])).toEqual([spanless, atZero])
  })

  test('puts a missing locale before a present one, and a missing key before a present one', () => {
    const withLocale = diag('arg-missing', { message: 'x', file: 'a', locale: 'de' })
    const withoutLocale = diag('arg-missing', { message: 'x', file: 'a', key: 'z' })
    expect(sortDiagnostics([withLocale, withoutLocale])).toEqual([withoutLocale, withLocale])
    const withKey = diag('arg-missing', { message: 'x', file: 'a', locale: 'de', key: 'a' })
    const withoutKey = diag('arg-missing', { message: 'x', file: 'a', locale: 'de' })
    expect(sortDiagnostics([withKey, withoutKey])).toEqual([withoutKey, withKey])
  })

  test('puts an empty string after null, since an empty field is still a field', () => {
    const empty = diag('arg-missing', { message: 'x', file: '' })
    const absent = diag('arg-missing', { message: 'x' })
    expect(sortDiagnostics([empty, absent])).toEqual([absent, empty])
  })

  test('orders keys outside the basic plane by code point, above every basic plane key', () => {
    const astral = diag('arg-missing', { message: 'x', key: '\u{1f600}' })
    const top = diag('arg-missing', { message: 'x', key: '￿' })
    expect(sortDiagnostics([astral, top]).map((diagnostic) => diagnostic.key)).toEqual(['￿', '\u{1f600}'])
  })

  test('keeps a composed and a decomposed key apart rather than collating them as one', () => {
    const composed = diag('arg-missing', { message: 'x', key: 'café' })
    const decomposed = diag('arg-missing', { message: 'x', key: 'café' })
    expect(sortDiagnostics([composed, decomposed]).map((diagnostic) => diagnostic.key)).toEqual([
      'café',
      'café',
    ])
  })

  test('orders codes across ranges as text, which matches their numeric order', () => {
    const sorted = sortDiagnostics(ALL_RULES.map((name) => diag(name, { message: name })).reverse())
    const errors = sorted.filter((diagnostic) => diagnostic.severity === 'error').map((diagnostic) => diagnostic.code)
    expect(errors).toEqual([...errors].sort((a, b) => Number(a.slice(2)) - Number(b.slice(2))))
  })

  test('orders a file by its parts rather than its length', () => {
    const files = ['locales/de/b.json', 'locales/de.json', 'locales/de-AT.json', 'locales/DE.json']
    const sorted = sortDiagnostics(files.map((file) => diag('arg-missing', { message: 'x', file })))
    expect(sorted.map((diagnostic) => diagnostic.file)).toEqual([
      'locales/DE.json',
      'locales/de-AT.json',
      'locales/de.json',
      'locales/de/b.json',
    ])
  })

  test('is stable for diagnostics that agree on every sort field', () => {
    const first = diag('arg-missing', { message: 'first', file: 'a', key: 'k' })
    const second = diag('arg-missing', { message: 'second', file: 'a', key: 'k' })
    expect(sortDiagnostics([first, second])).toEqual([first, second])
  })

  test('sorts a large shuffled set into the same order as its reverse', () => {
    const produced = Array.from({ length: 300 }, (_unused, index) =>
      diag(ALL_RULES[index % ALL_RULES.length] ?? 'arg-missing', {
        message: String(index),
        file: `locales/${index % 7}.json`,
        locale: index % 3 === 0 ? undefined : `l${index % 5}`,
        key: `k${index % 11}`,
        span: span(1, 1, index),
      }),
    )
    expect(sortDiagnostics([...produced].reverse())).toEqual(sortDiagnostics(produced))
  })
})

describe('renderHuman header at the edges', () => {
  test('leaves the location out when a span arrives with no file', () => {
    expect(human(diag('arg-missing', { message: 'x', span: span(3, 4, 30), key: 'k' }))[0]).toBe(
      'error  LZ3004  arg-missing  k',
    )
  })

  test('prints a location for a file at line one column one', () => {
    expect(human(diag('arg-missing', { message: 'x', file: 'a.json', span: span(1, 1, 0) }))[0]).toBe(
      'error  LZ3004  arg-missing  a.json:1:1',
    )
  })

  test('collapses a file path carrying CRLF into one header line', () => {
    const lines = human(diag('arg-missing', { message: 'x', file: 'locales/\r\nerror  LZ0000.json' }))
    expect(lines[0]).toBe('error  LZ3004  arg-missing  locales/ error  LZ0000.json')
    expect(lines).toHaveLength(3)
  })

  test('collapses a lone CR in a key, which a terminal would use to overwrite the header', () => {
    const lines = human(diag('arg-missing', { message: 'x', key: 'nav\rerror  LZ0000  clean' }))
    expect(lines[0]).toBe('error  LZ3004  arg-missing  nav error  LZ0000  clean')
  })

  test('keeps a key in a right-to-left script and with emoji byte for byte', () => {
    const key = 'مرحبا.\u{1f469}‍\u{1f4bb}'
    expect(human(diag('arg-missing', { message: 'x', key }))[0]).toBe(`error  LZ3004  arg-missing  ${key}`)
  })

  test('keeps a key named after a prototype field as plain text', () => {
    expect(human(diag('arg-missing', { message: 'x', key: '__proto__' }))[0]).toBe(
      'error  LZ3004  arg-missing  __proto__',
    )
  })

  test('keeps a locale with odd casing and an extension subtag as the producer wrote it', () => {
    expect(human(diag('locale-tag-invalid', { message: 'x', locale: 'EN-us-u-nu-LATN' }))[0]).toBe(
      'error  LZ1002  locale-tag-invalid  EN-us-u-nu-LATN',
    )
  })

  test('shows a byte order mark in a file name as text, since it is not a control character', () => {
    expect(human(diag('arg-missing', { message: 'x', file: '﻿en.json' }))[0]).toBe(
      'error  LZ3004  arg-missing  ﻿en.json',
    )
  })
})

describe('renderHuman body at the edges', () => {
  test('splits a CRLF message into lines rather than leaving a carriage return in each', () => {
    expect(human(diag('arg-missing', { message: 'first\r\nsecond' })).slice(2)).toEqual(['  first', '  second'])
  })

  test('neutralizes a lone CR inside a message, which would let the next text overwrite the line', () => {
    expect(human(diag('arg-missing', { message: 'all good\rforged' })).slice(2)).toEqual([
      '  all good<U+000D>forged',
    ])
  })

  test('prints a blank line inside a message as truly empty, with no trailing indent', () => {
    expect(human(diag('arg-missing', { message: 'first\n\nthird' })).slice(2)).toEqual(['  first', '', '  third'])
  })

  test('splits a CRLF hint, puts fix on the first line and indents the rest under it', () => {
    expect(human(diag('arg-missing', { message: 'x', hint: 'one\r\ntwo' })).slice(4)).toEqual([
      '  fix  one',
      '  two',
    ])
  })

  test('prints the fix label even for a hint that opens with an empty line', () => {
    expect(human(diag('arg-missing', { message: 'x', hint: '\nsecond' })).slice(4)).toEqual(['  fix  ', '  second'])
  })

  test('renders the related block before the hint', () => {
    const lines = human(
      diag('arg-missing', { message: 'x', hint: 'do it', related: [related({ key: 'k', message: 'here' })] }),
    )
    expect(lines.slice(2)).toEqual(['  x', '', '    k    here', '', '  fix  do it'])
  })

  test('leaves a lone surrogate in the message rather than dropping the text around it', () => {
    expect(human(diag('arg-missing', { message: 'a\ud800b' }))[2]).toBe('  a\ud800b')
  })

  test('renders a very long message on one line without truncating it', () => {
    const message = 'x'.repeat(100_000)
    expect(human(diag('arg-missing', { message }))[2]).toBe(`  ${message}`)
  })
})

describe('renderHuman related rows at the edges', () => {
  test('indents a row with no label and no location straight to its message', () => {
    const lines = human(diag('arg-missing', { message: 'x', related: [related({ message: 'only text' })] }))
    expect(lines.slice(4)).toEqual(['    only text'])
  })

  test('falls back to the locale for the label when a row has no key', () => {
    const lines = human(diag('arg-missing', { message: 'x', related: [related({ locale: 'de', message: 'here' })] }))
    expect(lines.slice(4)).toEqual(['    de    here'])
  })

  test('prefers the key over the locale for the label when a row has both', () => {
    const lines = human(
      diag('arg-missing', { message: 'x', related: [related({ key: 'k', locale: 'de', message: 'here' })] }),
    )
    expect(lines.slice(4)).toEqual(['    k    here'])
  })

  test('leaves the location column out when a related row has a span but no file', () => {
    const lines = human(
      diag('arg-missing', { message: 'x', related: [related({ key: 'k', span: span(2, 2, 9), message: 'here' })] }),
    )
    expect(lines.slice(4)).toEqual(['    k    here'])
  })

  test('pads every row to the widest label and the widest location', () => {
    const lines = human(
      diag('arg-missing', {
        message: 'x',
        related: [
          related({ key: 'a', file: 'f.json', span: span(1, 1, 0), message: 'one' }),
          related({ key: 'longer.key', file: 'g.json', message: 'two' }),
        ],
      }),
    )
    expect(lines.slice(4)).toEqual([
      '    a             f.json:1:1     one',
      '    longer.key    g.json         two',
    ])
  })

  test('keeps the row order the producer gave, since a row order can carry meaning', () => {
    const lines = human(
      diag('arg-missing', {
        message: 'x',
        related: [related({ key: 'z', message: '1' }), related({ key: 'a', message: '2' })],
      }),
    )
    expect(lines.slice(4)).toEqual(['    z    1', '    a    2'])
  })

  test('keeps an empty related list from printing a blank related block', () => {
    expect(human(diag('arg-missing', { message: 'x', related: [] }))).toEqual(['error  LZ3004  arg-missing', '', '  x'])
  })
})

describe('renderHuman colour', () => {
  test('paints warn in a different colour from error', () => {
    vi.stubEnv('NO_COLOR', '')
    const painted = renderHuman([diag('ambiguous-source', { message: 'Open' })], { color: true })
    expect(painted).toContain('\u001b[33mwarn\u001b[39m')
  })

  test('paints the location and dims the code', () => {
    vi.stubEnv('NO_COLOR', '')
    const painted = renderHuman([diag('arg-missing', { message: 'x', file: 'a.json' })], { color: true })
    expect(painted).toContain('\u001b[36ma.json\u001b[39m')
    expect(painted).toContain('\u001b[2mLZ3004\u001b[22m')
  })

  test('prints plain text when the caller asks for no colour, whatever NO_COLOR says', () => {
    vi.stubEnv('NO_COLOR', '')
    expect(renderHuman([diag('arg-missing', { message: 'x' })], { color: false })).not.toContain('\u001b[')
  })

  test('strips nothing but colour, so the painted text reads the same once the codes are removed', () => {
    vi.stubEnv('NO_COLOR', '')
    const diagnostic = diag('arg-missing', { message: 'x', file: 'a.json', locale: 'de', key: 'k', hint: 'h' })
    const painted = renderHuman([diagnostic], { color: true })
    expect(painted.replaceAll(/\u001b\[\d+m/gu, '')).toBe(renderHuman([diagnostic], { color: false }))
  })
})

describe('renderJson at the edges', () => {
  test('prints an empty run as an empty list beside the summary', () => {
    const parsed = JSON.parse(renderJson([], SUMMARY)) as unknown
    expect(parsed).toEqual({ schema: 1, diagnostics: [], summary: SUMMARY })
  })

  test('keeps the top-level fields in schema, diagnostics, summary order', () => {
    expect(Object.keys(JSON.parse(renderJson([], SUMMARY)) as object)).toEqual(['schema', 'diagnostics', 'summary'])
  })

  test('escapes a lone surrogate so the output stays well-formed UTF-8', () => {
    const out = renderJson([diag('arg-missing', { message: 'a\ud800b' })], SUMMARY)
    expect(out).toContain('a\\ud800b')
    expect(out).not.toMatch(/[\ud800-\udfff]/u)
  })

  test('round trips a lone surrogate back to the code unit the catalog held', () => {
    expect(parsedJson([diag('arg-missing', { message: 'a\udfffb' })])[0]?.message).toBe('a\udfffb')
  })

  test('round trips CRLF, a lone CR, a BOM, a right-to-left mark and a combining mark', () => {
    const message = 'one\r\ntwo\rthree﻿‏café'
    expect(parsedJson([diag('arg-missing', { message })])[0]?.message).toBe(message)
  })

  test('round trips a backslash sitting directly before a C1 control', () => {
    const message = 'path\\\u0085next'
    expect(parsedJson([diag('arg-missing', { message })])[0]?.message).toBe(message)
  })

  test('round trips the C1 escape in a key, a file and a related row, not only the message', () => {
    const control = '\u009b2K'
    const [parsed] = parsedJson([
      diag('arg-missing', {
        message: 'x',
        key: control,
        file: control,
        related: [related({ message: control })],
      }),
    ])
    expect([parsed?.key, parsed?.file, parsed?.related[0]?.message]).toEqual([control, control, control])
  })

  test('leaves U+00A0, the first character past the C1 block, unescaped', () => {
    expect(renderJson([diag('arg-missing', { message: 'a b' })], SUMMARY)).toContain('a b')
  })

  test('prints a key named __proto__ as an ordinary field value', () => {
    expect(parsedJson([diag('arg-missing', { message: 'x', key: '__proto__' })])[0]?.key).toBe('__proto__')
  })

  test('sorts by severity first, so the producer order never reaches the output', () => {
    const warning = diag('ambiguous-source', { message: 'w' })
    const error = diag('missing-translation', { message: 'e' })
    expect(renderJson([warning, error], SUMMARY)).toBe(renderJson([error, warning], SUMMARY))
  })

  test('does not mutate the list it was handed', () => {
    const warning = diag('ambiguous-source', { message: 'w' })
    const error = diag('missing-translation', { message: 'e' })
    const input = [warning, error]
    renderJson(input, SUMMARY)
    expect(input).toEqual([warning, error])
  })

  test('prints the same bytes when asked twice', () => {
    const produced = ALL_RULES.map((name) => diag(name, { message: name }))
    expect(renderJson(produced, SUMMARY)).toBe(renderJson(produced, SUMMARY))
  })
})
