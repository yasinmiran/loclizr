import { describe, expect, it } from 'vitest'
import type { Arg, Diagnostic, Node } from '../types'
import {
  argNode,
  at,
  body,
  branch,
  config,
  dateArg,
  dateTimeNode,
  markupArg,
  markupNode,
  message,
  numberArg,
  plural,
  pound,
  program,
  stringishArg,
  text,
  translated,
} from './__fixtures__/program'
import { runChecks } from './index'

function withCode(diagnostics: readonly Diagnostic[], code: string): readonly Diagnostic[] {
  return diagnostics.filter((entry) => entry.code === code)
}

function only(diagnostics: readonly Diagnostic[], code: string): Diagnostic {
  const found = withCode(diagnostics, code)
  const [first] = found
  if (first === undefined || found.length !== 1) {
    throw new Error(`expected exactly one ${code}, got ${found.length}`)
  }
  return first
}

function timeNode(name: string): Node {
  return {
    kind: 'dateTime',
    name,
    form: 'time',
    style: 'short',
    format: { kind: 'dateTime', options: { timeStyle: 'short' } },
  }
}

const englishOnly = config({ locales: ['en'], sourceLocale: 'en' })

describe('plural categories a locale can and cannot select', () => {
  it('lists every Arabic category the message omits, in CLDR order', () => {
    const branches = [branch('one', pound()), branch('other', pound())]
    const diagnostics = runChecks(
      program({
        config: config({ locales: ['ar', 'en'], sourceLocale: 'en' }),
        messages: [
          message({
            key: 'cart.items',
            bodies: [
              body('en', { nodes: [plural({ name: 'count', branches })], args: [numberArg('count')] }),
              body('ar', { nodes: [plural({ name: 'count', branches })], args: [numberArg('count')] }),
            ],
            origins: [translated('ar'), translated('en')],
            spans: [at('ar', 3, 5), at('en', 3, 5)],
          }),
        ],
      }),
    )

    const incomplete = only(diagnostics, 'LZ3007')
    expect(incomplete.locale).toBe('ar')
    expect(incomplete.message).toContain('zero, two, few, many')
  })

  it('reports an English two branch, which English cardinal never selects', () => {
    const diagnostics = runChecks(
      program({
        config: englishOnly,
        messages: [
          message({
            key: 'cart.items',
            bodies: [
              body('en', {
                nodes: [
                  plural({
                    name: 'count',
                    branches: [
                      branch('one', pound()),
                      branch('two', pound()),
                      branch('other', pound()),
                    ],
                  }),
                ],
                args: [numberArg('count')],
              }),
            ],
          }),
        ],
      }),
    )

    const unreachable = only(diagnostics, 'LZ3013')
    expect(unreachable.locale).toBe('en')
    expect(unreachable.message).toContain('"two"')
  })

  it('reads ordinal categories when it decides a selectordinal branch is dead', () => {
    const diagnostics = runChecks(
      program({
        config: englishOnly,
        messages: [
          message({
            key: 'race.place',
            bodies: [
              body('en', {
                nodes: [
                  plural({
                    name: 'count',
                    ordinal: true,
                    branches: [
                      branch('one', text('st')),
                      branch('two', text('nd')),
                      branch('few', text('rd')),
                      branch('many', text('th')),
                      branch('other', text('th')),
                    ],
                  }),
                ],
                args: [numberArg('count')],
              }),
            ],
          }),
        ],
      }),
    )

    const unreachable = only(diagnostics, 'LZ3013')
    expect(unreachable.message).toContain('"many"')
  })

  it('reports a German selectordinal one branch, which German ordinal never selects', () => {
    const branches = [branch('one', text('.')), branch('other', text('.'))]
    const diagnostics = runChecks(
      program({
        config: config({ locales: ['de', 'en'], sourceLocale: 'en' }),
        messages: [
          message({
            key: 'race.place',
            bodies: [
              body('en', {
                nodes: [plural({ name: 'count', ordinal: true, branches })],
                args: [numberArg('count')],
              }),
              body('de', {
                nodes: [plural({ name: 'count', ordinal: true, branches })],
                args: [numberArg('count')],
              }),
            ],
            origins: [translated('de'), translated('en')],
            spans: [at('de', 3, 5), at('en', 3, 5)],
          }),
        ],
      }),
    )

    const unreachable = withCode(diagnostics, 'LZ3013')
    expect(unreachable.map((entry) => entry.locale)).toEqual(['de'])
    expect(unreachable[0]?.message ?? '').toContain('"one"')
  })

  it('reaches a plural nested inside markup', () => {
    const diagnostics = runChecks(
      program({
        config: config({ locales: ['en', 'ru'], sourceLocale: 'en' }),
        messages: [
          message({
            key: 'cart.items',
            kind: 'markup',
            bodies: [
              body('ru', {
                nodes: [
                  markupNode(
                    'b',
                    plural({
                      name: 'count',
                      branches: [branch('one', pound()), branch('other', pound())],
                    }),
                  ),
                ],
                args: [markupArg('b'), numberArg('count')],
                markupTags: ['b'],
              }),
              body('en', {
                nodes: [
                  markupNode(
                    'b',
                    plural({
                      name: 'count',
                      branches: [branch('one', pound()), branch('other', pound())],
                    }),
                  ),
                ],
                args: [markupArg('b'), numberArg('count')],
                markupTags: ['b'],
              }),
            ],
            origins: [translated('en'), translated('ru')],
            spans: [at('en', 3, 5), at('ru', 3, 5)],
          }),
        ],
      }),
    )

    expect(only(diagnostics, 'LZ3007').locale).toBe('ru')
  })
})

