import { describe, expect, it } from 'vitest'
import type { Span } from '../types'
import { parseJsonWithSpans } from './json'

describe('parseJsonWithSpans', () => {
  it('records a 1-based span on the value of every path', () => {
    const parsed = parseJsonWithSpans('{\n  "nav": {\n    "home": "Home"\n  }\n}', 'locales/en.json')
    expect(parsed.spans.get('nav.home')).toEqual({ line: 3, column: 14, offset: 26, length: 4 })
    expect(parsed.spans.get('nav')).toEqual({ line: 2, column: 10, offset: 11, length: 24 })
  })

  it('puts the span where an offset into the message composes onto the character it names', () => {
    const text = '{\n  "nav": {\n    "home": "Hello {name"\n  }\n}\n'
    const span = parseJsonWithSpans(text, 'locales/en.json').spans.get('nav.home') as Span
    const brace = 'Hello {name'.indexOf('{')
    expect(text[span.offset + brace]).toBe('{')
    expect({ line: span.line, column: span.column + brace }).toEqual({ line: 3, column: 20 })
  })

  it('measures a value as the file spells it, so an escape counts its own characters', () => {
    const parsed = parseJsonWithSpans('{"a": "x\\ny"}', 'f.json')
    expect(parsed.spans.get('a')).toEqual({ line: 1, column: 8, offset: 7, length: 4 })
  })

  it('puts an empty value on the character after its opening quote', () => {
    const parsed = parseJsonWithSpans('{"a": ""}', 'f.json')
    expect(parsed.spans.get('a')).toEqual({ line: 1, column: 8, offset: 7, length: 0 })
  })

  it('keeps the JSON value shapes the catalog rules distinguish', () => {
    const parsed = parseJsonWithSpans('{"a": "x", "b": null, "c": ["x"], "d": 1, "e": {}}', 'f.json')
    expect(parsed.value).toEqual({ a: 'x', b: null, c: ['x'], d: 1, e: {} })
    expect(parsed.diagnostics).toEqual([])
  })

  it('reports a duplicate JSON key, which JSON.parse would keep silently', () => {
    const parsed = parseJsonWithSpans('{"a": "first", "a": "second"}', 'f.json')
    expect(parsed.duplicates).toEqual(['a'])
    expect(parsed.value).toEqual({ a: 'second' })
  })

  it('reports a dotted key colliding with a nested one', () => {
    const parsed = parseJsonWithSpans('{"nav.home": "x", "nav": {"home": "y"}}', 'f.json')
    expect(parsed.duplicates).toEqual(['nav.home'])
  })

  it('reports a duplicate once however often it repeats', () => {
    const parsed = parseJsonWithSpans('{"a": "1", "a": "2", "a": "3"}', 'f.json')
    expect(parsed.duplicates).toEqual(['a'])
  })

  it('does not treat two paths under different parents as one', () => {
    const parsed = parseJsonWithSpans('{"a": {"x": "1"}, "b": {"x": "2"}}', 'f.json')
    expect(parsed.duplicates).toEqual([])
  })

  it('leaves a dotted leaf beside a deeper nested branch alone, because neither shadows the other', () => {
    const parsed = parseJsonWithSpans('{"a.b": "leaf", "a": {"b": {"c": "deeper"}}}', 'f.json')
    expect(parsed.duplicates).toEqual([])
  })

  it('reports the deeper collision where both routes end in a message', () => {
    const parsed = parseJsonWithSpans('{"a.b": {"c": "one"}, "a": {"b": {"c": "two"}}}', 'f.json')
    expect(parsed.duplicates).toEqual(['a.b.c'])
  })

  it('reports a repeated object key, whose first branch is lost whole', () => {
    const parsed = parseJsonWithSpans('{"a": {"b": "first"}, "a": {"c": "second"}}', 'f.json')
    expect(parsed.duplicates).toEqual(['a'])
    expect(parsed.value).toEqual({ a: { c: 'second' } })
  })

  it('reports nesting past the cap instead of running out of stack', () => {
    const depth = 10000
    const parsed = parseJsonWithSpans(`${'['.repeat(depth)}${']'.repeat(depth)}`, 'locales/en.json')
    expect(parsed.diagnostics.map((one) => one.code)).toEqual(['LZ1009'])
    expect(parsed.diagnostics[0]?.span?.line).toBe(1)
    expect(parsed.value).toBeUndefined()
  })

  it('reads a catalog nested deeper than any real one without complaining', () => {
    const depth = 200
    const text = `${'{"a": '.repeat(depth)}"leaf"${'}'.repeat(depth)}`
    const parsed = parseJsonWithSpans(text, 'locales/en.json')
    expect(parsed.diagnostics).toEqual([])
    expect(parsed.spans.has(Array.from({ length: depth }, () => 'a').join('.'))).toBe(true)
  })

  it('returns LZ1009 with a span instead of throwing', () => {
    const parsed = parseJsonWithSpans('{"a": "x",}', 'locales/de.json')
    expect(parsed.diagnostics.map((one) => one.code)).toEqual(['LZ1009'])
    expect(parsed.diagnostics[0]?.file).toBe('locales/de.json')
    expect(parsed.diagnostics[0]?.span?.line).toBe(1)
    expect(parsed.value).toBeUndefined()
  })

  it('decodes string escapes', () => {
    const parsed = parseJsonWithSpans('{"a": "line\\nbreak \\u00e4 \\"q\\""}', 'f.json')
    expect(parsed.value).toEqual({ a: 'line\nbreak ä "q"' })
  })

  it('reports trailing content after the top-level value', () => {
    expect(parseJsonWithSpans('{} {}', 'f.json').diagnostics).toHaveLength(1)
  })
})
