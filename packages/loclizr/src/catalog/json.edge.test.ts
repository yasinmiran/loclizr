import { describe, expect, it } from 'vitest'
import type { Diagnostic, Span } from '../types'
import { parseJsonWithSpans } from './json'

const FILE = 'locales/en.json'

function parse(text: string): ReturnType<typeof parseJsonWithSpans> {
  return parseJsonWithSpans(text, FILE)
}

function codes(diagnostics: readonly Diagnostic[]): readonly string[] {
  return diagnostics.map((one) => one.code)
}

function spanOf(text: string, path: string): Span {
  const span = parse(text).spans.get(path)
  if (span === undefined) throw new Error(`no span for ${path}`)
  return span
}

function covered(text: string, path: string): string {
  const span = spanOf(text, path)
  return text.slice(span.offset, span.offset + span.length)
}

function nestedObjects(depth: number): string {
  return `${'{"a": '.repeat(depth)}"leaf"${'}'.repeat(depth)}`
}

describe('parseJsonWithSpans on empty and blank input', () => {
  it.each(['', ' ', '\t\n\r ', '\r\n\r\n'])(
    'reports %j at the end of the file with an empty span',
    (text) => {
      const [only] = parse(text).diagnostics
      expect(only?.code).toBe('LZ1009')
      expect(only?.span).toMatchObject({ offset: text.length, length: 0 })
      expect(only?.message).toContain('end of file')
    },
  )

  it('reads an empty object as no paths at all', () => {
    const result = parse('{}')
    expect(result.value).toEqual({})
    expect(result.spans.size).toBe(0)
    expect(result.duplicates).toEqual([])
  })
})

describe('parseJsonWithSpans on keys named after the prototype', () => {
  const names: readonly string[] = ['toString', 'valueOf', 'hasOwnProperty', 'constructor', '__proto__']

  it('keeps every prototype name as an own key with its own span', () => {
    const text = `{${names.map((name) => `"${name}": "${name}!"`).join(', ')}}`
    const result = parse(text)
    expect(Object.keys(result.value as object)).toEqual(names)
    for (const name of names) expect(covered(text, name)).toBe(`${name}!`)
  })

  it('reports a repeated __proto__ like any other repeated key', () => {
    const result = parse('{"a": {"__proto__": "first", "__proto__": "second"}}')
    expect(result.duplicates).toEqual(['a.__proto__'])
    expect(Object.getOwnPropertyDescriptor((result.value as Record<string, object>)['a'], '__proto__')?.value).toBe(
      'second',
    )
  })

  it('leaves Object.prototype untouched after reading a hostile tree', () => {
    parse('{"__proto__": {"toString": "x", "polluted": "y"}, "constructor": {"prototype": {"z": "w"}}}')
    expect(Object.prototype.toString.call([])).toBe('[object Array]')
    expect(Object.hasOwn(Object.prototype, 'polluted')).toBe(false)
    expect(Object.hasOwn(Object.prototype, 'z')).toBe(false)
  })
})

describe('parseJsonWithSpans on keys that differ only in their code points', () => {
  it('keeps an NFC and an NFD spelling of one key apart', () => {
    const result = parse('{"caf\\u00e9": "nfc", "cafe\\u0301": "nfd"}')
    expect(result.duplicates).toEqual([])
    expect([...result.spans.keys()]).toEqual(['café', 'café'])
  })

  it('keeps a key with a right-to-left mark apart from the bare one', () => {
    const result = parse('{"‏a": "marked", "a": "bare"}')
    expect(result.duplicates).toEqual([])
    expect(result.spans.size).toBe(2)
  })

  it('collides an escaped dot with a nested key, because the decoded key is what flattens', () => {
    expect(parse('{"a\\u002eb": "escaped", "a": {"b": "nested"}}').duplicates).toEqual(['a.b'])
  })

  it('reads an escaped quote and backslash into the key itself', () => {
    const result = parse('{"a\\"b\\\\c": "x"}')
    expect([...result.spans.keys()]).toEqual(['a"b\\c'])
  })

  it('reads a NUL escape into the key without cutting it short', () => {
    const result = parse('{"a\\u0000b": "x"}')
    expect([...result.spans.keys()]).toEqual(['a\u0000b'])
  })
})

