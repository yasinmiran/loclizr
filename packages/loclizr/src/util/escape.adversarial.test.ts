import {
  isArgumentElement,
  isLiteralElement,
  isPluralElement,
  isSelectElement,
  parse,
} from '@formatjs/icu-messageformat-parser'
import { describe, expect, test } from 'vitest'
import { escapeIcuLiteral } from './index'

const PARSE_OPTIONS = {
  shouldParseSkeletons: true,
  requiresOtherClause: true,
  captureLocation: false,
  ignoreTag: false,
} as const

function literalText(icu: string): string {
  let out = ''
  for (const element of parse(icu, PARSE_OPTIONS)) {
    if (!isLiteralElement(element)) {
      throw new Error(`${JSON.stringify(icu)} lowered to more than literal text`)
    }
    out += element.value
  }
  return out
}

function literalTextInsidePlural(icu: string): string {
  const [plural] = parse(`{c, plural, other {${icu}}}`, PARSE_OPTIONS)
  if (plural === undefined || !isPluralElement(plural)) {
    throw new Error(`${JSON.stringify(icu)} did not survive inside a plural body`)
  }
  let out = ''
  for (const element of plural.options['other']?.value ?? []) {
    if (!isLiteralElement(element)) {
      throw new Error(`${JSON.stringify(icu)} lowered to more than literal text inside a plural`)
    }
    out += element.value
  }
  return out
}

// The parser unquotes `#` only where the enclosing argument is the plural
// itself, so text one select deeper is escaped with inPlural off. Nothing else
// exercises that reset, and a wrong one is invisible: the pound reads as a
// literal either way until the quotes around it start printing.
function literalTextInsideSelectInsidePlural(icu: string): string {
  const [plural] = parse(`{c, plural, other {{g, select, other {${icu}}}}}`, PARSE_OPTIONS)
  if (plural === undefined || !isPluralElement(plural)) {
    throw new Error(`${JSON.stringify(icu)} did not survive inside a plural body`)
  }
  const [select] = plural.options['other']?.value ?? []
  if (select === undefined || !isSelectElement(select)) {
    throw new Error(`${JSON.stringify(icu)} broke the select nested in the plural`)
  }
  let out = ''
  for (const element of select.options['other']?.value ?? []) {
    if (!isLiteralElement(element)) {
      throw new Error(`${JSON.stringify(icu)} lowered to more than literal text inside the select`)
    }
    out += element.value
  }
  return out
}

// printIcu concatenates an escaped text node with the node printed after it, so
// a quote the escape left open takes that node with it.
function literalTextBeforeArgument(icu: string): string {
  const elements = parse(`${icu}{id}`, PARSE_OPTIONS)
  const last = elements.at(-1)
  if (last === undefined || !isArgumentElement(last) || last.value !== 'id') {
    throw new Error(`${JSON.stringify(icu)} swallowed the argument that followed it`)
  }
  let out = ''
  for (const element of elements.slice(0, -1)) {
    if (!isLiteralElement(element)) {
      throw new Error(`${JSON.stringify(icu)} lowered to more than literal text`)
    }
    out += element.value
  }
  return out
}

function escapeFor(text: string, inPlural: boolean): string {
  return inPlural ? escapeIcuLiteral(text, { inPlural: true }) : escapeIcuLiteral(text)
}

