import { parse, TYPE } from '@formatjs/icu-messageformat-parser'
import { describe, expect, it } from 'vitest'
import type { Diagnostic, RawEntry, Span } from '../types'
import { classifyFormat, foldPluralSuffixes, toIcu } from './i18next'

const SPAN: Span = { line: 1, column: 1, offset: 0, length: 0 }

function ast(icu: string): ReturnType<typeof parse> {
  return parse(icu, {
    shouldParseSkeletons: true,
    requiresOtherClause: true,
    captureLocation: false,
    ignoreTag: false,
  })
}

function convert(value: string, markup: 'literal' | 'tags' = 'literal'): ReturnType<typeof toIcu> {
  return toIcu(value, { key: 'k', locale: 'en', file: 'locales/en.json', span: SPAN, markup })
}

function entries(values: Readonly<Record<string, string>>): readonly RawEntry[] {
  return Object.entries(values).map(([key, value]) => ({ key, value, span: SPAN }))
}

function codes(diagnostics: readonly Diagnostic[]): readonly string[] {
  return diagnostics.map((one) => one.code)
}

function fold(values: Readonly<Record<string, string>>, locale = 'en'): ReturnType<typeof foldPluralSuffixes> {
  return foldPluralSuffixes(entries(values), locale, `locales/${locale}.json`)
}

function pairs(result: { readonly entries: readonly RawEntry[] }): readonly (readonly [string, string])[] {
  return result.entries.map((entry) => [entry.key, entry.value] as const)
}

describe('toIcu on empty and blank values', () => {
  it.each(['', ' ', '\t', '\r\n', ' '])('passes %j through untouched and silent', (value) => {
    expect(convert(value)).toEqual({ icu: value, diagnostics: [] })
  })
})

describe('toIcu placeholder names outside ASCII', () => {
  it.each([
    ['{{名前}}', '名前'],
    ['{{\u{1f600}}}', '\u{1f600}'],
    ['{{اسم}}', 'اسم'],
    ['{{café}}', 'café'],
  ])('reads %j as one argument', (value, name) => {
    const { icu, diagnostics } = convert(value)
    expect(diagnostics).toEqual([])
    expect(ast(icu)).toEqual([{ type: TYPE.argument, value: name }])
  })

  it('trims a no-break space inside the braces, as String.prototype.trim does', () => {
    expect(convert('{{ name }}').icu).toBe('{name}')
  })

  it('keeps bidi controls around a placeholder as literal text', () => {
    const { icu } = convert('‫שלום {{name}}‬')
    expect(ast(icu)).toEqual([
      { type: TYPE.literal, value: '‫שלום ' },
      { type: TYPE.argument, value: 'name' },
      { type: TYPE.literal, value: '‬' },
    ])
  })
})

describe('toIcu placeholder names that collide with JavaScript', () => {
  it.each(['constructor', '__proto__', 'toString', 'hasOwnProperty', 'class', 'default', '0', '42'])(
    'reads {{%s}} as an argument and leaves judging the name downstream',
    (name) => {
      const { icu, diagnostics } = convert(`{{${name}}}`)
      expect(diagnostics).toEqual([])
      expect(ast(icu)).toEqual([{ type: TYPE.argument, value: name }])
    },
  )
})

describe('toIcu repeated and adjacent placeholders', () => {
  it('converts one name written twice into two arguments', () => {
    expect(ast(convert('{{a}} and {{a}}').icu)).toEqual([
      { type: TYPE.argument, value: 'a' },
      { type: TYPE.literal, value: ' and ' },
      { type: TYPE.argument, value: 'a' },
    ])
  })

  it('converts two placeholders with no text between them', () => {
    expect(convert('{{a}}{{b}}').icu).toBe('{a}{b}')
  })

  it('keeps a third closing brace as literal text after the argument', () => {
    expect(ast(convert('{{a}}}').icu)).toEqual([
      { type: TYPE.argument, value: 'a' },
      { type: TYPE.literal, value: '}' },
    ])
  })
})

describe('toIcu runs with no usable name', () => {
  it.each(['{{-}}', '{{,fmt}}', '{{ - name}}'])('keeps %j as literal text and reports it', (value) => {
    const { icu, diagnostics } = convert(value)
    expect(codes(diagnostics)).toEqual(['LZ1013'])
    expect(ast(icu)).toEqual([{ type: TYPE.literal, value }])
  })

  it('reads a trailing comma as an empty formatter on a real name', () => {
    const { icu, diagnostics } = convert('{{a,}}')
    expect(icu).toBe('{a}')
    expect(codes(diagnostics)).toEqual(['LZ1013'])
  })
})

