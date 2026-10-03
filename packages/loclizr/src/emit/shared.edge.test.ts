import { describe, expect, test } from 'vitest'
import {
  bindsHandlerType,
  byCodepoint,
  docComment,
  formatName,
  handlerNames,
  isIdentifier,
  objectLiteral,
  property,
  quoted,
  templateText,
  textOf,
} from './shared'
import { body, message, text, translated } from './__fixtures__/program'

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u

// A raw line terminator inside a string literal is a SyntaxError, and a raw CR
// inside a template literal is normalised to LF by the engine.
const RAW_TERMINATOR = /[\r\n\u2028\u2029]/u

const HOSTILE: Readonly<Record<string, string>> = {
  empty: '',
  whitespace: ' \t  \u00A0',
  crlf: 'one\r\ntwo',
  'lone cr': 'one\rtwo',
  'lone lf': 'one\ntwo',
  separators: 'a\u2028b\u2029c',
  bom: '\uFEFFstarts with a byte order mark',
  'rtl marks': 'abc \u200F\u202Eevil\u202C \u200E',
  combining: 'cafe\u0301 and n\u0303',
  emoji: '\u{1F600} and a family \u{1F468}\u200D\u{1F469}\u200D\u{1F467}',
  'lone high surrogate': 'x\uD800y',
  'lone low surrogate': 'x\uDC00y',
  'reversed pair': '\uDC00\uD800',
  'high surrogate at the very end': 'ends\uD83D',
  nul: 'nul \u0000 then 1',
  'trailing backslash': 'ends with \\',
  'escape lookalike': '\\u0041 and \\n and \\x41',
  quotes: `single ' double " backtick \``,
  'template syntax': 'dollar $ then ${args.count} then $',
  'octal lookalike': '\\0 and \\08',
}

function evalString(literal: string): unknown {
  return new Function(`'use strict'; return ${literal}`)()
}

function evalTemplate(inner: string): unknown {
  return new Function(`'use strict'; return \`${inner}\``)()
}

describe('quoted', () => {
  for (const [label, value] of Object.entries(HOSTILE)) {
    test(`evaluates back to the exact input: ${label}`, () => {
      expect(evalString(quoted(value))).toBe(value)
    })
  }

  test('never leaves a raw line terminator or an unpaired surrogate in the literal', () => {
    for (const value of Object.values(HOSTILE)) {
      const literal = quoted(value)
      expect(literal).not.toMatch(RAW_TERMINATOR)
      expect(literal).not.toMatch(LONE_SURROGATE)
    }
  })

  test('keeps a whole astral character as itself rather than as escapes', () => {
    expect(quoted('\u{1F600}')).toBe("'\u{1F600}'")
  })

  test('prints the empty string as an empty literal', () => {
    expect(quoted('')).toBe("''")
  })

  test('round trips a string far longer than any real message', () => {
    const long = `${"'\\\r\n".repeat(25_000)}end`
    expect(evalString(quoted(long))).toBe(long)
  })
})

describe('templateText', () => {
  for (const [label, value] of Object.entries(HOSTILE)) {
    test(`evaluates back to the exact input inside a template literal: ${label}`, () => {
      expect(evalTemplate(templateText(value))).toBe(value)
    })
  }

  test('never leaves a raw line terminator or an unpaired surrogate in the text', () => {
    for (const value of Object.values(HOSTILE)) {
      const inner = templateText(value)
      expect(inner).not.toMatch(RAW_TERMINATOR)
      expect(inner).not.toMatch(LONE_SURROGATE)
    }
  })

  test('cannot open an interpolation when two escaped pieces are joined', () => {
    const joined = `${templateText('ends with $')}${templateText('{args.secret}')}`
    expect(evalTemplate(joined)).toBe('ends with ${args.secret}')
  })

  test('cannot close the literal early with a backtick after a backslash', () => {
    expect(evalTemplate(templateText('\\`'))).toBe('\\`')
  })
})

describe('docComment', () => {
  test('collapses a CRLF pair into one space, not two', () => {
    expect(docComment('en', 'one\r\ntwo')).toBe('/** en: "one two" */')
  })

  test('turns a lone CR into a space', () => {
    expect(docComment('en', 'one\rtwo')).toBe('/** en: "one two" */')
  })

  test('closes exactly once however many comment terminators the source holds', () => {
    const comment = docComment('en', '*/*/ and **/ and */')
    expect(comment.indexOf('*/')).toBe(comment.length - 2)
  })

  test('still closes when a CR or LF splits a terminator in the source', () => {
    for (const source of ['*\r\n/', '*\n/', '*\r/']) {
      const comment = docComment('en', source)
      expect(comment.indexOf('*/')).toBe(comment.length - 2)
    }
  })

  test('prints an empty source as an empty quoted string', () => {
    expect(docComment('en', '')).toBe('/** en: "" */')
  })

  test('labels the comment with the locale it was handed, verbatim', () => {
    expect(docComment('zh-Hant-TW', 'x')).toBe('/** zh-Hant-TW: "x" */')
  })

  test('writes no unpaired surrogate', () => {
    expect(docComment('en', 'x\uDC00y\uD800')).not.toMatch(LONE_SURROGATE)
  })

  test('parses as a comment for every hostile source', () => {
    for (const value of Object.values(HOSTILE)) {
      expect(() => new Function(`${docComment('en', value)}\nreturn 1`)).not.toThrow()
    }
  })
})

