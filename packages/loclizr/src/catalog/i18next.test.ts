import { parse, TYPE } from '@formatjs/icu-messageformat-parser'
import { describe, expect, it } from 'vitest'
import type { Diagnostic, RawEntry } from '../types'
import { classifyFormat, findTypedArgument, foldPluralSuffixes, toIcu } from './i18next'

const SPAN = { line: 1, column: 1, offset: 0, length: 0 }

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

function entries(values: Record<string, string>): readonly RawEntry[] {
  return Object.entries(values).map(([key, value]) => ({ key, value, span: SPAN }))
}

function keys(values: Record<string, string>): readonly RawEntry[] {
  return entries(values)
}

function codes(diagnostics: readonly Diagnostic[]): readonly string[] {
  return diagnostics.map((one) => one.code)
}

function valueOf(result: { readonly entries: readonly RawEntry[] }, key: string): string | undefined {
  return result.entries.find((entry) => entry.key === key)?.value
}

describe('toIcu escaping', () => {
  it('keeps both apostrophes of a doubled apostrophe and keeps the placeholder', () => {
    const { icu } = convert("Don''t {{x}}")
    expect(ast(icu)).toEqual([
      { type: TYPE.literal, value: "Don''t " },
      { type: TYPE.argument, value: 'x' },
    ])
  })

  it('invents no argument out of single-brace text', () => {
    const { icu } = convert('Set {color} in CSS')
    expect(ast(icu)).toEqual([{ type: TYPE.literal, value: 'Set {color} in CSS' }])
  })

  it('leaves a lone apostrophe alone', () => {
    expect(ast(convert("Don't panic").icu)).toEqual([{ type: TYPE.literal, value: "Don't panic" }])
  })

  it('keeps a hash literal without swallowing the argument behind it', () => {
    const { icu } = convert('Ticket #{{id}} updated')
    expect(ast(icu)).toEqual([
      { type: TYPE.literal, value: 'Ticket #' },
      { type: TYPE.argument, value: 'id' },
      { type: TYPE.literal, value: ' updated' },
    ])
  })

  it('escapes tag-shaped text to literal text and says so', () => {
    const { icu, diagnostics } = convert('Click <b>here</b> {{x}}')
    expect(ast(icu)).toEqual([
      { type: TYPE.literal, value: 'Click <b>here</b> ' },
      { type: TYPE.argument, value: 'x' },
    ])
    expect(codes(diagnostics)).toEqual(['LZ1016'])
  })

  it('escapes text the parser would reject as a tag', () => {
    expect(ast(convert('Line<br>break').icu)).toEqual([
      { type: TYPE.literal, value: 'Line<br>break' },
    ])
    expect(ast(convert('Read <a href="/t">terms</a>').icu)).toEqual([
      { type: TYPE.literal, value: 'Read <a href="/t">terms</a>' },
    ])
  })

  it('lowers tags to markup under i18nextMarkup tags, with no LZ1016', () => {
    const { icu, diagnostics } = convert('Click <b>here</b> {{x}}', 'tags')
    expect(ast(icu)).toEqual([
      { type: TYPE.literal, value: 'Click ' },
      { type: TYPE.tag, value: 'b', children: [{ type: TYPE.literal, value: 'here' }] },
      { type: TYPE.literal, value: ' ' },
      { type: TYPE.argument, value: 'x' },
    ])
    expect(diagnostics).toEqual([])
  })

  it('still escapes braces under i18nextMarkup tags', () => {
    expect(ast(convert('Set {color} on <b>this</b>', 'tags').icu)).toEqual([
      { type: TYPE.literal, value: 'Set {color} on ' },
      { type: TYPE.tag, value: 'b', children: [{ type: TYPE.literal, value: 'this' }] },
    ])
  })
})