function reparse(text: string, inPlural: boolean): string {
  const escaped = escapeFor(text, inPlural)
  try {
    return inPlural ? literalTextInsidePlural(escaped) : literalText(escaped)
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

function generator(seed: number): () => number {
  let state = seed | 0
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    state |= 0
    return (state >>> 0) / 4294967296
  }
}

function corpus(alphabet: readonly string[], count: number, seed: number): readonly string[] {
  const next = generator(seed)
  const out: string[] = []
  for (let i = 0; i < count; i += 1) {
    const length = 1 + Math.floor(next() * 8)
    let text = ''
    for (let j = 0; j < length; j += 1) {
      text += alphabet[Math.floor(next() * alphabet.length)] ?? 'a'
    }
    out.push(text)
  }
  return out
}

function survivors(texts: readonly string[], inPlural: boolean): readonly string[] {
  return texts.filter((text) => reparse(text, inPlural) !== text).slice(0, 6)
}

function everyString(alphabet: readonly string[], maxLength: number): readonly string[] {
  let frontier: readonly string[] = ['']
  const out: string[] = []
  for (let length = 0; length < maxLength; length += 1) {
    const next: string[] = []
    for (const prefix of frontier) {
      for (const char of alphabet) next.push(prefix + char)
    }
    out.push(...next)
    frontier = next
  }
  return out
}

const WITHOUT_POUND: readonly string[] = ['a', 'b', "'", '{', '}', '<', '>', ' ']
const WITH_POUND: readonly string[] = [...WITHOUT_POUND, '#']
const ALPHABET: readonly string[] = ['a', "'", '{', '}', '<', '#']

describe('escapeIcuLiteral under fuzzed catalog text', () => {
  test('gives back the same text at the top level for every generated string', () => {
    expect(survivors(corpus(WITHOUT_POUND, 2000, 20260926), false)).toEqual([])
  })

  test('gives back the same text inside a plural body for every generated string', () => {
    expect(survivors(corpus(WITH_POUND, 2000, 815), true)).toEqual([])
  })
})

describe('escapeIcuLiteral over every short string of the characters that matter', () => {
  const exhaustive = everyString(ALPHABET, 4)

  test('covers the whole alphabet up to four characters', () => {
    expect(exhaustive).toHaveLength(6 + 36 + 216 + 1296)
  })

  test('gives back the same text at the top level', () => {
    expect(survivors(exhaustive, false)).toEqual([])
  })

  test('gives back the same text inside a plural body', () => {
    expect(survivors(exhaustive, true)).toEqual([])
  })

  test('gives back the same text inside a select inside a plural', () => {
    const lost = exhaustive.filter((text) => {
      try {
        return literalTextInsideSelectInsidePlural(escapeIcuLiteral(text)) !== text
      } catch {
        return true
      }
    })
    expect(lost.slice(0, 6)).toEqual([])
  })

  test('never swallows the argument printed after it', () => {
    const lost = exhaustive.filter((text) => {
      try {
        return literalTextBeforeArgument(escapeIcuLiteral(text)) !== text
      } catch {
        return true
      }
    })
    expect(lost.slice(0, 6)).toEqual([])
  })
})

describe('escapeIcuLiteral at the boundaries', () => {
  const cases: readonly string[] = [
    '{',
    '}',
    '<',
    "'",
    "''",
    "'''",
    "{'",
    "'{",
    "'{'",
    "''{''",
    "'}'",
    '{}{}{}',
    '<b>{x}</b>',
    '{{count}}',
    "a'",
    "'a",
    '{'.repeat(1000),
    "It's {name}'s turn",
    "50% of '{x}' and '{y}'",
  ]

  test.each(cases)('round trips %j at the top level', (text) => {
    expect(literalText(escapeIcuLiteral(text))).toBe(text)
  })

  test.each(cases)('round trips %j inside a plural body', (text) => {
    expect(literalTextInsidePlural(escapeIcuLiteral(text, { inPlural: true }))).toBe(text)
  })

  test('quotes one maximal run rather than one quote pair per character', () => {
    expect(escapeIcuLiteral('{}{}')).toBe("'{}{}'")
    expect(escapeIcuLiteral('a{}b{}c')).toBe("a'{}'b'{}'c")
  })
})

describe('escapeIcuLiteral on text outside the basic plane', () => {
  const unicode: readonly string[] = [
    'Grüße',
    'café',
    'café',
    '日本語',
    'مرحبا',
    'a\u{1f600}b',
    '\u{1f469}‍\u{1f4bb}',
    'a\ud800b',
    'a b',
    '‮{x}‬',
  ]

  test.each(unicode)('round trips %j at the top level', (text) => {
    expect(literalText(escapeIcuLiteral(text))).toBe(text)
  })

  test('leaves the composed and the decomposed form alone, so neither becomes the other', () => {
    expect(escapeIcuLiteral('café')).toBe('café')
    expect(escapeIcuLiteral('café')).toBe('café')
    expect(escapeIcuLiteral('café')).not.toBe(escapeIcuLiteral('café'))
  })

  test('leaves an astral character whole rather than splitting its surrogates', () => {
    expect(escapeIcuLiteral('{\u{1f600}}')).toBe("'{'\u{1f600}'}'")
  })
})

describe('escapeIcuLiteral on an apostrophe between two brace or tag characters', () => {
  const both: readonly string[] = [
    "{'{",
    "{'<",
    "<'{",
    "<'<",
    "}'{",
    "a{'{b",
    "{'}",
    "{'{'}",
    "Use {'{'} for a literal brace",
    "Write <code>{'{'}</code>",
    "{'".repeat(20),
  ]

  test.each(both)('round trips %j at the top level', (text) => {
    expect(literalText(escapeIcuLiteral(text))).toBe(text)
  })

  test.each(both)('round trips %j inside a plural body', (text) => {
    expect(literalTextInsidePlural(escapeIcuLiteral(text, { inPlural: true }))).toBe(text)
  })

  test('round trips a pound between two apostrophes inside a plural body', () => {
    expect(literalTextInsidePlural(escapeIcuLiteral("#'#", { inPlural: true }))).toBe("#'#")
  })
})

describe('escapeIcuLiteral on a pound outside a plural body', () => {
  const pounds: readonly string[] = ['Item #5', 'C# rocks', 'Press # to continue', '#']

  test.each(pounds)('round trips %j at the top level', (text) => {
    expect(literalText(escapeIcuLiteral(text))).toBe(text)
  })

  test.each(pounds)('round trips %j inside a plural body, where the quoting is needed', (text) => {
    expect(literalTextInsidePlural(escapeIcuLiteral(text, { inPlural: true }))).toBe(text)
  })

  test.each(pounds)('leaves %j untouched at the top level, where a pound is already literal', (text) => {
    expect(escapeIcuLiteral(text)).toBe(text)
  })

  test('keeps an imported link with a single-quoted attribute rendering what it said', () => {
    expect(literalText(escapeIcuLiteral("Read <a href='#'>terms</a>"))).toBe(
      "Read <a href='#'>terms</a>",
    )
  })
})
