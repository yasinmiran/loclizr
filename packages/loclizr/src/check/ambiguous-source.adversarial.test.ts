import { describe, expect, it } from 'vitest'
import type { Diagnostic } from '../types'
import { at, body, config, message, program } from './__fixtures__/program'
import { runChecks } from './index'

const sourceOnly = config({ locales: ['en'], sourceLocale: 'en' })

function only(diagnostics: readonly Diagnostic[], code: string): Diagnostic {
  const found = diagnostics.filter((entry) => entry.code === code)
  const [first] = found
  if (first === undefined || found.length !== 1) {
    throw new Error(`expected exactly one ${code}, got ${found.length}`)
  }
  return first
}

// The pasteable block is every line between the "add descriptions" line and the
// "or" line.
function entryLines(hint: string): readonly string[] {
  const lines = hint.split('\n')
  const end = lines.findIndex((line) => line.startsWith('or '))
  return lines.slice(1, end === -1 ? lines.length : end).map((line) => line.trim())
}

function pasteableKeys(hint: string): readonly string[] {
  const parsed: unknown = JSON.parse(`{${entryLines(hint).join(',')}}`)
  return Object.keys(parsed as Record<string, unknown>)
}

function openMessage(key: string, line: number, description?: string) {
  return message({
    key,
    source: 'Open',
    description: description ?? null,
    bodies: [body('en')],
    spans: [at('en', line, 5)],
  })
}

describe('keys that share one source string', () => {
  it('escapes a key so the meta entries it tells you to paste are valid JSON', () => {
    const diagnostics = runChecks(
      program({
        config: sourceOnly,
        messages: [openMessage('say "open"', 12), openMessage('path\\open', 31)],
      }),
    )

    const hint = only(diagnostics, 'LZ3012').hint ?? ''
    expect(() => pasteableKeys(hint)).not.toThrow()
    expect(pasteableKeys(hint)).toEqual(['path\\open', 'say "open"'])
  })

  it('keeps one pasteable line per undescribed key when a key holds a line break', () => {
    const diagnostics = runChecks(
      program({
        config: sourceOnly,
        messages: [openMessage('a.plain', 12), openMessage('a.two\nlines', 31)],
      }),
    )

    const hint = only(diagnostics, 'LZ3012').hint ?? ''
    expect(entryLines(hint)).toHaveLength(2)
  })

  it('names every colliding key with a position and a status, and asks only the undescribed ones', () => {
    const diagnostics = runChecks(
      program({
        config: sourceOnly,
        messages: [
          openMessage('dialog.open', 12),
          openMessage('file.open', 31),
          openMessage('status.open', 58, 'Badge on a ticket that is not closed'),
        ],
      }),
    )

    const ambiguous = only(diagnostics, 'LZ3012')
    expect(ambiguous.related.map((entry) => entry.key)).toEqual([
      'dialog.open',
      'file.open',
      'status.open',
    ])
    for (const entry of ambiguous.related) {
      expect(entry.file).toBe('locales/en.json')
      expect(entry.span).not.toBeNull()
    }
    expect(ambiguous.related[2]?.message ?? '').toContain('Badge on a ticket that is not closed')
    expect(pasteableKeys(ambiguous.hint ?? '')).toEqual(['dialog.open', 'file.open'])
  })

  it('carries no key and no locale, so the header names the shared text once', () => {
    const diagnostics = runChecks(
      program({
        config: sourceOnly,
        messages: [openMessage('dialog.open', 12), openMessage('file.open', 31)],
      }),
    )

    const ambiguous = only(diagnostics, 'LZ3012')
    expect(ambiguous.key).toBeNull()
    expect(ambiguous.locale).toBeNull()
    expect(ambiguous.file).toBe('locales/en.json')
    expect(ambiguous.span?.line).toBe(12)
  })

  it('indents the paste block under its own line and starts the alternative with or', () => {
    const diagnostics = runChecks(
      program({
        config: sourceOnly,
        messages: [openMessage('dialog.open', 12), openMessage('file.open', 31)],
      }),
    )

    const lines = (only(diagnostics, 'LZ3012').hint ?? '').split('\n')

    expect(lines[0]).toBe('add descriptions in locales/en.meta.json:')
    expect(lines.slice(1, 3)).toEqual([
      `       "dialog.open": { "description": "" }`,
      `       "file.open":   { "description": "" }`,
    ])
    expect(lines[3]).toBe('or   make this a hard gate in loclizr.config.ts:')
    expect(lines[4]).toBe(`       severity: { 'ambiguous-source': 'error' }`)
    expect(lines).toHaveLength(5)
  })

  it('offers the way down once the project has already made the rule a hard gate', () => {
    const gated = runChecks(
      program({
        config: config({
          locales: ['en'],
          sourceLocale: 'en',
          severity: { 'ambiguous-source': 'error' },
        }),
        messages: [openMessage('dialog.open', 12), openMessage('file.open', 31)],
      }),
    )

    const ambiguous = only(gated, 'LZ3012')
    const lines = (ambiguous.hint ?? '').split('\n')

    expect(lines[3]).toBe('or   turn the rule down in loclizr.config.ts:')
    expect(lines[4]).toBe(`       severity: { 'ambiguous-source': 'warn' }`)
    // Quoting the setting is not re-levelling: the stamp stays the rule default
    // and M10 is still the module that moves it.
    expect(ambiguous.severity).toBe('warn')
  })

  it('flips the alternative for error alone, so an explicit warn reads like the default', () => {
    for (const severity of ['warn', 'off'] as const) {
      const diagnostics = runChecks(
        program({
          config: config({
            locales: ['en'],
            sourceLocale: 'en',
            severity: { 'ambiguous-source': severity },
          }),
          messages: [openMessage('dialog.open', 12), openMessage('file.open', 31)],
        }),
      )

      const lines = (only(diagnostics, 'LZ3012').hint ?? '').split('\n')

      expect(lines[3]).toBe('or   make this a hard gate in loclizr.config.ts:')
      expect(lines[4]).toBe(`       severity: { 'ambiguous-source': 'error' }`)
    }
  })

  it('compares bytes, so a composed and a decomposed source string are two strings', () => {
    const diagnostics = runChecks(
      program({
        config: sourceOnly,
        messages: [
          message({ key: 'a.cafe', source: 'Café', bodies: [body('en')] }),
          message({ key: 'b.cafe', source: 'Café', bodies: [body('en')] }),
        ],
      }),
    )

    expect(diagnostics).toEqual([])
  })

  it('buckets a source string that names an object prototype member', () => {
    const diagnostics = runChecks(
      program({
        config: sourceOnly,
        messages: [
          message({ key: 'a.proto', source: '__proto__', bodies: [body('en')] }),
          message({ key: 'b.proto', source: '__proto__', bodies: [body('en')] }),
        ],
      }),
    )

    const ambiguous = only(diagnostics, 'LZ3012')
    expect(ambiguous.related.map((entry) => entry.key)).toEqual(['a.proto', 'b.proto'])
  })

  it('substitutes the source locale into the configured meta path', () => {
    const diagnostics = runChecks(
      program({
        config: config({
          locales: ['en'],
          sourceLocale: 'en',
          meta: 'i18n/{sourceLocale}.notes.json',
        }),
        messages: [openMessage('dialog.open', 12), openMessage('file.open', 31)],
      }),
    )

    expect(only(diagnostics, 'LZ3012').hint ?? '').toContain('i18n/en.notes.json')
  })
})