describe('toIcu placeholders', () => {
  it('trims the braces and keeps count a plain argument', () => {
    expect(convert('{{ name }} has {{count}}').icu).toBe('{name} has {count}')
  })

  it('reports an inline formatter and keeps the bare argument', () => {
    const { icu, diagnostics } = convert('{{val, uppercase}} now')
    expect(icu).toBe('{val} now')
    expect(codes(diagnostics)).toEqual(['LZ1013'])
  })

  it('reports nesting and leaves the call as literal text', () => {
    const { icu, diagnostics } = convert('See $t(nav.home) first')
    expect(codes(diagnostics)).toEqual(['LZ1012'])
    expect(ast(icu)).toEqual([{ type: TYPE.literal, value: 'See $t(nav.home) first' }])
  })

  it('treats an unterminated run as literal text', () => {
    expect(ast(convert('Two {{ braces').icu)).toEqual([
      { type: TYPE.literal, value: 'Two {{ braces' },
    ])
  })

  it('treats a run with no name as the literal text i18next rendered', () => {
    expect(ast(convert('Empty {{}} and {{ }} runs').icu)).toEqual([
      { type: TYPE.literal, value: 'Empty {{}} and {{ }} runs' },
    ])
  })

  it('treats a run whose name carries a brace as literal text', () => {
    expect(ast(convert('Open {{{name}}').icu)).toEqual([
      { type: TYPE.literal, value: 'Open {{{name}}' },
    ])
  })

  it('drops the unescape prefix and keeps the argument', () => {
    expect(convert('Hello {{- name}}')).toEqual({ icu: 'Hello {name}', diagnostics: [] })
    expect(convert('Hello {{-name}}').icu).toBe('Hello {name}')
  })

  it('drops the unescape prefix before it reads a formatter', () => {
    const { icu, diagnostics } = convert('{{- price, currency}}')
    expect(icu).toBe('{price}')
    expect(codes(diagnostics)).toEqual(['LZ1013'])
  })

  it('keeps a dash that is not the unescape prefix as the literal text i18next rendered', () => {
    const { icu, diagnostics } = convert('Hello {{ - name}}')
    expect(ast(icu)).toEqual([{ type: TYPE.literal, value: 'Hello {{ - name}}' }])
    expect(codes(diagnostics)).toEqual(['LZ1013'])
  })

  it('keeps a nested path as literal text and names the flat argument to write', () => {
    const { icu, diagnostics } = convert('Logged in as {{user.name}}')
    expect(ast(icu)).toEqual([{ type: TYPE.literal, value: 'Logged in as {{user.name}}' }])
    expect(codes(diagnostics)).toEqual(['LZ1013'])
    expect(diagnostics[0]?.message).toContain('{{user.name}}')
    expect(diagnostics[0]?.hint).toContain('{{userName}}')
  })

  it('keeps every name the parser would reject as literal text', () => {
    for (const value of ['{{user-name}}', '{{items[0]}}', '{{a b}}', '{{a.b, currency}}']) {
      const { icu, diagnostics } = convert(value)
      expect(ast(icu)).toEqual([{ type: TYPE.literal, value }])
      expect(codes(diagnostics)).toEqual(['LZ1013'])
    }
  })

  it('escapes the text around a rejected name in one pass', () => {
    expect(ast(convert('Press { then {{user.name}} and {{x}}').icu)).toEqual([
      { type: TYPE.literal, value: 'Press { then {{user.name}} and ' },
      { type: TYPE.argument, value: 'x' },
    ])
  })
})

describe('toIcu under i18nextMarkup tags', () => {
  it('escapes a numbered Trans tag to literal text and names it', () => {
    const { icu, diagnostics } = convert('I accept the <1>terms of service</1>', 'tags')
    expect(ast(icu)).toEqual([{ type: TYPE.literal, value: 'I accept the <1>terms of service</1>' }])
    expect(codes(diagnostics)).toEqual(['LZ1016'])
    expect(diagnostics[0]?.message).toContain('</1>')
  })

  it('escapes nested numbered tags to literal text', () => {
    const { icu, diagnostics } = convert('<0><1>Read this first</1></0>', 'tags')
    expect(ast(icu)).toEqual([{ type: TYPE.literal, value: '<0><1>Read this first</1></0>' }])
    expect(codes(diagnostics)).toEqual(['LZ1016'])
  })

  it('escapes a tag with attributes to literal text', () => {
    const { icu, diagnostics } = convert('Read <a href="/t">terms</a>', 'tags')
    expect(ast(icu)).toEqual([{ type: TYPE.literal, value: 'Read <a href="/t">terms</a>' }])
    expect(codes(diagnostics)).toEqual(['LZ1016'])
    expect(diagnostics[0]?.message).toContain('<a href="/t">')
  })

  it('escapes the whole value when one tag of it cannot lower', () => {
    const value = '<bold>Ada</bold> accepted the <1>terms</1>'
    const { icu, diagnostics } = convert(value, 'tags')
    expect(ast(icu)).toEqual([{ type: TYPE.literal, value }])
    expect(codes(diagnostics)).toEqual(['LZ1016'])
  })

  it('escapes what the parser would reject as unclosed, unmatched or cut by an argument', () => {
    for (const value of [
      'Line<br>break',
      '<b><i>x</b></i>',
      'stray </b> here',
      '<b{{x}}>',
      '</{{x}}',
      '{{a<b}}',
      '{{<b>}}',
    ]) {
      const { icu, diagnostics } = convert(value, 'tags')
      expect(() => ast(icu)).not.toThrow()
      expect(codes(diagnostics)).toContain('LZ1016')
    }
  })

  it('still lowers a self-closing tag and a tag with space before its bracket', () => {
    expect(convert('a<br/>b <br />c', 'tags').diagnostics).toEqual([])
    expect(() => ast(convert('a<br/>b <br />c', 'tags').icu)).not.toThrow()
    const { icu, diagnostics } = convert('<b >x</b >', 'tags')
    expect(diagnostics).toEqual([])
    expect(ast(icu)).toEqual([
      { type: TYPE.tag, value: 'b', children: [{ type: TYPE.literal, value: 'x' }] },
    ])
  })

  it('leaves an angle bracket that opens no tag alone', () => {
    for (const value of ['a < b && c > d', '<3 {{x}}', '<{{x}}', 'x <']) {
      const { icu, diagnostics } = convert(value, 'tags')
      expect(diagnostics).toEqual([])
      expect(() => ast(icu)).not.toThrow()
    }
  })
})

