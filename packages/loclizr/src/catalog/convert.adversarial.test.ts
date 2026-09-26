import type { MessageFormatElement } from '@formatjs/icu-messageformat-parser'
import { parse, TYPE } from '@formatjs/icu-messageformat-parser'
import { describe, expect, it } from 'vitest'
import type { Diagnostic, RawEntry } from '../types'
import { foldPluralSuffixes, toIcu } from './i18next'

const SPAN = { line: 1, column: 1, offset: 0, length: 0 }
const OPEN = '⟦'
const CLOSE = '⟧'

function convert(value: string, markup: 'literal' | 'tags' = 'literal'): ReturnType<typeof toIcu> {
  return toIcu(value, { key: 'k', locale: 'en', file: 'locales/en.json', span: SPAN, markup })
}

function ast(icu: string): readonly MessageFormatElement[] {
  return parse(icu, {
    shouldParseSkeletons: true,
    requiresOtherClause: true,
    captureLocation: false,
    ignoreTag: false,
  })
}

// What a reader sees, with every argument stamped so a placeholder that turned
// into literal text, or literal text that turned into an argument, shows up as a
// difference rather than as an equal string.
function render(elements: readonly MessageFormatElement[]): string {
  let out = ''
  for (const element of elements) {
    if (element.type === TYPE.literal) out += element.value
    else if (element.type === TYPE.argument) out += `${OPEN}${element.value}${CLOSE}`
    else if (element.type === TYPE.tag) out += `<${element.value}>${render(element.children)}</${element.value}>`
    else out += `UNEXPECTED_${element.type}`
  }
  return out
}

function asRendered(value: string): string {
  return value.replaceAll(/\{\{\s*([^{}]+?)\s*\}\}/g, `${OPEN}$1${CLOSE}`)
}

function codes(diagnostics: readonly Diagnostic[]): readonly string[] {
  return diagnostics.map((one) => one.code)
}

const HOSTILE: readonly string[] = [
  "Don't stop",
  "Don''t stop {{x}}",
  "'{'",
  "It's {{count}}% of {{total}}",
  '#1 {{name}}',
  'C# and F# {{x}}',
  '{{a}}{{b}}',
  '{ unbalanced {{x}}',
  '} closing first {{x}}',
  '<b>{{x}}</b>',
  'Read <a href="/t">terms</a> {{x}}',
  'Line<br>break {{x}}',
  'a < b && c > d {{x}}',
  "'<b>' quoted {{x}}",
  '<3 {{x}}',
  '100% sure {{x}}',
  '{{x}} \u{1f600} züri נס {{y}}',
  'Zero​width {{x}}',
  'Tab\there {{x}}',
  'Line1\nLine2 {{x}}',
  '${{x}}',
  "{{x}}'",
  "''{{x}}''",
  "a''{b}''c {{x}}",
  '50 {{x}} # 60',
  '{{ spaced }}',
  '{{\tname\n}}',
  '{{ nbsp }}',
  '{{ünïcode}}',
  'Back\\slash {{x}}',
  "Press '{' then {{x}}",
  '#{{x}}#',
  'Two {{ braces',
  "Ticket #'#2 {{x}}",
  "#'{ {{x}}",
  'Empty {{}} runs',
]

const TAGGED: readonly string[] = [
  'Click <b>here</b> {{x}}',
  '<b><i>{{x}}</i></b>',
  'Set {color} on <b>x</b>',
  '#1 <b>{{x}}</b>',
  "Don't <b>{{x}}</b>",
]

describe('toIcu keeps what i18next rendered', () => {
  it.each(HOSTILE)('converts %j without changing what it says', (value) => {
    const { icu } = convert(value)
    expect(render(ast(icu))).toBe(asRendered(value))
  })

  it.each(TAGGED)('lowers %j to markup without changing what it says', (value) => {
    const { icu } = convert(value, 'tags')
    expect(render(ast(icu))).toBe(asRendered(value))
  })
})

describe('foldPluralSuffixes keeps what the branches said', () => {
  it.each(HOSTILE)('wraps %j into a plural branch unchanged', (value) => {
    const entries: readonly RawEntry[] = [
      { key: 'x_one', value: convert(value).icu, span: SPAN },
      { key: 'x_other', value: convert(`${value} plural`).icu, span: SPAN },
    ]
    const folded = foldPluralSuffixes(entries, 'en', 'locales/en.json')
    const [element] = ast(folded.entries[0]?.value ?? '')
    if (element === undefined || element.type !== TYPE.plural) throw new Error('not a plural')
    expect(render(element.options['one']?.value ?? [])).toBe(asRendered(value))
    expect(render(element.options['other']?.value ?? [])).toBe(asRendered(`${value} plural`))
  })
})

describe('toIcu reports tag-shaped text and nothing else', () => {
  const tagShaped: readonly string[] = [
    '<b>{{x}}</b>',
    'Line<br>break {{x}}',
    'Read <a href="/t">terms</a> {{x}}',
    "'<b>' quoted {{x}}",
  ]
  const notTagShaped: readonly string[] = ['a < b && c > d {{x}}', '<3 {{x}}', '100% sure {{x}}']

  it.each(tagShaped)('raises one LZ1016 for %j', (value) => {
    expect(codes(convert(value).diagnostics)).toEqual(['LZ1016'])
  })

  it.each(notTagShaped)('raises nothing for %j', (value) => {
    expect(convert(value).diagnostics).toEqual([])
  })

  it.each(tagShaped)('raises no LZ1016 for %j under i18nextMarkup tags', (value) => {
    expect(codes(convert(value, 'tags').diagnostics)).not.toContain('LZ1016')
  })
})

describe('toIcu on a run that carries no name', () => {
  it('keeps a nameless run as the literal text i18next rendered', () => {
    const { icu } = convert('Empty {{}} and {{ }} runs')
    expect(render(ast(icu))).toBe('Empty {{}} and {{ }} runs')
  })
})

describe('toIcu placeholder names it must not judge', () => {
  it('passes a reserved name straight through for M3 to reject', () => {
    const { icu, diagnostics } = convert('{{__proto__}} and {{constructor}}')
    expect(icu).toBe('{__proto__} and {constructor}')
    expect(diagnostics).toEqual([])
  })

  it('reports an inline formatter once and keeps only the name', () => {
    const { icu, diagnostics } = convert('{{ val , number(minimumFractionDigits: 2) }} left')
    expect(icu).toBe('{val} left')
    expect(codes(diagnostics)).toEqual(['LZ1013'])
  })

  it('reports nesting whatever else the value holds', () => {
    const { diagnostics } = convert("Read $t(terms) and $t(privacy) {{x}}'")
    expect(codes(diagnostics)).toEqual(['LZ1012'])
  })
})