describe('dates without a zone', () => {
  it('reports a time argument, not only a date argument', () => {
    const diagnostics = runChecks(
      program({
        config: englishOnly,
        messages: [
          message({
            key: 'cart.updated',
            bodies: [body('en', { nodes: [timeNode('at')], args: [dateArg('at')] })],
          }),
        ],
      }),
    )

    expect(only(diagnostics, 'LZ3011').message).toContain('{at}')
  })

  it('finds a date nested inside markup and inside a plural branch', () => {
    const diagnostics = runChecks(
      program({
        config: englishOnly,
        messages: [
          message({
            key: 'cart.updated',
            kind: 'markup',
            bodies: [
              body('en', {
                nodes: [
                  markupNode('b', dateTimeNode('wrapped')),
                  plural({
                    name: 'count',
                    branches: [branch('one', dateTimeNode('counted')), branch('other', pound())],
                  }),
                ],
                args: [markupArg('b'), dateArg('wrapped'), numberArg('count'), dateArg('counted')],
                markupTags: ['b'],
              }),
            ],
          }),
        ],
      }),
    )

    const unzoned = only(diagnostics, 'LZ3011')
    expect(unzoned.message).toContain('{wrapped}')
    expect(unzoned.message).toContain('{counted}')
  })

  it('names only the arguments that carry no zone', () => {
    const diagnostics = runChecks(
      program({
        config: englishOnly,
        messages: [
          message({
            key: 'cart.updated',
            bodies: [
              body('en', {
                nodes: [
                  dateTimeNode('pinned', { dateStyle: 'medium', timeZone: 'UTC' }),
                  dateTimeNode('loose'),
                ],
                args: [dateArg('pinned'), dateArg('loose')],
              }),
            ],
          }),
        ],
      }),
    )

    const unzoned = only(diagnostics, 'LZ3011')
    expect(unzoned.message).toContain('{loose}')
    expect(unzoned.message).not.toContain('{pinned}')
  })

  it('stays silent when only a translation formats a date', () => {
    const diagnostics = runChecks(
      program({
        config: config({ locales: ['de', 'en'], sourceLocale: 'en' }),
        messages: [
          message({
            key: 'cart.updated',
            bodies: [
              body('en', { nodes: [argNode('at')], args: [stringishArg('at')] }),
              body('de', { nodes: [dateTimeNode('at')], args: [dateArg('at')] }),
            ],
            origins: [translated('de'), translated('en')],
            spans: [at('de', 3, 5), at('en', 3, 5)],
          }),
        ],
      }),
    )

    expect(withCode(diagnostics, 'LZ3011')).toEqual([])
  })
})