describe('toIcu output always parses', () => {
  const values: readonly string[] = [
    'Hello {{- name}}',
    'Logged in as {{user.name}}',
    'I accept the <1>terms of service</1>',
    '<0><1>Read this first</1></0>',
    'Read <a href="/t">terms</a>',
    'Line<br>break',
    '<b><i>x</b></i>',
    'stray </b> here',
    '<b{{x}}>',
    '{{a<b}}',
    '{{<b>}}',
    'Press { then {{user.name}}',
    '{{- }}',
    '{{ - x}}',
    '{{a.b, currency}}',
    "'{'{{user.name}}'}'",
  ]

  it.each(values)('parses %j under i18nextMarkup literal', (value) => {
    expect(() => ast(convert(value).icu)).not.toThrow()
  })

  it.each(values)('parses %j under i18nextMarkup tags', (value) => {
    expect(() => ast(convert(value, 'tags').icu)).not.toThrow()
  })
})

describe('findTypedArgument', () => {
  it('finds every typed ICU form', () => {
    expect(findTypedArgument('{count, plural, one {a} other {b}}')).toBe('{count, plural')
    expect(findTypedArgument('x {s, selectordinal, other {b}}')).toBe('{s, selectordinal')
    expect(findTypedArgument('{g, select, other {b}}')).toBe('{g, select')
    expect(findTypedArgument('{n, number, ::currency/USD}')).toBe('{n, number')
    expect(findTypedArgument('{d, date, medium}')).toBe('{d, date')
    expect(findTypedArgument('{t, time, short}')).toBe('{t, time')
  })

  it('ignores a doubled brace and anything that is not a typed argument', () => {
    expect(findTypedArgument('{{x, plural}}')).toBeNull()
    expect(findTypedArgument('{name}')).toBeNull()
    expect(findTypedArgument('{x, uppercase}')).toBeNull()
    expect(findTypedArgument('nothing here')).toBeNull()
  })
})

