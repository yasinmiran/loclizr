import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { diag } from '../diagnostics'
import type { BuildResult, Diagnostic } from '../types'
import { buildResult, config, program, summary } from './__fixtures__/results'
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
const json = { reporter: 'json', quiet: false, color: false } as const

const ESC = '\u001b['

function withRecord(record: string | false, fields: Partial<BuildResult>): BuildResult {
  return buildResult({ program: { ...program(), config: { ...config(), record } }, ...fields })
}

describe('the artifact lines name only what was written', () => {
  it('names the tree and asks for no commit when the record is turned off', () => {
    const text = renderReport(
      withRecord(false, { written: ['src/loclizr/messages.js', 'src/loclizr/_locale.js'] }),
      plain,
    )

    expect(text.split('\n')[0]).toBe('wrote src/loclizr (2 files)')
    expect(text).not.toContain('commit')
  })

  it('names the record alone when only the record was written', () => {
    const text = renderReport(buildResult({ written: ['locales/loclizr.context.json'] }), plain)

    expect(text.split('\n')[0]).toBe('wrote locales/loclizr.context.json')
    expect(text).toContain('commit locales/loclizr.context.json; `loclizr check` compares it')
  })

  it('does not count a sibling directory that only shares the outDir prefix', () => {
    const text = renderReport(
      buildResult({ written: ['src/loclizr-legacy/messages.js', 'src/loclizrx.js'] }),
      plain,
    )

    expect(text).not.toContain('wrote')
  })

  it('does not count a written path equal to outDir itself', () => {
    expect(renderReport(buildResult({ written: ['src/loclizr'] }), plain)).not.toContain('wrote')
  })

  it('counts files nested at any depth under outDir', () => {
    const text = renderReport(
      buildResult({ written: ['src/loclizr/a/b/c/d.js', 'src/loclizr/messages.d.ts'] }),
      plain,
    )

    expect(text).toContain('wrote src/loclizr (2 files)')
  })

  it('keeps a non ASCII outDir and record path verbatim', () => {
    const result = buildResult({
      program: {
        ...program(),
        config: { ...config(), outDir: 'src/übersetzung', record: 'locales/контекст.json' },
      },
      written: ['src/übersetzung/messages.js', 'locales/контекст.json'],
    })

    expect(renderReport(result, plain).split('\n')[0]).toBe(
      'wrote src/übersetzung (1 file) and locales/контекст.json',
    )
  })

  it('does not name a record path that was not among the written files', () => {
    const text = renderReport(buildResult({ written: ['src/loclizr/messages.js'] }), plain)

    expect(text).not.toContain('loclizr.context.json')
  })
})

describe('the counts line', () => {
  it('pluralizes zero', () => {
    expect(renderReport(buildResult(), plain)).toBe(
      '0 messages, 0 locales (source en), 0 errors, 0 warnings\n',
    )
  })

  it('prints a large count in full', () => {
    const text = renderReport(
      buildResult({ summary: summary({ messages: Number.MAX_SAFE_INTEGER, locales: 1 }) }),
      plain,
    )

    expect(text).toContain(`${Number.MAX_SAFE_INTEGER} messages, 1 locale`)
  })

  it('names a source locale with an extension subtag verbatim', () => {
    const text = renderReport(
      buildResult({ program: { ...program(), sourceLocale: 'en-u-nu-latn' } }),
      plain,
    )

    expect(text).toContain('(source en-u-nu-latn)')
  })

  it('names one fallback locale without a separator', () => {
    const text = renderReport(
      buildResult({ summary: summary({ fellBack: [{ locale: 'de', count: 1 }] }) }),
      plain,
    )

    expect(text.trimEnd().split('\n').at(-1)).toBe('fell back to source text: de 1')
  })

  it('keeps the fallback order the summary gave it', () => {
    const text = renderReport(
      buildResult({
        summary: summary({
          fellBack: [
            { locale: 'de', count: 3 },
            { locale: 'de-AT', count: 1 },
            { locale: 'zh-Hant', count: 2 },
          ],
        }),
      }),
      plain,
    )

    expect(text).toContain('fell back to source text: de 3, de-AT 1, zh-Hant 2')
  })
})

