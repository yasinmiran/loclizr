import { describe, expect, it } from 'vitest'
import type { Span } from '../types'
import { flatten } from './flatten'
import { parseJsonWithSpans } from './json'

const FILE = 'locales/en.json'
const ROOT: Span = { line: 1, column: 1, offset: 0, length: 0 }

function run(
  value: unknown,
  ns: string | null = null,
  spans: ReadonlyMap<string, Span> = new Map(),
): ReturnType<typeof flatten> {
  return flatten({ value, file: FILE, locale: 'en', ns, spans })
}

function fromText(text: string, ns: string | null = null): ReturnType<typeof flatten> {
  const parsed = parseJsonWithSpans(text, FILE)
  return flatten({ value: parsed.value, file: FILE, locale: 'en', ns, spans: parsed.spans })
}

function keysOf(result: ReturnType<typeof flatten>): readonly string[] {
  return result.entries.map((entry) => entry.key)
}

describe('flatten on keys named after the prototype', () => {
  it('yields an entry for every prototype name read from a file', () => {
    const result = fromText(
      '{"toString": "a", "valueOf": "b", "hasOwnProperty": "c", "constructor": "d", "__proto__": "e"}',
    )
    expect(result.entries.map((entry) => [entry.key, entry.value])).toEqual([
      ['toString', 'a'],
      ['valueOf', 'b'],
      ['hasOwnProperty', 'c'],
      ['constructor', 'd'],
      ['__proto__', 'e'],
    ])
    expect(result.diagnostics).toEqual([])
  })

  it('prefixes a prototype name with the namespace like any other key', () => {
    expect(keysOf(fromText('{"__proto__": {"constructor": "x"}}', 'common'))).toEqual([
      'common.__proto__.constructor',
    ])
  })
})

describe('flatten keys and the namespace prefix', () => {
  it('prefixes a key that already starts with the namespace name a second time', () => {
    expect(keysOf(run({ common: { x: 'y' } }, 'common'))).toEqual(['common.common.x'])
  })

  it('looks the span up by the unprefixed path the scanner recorded', () => {
    const span: Span = { line: 2, column: 3, offset: 9, length: 1 }
    const result = run({ a: 'x' }, 'errors', new Map([['a', span]]))
    expect(result.entries[0]).toEqual({ key: 'errors.a', value: 'x', span })
  })

  it('falls back to the root span when the scanner recorded none', () => {
    expect(run({ a: { b: 'x' } }).entries[0]?.span).toEqual(ROOT)
  })

  it('names an array leaf by its prefixed key', () => {
    expect(run({ tips: ['a'] }, 'help').diagnostics[0]?.key).toBe('help.tips')
  })

  it('keeps a trailing empty segment as a trailing dot', () => {
    expect(keysOf(fromText('{"a": {"": "x"}}'))).toEqual(['a.'])
  })

  it('reads an empty root key as the empty key', () => {
    expect(keysOf(fromText('{"": "x"}'))).toEqual([''])
  })
})

describe('flatten keys that differ only in their code points', () => {
  it('keeps NFC and NFD spellings as two keys, normalizing nothing', () => {
    expect(keysOf(run({ 'café': 'a', 'café': 'b' }))).toEqual(['café', 'café'])
  })

  it('keeps emoji, CJK and bidi controls in a key byte for byte', () => {
    const key = '\u{1f600}.名前.‏x'
    expect(keysOf(fromText(`{"${key}": "v"}`))).toEqual([key])
  })

  it('keeps a value with a lone surrogate and CRLF exactly as written', () => {
    expect(run({ a: '\ud800\r\n\rx' }).entries[0]?.value).toBe('\ud800\r\n\rx')
  })
})

describe('flatten leaves that are not messages', () => {
  it.each([0, -0, Number.NaN, Number.POSITIVE_INFINITY, 1e21, Number.MAX_SAFE_INTEGER])(
    'reports the number %s and yields no entry',
    (value) => {
      const result = run({ n: value })
      expect(result.entries).toEqual([])
      expect(result.diagnostics.map((one) => one.code)).toEqual(['LZ1010'])
      expect(result.diagnostics[0]?.hint).toContain('null')
    },
  )

  it('reports false rather than dropping it like null', () => {
    const result = run({ off: false })
    expect(result.diagnostics.map((one) => one.code)).toEqual(['LZ1010'])
    expect(result.diagnostics[0]?.message).toContain('boolean')
  })

  it('reports an empty array with the array hint', () => {
    expect(run({ tips: [] }).diagnostics[0]?.hint).toContain('format()')
  })

  it('reports an empty string root as a shape error', () => {
    expect(run('').diagnostics.map((one) => one.code)).toEqual(['LZ1010'])
  })

  it('reports one diagnostic per bad leaf and keeps every good one', () => {
    const result = run({ a: 1, b: 'ok', c: [1], d: { e: true, f: 'fine' }, g: null })
    expect(keysOf(result)).toEqual(['b', 'd.f'])
    expect(result.diagnostics.map((one) => one.key)).toEqual(['a', 'c', 'd.e'])
  })

  it('yields nothing and says nothing for an object of nulls', () => {
    expect(run({ a: null, b: { c: null } })).toEqual({ entries: [], diagnostics: [] })
  })

  it('stamps the locale and the file on every shape diagnostic', () => {
    const [only] = flatten({
      value: { a: 1 },
      file: 'locales/de-AT.json',
      locale: 'de-AT',
      ns: null,
      spans: new Map(),
    }).diagnostics
    expect(only).toMatchObject({ file: 'locales/de-AT.json', locale: 'de-AT', key: 'a' })
  })
})

describe('flatten collisions', () => {
  it('keeps the first position and the last value of a key reached three ways', () => {
    const result = run({ x: '0', 'a.b.c': '1', y: '2', 'a.b': { c: '3' }, a: { b: { c: '4' } } })
    expect(result.entries.map((entry) => [entry.key, entry.value])).toEqual([
      ['x', '0'],
      ['a.b.c', '4'],
      ['y', '2'],
    ])
  })

  it('keeps a leaf beside a deeper branch as two keys', () => {
    expect(keysOf(run({ 'a.b': 'leaf', a: { b: { c: 'deeper' } } }))).toEqual(['a.b', 'a.b.c'])
  })
})

describe('flatten depth and size', () => {
  it('joins 256 levels into one dotted key', () => {
    const depth = 256
    let value: unknown = 'leaf'
    for (let level = 0; level < depth; level += 1) value = { k: value }
    const [entry] = run(value).entries
    expect(entry?.key.split('.')).toHaveLength(depth)
  })

  it('keeps ten thousand keys in the order the file wrote them', () => {
    const keys = Array.from({ length: 10_000 }, (_, index) => `key${index}`)
    const result = run(Object.fromEntries(keys.map((key) => [key, key])))
    expect(keysOf(result)).toEqual(keys)
  })
})

describe('flatten determinism', () => {
  it('returns equal entries and diagnostics on two runs over one tree', () => {
    const text = '{"b": {"x": "1", "y": 2}, "a": "z", "b.x": "w"}'
    expect(fromText(text)).toEqual(fromText(text))
  })
})