describe('classifyFormat', () => {
  it('reads a file with a double brace as i18next and quotes the deciding value', () => {
    expect(classifyFormat(keys({ 'cart.greeting': 'Servus {{name}}' }))).toEqual({
      format: 'i18next',
      because: 'Servus {{name}}',
    })
  })

  it('reads a file with a foldable plural group as i18next and names the deciding key', () => {
    expect(classifyFormat(keys({ items_one: 'one', items_other: 'many' }))).toEqual({
      format: 'i18next',
      because: 'items_one',
    })
  })

  it('does not read an ICU branch body opening onto an argument as a placeholder', () => {
    const icuPlural =
      '{count, plural, =0 {Dein Warenkorb ist leer} one {{count} Artikel} other {{count} Artikel}}'
    expect(classifyFormat(keys({ 'cart.items': icuPlural })).format).toBe('icu')
    expect(classifyFormat(keys({ 'order.status': '{state, select, other {{name}}}' })).format).toBe(
      'icu',
    )
  })

  it('still sees a placeholder beside single-brace text', () => {
    expect(classifyFormat(keys({ a: 'Set {color} and {{x}}' })).format).toBe('i18next')
  })

  it('still sees a placeholder that follows a typed ICU run', () => {
    expect(classifyFormat(keys({ a: '{n, number} left, {{name}}' })).format).toBe('i18next')
  })

  it('reads prose around a stray brace as the i18next it is', () => {
    expect(classifyFormat(keys({ a: 'a { color: {{c}} }' })).format).toBe('i18next')
  })

  it('reads ICU argument syntax as ICU', () => {
    expect(classifyFormat(keys({ items: '{count, plural, one {a} other {b}}' }))).toEqual({
      format: 'icu',
      because: null,
    })
  })

  it('does not classify on a suffix the fold step would not fold', () => {
    expect(classifyFormat(keys({ items_one: 'one' })).format).toBe('icu')
    expect(classifyFormat(keys({ items: 'one', items_plural: 'many' })).format).toBe('icu')
    expect(classifyFormat(keys({ items_other: 'many' })).format).toBe('icu')
  })

  it('reports the first entry that decided, not the first of a kind', () => {
    expect(
      classifyFormat(keys({ a_one: 'one', a_other: 'many', b: 'has {{x}}' })).because,
    ).toBe('a_one')
  })
})

describe('foldPluralSuffixes cardinal groups', () => {
  it('folds one group to the base key with count as the selector', () => {
    const result = foldPluralSuffixes(
      entries({ items_one: '{count} item', items_other: '{count} items' }),
      'en',
      'locales/en.json',
    )
    expect(result.entries).toEqual([
      {
        key: 'items',
        value: '{count, plural, one {{count} item} other {{count} items}}',
        span: SPAN,
      },
    ])
    expect(result.diagnostics).toEqual([])
  })

  it('orders branches in CLDR order whatever the file order', () => {
    const result = foldPluralSuffixes(
      entries({
        x_other: 'o',
        x_few: 'f',
        x_zero: 'z',
        x_one: '1',
        x_many: 'm',
        x_two: '2',
      }),
      'ar',
      'locales/ar.json',
    )
    expect(valueOf(result, 'x')).toBe(
      '{count, plural, zero {z} one {1} two {2} few {f} many {m} other {o}}',
    )
  })

  it('decides the zero branch per locale', () => {
    const german = foldPluralSuffixes(
      entries({ x_zero: 'keins', x_one: 'eins', x_other: 'viele' }),
      'de',
      'locales/de.json',
    )
    const latvian = foldPluralSuffixes(
      entries({ x_zero: 'nulle', x_one: 'viens', x_other: 'daudz' }),
      'lv',
      'locales/lv.json',
    )
    expect(valueOf(german, 'x')).toBe('{count, plural, =0 {keins} one {eins} other {viele}}')
    expect(valueOf(latvian, 'x')).toBe('{count, plural, zero {nulle} one {viens} other {daudz}}')
  })

  it('keeps a hash literal inside a folded branch instead of rendering the count', () => {
    const converted = entries({
      x_one: convert('Row #{{n}}').icu,
      x_other: convert('Rows #{{n}}').icu,
    })
    const value = valueOf(foldPluralSuffixes(converted, 'en', 'locales/en.json'), 'x') ?? ''
    expect(ast(value)).toEqual([
      {
        type: TYPE.plural,
        value: 'count',
        offset: 0,
        pluralType: 'cardinal',
        options: {
          one: {
            value: [
              { type: TYPE.literal, value: 'Row #' },
              { type: TYPE.argument, value: 'n' },
            ],
          },
          other: {
            value: [
              { type: TYPE.literal, value: 'Rows #' },
              { type: TYPE.argument, value: 'n' },
            ],
          },
        },
      },
    ])
  })

  it('wraps a run i18next could not name into a branch as the text it was', () => {
    const converted = entries({
      x_one: convert('Open {{{name}}').icu,
      x_other: convert('Empty {{}} and {{ }} runs').icu,
    })
    const value = valueOf(foldPluralSuffixes(converted, 'en', 'locales/en.json'), 'x') ?? ''
    expect(ast(value)[0]).toMatchObject({
      options: {
        one: { value: [{ type: TYPE.literal, value: 'Open {{{name}}' }] },
        other: { value: [{ type: TYPE.literal, value: 'Empty {{}} and {{ }} runs' }] },
      },
    })
  })

  it('keeps an apostrophe between two hashes from doubling inside the branch', () => {
    const converted = entries({
      x_one: convert("Ticket #'#2").icu,
      x_other: convert('rest').icu,
    })
    const value = valueOf(foldPluralSuffixes(converted, 'en', 'locales/en.json'), 'x') ?? ''
    expect(ast(value)[0]).toMatchObject({
      options: { one: { value: [{ type: TYPE.literal, value: "Ticket #'#2" }] } },
    })
  })

  it('merges a hash into the quoted run beside it', () => {
    const converted = entries({
      x_one: convert('<b>#1</b>').icu,
      x_other: convert('rest').icu,
    })
    const value = valueOf(foldPluralSuffixes(converted, 'en', 'locales/en.json'), 'x') ?? ''
    expect(ast(value)[0]).toMatchObject({
      options: { one: { value: [{ type: TYPE.literal, value: '<b>#1</b>' }] } },
    })
  })

  it('keeps a converted placeholder as an argument rather than a pound', () => {
    const converted = entries({
      'cart.items_one': convert('{{count}} Artikel').icu,
      'cart.items_other': convert('{{count}} Artikel').icu,
    })
    expect(valueOf(foldPluralSuffixes(converted, 'de', 'locales/de.json'), 'cart.items')).toBe(
      '{count, plural, one {{count} Artikel} other {{count} Artikel}}',
    )
  })
})

