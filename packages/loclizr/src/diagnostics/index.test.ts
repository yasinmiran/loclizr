import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Diagnostic, RuleName, Span, Summary } from '../types'
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

function span(line: number, column: number, offset: number): Span {
  return { line, column, offset, length: 4 }
}

function namesWhere(predicate: (rule: (typeof RULES)[RuleName]) => boolean): readonly string[] {
  return Object.values(RULES)
    .filter(predicate)
    .map((rule) => rule.name)
    .sort()
}

const AMBIGUOUS_SOURCE = diag('ambiguous-source', {
  message:
    'Three keys share the source text "Open" and two have no description.\nA translator cannot tell a verb from an adjective.',
  file: 'locales/en.json',
  span: span(12, 5, 180),
  related: [
    {
      file: 'locales/en.json',
      locale: null,
      key: 'dialog.open',
      span: span(12, 5, 180),
      message: 'no description',
    },
    {
      file: 'locales/en.json',
      locale: null,
      key: 'file.open',
      span: span(31, 7, 520),
      message: 'no description',
    },
    {
      file: 'locales/en.json',
      locale: null,
      key: 'status.open',
      span: span(58, 3, 940),
      message: '"Badge on a ticket that is not closed"',
    },
  ],
  hint: [
    'add descriptions in locales/en.meta.json:',
    '       "dialog.open": { "description": "Button that opens the selected file" }',
    '       "file.open":   { "description": "Menu item under File" }',
    "or   turn the rule down in loclizr.config.ts:",
    "       severity: { 'ambiguous-source': 'warn' }",
  ].join('\n'),
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('RULES', () => {
  test('carries the fifty-four rules of the catalog', () => {
    expect(Object.keys(RULES)).toHaveLength(54)
  })

  test('keys the table by the rule name it holds', () => {
    for (const [key, rule] of Object.entries(RULES)) expect(rule.name).toBe(key)
  })

  test('gives every rule a unique stable code', () => {
    const codes = Object.values(RULES).map((rule) => rule.code)
    for (const code of codes) expect(code).toMatch(/^LZ\d{4}$/)
    expect(new Set(codes).size).toBe(codes.length)
  })

  test('exits two for exactly the three rules that mean the tool could not run', () => {
    expect(namesWhere((rule) => rule.exitTwo)).toEqual([
      'config-invalid',
      'outdir-unsafe',
      'output-unwritable',
    ])
  })

  test('defaults exactly three rules to off', () => {
    expect(namesWhere((rule) => rule.severity === 'off')).toEqual([
      'date-without-timezone',
      'missing-description',
      'unused-message',
    ])
  })

  test('scopes fatality to the catalog reads that only matter for the source locale', () => {
    expect(namesWhere((rule) => rule.fatal === 'ifSource')).toEqual([
      'catalog-json-syntax',
      'catalog-unreadable',
    ])
  })

  test('scopes fatality to one message for the failures that drop a single message', () => {
    expect(namesWhere((rule) => rule.fatal === 'message')).toEqual([
      'arg-type-conflict-local',
      'icu-syntax',
      'plural-other-missing',
      'select-other-missing',
    ])
  })

  test('blocks emission entirely for the rules that cannot produce a correct artifact', () => {
    expect(namesWhere((rule) => rule.fatal === 'always')).toEqual([
      'config-invalid',
      'identifier-collision',
      'identifier-reserved',
      'locale-tag-invalid',
      'no-catalogs-found',
      'nondeterministic-output',
      'outdir-unsafe',
      'output-unwritable',
      'source-catalog-missing',
    ])
  })

  test('gives every rule an owning module that can produce it', () => {
    for (const rule of Object.values(RULES)) {
      expect(['M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9', 'M10']).toContain(rule.owner)
    }
  })
})

describe('diag', () => {
  test('stamps the code and the rule default severity', () => {
    const diagnostic = diag('missing-translation', { message: 'no German for cart.items' })
    expect(diagnostic.code).toBe('LZ3001')
    expect(diagnostic.rule).toBe('missing-translation')
    expect(diagnostic.severity).toBe('error')
  })

  test('stamps warn where the rule default is off, because off is not representable', () => {
    expect(diag('unused-message', { message: 'never seen' }).severity).toBe('warn')
    expect(diag('date-without-timezone', { message: 'no zone' }).severity).toBe('warn')
  })

  test('fills every optional field with null and related with an empty list', () => {
    expect(diag('duplicate-key', { message: 'twice' })).toEqual({
      code: 'LZ1011',
      rule: 'duplicate-key',
      severity: 'error',
      fatal: false,
      message: 'twice',
      hint: null,
      file: null,
      locale: null,
      key: null,
      span: null,
      related: [],
    })
  })

  test('resolves an always-fatal rule to fatal', () => {
    expect(diag('identifier-collision', { message: 'two keys, one identifier' }).fatal).toBe(true)
  })

  test('resolves a message-scoped rule to not fatal, because it drops one message and blocks nothing', () => {
    expect(diag('icu-syntax', { message: 'unclosed brace' }).fatal).toBe(false)
  })

  test('defaults an ifSource rule to fatal, so a forgotten field blocks the build', () => {
    expect(diag('catalog-unreadable', { message: 'EACCES' }).fatal).toBe(true)
  })

  test('lets the only module that knows the file clear an ifSource rule for a target catalog', () => {
    expect(diag('catalog-json-syntax', { message: 'bad json', fatal: false }).fatal).toBe(false)
    expect(diag('catalog-json-syntax', { message: 'bad json', fatal: true }).fatal).toBe(true)
  })

  test('ignores a declared fatal on a rule whose scope is not ifSource', () => {
    expect(diag('catalog-missing', { message: 'no de.json', fatal: true }).fatal).toBe(false)
  })
})

describe('applySeverity', () => {
  test('drops a diagnostic whose rule the user turned off', () => {
    const diagnostics = [diag('extra-translation', { message: 'de has cart.legacy' })]
    expect(applySeverity(diagnostics, { 'extra-translation': 'off' })).toEqual([])
  })

  test('drops a default-off rule with no configuration reaching its producer', () => {
    expect(applySeverity([diag('unused-message', { message: 'never seen' })], {})).toEqual([])
  })

  test('keeps a default-off rule the user asked for, at the severity they asked for', () => {
    const kept = applySeverity([diag('unused-message', { message: 'never seen' })], {
      'unused-message': 'error',
    })
    expect(kept).toHaveLength(1)
    expect(kept[0]?.severity).toBe('error')
  })

  test('never consults the stamped severity, only the rule default and the override', () => {
    const stamped = diag('missing-translation', { message: 'no German' })
    expect(applySeverity([stamped], { 'missing-translation': 'warn' })[0]?.severity).toBe('warn')
  })

  test('a fatal rule turned down to warn stops being fatal', () => {
    const fatal = [diag('locale-tag-invalid', { message: 'sp is not a locale' })]
    expect(hasFatal(fatal)).toBe(true)
    const relevelled = applySeverity(fatal, { 'locale-tag-invalid': 'warn' })
    expect(hasFatal(relevelled)).toBe(false)
    expect(hasError(relevelled)).toBe(false)
    expect(relevelled[0]?.fatal).toBe(true)
  })

  test('skips the three rules that are not re-levelable, even when named', () => {
    const diagnostics = [
      diag('config-invalid', { message: 'severity names outdir-unsafe' }),
      diag('outdir-unsafe', { message: 'outDir escapes the project root' }),
      diag('output-unwritable', { message: 'EROFS' }),
    ]
    const kept = applySeverity(diagnostics, {
      'config-invalid': 'off',
      'outdir-unsafe': 'warn',
      'output-unwritable': 'off',
    })
    expect(kept).toEqual(diagnostics)
    expect(hasFatal(kept)).toBe(true)
  })

  test('preserves input order and leaves the originals untouched', () => {
    const first = diag('arg-missing', { message: 'name', key: 'b' })
    const second = diag('arg-extra', { message: 'nmae', key: 'a' })
    const kept = applySeverity([first, second], { 'arg-missing': 'warn' })
    expect(kept.map((diagnostic) => diagnostic.key)).toEqual(['b', 'a'])
    expect(first.severity).toBe('error')
  })
})

describe('exitCodeFor', () => {
  test('is clean with nothing to report', () => {
    expect(exitCodeFor([], Number.POSITIVE_INFINITY)).toBe(0)
  })

  test('lets warnings alone pass when no cap was given', () => {
    const warnings = Array.from({ length: 400 }, () => diag('ambiguous-source', { message: 'Open' }))
    expect(exitCodeFor(warnings, Number.POSITIVE_INFINITY)).toBe(0)
  })

  test('fails on warnings over the cap', () => {
    const warnings = [diag('ambiguous-source', { message: 'Open' })]
    expect(exitCodeFor(warnings, 0)).toBe(1)
    expect(exitCodeFor(warnings, 1)).toBe(0)
  })

  test('fails on any error', () => {
    expect(exitCodeFor([diag('missing-translation', { message: 'no German' })], 0)).toBe(1)
  })

  test('reports two when the tool could not run, even beside ordinary errors', () => {
    const diagnostics = [
      diag('missing-translation', { message: 'no German' }),
      diag('outdir-unsafe', { message: 'outDir escapes the project root' }),
    ]
    expect(exitCodeFor(diagnostics, Number.POSITIVE_INFINITY)).toBe(2)
  })

  test('does not report two for an exit-two rule that no longer carries error severity', () => {
    const warned: Diagnostic = {
      ...diag('output-unwritable', { message: 'EROFS' }),
      severity: 'warn',
    }
    expect(exitCodeFor([warned], Number.POSITIVE_INFINITY)).toBe(0)
  })
})

describe('sortDiagnostics', () => {
  test('puts errors before warnings', () => {
    const warning = diag('ambiguous-source', { message: 'Open' })
    const error = diag('missing-translation', { message: 'no German' })
    expect(sortDiagnostics([warning, error]).map((diagnostic) => diagnostic.code)).toEqual([
      'LZ3001',
      'LZ3012',
    ])
  })

  test('orders by code, then file, then locale, then key, then offset', () => {
    const base = { message: 'x', file: 'locales/de.json' } as const
    const diagnostics = [
      diag('arg-missing', { ...base, locale: 'de', key: 'b', span: span(2, 1, 20) }),
      diag('arg-missing', { ...base, locale: 'de', key: 'a', span: span(9, 1, 90) }),
      diag('arg-missing', { ...base, locale: 'de', key: 'a', span: span(1, 1, 10) }),
      diag('arg-missing', { ...base, file: 'locales/da.json', locale: 'da', key: 'z' }),
      diag('arg-extra', { ...base, locale: 'de', key: 'z' }),
    ]
    expect(
      sortDiagnostics(diagnostics).map((diagnostic) => `${diagnostic.code} ${diagnostic.file} ${diagnostic.key}`),
    ).toEqual([
      'LZ3004 locales/da.json z',
      'LZ3004 locales/de.json a',
      'LZ3004 locales/de.json a',
      'LZ3004 locales/de.json b',
      'LZ3005 locales/de.json z',
    ])
    const [, first, second] = sortDiagnostics(diagnostics)
    expect(first?.span?.offset).toBe(10)
    expect(second?.span?.offset).toBe(90)
  })

  test('sorts a missing field before a present one and copies rather than mutates', () => {
    const withoutFile = diag('arg-missing', { message: 'x' })
    const withFile = diag('arg-missing', { message: 'x', file: 'locales/en.json' })
    const input = [withFile, withoutFile]
    expect(sortDiagnostics(input)[0]).toBe(withoutFile)
    expect(input[0]).toBe(withFile)
  })
})

describe('renderHuman', () => {
  test('renders the ambiguous-source report exactly as the reference output prints it', () => {
    const raised = applySeverity([AMBIGUOUS_SOURCE], { 'ambiguous-source': 'error' })
    expect(renderHuman(raised, { color: false })).toBe(
      [
        'error  LZ3012  ambiguous-source  locales/en.json:12:5',
        '',
        '  Three keys share the source text "Open" and two have no description.',
        '  A translator cannot tell a verb from an adjective.',
        '',
        '    dialog.open    locales/en.json:12:5     no description',
        '    file.open      locales/en.json:31:7     no description',
        '    status.open    locales/en.json:58:3     "Badge on a ticket that is not closed"',
        '',
        '  fix  add descriptions in locales/en.meta.json:',
        '         "dialog.open": { "description": "Button that opens the selected file" }',
        '         "file.open":   { "description": "Menu item under File" }',
        '  or   turn the rule down in loclizr.config.ts:',
        "         severity: { 'ambiguous-source': 'warn' }",
      ].join('\n'),
    )
  })

  test('renders the same report with warn in the severity column where the rule is left at its default', () => {
    expect(renderHuman([AMBIGUOUS_SOURCE], { color: false }).split('\n')[0]).toBe(
      'warn  LZ3012  ambiguous-source  locales/en.json:12:5',
    )
  })

  test('names the locale and the key when a diagnostic carries them', () => {
    const diagnostic = diag('missing-translation', {
      message: 'cart.items has no German translation',
      file: 'locales/de.json',
      locale: 'de',
      key: 'cart.items',
    })
    expect(renderHuman([diagnostic], { color: false })).toBe(
      [
        'error  LZ3001  missing-translation  locales/de.json  de  cart.items',
        '',
        '  cart.items has no German translation',
      ].join('\n'),
    )
  })

  test('omits the location when a diagnostic has no file', () => {
    const diagnostic = diag('locale-tag-invalid', { message: 'sp is not a locale', locale: 'sp' })
    expect(renderHuman([diagnostic], { color: false }).split('\n')[0]).toBe(
      'error  LZ1002  locale-tag-invalid  sp',
    )
  })

  test('separates several reports with a blank line and renders nothing for none', () => {
    const first = diag('arg-missing', { message: 'name' })
    const second = diag('arg-extra', { message: 'nmae' })
    expect(renderHuman([first, second], { color: false })).toBe(
      ['error  LZ3004  arg-missing', '', '  name', '', 'error  LZ3005  arg-extra', '', '  nmae'].join(
        '\n',
      ),
    )
    expect(renderHuman([], { color: false })).toBe('')
  })

  test('paints the severity when colour is asked for', () => {
    vi.stubEnv('NO_COLOR', '')
    const painted = renderHuman([diag('arg-missing', { message: 'name' })], { color: true })
    expect(painted).toContain('\u001b[31merror\u001b[39m')
  })

  test('honours NO_COLOR over the caller', () => {
    vi.stubEnv('NO_COLOR', '1')
    const painted = renderHuman([diag('arg-missing', { message: 'name' })], { color: true })
    expect(painted).not.toContain('\u001b[')
  })
})

describe('renderJson', () => {
  const summary: Summary = {
    errors: 1,
    warnings: 1,
    messages: 9,
    locales: 3,
    fellBack: [{ locale: 'de', count: 2 }],
  }

  test('prints the schema, the sorted diagnostics and the summary', () => {
    const warning = diag('ambiguous-source', { message: 'Open' })
    const error = diag('missing-translation', { message: 'no German' })
    const out = renderJson([warning, error], summary)
    expect(out.startsWith('{\n  "schema": 1,')).toBe(true)
    const parsed = JSON.parse(out) as {
      schema: number
      diagnostics: readonly Diagnostic[]
      summary: Summary
    }
    expect(parsed.schema).toBe(1)
    expect(parsed.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['LZ3001', 'LZ3012'])
    expect(parsed.summary).toEqual(summary)
  })

  test('keeps a null field rather than dropping it', () => {
    const parsed = JSON.parse(renderJson([diag('arg-missing', { message: 'name' })], summary)) as {
      diagnostics: readonly Diagnostic[]
    }
    expect(parsed.diagnostics[0]).toEqual({
      code: 'LZ3004',
      rule: 'arg-missing',
      severity: 'error',
      fatal: false,
      message: 'name',
      hint: null,
      file: null,
      locale: null,
      key: null,
      span: null,
      related: [],
    })
  })
})