describe('parseJsonWithSpans duplicate detection boundaries', () => {
  it('reports a key written twice whatever the second value is', () => {
    const result = parse('{"a": "x", "a": null}')
    expect(result.duplicates).toEqual(['a'])
    expect(result.value).toEqual({ a: null })
  })

  it('does not collide a dotted null with a nested message, because only one route ends in a message', () => {
    expect(parse('{"a.b": null, "a": {"b": "x"}}').duplicates).toEqual([])
  })

  it('does not collide a dotted number with a nested message', () => {
    expect(parse('{"a.b": 1, "a": {"b": "x"}}').duplicates).toEqual([])
  })

  it('records no path inside an array, so a repeated key there is not a catalog duplicate', () => {
    const result = parse('{"a": [{"b": "x", "b": "y"}]}')
    expect(result.duplicates).toEqual([])
    expect([...result.spans.keys()]).toEqual(['a'])
  })

  it('collides three routes to one key once', () => {
    const result = parse('{"a.b.c": "1", "a.b": {"c": "2"}, "a": {"b": {"c": "3"}}}')
    expect(result.duplicates).toEqual(['a.b.c'])
  })

  it('records each span at the last route, where the kept value sits', () => {
    const text = '{"a.b": "first", "a": {"b": "second"}}'
    expect(covered(text, 'a.b')).toBe('second')
  })
})

describe('parseJsonWithSpans nesting cap', () => {
  it('reads exactly 256 levels', () => {
    expect(parse(nestedObjects(256)).diagnostics).toEqual([])
  })

  it('reports level 257 at its opening brace', () => {
    const [only] = parse(nestedObjects(257)).diagnostics
    expect(only?.code).toBe('LZ1009')
    expect(only?.span).toMatchObject({ line: 1, offset: '{"a": '.length * 256, length: 1 })
    expect(only?.message).toContain('256')
  })

  it('counts arrays and objects against one cap', () => {
    const text = `${'{"a": ['.repeat(128)}"leaf"${']}'.repeat(128)}`
    expect(parse(text).diagnostics).toEqual([])
    const deeper = `{"x": ${text}}`
    expect(codes(parse(deeper).diagnostics)).toEqual(['LZ1009'])
  })
})

describe('parseJsonWithSpans numbers at the limits', () => {
  const numbers: readonly string[] = [
    '0',
    '-0',
    '1e21',
    '9007199254740991',
    '9007199254740993',
    '-9007199254740993',
    '1e400',
    '-1e400',
    '1e-400',
    '5e-324',
    '0.1',
    '123456789012345678901234567890',
  ]

  it.each(numbers)('reads %s as the number JSON.parse reads', (literal) => {
    const result = parse(`{"n": ${literal}}`)
    const expected = (JSON.parse(`{"n": ${literal}}`) as { n: number }).n
    expect(Object.is((result.value as { n: number }).n, expected)).toBe(true)
  })

  it.each(numbers)('spans %s exactly as the file spells it', (literal) => {
    expect(covered(`{"n": ${literal}}`, 'n')).toBe(literal)
  })

  it.each(['-', '-a', '1e', '1e+', '00', '-01', '0x10', '1_000'])('rejects %j', (literal) => {
    expect(codes(parse(`{"n": ${literal}}`).diagnostics)).toEqual(['LZ1009'])
  })
})

describe('parseJsonWithSpans spans on values that are not strings', () => {
  const text = '{\n  "o": { "k": "v" },\n  "a": [1, 2],\n  "n": null,\n  "t": true,\n  "f": false\n}'

  it.each([
    ['o', '{ "k": "v" }'],
    ['a', '[1, 2]'],
    ['n', 'null'],
    ['t', 'true'],
    ['f', 'false'],
  ] as const)('covers %s with its literal', (path, literal) => {
    expect(covered(text, path)).toBe(literal)
  })

  it('puts the line and column of each value where an editor shows them', () => {
    expect(spanOf(text, 'a')).toMatchObject({ line: 3, column: 8 })
    expect(spanOf(text, 'f')).toMatchObject({ line: 6, column: 8 })
  })
})