describe('foldPluralSuffixes ordinal groups', () => {
  it('matches the ordinal infix before the plain suffix', () => {
    const result = foldPluralSuffixes(
      entries({ place_ordinal_one: '{count}st', place_ordinal_other: '{count}th' }),
      'en',
      'locales/en.json',
    )
    expect(result.entries.map((entry) => entry.key)).toEqual(['place'])
    expect(valueOf(result, 'place')).toBe(
      '{count, selectordinal, one {{count}st} other {{count}th}}',
    )
  })

  it('keeps both keys when a cardinal group shares the base', () => {
    const result = foldPluralSuffixes(
      entries({
        place_one: 'one place',
        place_other: 'places',
        place_ordinal_one: '{count}st',
        place_ordinal_other: '{count}th',
      }),
      'en',
      'locales/en.json',
    )
    expect(result.entries.map((entry) => entry.key)).toEqual(['place', 'place_ordinal'])
    expect(valueOf(result, 'place')).toBe('{count, plural, one {one place} other {places}}')
    expect(valueOf(result, 'place_ordinal')).toBe(
      '{count, selectordinal, one {{count}st} other {{count}th}}',
    )
  })

  it('decides the ordinal zero branch against the ordinal category set', () => {
    const result = foldPluralSuffixes(
      entries({ x_ordinal_zero: 'z', x_ordinal_one: '1st', x_ordinal_other: 'nth' }),
      'lv',
      'locales/lv.json',
    )
    expect(valueOf(result, 'x')).toBe('{count, selectordinal, =0 {z} one {1st} other {nth}}')
  })
})