describe('one argument name at several types', () => {
  function tipMessage(types: Readonly<Record<string, Node>>, args: Readonly<Record<string, Arg>>) {
    const locales = Object.keys(types).sort()
    return message({
      key: 'nav.tip',
      bodies: locales.map((locale) =>
        body(locale, { nodes: [types[locale] ?? text('')], args: [args[locale] ?? stringishArg('x')] }),
      ),
      origins: locales.map((locale) => translated(locale)),
      spans: locales.map((locale) => at(locale, 3, 5)),
    })
  }

  it('reports every locale whose type cannot be reconciled, not only the first', () => {
    const diagnostics = runChecks(
      program({
        config: config({ locales: ['de', 'en', 'fr', 'ja'], sourceLocale: 'en' }),
        messages: [
          tipMessage(
            {
              en: argNode('x'),
              de: dateTimeNode('x'),
              fr: argNode('x'),
              ja: argNode('x'),
            },
            {
              en: stringishArg('x'),
              de: dateArg('x'),
              fr: numberArg('x'),
              ja: numberArg('x'),
            },
          ),
        ],
      }),
    )

    const conflicts = withCode(diagnostics, 'LZ3006')
    expect(conflicts.map((entry) => entry.locale)).toEqual(['fr', 'ja'])
    for (const conflict of conflicts) {
      expect(conflict.related.map((entry) => entry.locale)).toEqual(['de'])
    }
  })

  it('stays quiet while a plain text source narrows through one locale and back', () => {
    const diagnostics = runChecks(
      program({
        config: config({ locales: ['de', 'en', 'fr'], sourceLocale: 'en' }),
        messages: [
          tipMessage(
            { en: argNode('x'), de: argNode('x'), fr: argNode('x') },
            { en: stringishArg('x'), de: numberArg('x'), fr: stringishArg('x') },
          ),
        ],
      }),
    )

    expect(diagnostics).toEqual([])
  })

  // Pinned, not endorsed: stringish narrows to markup, the name is in both
  // argument sets, and the source has no tag to miss, so no rule in the catalog
  // reaches a translation that turns a plain argument into a tag of that name.
  it('says nothing when a translation turns a plain source argument into a tag', () => {
    const diagnostics = runChecks(
      program({
        config: config({ locales: ['de', 'en'], sourceLocale: 'en' }),
        messages: [
          message({
            key: 'terms.accept',
            source: '{link}',
            bodies: [
              body('en', { nodes: [argNode('link')], args: [stringishArg('link')] }),
              body('de', {
                nodes: [markupNode('link', text('AGB'))],
                args: [markupArg('link')],
                markupTags: ['link'],
              }),
            ],
            origins: [translated('de'), translated('en')],
            spans: [at('de', 3, 5), at('en', 3, 5)],
          }),
        ],
      }),
    )

    expect(diagnostics).toEqual([])
  })
})

describe('argument names that are also object members', () => {
  it('compares them by name without reading anything off Object.prototype', () => {
    const diagnostics = runChecks(
      program({
        config: config({ locales: ['de', 'en'], sourceLocale: 'en' }),
        messages: [
          message({
            key: 'nav.tip',
            bodies: [
              body('en', {
                nodes: [argNode('constructor'), argNode('toString'), argNode('hasOwnProperty')],
                args: [
                  stringishArg('constructor'),
                  stringishArg('toString'),
                  stringishArg('hasOwnProperty'),
                ],
              }),
              body('de', {
                nodes: [argNode('prototype')],
                args: [stringishArg('prototype')],
              }),
            ],
            origins: [translated('de'), translated('en')],
            spans: [at('de', 3, 5), at('en', 3, 5)],
          }),
        ],
      }),
    )

    const missing = withCode(diagnostics, 'LZ3004').map((entry) => entry.message).join('\n')
    expect(withCode(diagnostics, 'LZ3004')).toHaveLength(3)
    expect(missing).toContain('{constructor}')
    expect(missing).toContain('{toString}')
    expect(missing).toContain('{hasOwnProperty}')
    expect(only(diagnostics, 'LZ3005').message).toContain('{prototype}')
  })

  it('compares a markup tag named after an object member the same way', () => {
    const diagnostics = runChecks(
      program({
        config: config({ locales: ['de', 'en'], sourceLocale: 'en' }),
        messages: [
          message({
            key: 'terms.accept',
            kind: 'markup',
            bodies: [
              body('en', {
                nodes: [markupNode('constructor', text('terms'))],
                args: [markupArg('constructor')],
                markupTags: ['constructor'],
              }),
              body('de', { nodes: [text('AGB')] }),
            ],
            origins: [translated('de'), translated('en')],
            spans: [at('de', 3, 5), at('en', 3, 5)],
          }),
        ],
      }),
    )

    expect(only(diagnostics, 'LZ3010').message).toContain('<constructor>')
    expect(withCode(diagnostics, 'LZ3004')).toEqual([])
  })
})