describe('toIcu line endings and code units', () => {
  it.each(['a\r\nb {{x}}', 'a\rb {{x}}', 'a\nb {{x}}'])('keeps the line ending in %j', (value) => {
    const { icu } = convert(value)
    expect(icu).toBe(value.replace('{{x}}', '{x}'))
  })

  it('keeps a lone surrogate in the literal run', () => {
    expect(convert('\ud800 {{x}}').icu).toBe('\ud800 {x}')
  })

  it('keeps combining characters in literal text as written', () => {
    expect(convert('é {{x}}').icu).toBe('é {x}')
  })
})

describe('toIcu diagnostics carry the context they were given', () => {
  it('stamps file, locale, key and span on every diagnostic', () => {
    const span: Span = { line: 4, column: 12, offset: 80, length: 22 }
    const { diagnostics } = toIcu('$t(x) {{a, b}} <b>c</b>', {
      key: 'nav.home',
      locale: 'pt-BR',
      file: 'public/locales/pt-BR/common.json',
      span,
      markup: 'literal',
    })
    expect(codes(diagnostics)).toEqual(['LZ1012', 'LZ1013', 'LZ1016'])
    for (const one of diagnostics) {
      expect(one).toMatchObject({
        key: 'nav.home',
        locale: 'pt-BR',
        file: 'public/locales/pt-BR/common.json',
        span,
      })
    }
  })
})

describe('toIcu on large input', () => {
  it('converts a long value of many placeholders into a message that parses', () => {
    const value = Array.from({ length: 2000 }, (_, index) => `{ {{a${index}}} '#' <x>`).join(' ')
    const parsed = ast(convert(value).icu)
    expect(parsed.filter((element) => element.type === TYPE.argument)).toHaveLength(2000)
  })
})

describe('toIcu determinism', () => {
  it('returns equal output on two runs', () => {
    const value = "It's {{a}} <b>{x}</b> {{a, f}} $t(z) '#'"
    expect(convert(value)).toEqual(convert(value))
    expect(convert(value, 'tags')).toEqual(convert(value, 'tags'))
  })
})

describe('classifyFormat on blank and odd input', () => {
  it('reads empty and whitespace-only values as ICU', () => {
    expect(classifyFormat(entries({ a: '', b: '   ', c: '\r\n' }))).toEqual({
      format: 'icu',
      because: null,
    })
  })

  it('does not read a lone brace pair split by a line break as a placeholder', () => {
    expect(classifyFormat(entries({ a: '{\n{x}' })).format).toBe('icu')
  })

  it('carves out a typed run whose separators are CRLF line breaks', () => {
    expect(
      classifyFormat(entries({ a: '{n,\r\nplural,\r\none {{n} item} other {{n} items}}' })).format,
    ).toBe('icu')
  })

  it('quotes the deciding value verbatim, unicode and all', () => {
    const value = '‫{{名前}}‬ é'
    expect(classifyFormat(entries({ a: 'plain', b: value })).because).toBe(value)
  })

  it('decides on a plural group whose base is a prototype name', () => {
    expect(classifyFormat(entries({ constructor_one: 'a', constructor_other: 'b' }))).toEqual({
      format: 'i18next',
      because: 'constructor_one',
    })
  })

  it('does not decide on a suffix spelled in another case', () => {
    expect(classifyFormat(entries({ x_ONE: 'a', x_OTHER: 'b' })).format).toBe('icu')
  })

  it('returns the same verdict on two runs', () => {
    const list = entries({ a_other: 'x', a_two: 'y', b: '{{c}}' })
    expect(classifyFormat(list)).toEqual(classifyFormat(list))
  })
})

describe('foldPluralSuffixes on empty and degenerate keys', () => {
  it('returns nothing for no entries', () => {
    expect(foldPluralSuffixes([], 'en', 'locales/en.json')).toEqual({ entries: [], diagnostics: [] })
  })

  it('leaves a suffix with no base as an ordinary key and says nothing', () => {
    const result = fold({ _one: 'a', _other: 'b' })
    expect(pairs(result)).toEqual([
      ['_one', 'a'],
      ['_other', 'b'],
    ])
    expect(result.diagnostics).toEqual([])
  })

  it('folds nothing on a suffix in another case', () => {
    const result = fold({ x_ONE: 'a', x_Other: 'b' })
    expect(pairs(result).map(([key]) => key)).toEqual(['x_ONE', 'x_Other'])
    expect(result.diagnostics).toEqual([])
  })
})