describe('parseJsonWithSpans spans on strings the file spells with escapes', () => {
  it('measures a unicode escape by its six characters', () => {
    const text = '{"a": "\\u00e9x"}'
    expect(spanOf(text, 'a').length).toBe(7)
    expect((parse(text).value as { a: string }).a).toBe('éx')
  })

  it('measures an escaped surrogate pair by its twelve characters and decodes one emoji', () => {
    const text = '{"a": "\\ud83d\\ude00"}'
    expect(spanOf(text, 'a').length).toBe(12)
    expect((parse(text).value as { a: string }).a).toBe('\u{1f600}')
  })

  it('reads a raw lone surrogate as the one code unit it is', () => {
    const text = '{"a": "\ud800"}'
    expect((parse(text).value as { a: string }).a).toBe('\ud800')
    expect(spanOf(text, 'a').length).toBe(1)
  })

  it('keeps combining characters and bidi controls byte for byte', () => {
    const value = 'é ‫שלום‬ ‏'
    const text = `{"a": "${value}"}`
    expect((parse(text).value as { a: string }).a).toBe(value)
    expect(covered(text, 'a')).toBe(value)
  })

  it('keeps an escaped CRLF inside the value and counts no line break for it', () => {
    const text = '{"a": "x\\r\\ny", "b": "z"}'
    expect((parse(text).value as { a: string }).a).toBe('x\r\ny')
    expect(spanOf(text, 'b').line).toBe(1)
  })
})

describe('parseJsonWithSpans syntax errors', () => {
  it('points at a raw tab inside a string', () => {
    const text = '{"a": "x\ty"}'
    const [only] = parse(text).diagnostics
    expect(only?.code).toBe('LZ1009')
    expect(only?.span).toMatchObject({ offset: text.indexOf('\t'), length: 1 })
  })

  it('points at the end of the file for a string left open', () => {
    const text = '{"a": "never closed'
    const [only] = parse(text).diagnostics
    expect(only?.span).toMatchObject({ offset: text.length, length: 0 })
    expect(only?.message).toContain('Unterminated')
  })

  it('names the character it did not expect', () => {
    expect(parse('{"a": @}').diagnostics[0]?.message).toContain('"@"')
  })

  it('reports an error on a later CRLF line by its line and column', () => {
    const text = '{\r\n  "a": "x",\r\n  "b": oops\r\n}'
    expect(parse(text).diagnostics[0]?.span).toMatchObject({ line: 3, column: 8 })
  })

  it('reports nothing but the one diagnostic, with no partial spans', () => {
    const result = parse('{"a": "x", "b": }')
    expect(result.spans.size).toBe(0)
    expect(result.duplicates).toEqual([])
    expect(result.diagnostics).toHaveLength(1)
  })

  it('carries the file it was given on the diagnostic', () => {
    expect(parseJsonWithSpans('{', 'public/locales/de/common.json').diagnostics[0]?.file).toBe(
      'public/locales/de/common.json',
    )
  })
})

describe('parseJsonWithSpans on large input', () => {
  it('reads a value of a million characters with a span that covers it', () => {
    const value = 'x'.repeat(1_000_000)
    expect(spanOf(`{"a": "${value}"}`, 'a').length).toBe(1_000_000)
  })

  it('reads ten thousand keys in file order', () => {
    const keys = Array.from({ length: 10_000 }, (_, index) => `k${index}`)
    const text = `{${keys.map((key) => `"${key}": "v"`).join(',\n')}}`
    const result = parse(text)
    expect([...result.spans.keys()]).toEqual(keys)
    expect(result.spans.get('k9999')?.line).toBe(10_000)
  })
})

describe('parseJsonWithSpans determinism', () => {
  it('returns the same value, spans and duplicates on two runs', () => {
    const text = '{"b": {"x": "1"}, "a": "2", "b.x": "3", "a": "4"}'
    const first = parse(text)
    const second = parse(text)
    expect(second.value).toEqual(first.value)
    expect([...second.spans]).toEqual([...first.spans])
    expect(second.duplicates).toEqual(first.duplicates)
  })
})