describe('--quiet with both severities', () => {
  const both = buildResult({
    exitCode: 1,
    ok: false,
    diagnostics: [orphan, missing],
    written: ['src/loclizr/messages.js', 'locales/loclizr.context.json'],
    summary: summary({ errors: 1, warnings: 1, messages: 4, locales: 2 }),
  })

  it('prints the error and then the counts that account for the dropped warning', () => {
    const text = renderReport(both, { ...plain, quiet: true })

    expect(text).toContain('LZ3001')
    expect(text).not.toContain('LZ1014')
    expect(text.trimEnd().split('\n').at(-1)).toBe(
      '4 messages, 2 locales (source en), 1 error, 1 warning',
    )
  })

  it('keeps the artifact lines out even when errors are printed', () => {
    const text = renderReport(both, { ...plain, quiet: true })

    expect(text).not.toContain('wrote')
    expect(text).not.toContain('commit')
  })
})

describe('the report is a function of the result, not of its order', () => {
  it('prints byte identical human text whatever order the diagnostics arrive in', () => {
    const forward = renderReport(buildResult({ diagnostics: [missing, orphan] }), plain)
    const backward = renderReport(buildResult({ diagnostics: [orphan, missing] }), plain)

    expect(backward).toBe(forward)
  })

  it('prints byte identical json whatever order the diagnostics arrive in', () => {
    const forward = renderReport(buildResult({ diagnostics: [missing, orphan] }), json)
    const backward = renderReport(buildResult({ diagnostics: [orphan, missing] }), json)

    expect(backward).toBe(forward)
  })

  it('prints the same bytes on two renders of one result', () => {
    const result = buildResult({
      diagnostics: [orphan, missing],
      written: ['src/loclizr/messages.js'],
      summary: summary({ errors: 1, warnings: 1, fellBack: [{ locale: 'de', count: 2 }] }),
    })

    expect(renderReport(result, plain)).toBe(renderReport(result, plain))
    expect(renderReport(result, json)).toBe(renderReport(result, json))
  })

  it('does not mutate the diagnostics it was handed', () => {
    const diagnostics = [orphan, missing]

    renderReport(buildResult({ diagnostics }), plain)

    expect(diagnostics).toEqual([orphan, missing])
  })
})

describe('the json reporter', () => {
  it('carries fellBack through as the summary gave it', () => {
    const text = renderReport(
      buildResult({ summary: summary({ fellBack: [{ locale: 'de-AT', count: 7 }] }) }),
      json,
    )

    expect(JSON.parse(text)).toMatchObject({ summary: { fellBack: [{ locale: 'de-AT', count: 7 }] } })
  })

  it('ends with exactly one newline', () => {
    const text = renderReport(buildResult(), json)

    expect(text.endsWith('\n')).toBe(true)
    expect(text.endsWith('\n\n')).toBe(false)
  })

  it('prints the same payload whatever the artifact lines would have said', () => {
    const base = renderReport(buildResult(), json)
    const wrote = renderReport(
      buildResult({ written: ['src/loclizr/messages.js', 'locales/loclizr.context.json'] }),
      json,
    )

    expect(wrote).toBe(base)
  })

  it('round trips unicode, RTL marks and combining characters in a message', () => {
    const text = '‮שלום‬ café 👩🏽‍💻'
    const hostile = diag('missing-translation', { message: text, key: 'נ.מפתח' })
    const parsed: unknown = JSON.parse(renderReport(buildResult({ diagnostics: [hostile] }), json))

    expect(parsed).toMatchObject({ diagnostics: [{ message: text, key: 'נ.מפתח' }] })
  })
})

describe('colour', () => {
  beforeEach(() => {
    vi.stubEnv('NO_COLOR', '')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('paints the human reporter when asked to', () => {
    expect(renderReport(buildResult({ diagnostics: [missing] }), { ...plain, color: true })).toContain(
      ESC,
    )
  })

  it('never paints the json reporter, whatever it was asked', () => {
    expect(
      renderReport(buildResult({ diagnostics: [missing] }), { ...json, color: true }),
    ).not.toContain(ESC)
  })

  it('prints no escape when colour is off', () => {
    expect(renderReport(buildResult({ diagnostics: [missing] }), plain)).not.toContain(ESC)
  })

  it('leaves the counts line unpainted, so it greps the same on a terminal', () => {
    const text = renderReport(
      buildResult({ diagnostics: [missing], summary: summary({ errors: 1 }) }),
      { ...plain, color: true },
    )

    expect(text.trimEnd().split('\n').at(-1)).toBe(
      '0 messages, 0 locales (source en), 1 error, 0 warnings',
    )
  })
})
