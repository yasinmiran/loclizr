import { describe, expect, it } from 'vitest'
import { diag } from '../diagnostics'
import type { Diagnostic } from '../types'
import { buildResult, program, summary } from './__fixtures__/results'
import { renderReport } from './report'

const missing: Diagnostic = diag('missing-translation', {
  message: 'de has no value for cart.items.',
  file: 'locales/de.json',
  locale: 'de',
  key: 'cart.items',
})

const orphan: Diagnostic = diag('plural-suffix-orphan', {
  message: 'items_one has no items_other sibling.',
  file: 'locales/en.json',
  locale: 'en',
  key: 'items_one',
})

const plain = { reporter: 'human', quiet: false, color: false } as const

describe('renderReport, human', () => {
  it('prints diagnostics above a summary', () => {
    const text = renderReport(
      buildResult({
        diagnostics: [missing, orphan],
        summary: summary({ errors: 1, warnings: 1, messages: 12, locales: 3 }),
      }),
      plain,
    )

    expect(text).toContain('LZ3001')
    expect(text).toContain('LZ1014')
    expect(text.trimEnd().split('\n').at(-1)).toBe('12 messages, 3 locales (source en), 1 error, 1 warning')
  })

  it('names how many messages fell back and to which locale', () => {
    const text = renderReport(
      buildResult({
        summary: summary({
          messages: 3,
          locales: 3,
          fellBack: [
            { locale: 'de', count: 2 },
            { locale: 'de-AT', count: 2 },
          ],
        }),
      }),
      plain,
    )

    expect(text).toContain('fell back to source text: de 2, de-AT 2')
  })

  it('leaves the fallback line out when nothing fell back', () => {
    expect(renderReport(buildResult(), plain)).not.toContain('fell back')
  })

  it('pluralizes counts', () => {
    const text = renderReport(
      buildResult({ summary: summary({ messages: 1, locales: 1, errors: 2, warnings: 0 }) }),
      plain,
    )

    expect(text).toContain('1 message, 1 locale (source en), 2 errors, 0 warnings')
  })

  it('sorts diagnostics before printing them', () => {
    const text = renderReport(buildResult({ diagnostics: [orphan, missing] }), plain)

    expect(text.indexOf('LZ3001')).toBeLessThan(text.indexOf('LZ1014'))
  })

  it('prints nothing but the summary on a clean run', () => {
    expect(renderReport(buildResult({ summary: summary({ messages: 4, locales: 2 }) }), plain)).toBe(
      '4 messages, 2 locales (source en), 0 errors, 0 warnings\n',
    )
  })

  it('prints no summary when the tool could not run', () => {
    const text = renderReport(
      buildResult({ program: null, exitCode: 2, ok: false, diagnostics: [missing] }),
      plain,
    )

    expect(text).toContain('LZ3001')
    expect(text).not.toContain('messages,')
  })
})

describe('renderReport, what the run produced', () => {
  const wrote = buildResult({
    written: [
      'src/loclizr/messages.js',
      'src/loclizr/messages/cart.js',
      'locales/loclizr.context.json',
    ],
    summary: summary({ messages: 4, locales: 1 }),
  })

  it('names the generated tree and the record beside the counts', () => {
    const text = renderReport(wrote, plain)

    expect(text.split('\n')[0]).toBe(
      'wrote src/loclizr (2 files) and locales/loclizr.context.json',
    )
    expect(text).toContain('4 messages, 1 locale (source en), 0 errors, 0 warnings')
  })

  it('asks for the record to be committed, which is the artifact the gate reads', () => {
    expect(renderReport(wrote, plain)).toContain(
      'commit locales/loclizr.context.json; `loclizr check` compares it',
    )
  })

  it('leaves that line to LZ5007 when the record was rewritten', () => {
    const text = renderReport(
      buildResult({
        ...wrote,
        diagnostics: [
          diag('record-rewritten', { message: '`locales/loclizr.context.json` was rewritten.' }),
        ],
      }),
      plain,
    )

    expect(text).toContain('wrote src/loclizr (2 files)')
    expect(text).not.toContain('commit locales/loclizr.context.json;')
  })

  it('names nothing on a run that wrote nothing, which is every check', () => {
    expect(renderReport(buildResult({ summary: summary({ messages: 4 }) }), plain)).not.toContain(
      'wrote',
    )
  })

  it('counts one generated file as one', () => {
    const text = renderReport(buildResult({ written: ['src/loclizr/messages.js'] }), plain)

    expect(text).toContain('wrote src/loclizr (1 file)')
    expect(text).not.toContain('commit')
  })

  it('names the source locale it was given, not en', () => {
    const text = renderReport(
      buildResult({
        program: { ...program(), sourceLocale: 'de' },
        summary: summary({ messages: 1, locales: 1 }),
      }),
      plain,
    )

    expect(text).toContain('1 message, 1 locale (source de), 0 errors, 0 warnings')
  })
})