describe('foldPluralSuffixes on prototype names', () => {
  it('folds groups whose base is __proto__ and constructor into plain keys', () => {
    const result = fold({ __proto___one: 'a', __proto___other: 'b', constructor_one: 'c', constructor_other: 'd' })
    expect(pairs(result)).toEqual([
      ['__proto__', '{count, plural, one {a} other {b}}'],
      ['constructor', '{count, plural, one {c} other {d}}'],
    ])
    expect(result.diagnostics).toEqual([])
  })

  it('reports a lone toString_one as an orphan, not as a fold', () => {
    expect(codes(fold({ toString_one: 'a' }).diagnostics)).toEqual(['LZ1014'])
  })
})

describe('foldPluralSuffixes on stacked suffixes', () => {
  it('folds x_one_one with x_one_other into x_one, beside x itself', () => {
    expect(pairs(fold({ x_one: 'a', x_other: 'b', x_one_one: 'c', x_one_other: 'd' }))).toEqual([
      ['x', '{count, plural, one {a} other {b}}'],
      ['x_one', '{count, plural, one {c} other {d}}'],
    ])
  })
})

describe('foldPluralSuffixes on namespaced keys', () => {
  it('folds onto the prefixed base and reports a prefixed bare key beside it', () => {
    const result = fold({ 'common.items_one': 'a', 'common.items_other': 'b', 'common.items': 'c' })
    expect(pairs(result)).toEqual([['common.items', '{count, plural, one {a} other {b}}']])
    expect(codes(result.diagnostics)).toEqual(['LZ1011'])
    expect(result.diagnostics[0]?.key).toBe('common.items')
  })
})

describe('foldPluralSuffixes across locale spellings', () => {
  it('folds a lone other under a region subtag of a single-category locale', () => {
    expect(pairs(fold({ items_other: 'x' }, 'ja-JP'))).toEqual([
      ['items', '{count, plural, other {x}}'],
    ])
  })

  it('reads an extension subtag as the base locale', () => {
    expect(pairs(fold({ x_zero: 'none', x_other: 'some' }, 'en-u-nu-arab'))).toEqual([
      ['x', '{count, plural, =0 {none} other {some}}'],
    ])
  })

  it('reads an upper case tag as the same locale', () => {
    expect(fold({ x_one: 'a', x_other: 'b' }, 'EN')).toEqual(fold({ x_one: 'a', x_other: 'b' }, 'en'))
  })

  it('keeps a keyword zero under a region of a locale that has the category', () => {
    expect(pairs(fold({ x_zero: 'z', x_other: 'o' }, 'ar-EG'))).toEqual([
      ['x', '{count, plural, zero {z} other {o}}'],
    ])
  })

  it('folds a lone ordinal other in German, whose ordinal has one category', () => {
    expect(pairs(fold({ place_ordinal_other: '{n}.' }, 'de-u-co-phonebk'))).toEqual([
      ['place', '{count, selectordinal, other {{n}.}}'],
    ])
  })
})

describe('foldPluralSuffixes keeps branch text as written', () => {
  it('keeps bidi controls and CRLF inside a branch', () => {
    const body = '‫א‬\r\n'
    expect(pairs(fold({ x_one: body, x_other: 'b' }))).toEqual([
      ['x', `{count, plural, one {${body}} other {b}}`],
    ])
  })

  it('keeps an emoji branch that parses back to the same text', () => {
    const value = pairs(fold({ x_one: '\u{1f600}', x_other: '\u{1f600}\u{1f600}' }))[0]?.[1] ?? ''
    const [element] = ast(value)
    if (element === undefined || element.type !== TYPE.plural) throw new Error('not a plural')
    expect(element.options['one']?.value).toEqual([{ type: TYPE.literal, value: '\u{1f600}' }])
  })

  it('carries the span of the first member onto the folded key', () => {
    const first: Span = { line: 2, column: 3, offset: 10, length: 1 }
    const second: Span = { line: 3, column: 3, offset: 20, length: 1 }
    const result = foldPluralSuffixes(
      [
        { key: 'x_other', value: 'b', span: first },
        { key: 'x_one', value: 'a', span: second },
      ],
      'en',
      'locales/en.json',
    )
    expect(result.entries[0]?.span).toEqual(first)
  })
})

describe('foldPluralSuffixes v3 plural shape', () => {
  it('raises nothing for x_plural with no bare x beside it', () => {
    const result = fold({ items_plural: 'many' })
    expect(result.diagnostics).toEqual([])
    expect(pairs(result)).toEqual([['items_plural', 'many']])
  })
})

describe('foldPluralSuffixes determinism', () => {
  it('returns equal entries and diagnostics on two runs', () => {
    const values = {
      friend: 'f',
      friend_male_one: 'a',
      friend_male_other: 'b',
      x_one: 'c',
      x: 'd',
      x_other: 'e',
      y_few: 'g',
    }
    expect(fold(values, 'ru')).toEqual(fold(values, 'ru'))
  })
})
