import { describe, expect, it } from 'vitest'
import { readIdentEnd, scrub } from './scrub'

// Every position pass two reports is an offset into the scrubbed text, so the
// scrub must keep the length and every newline where the source had them.
const SOURCES: readonly string[] = [
  '',
  '\ufeff',
  "const a = 'x' // tail\r\nconst b = \"y\"\r\n",
  'const t = `a ${`b ${c}`} d`\n/* block\nspans */ x\n',
  'const r = /[/]x/gi; const h = a / b\n',
  "<p>Don't stop {x}</p>\n<a href=\"https://x\">y</a>\n",
  'const e = \'\u{1f600}\u0301\u200f\' + `\ud800`\n',
  '`unterminated ${ {',
  "'unterminated\n\"also\n",
]

describe('scrub keeps positions', () => {
  it.each(SOURCES.flatMap((source) => [
    [source, false],
    [source, true],
  ] as const))('keeps the length and newlines of %j (component file: %s)', (source, jsx) => {
    const scrubbed = scrub(source, jsx)
    for (const text of [scrubbed.withoutComments, scrubbed.codeOnly]) {
      expect(text).toHaveLength(source.length)
      expect([...text.matchAll(/\n/gu)].map((match) => match.index)).toEqual(
        [...source.matchAll(/\n/gu)].map((match) => match.index),
      )
    }
  })
})

describe('scrub blanks', () => {
  it('blanks string contents but keeps the quotes in a module file', () => {
    expect(scrub("f('m.x')", false).codeOnly).toBe("f('   ')")
  })

  it('blanks a line comment in withoutComments and leaves strings for codeOnly', () => {
    const scrubbed = scrub("a('b') // c", false)
    expect(scrubbed.withoutComments).toBe("a('b')     ")
    expect(scrubbed.codeOnly).toBe("a(' ')     ")
  })

  it('blanks a combining mark and a right-to-left mark inside a string by code unit', () => {
    const source = "f('e\u0301\u200f')"
    expect(scrub(source, false).codeOnly).toBe("f('   ')")
  })

  it('keeps a template hole live in a component file', () => {
    expect(scrub('x = `a${b}c`', true).codeOnly).toBe('x = ` ${b} `')
  })
})

describe('readIdentEnd', () => {
  it('reads a combining mark as part of an identifier', () => {
    expect(readIdentEnd('e\u0301x.y', 0)).toBe(3)
  })

  it('stops at a lone high surrogate', () => {
    expect(readIdentEnd('ab\ud800c', 0)).toBe(2)
  })

  it('reads a zero width joiner as part of an identifier, as ECMAScript does', () => {
    expect(readIdentEnd('a\u200db.c', 0)).toBe(3)
  })
})