describe('renderReport, --quiet', () => {
  it('drops warn diagnostics and keeps errors', () => {
    const text = renderReport(buildResult({ diagnostics: [missing, orphan] }), {
      ...plain,
      quiet: true,
    })

    expect(text).toContain('LZ3001')
    expect(text).not.toContain('LZ1014')
  })

  it('accounts for the warnings it dropped, so a failing run is never silent', () => {
    const text = renderReport(
      buildResult({
        exitCode: 1,
        ok: false,
        diagnostics: [orphan],
        summary: summary({ warnings: 1, messages: 4, locales: 2 }),
      }),
      { ...plain, quiet: true },
    )

    expect(text).not.toContain('LZ1014')
    expect(text).toBe('4 messages, 2 locales (source en), 0 errors, 1 warning\n')
  })

  it('prints nothing on a clean run, which is what --quiet is for', () => {
    expect(renderReport(buildResult(), { ...plain, quiet: true })).toBe('')
  })

  it('keeps the artifact lines out, so the counts stay the one line it prints', () => {
    const text = renderReport(
      buildResult({
        exitCode: 1,
        ok: false,
        diagnostics: [orphan],
        written: ['src/loclizr/messages.js', 'locales/loclizr.context.json'],
        summary: summary({ warnings: 1, messages: 4, locales: 2 }),
      }),
      { ...plain, quiet: true },
    )

    expect(text).toBe('4 messages, 2 locales (source en), 0 errors, 1 warning\n')
  })

  it('leaves the summary out when the filter dropped nothing', () => {
    const text = renderReport(
      buildResult({ diagnostics: [missing], summary: summary({ errors: 1, messages: 4 }) }),
      { ...plain, quiet: true },
    )

    expect(text).toContain('LZ3001')
    expect(text).not.toContain('messages,')
  })

  it('does not thin the json payload, whose counts have to agree', () => {
    const text = renderReport(buildResult({ diagnostics: [missing, orphan] }), {
      reporter: 'json',
      quiet: true,
      color: false,
    })

    expect(JSON.parse(text)).toMatchObject({
      schema: 1,
      diagnostics: [{ code: 'LZ3001' }, { code: 'LZ1014' }],
    })
  })
})

describe('renderReport, json', () => {
  it('prints schema, diagnostics and summary', () => {
    const text = renderReport(
      buildResult({
        diagnostics: [orphan, missing],
        summary: summary({ errors: 1, warnings: 1, messages: 9, locales: 2 }),
      }),
      { reporter: 'json', quiet: false, color: false },
    )

    expect(text.endsWith('\n')).toBe(true)
    expect(JSON.parse(text)).toEqual({
      schema: 1,
      diagnostics: [
        expect.objectContaining({ code: 'LZ3001', rule: 'missing-translation' }),
        expect.objectContaining({ code: 'LZ1014', rule: 'plural-suffix-orphan' }),
      ],
      summary: { errors: 1, warnings: 1, messages: 9, locales: 2, fellBack: [] },
    })
  })
})
