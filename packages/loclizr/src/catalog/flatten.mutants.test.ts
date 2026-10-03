import { describe, expect, it } from 'vitest'
import { flatten } from './flatten'
import { parseJsonWithSpans } from './json'

const FILE = 'locales/en.json'

function fromText(text: string): ReturnType<typeof flatten> {
  const parsed = parseJsonWithSpans(text, FILE)
  return flatten({ value: parsed.value, file: FILE, locale: 'en', ns: null, spans: parsed.spans })
}

function shapeFindings(result: ReturnType<typeof flatten>): readonly (readonly [string | null, number | undefined])[] {
  return result.diagnostics
    .filter((one) => one.rule === 'catalog-shape-invalid')
    .map((one) => [one.key, one.span?.offset] as const)
}

// A key written twice in one object loses its first value whole, so only the
// surviving value is shape-checked; the lost one is LZ1011's to report.
describe('flatten over a key written twice in one object', () => {
  it('reports a non-string surviving value once, at its last spelling', () => {
    const text = '{"n": 1, "b": "x", "n": 2}'
    const result = fromText(text)
    expect(shapeFindings(result)).toEqual([['n', text.lastIndexOf('2')]])
    expect(result.entries.map((entry) => [entry.key, entry.value])).toEqual([['b', 'x']])
  })

  it('reports a bad leaf under a rewritten branch once', () => {
    const text = '{"a": {"x": 1}, "b": "y", "a": {"x": 2}}'
    expect(shapeFindings(fromText(text))).toEqual([['a.x', text.lastIndexOf('2')]])
  })
})
