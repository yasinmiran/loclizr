import { describe, expect, test } from 'vitest'
import type { Config, EmittedFile, Message } from '../types'
import { emit } from './index'
import { HEADER } from './shared'
import { body, choice, config, message, plural, pound, program, text, translated } from './__fixtures__/program'

function tree(messages: readonly Message[], resolved: Config = config({ locales: ['en'] })): readonly EmittedFile[] {
  const result = emit(program({ messages, config: resolved }))
  expect(result.diagnostics).toEqual([])
  return result.files
}

function contentsOf(files: readonly EmittedFile[], path: string): string {
  const file = files.find((candidate) => candidate.path === path)
  if (file === undefined) throw new Error(`no emitted file at ${path}`)
  return file.contents
}

function positionOf(haystack: string, needle: string): number {
  const index = haystack.indexOf(needle)
  if (index === -1) throw new Error(`${needle} not emitted`)
  return index
}

describe('_formats.d.ts with no number, date or # node', () => {
  test('is header only, as section 7 promises', () => {
    const greeting = message({
      key: 'greeting',
      source: 'Hello',
      bodies: [body('en', [text('Hello')])],
      origins: [translated('en')],
    })
    expect(contentsOf(tree([greeting]), 'messages/_formats.d.ts')).toBe(`${HEADER}\n`)
  })
})

describe('plural locals', () => {
  test('are numbered by first appearance of each distinct selector name', () => {
    const counts = message({
      key: 'counts',
      source: '{count, plural, other {#}} of {count, plural, one {# file} other {# files}} in {items, plural, other {# items}}',
      args: [
        { name: 'count', type: { kind: 'number' } },
        { name: 'items', type: { kind: 'number' } },
      ],
      bodies: [
        body('en', [
          plural('count', { branches: [{ keyword: 'other', body: [pound()] }] }),
          text(' of '),
          plural('count', {
            branches: [
              { keyword: 'one', body: [pound(), text(' file')] },
              { keyword: 'other', body: [pound(), text(' files')] },
            ],
          }),
          text(' in '),
          plural('items', { branches: [{ keyword: 'other', body: [pound(), text(' items')] }] }),
        ]),
      ],
      origins: [translated('en')],
    })
    const emitted = contentsOf(tree([counts]), 'messages/_root.js')
    expect(emitted).toContain('const n0 = args.count')
    expect(emitted).toContain('const n1 = args.items')
    expect(emitted).not.toContain('n2')
  })
})

describe('branch collapse is all or nothing', () => {
  test('a plural keeps its keyword branches when only some of them match other', () => {
    // Russian writes `other` (fractions) with the same form as `few`, while
    // `one` and `many` still differ.
    const files = message({
      key: 'files',
      source: '{count, plural, one {# file} other {# files}}',
      args: [{ name: 'count', type: { kind: 'number' } }],
      bodies: [
        body('en', [
          plural('count', {
            branches: [
              { keyword: 'one', body: [pound(), text(' file')] },
              { keyword: 'other', body: [pound(), text(' files')] },
            ],
          }),
        ]),
        body('ru', [
          plural('count', {
            branches: [
              { keyword: 'one', body: [pound(), text(' файл')] },
              { keyword: 'few', body: [pound(), text(' файла')] },
              { keyword: 'many', body: [pound(), text(' файлов')] },
              { keyword: 'other', body: [pound(), text(' файла')] },
            ],
          }),
        ]),
      ],
      origins: [translated('en'), translated('ru')],
    })
    const emitted = contentsOf(tree([files], config({ locales: ['en', 'ru'] })), 'messages/_root.js')
    expect(emitted).toContain(" файл`")
    expect(emitted).toContain(" файлов`")
    expect(emitted).toContain("switch ($plural1('ru', n0, false)) {")
  })

  test('an exact branch matching other stays while its keyword siblings differ', () => {
    // French selects `one` for 0, so dropping `=0` would print the singular.
    const files = message({
      key: 'files',
      source: '{count, plural, one {# file} other {# files}}',
      args: [{ name: 'count', type: { kind: 'number' } }],
      bodies: [
        body('en', [
          plural('count', {
            branches: [
              { keyword: 'one', body: [pound(), text(' file')] },
              { keyword: 'other', body: [pound(), text(' files')] },
            ],
          }),
        ]),
        body('fr', [
          plural('count', {
            exact: [{ value: 0, body: [pound(), text(' fichiers')] }],
            branches: [
              { keyword: 'one', body: [pound(), text(' fichier')] },
              { keyword: 'other', body: [pound(), text(' fichiers')] },
            ],
          }),
        ]),
      ],
      origins: [translated('en'), translated('fr')],
    })
    const emitted = contentsOf(tree([files], config({ locales: ['en', 'fr'] })), 'messages/_root.js')
    expect(emitted).toContain('if (n0 === 0) return')
  })

  test('a select keeps its options when only some of them match other', () => {
    const pronoun = message({
      key: 'pronoun',
      source: '{gender, select, female {she} male {he} other {he}}',
      args: [{ name: 'gender', type: { kind: 'select', options: ['female', 'male', 'other'] } }],
      bodies: [
        body('en', [
          choice('gender', [
            { option: 'female', body: [text('she')] },
            { option: 'male', body: [text('he')] },
            { option: 'other', body: [text('he')] },
          ]),
        ]),
      ],
      origins: [translated('en')],
    })
    const emitted = contentsOf(tree([pronoun]), 'messages/_root.js')
    expect(emitted).toContain("case 'female':")
    expect(emitted).toContain('return `she`')
  })
})

describe('plural branch order, whatever order the catalog wrote', () => {
  const ranked = message({
    key: 'ranked',
    source: '{count, plural, =2 {a pair} =0 {none} other {# rest} many {# many} few {# few} one {# one}}',
    args: [{ name: 'count', type: { kind: 'number' } }],
    bodies: [
      body('en', [
        plural('count', {
          exact: [
            { value: 2, body: [text('a pair')] },
            { value: 0, body: [text('none')] },
          ],
          branches: [
            { keyword: 'other', body: [pound(), text(' rest')] },
            { keyword: 'many', body: [pound(), text(' many')] },
            { keyword: 'few', body: [pound(), text(' few')] },
            { keyword: 'one', body: [pound(), text(' one')] },
          ],
        }),
      ]),
    ],
    origins: [translated('en')],
  })
  const emitted = contentsOf(tree([ranked]), 'messages/_root.js')

  test('exact branches ascend by value', () => {
    expect(positionOf(emitted, 'n0 === 0')).toBeLessThan(positionOf(emitted, 'n0 === 2'))
  })

  test('keyword branches follow CLDR order', () => {
    const one = positionOf(emitted, "case 'one':")
    const few = positionOf(emitted, "case 'few':")
    const many = positionOf(emitted, "case 'many':")
    expect(one).toBeLessThan(few)
    expect(few).toBeLessThan(many)
  })
})