describe('foldPluralSuffixes diagnostics', () => {
  it('reports a suffixed key with no other sibling and leaves it ordinary', () => {
    const result = foldPluralSuffixes(entries({ items_one: 'one' }), 'en', 'locales/en.json')
    expect(result.entries.map((entry) => entry.key)).toEqual(['items_one'])
    expect(codes(result.diagnostics)).toEqual(['LZ1014'])
    expect(result.diagnostics[0]?.hint).toContain('items_other')
  })

  it('leaves a lone other alone where the locale has a sibling category', () => {
    const result = foldPluralSuffixes(entries({ items_other: 'many' }), 'en', 'locales/en.json')
    expect(result.entries.map((entry) => entry.key)).toEqual(['items_other'])
    expect(result.diagnostics).toEqual([])
  })

  it('folds a lone other where the locale has no second category to pair it with', () => {
    const result = foldPluralSuffixes(
      entries({ items_other: '{count} アイテム' }),
      'ja',
      'locales/ja.json',
    )
    expect(result.entries.map((entry) => entry.key)).toEqual(['items'])
    expect(valueOf(result, 'items')).toBe('{count, plural, other {{count} アイテム}}')
    expect(result.diagnostics).toEqual([])
  })

  it('folds a lone ordinal other against the ordinal category set', () => {
    const result = foldPluralSuffixes(
      entries({ place_ordinal_other: '{count}.' }),
      'de',
      'locales/de.json',
    )
    expect(result.entries.map((entry) => entry.key)).toEqual(['place'])
    expect(valueOf(result, 'place')).toBe('{count, selectordinal, other {{count}.}}')
  })

  it('leaves a lone cardinal other of that same locale alone', () => {
    const result = foldPluralSuffixes(entries({ place_other: 'Plätze' }), 'de', 'locales/de.json')
    expect(result.entries.map((entry) => entry.key)).toEqual(['place_other'])
  })

  it('reports the i18next JSON v3 pair and keeps both keys', () => {
    const result = foldPluralSuffixes(
      entries({ items: 'one item', items_plural: 'many items' }),
      'en',
      'locales/en.json',
    )
    expect(result.entries.map((entry) => entry.key)).toEqual(['items', 'items_plural'])
    expect(codes(result.diagnostics)).toEqual(['LZ1014'])
    expect(result.diagnostics[0]?.hint).toContain('v3 to v4')
  })

  it('reports context suffixes with the ICU rewrite to paste', () => {
    const result = foldPluralSuffixes(
      entries({ friend: 'A friend', friend_male: 'A boyfriend', friend_female: 'A girlfriend' }),
      'en',
      'locales/en.json',
    )
    expect(codes(result.diagnostics)).toEqual(['LZ1017'])
    const [reported] = result.diagnostics
    expect(reported?.key).toBe('friend')
    expect(reported?.related.map((one) => one.key)).toEqual(['friend_male', 'friend_female'])
    expect(reported?.hint).toContain('{context, select, male {...} female {...} other {...}}')
    expect(reported?.hint).toContain('convert this file to ICU first')
    expect(result.entries.map((entry) => entry.key)).toEqual([
      'friend',
      'friend_male',
      'friend_female',
    ])
  })

  it('does not read ordinary snake_case keys beside their base as contexts', () => {
    const result = foldPluralSuffixes(
      entries({
        accept: 'Accept',
        accept_invitation: 'Accept invitation',
        accept_license: 'Accept license',
        basic: 'Basic',
        basic_desc: 'Basic description',
      }),
      'en',
      'locales/en.json',
    )
    expect(result.diagnostics).toEqual([])
  })

  it('reports only the context suffixes of a base that also has snake_case siblings', () => {
    const result = foldPluralSuffixes(
      entries({ friend: 'A friend', friend_male: 'A boyfriend', friend_request: 'Add friend' }),
      'en',
      'locales/en.json',
    )
    expect(codes(result.diagnostics)).toEqual(['LZ1017'])
    const [reported] = result.diagnostics
    expect(reported?.related.map((one) => one.key)).toEqual(['friend_male'])
    expect(reported?.hint).toContain('{context, select, male {...} other {...}}')
  })

  it('does not claim a context member is unreachable, since it keeps its own function', () => {
    const result = foldPluralSuffixes(
      entries({ friend: 'A friend', friend_male: 'A boyfriend' }),
      'en',
      'locales/en.json',
    )
    expect(codes(result.diagnostics)).toEqual(['LZ1017'])
    const [reported] = result.diagnostics
    expect(reported?.message).not.toContain('nothing selects')
    expect(reported?.related.map((one) => one.message)).not.toContain(
      'selected by nothing after import',
    )
  })

  it('sees a context under a folded base', () => {
    const result = foldPluralSuffixes(
      entries({
        friend_one: 'a friend',
        friend_other: 'friends',
        friend_male_one: 'a boyfriend',
        friend_male_other: 'boyfriends',
      }),
      'en',
      'locales/en.json',
    )
    expect(result.entries.map((entry) => entry.key)).toEqual(['friend', 'friend_male'])
    expect(codes(result.diagnostics)).toEqual(['LZ1017'])
  })

  it('does not report a plural key as a context suffix', () => {
    const result = foldPluralSuffixes(
      entries({ items_one: 'one', items_other: 'many' }),
      'en',
      'locales/en.json',
    )
    expect(result.diagnostics).toEqual([])
  })

  it('reports a bare key that the fold overwrites', () => {
    const result = foldPluralSuffixes(
      entries({ items: 'items', items_one: 'one', items_other: 'many' }),
      'en',
      'locales/en.json',
    )
    expect(codes(result.diagnostics)).toEqual(['LZ1011'])
    expect(valueOf(result, 'items')).toBe('{count, plural, one {one} other {many}}')
    expect(result.entries).toHaveLength(1)
  })
})