describe('isIdentifier and property', () => {
  test('rejects the empty string', () => {
    expect(isIdentifier('')).toBe(false)
    expect(property('')).toBe("''")
  })

  test('rejects a leading digit and quotes it as a property', () => {
    expect(isIdentifier('9x')).toBe(false)
    expect(property('9x')).toBe("'9x'")
  })

  test('accepts a bare dollar and a bare underscore', () => {
    expect(isIdentifier('$')).toBe(true)
    expect(isIdentifier('_')).toBe(true)
  })

  test('accepts a non-Latin name and a decomposed accent', () => {
    expect(isIdentifier('名前')).toBe(true)
    expect(isIdentifier('ä')).toBe(true)
    expect(isIdentifier('cafe\u0301')).toBe(true)
  })

  test('rejects an emoji, a hyphen, a dot and a space', () => {
    for (const name of ['\u{1F600}', 'a-b', 'a.b', 'a b']) expect(isIdentifier(name)).toBe(false)
  })

  test('leaves a reserved word bare, since it is a legal property name', () => {
    for (const name of ['class', 'default', 'new', 'then']) expect(property(name)).toBe(name)
  })

  test('prints a property every engine parses, for any name', () => {
    const names = ['9x', '', 'a-b', "it's", 'a\nb', '\u{1F600}', 'x\uD800', 'class', 'ä']
    for (const name of names) {
      const record = evalString(`({ ${property(name)}: 1 })`) as Record<string, number>
      expect(Object.keys(record)).toEqual([name])
    }
  })
})

describe('objectLiteral', () => {
  test('prints an empty option set as an empty object', () => {
    expect(objectLiteral({})).toBe('{}')
  })

  test('orders keys by code point whatever order they were inserted in', () => {
    expect(objectLiteral({ b: 1, a: 2, B: 3 })).toBe('{ B: 3, a: 2, b: 1 }')
  })

  test('evaluates numbers at the limits back to the same value', () => {
    const options = {
      zero: 0,
      huge: 1e21,
      safe: Number.MAX_SAFE_INTEGER,
      tiny: Number.MIN_VALUE,
      negative: -1.5,
      infinite: Infinity,
      negativeInfinite: -Infinity,
    }
    expect(evalString(`(${objectLiteral(options)})`)).toEqual(options)
  })

  test('evaluates NaN back to NaN', () => {
    const evaluated = evalString(`(${objectLiteral({ value: Number.NaN })})`) as { value: number }
    expect(Number.isNaN(evaluated.value)).toBe(true)
  })

  test('keeps booleans and strings distinct from look-alike values', () => {
    const options = { flag: false, text: 'false', number: '0', other: 0 }
    expect(evalString(`(${objectLiteral(options)})`)).toEqual(options)
  })

  test('quotes a key that is not an identifier and escapes a hostile value', () => {
    const options = { 'odd-key': "it's\r\n", '9': 'x' }
    expect(evalString(`(${objectLiteral(options)})`)).toEqual(options)
  })
})

describe('formatName', () => {
  test('does not depend on key insertion order', () => {
    expect(formatName({ style: 'currency', currency: 'USD' })).toBe(
      formatName({ currency: 'USD', style: 'currency' }),
    )
  })

  test('tells a number apart from the string that prints like it', () => {
    expect(formatName({ minimumFractionDigits: 2 })).not.toBe(formatName({ minimumFractionDigits: '2' }))
  })

  test('tells a boolean apart from the string that prints like it', () => {
    expect(formatName({ useGrouping: false })).not.toBe(formatName({ useGrouping: 'false' }))
  })

  test('is a dollar-prefixed identifier of sixteen hex digits', () => {
    const name = formatName({ style: 'percent' })
    expect(name).toMatch(/^\$f[0-9a-f]{16}$/u)
    expect(isIdentifier(name)).toBe(true)
  })

  test('names the empty option set the same every time', () => {
    expect(formatName({})).toBe(formatName({}))
  })
})

describe('byCodepoint', () => {
  test('puts a BMP character above the surrogate range before an astral one', () => {
    expect(byCodepoint(['\u{1F600}', '\uFFFD'])).toEqual(['\uFFFD', '\u{1F600}'])
  })

  test('puts upper case before lower case and a prefix before its extension', () => {
    expect(byCodepoint(['de-AT', 'de', 'DE', 'de-at'])).toEqual(['DE', 'de', 'de-AT', 'de-at'])
  })

  test('leaves the array it was handed alone', () => {
    const input = ['b', 'a']
    byCodepoint(input)
    expect(input).toEqual(['b', 'a'])
  })
})

describe('textOf', () => {
  test('ends with exactly one newline', () => {
    expect(textOf(['a', 'b'])).toBe('a\nb\n')
  })

  test('prints no lines as a lone newline', () => {
    expect(textOf([])).toBe('\n')
  })
})

describe('handler typing', () => {
  const plain = message({
    key: 'x.plain',
    source: 'x',
    args: [{ name: 'n', type: { kind: 'number' } }],
    bodies: [body('en', [text('x')])],
    origins: [translated('en')],
  })

  test('binds no type parameter for a text message without a handler argument', () => {
    expect(bindsHandlerType(plain)).toBe(false)
  })

  test('binds the type parameter for a text message that takes a handler', () => {
    const handed = { ...plain, args: [...plain.args, { name: 'b', type: { kind: 'markup' as const } }] }
    expect(bindsHandlerType(handed)).toBe(true)
  })

  test('names only the markup arguments as handlers', () => {
    const names = handlerNames([
      { name: 'n', type: { kind: 'number' } },
      { name: 'b', type: { kind: 'markup' } },
      { name: 'link', type: { kind: 'markup' } },
      { name: 's', type: { kind: 'stringish' } },
    ])
    expect([...names]).toEqual(['b', 'link'])
  })
})
