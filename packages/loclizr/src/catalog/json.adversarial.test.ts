import { describe, expect, it } from 'vitest'
import type { Diagnostic, Span } from '../types'
import { flatten } from './flatten'
import { parseJsonWithSpans } from './json'

const FILE = 'locales/en.json'

function codes(diagnostics: readonly Diagnostic[]): readonly string[] {
  return diagnostics.map((one) => one.code)
}

function parse(text: string): ReturnType<typeof parseJsonWithSpans> {
  return parseJsonWithSpans(text, FILE)
}

const ACCEPTED: readonly string[] = [
  '{}',
  '{"a": {}}',
  '{"a": []}',
  '{"a": null, "b": true, "c": false}',
  '{"a": 0, "b": -0, "c": -1, "d": 1e-7, "e": 1E+3, "f": 12.75}',
  '{"a": 1e400}',
  '{"a": "\\u0041\\/\\b\\f\\n\\r\\t\\\\\\""}',
  '{"a": "\\ud83d\\ude00"}',
  '{"a": "\\ud800"}',
  '{"a": "\\u0000"}',
  '{"": "empty key"}',
  '{"\\u00e9": "nfc", "e\\u0301": "nfd"}',
  '{"a": "x"}\n',
  '\t{\r\n"a"\r\n:\r\n"x"\r\n}\t',
  '"a bare string"',
  '[1, 2]',
  'null',
  '{"a": {"b": {"c": {"d": "deep"}}}}',
]

const REJECTED: readonly string[] = [
  '',
  '   ',
  '\ufeff{"a": "x"}',
  '{"a": "x",}',
  "{'a': 'x'}",
  '{a: "x"}',
  '{"a": 01}',
  '{"a": .5}',
  '{"a": 1.}',
  '{"a": +1}',
  '{"a": NaN}',
  '{"a": Infinity}',
  '{"a": undefined}',
  '{"a": "line\nbreak"}',
  '{"a": "unterminated}',
  '{"a": "\\x41"}',
  '{"a": "\\u12"}',
  '{"a": "x"} trailing',
  '// comment\n{"a": "x"}',
  '{"a" "x"}',
  '{"a": "x" "b": "y"}',
]

describe('parseJsonWithSpans decides exactly what JSON.parse decides', () => {
  it.each(ACCEPTED)('accepts %j and reads the same value', (text) => {
    const expected = JSON.parse(text) as unknown
    const result = parse(text)
    expect(result.diagnostics).toEqual([])
    expect(JSON.stringify(result.value)).toBe(JSON.stringify(expected))
  })

  it.each(REJECTED)('reports %j as LZ1009 rather than reading it', (text) => {
    expect(() => JSON.parse(text)).toThrow()
    const result = parse(text)
    expect(codes(result.diagnostics)).toEqual(['LZ1009'])
    expect(result.value).toBeUndefined()
    expect(result.diagnostics[0]?.file).toBe(FILE)
    expect(result.diagnostics[0]?.span).not.toBeNull()
  })
})

describe('parseJsonWithSpans on keys that reach into the prototype', () => {
  it('keeps __proto__ as an ordinary key and pollutes nothing', () => {
    const result = parse('{"__proto__": {"polluted": "yes"}, "nav": {"home": "Home"}}')
    expect(result.diagnostics).toEqual([])
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined()
    const flat = flatten({
      value: result.value,
      file: FILE,
      locale: 'en',
      ns: null,
      spans: result.spans,
    })
    expect(flat.entries.map((entry) => entry.key)).toEqual(['__proto__.polluted', 'nav.home'])
  })

  it('keeps constructor and prototype as ordinary keys', () => {
    const result = parse('{"constructor": {"prototype": {"injected": "yes"}}}')
    const flat = flatten({
      value: result.value,
      file: FILE,
      locale: 'en',
      ns: null,
      spans: result.spans,
    })
    expect(flat.entries.map((entry) => entry.key)).toEqual(['constructor.prototype.injected'])
    expect(({} as Record<string, unknown>)['injected']).toBeUndefined()
  })
})

describe('parseJsonWithSpans positions', () => {
  const text = '{\r\n  "a": "\u{1f600}",\r\n  "b": { "c.d": "x" },\r\n  "b.e": "y"\r\n}'

  const VALUES: Readonly<Record<string, string>> = {
    a: '\u{1f600}',
    b: '{ "c.d": "x" }',
    'b.c.d': 'x',
    'b.e': 'y',
  }

  function lineColumnAt(offset: number): { readonly line: number; readonly column: number } {
    const before = text.slice(0, offset)
    const lastBreak = before.lastIndexOf('\n')
    return { line: before.split('\n').length, column: offset - lastBreak }
  }

  it('covers the value of every recorded path, where the file has it', () => {
    const { spans } = parse(text)
    expect([...spans.keys()].sort()).toEqual(['a', 'b', 'b.c.d', 'b.e'])
    for (const [path, span] of spans) {
      expect(text.slice(span.offset, span.offset + span.length)).toBe(VALUES[path])
      expect({ line: span.line, column: span.column }).toEqual(lineColumnAt(span.offset))
    }
  })

  it('counts a surrogate pair the way the file does, so a later value keeps its position', () => {
    const { spans } = parse(text)
    const b = spans.get('b') as Span
    expect(b.offset).toBe(text.indexOf('{ "c.d"'))
    expect(b).toEqual({ line: 3, column: 8, offset: b.offset, length: 14 })
  })
})

describe('parseJsonWithSpans on a hostile file', () => {
  it('reports rather than throwing on nesting no translator writes', () => {
    const depth = 10000
    const text = `${'['.repeat(depth)}${']'.repeat(depth)}`
    expect(() => JSON.parse(text)).not.toThrow()
    expect(() => parse(text)).not.toThrow()
  })
})
