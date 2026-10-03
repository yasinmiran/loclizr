import { describe, expect, it } from 'vitest'
import type { Body, Diagnostic, Node } from '../types'
import {
  argNode,
  at,
  body,
  type BodyInput,
  branch,
  config,
  dateArg,
  extra,
  message,
  numberArg,
  option,
  plural,
  pound,
  program,
  selectArg,
  selectNode,
  span,
  stringishArg,
  text,
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

function countPlural(keywords: readonly string[], ordinal = false): Node {
  return plural({
    name: 'count',
    ordinal,
    branches: keywords.map((keyword) => branch(keyword, pound(), text(' x'))),
  })
}

function i18nextBody(locale: string, input: BodyInput): Body {
  return body(locale, { ...input, format: 'i18next' })
}

describe('arg-type-conflict points at the locale that carries the other type', () => {
  it('keeps the source as the related location when a locale between agrees by leaving the argument bare', () => {
    const diagnostics = runChecks(
      program({
        config: config({ locales: ['de', 'en', 'fr'] }),
        messages: [
          message({
            key: 'cart.total',
            bodies: [
              body('en', { args: [numberArg('n')] }),
              body('de', { args: [stringishArg('n')] }),
              body('fr', { args: [dateArg('n')] }),
            ],
          }),
        ],
      }),
    )

    // de writes a bare {n}, so pointing there as "a number here" would send
    // the reader to a locale that is not a number at all.
    const conflict = only(diagnostics, 'LZ3006')
    expect(conflict.locale).toBe('fr')
    expect(conflict.related[0]).toMatchObject({ locale: 'en', file: 'locales/en.json' })
  })

  it('gives the related location the position of the other type in its catalog', () => {
    const diagnostics = runChecks(
      program({
        messages: [
          message({
            key: 'cart.updated',
            bodies: [body('en', { args: [numberArg('at')] }), body('de', { args: [dateArg('at')] })],
            spans: [at('en', 12, 5), at('de', 30, 7)],
          }),
        ],
      }),
    )

    const conflict = only(diagnostics, 'LZ3006')
    expect(conflict.span).toEqual(span(30, 7))
    expect(conflict.related[0]).toMatchObject({
      locale: 'en',
      file: 'locales/en.json',
      span: span(12, 5),
    })
  })
})

describe('select options on every select argument', () => {
  it('compares a later select even when an earlier one stays bare in the translation', () => {
    const diagnostics = runChecks(
      program({
        messages: [
          message({
            key: 'feed.item',
            bodies: [
              body('en', {
                nodes: [
                  selectNode('kind', [option('x', text('X')), option('other', text('Y'))]),
                  selectNode('mode', [
                    option('p', text('P')),
                    option('q', text('Q')),
                    option('other', text('R')),
                  ]),
                ],
                args: [selectArg('kind', ['x']), selectArg('mode', ['p', 'q'])],
              }),
              body('de', {
                nodes: [
                  argNode('kind'),
                  selectNode('mode', [option('p', text('P')), option('other', text('R'))]),
                ],
                args: [stringishArg('kind'), selectArg('mode', ['p'])],
              }),
            ],
          }),
        ],
      }),
    )

    expect(only(diagnostics, 'LZ3008').message).toContain('"q" branch for {mode}')
    expect(withCode(diagnostics, 'LZ3009')).toHaveLength(0)
    expect(withCode(diagnostics, 'LZ3005')).toHaveLength(0)
  })
})

describe('markup-mismatch compares tag sets', () => {
  it('names a tag the source writes twice only once', () => {
    const diagnostics = runChecks(
      program({
        messages: [
          message({
            key: 'legal.terms',
            bodies: [body('en', { markupTags: ['b', 'b'] }), body('de', { markupTags: [] })],
          }),
        ],
      }),
    )

    const mismatch = only(diagnostics, 'LZ3010')
    expect(mismatch.message).toBe('The en text uses <b> and the de translation does not.')
  })
})

describe('i18next ordinal keys follow the per-file fold', () => {
  it('does not treat a key eight characters longer than another as its _ordinal sibling', () => {
    // `finishPosition` minus its last eight characters is `finish`, the same
    // length as the `_ordinal` suffix, so only the suffix itself may decide.
    const diagnostics = runChecks(
      program({
        config: config({ catalogFormat: 'i18next', locales: ['en'] }),
        messages: [
          message({ key: 'finish', bodies: [i18nextBody('en', { nodes: [text('Done')] })] }),
          message({
            key: 'finishPosition',
            bodies: [i18nextBody('en', { nodes: [countPlural(['one', 'other'], true)], args: [numberArg('count')] })],
          }),
        ],
      }),
    )

    expect(only(diagnostics, 'LZ3007').hint).toBe(
      'add "finishPosition_ordinal_two", "finishPosition_ordinal_few" to locales/en.json',
    )
  })

  it('reads the cardinal sibling from the same locale, not from the source', () => {
    const diagnostics = runChecks(
      program({
        config: config({ catalogFormat: 'i18next', locales: ['en', 'fr'] }),
        messages: [
          message({
            key: 'place',
            bodies: [i18nextBody('en', { nodes: [countPlural(['one', 'other'])], args: [numberArg('count')] })],
          }),
          message({
            key: 'place_ordinal',
            bodies: [
              i18nextBody('en', {
                nodes: [countPlural(['one', 'two', 'few', 'other'], true)],
                args: [numberArg('count')],
              }),
              i18nextBody('fr', {
                nodes: [countPlural(['one', 'two', 'other'], true)],
                args: [numberArg('count')],
              }),
            ],
          }),
        ],
      }),
    )

    // fr has no cardinal `place`, so its ordinal group kept the `_ordinal`
    // infix on the base `place_ordinal`.
    expect(only(diagnostics, 'LZ3013').hint).toBe(
      'fr never selects two; delete "place_ordinal_ordinal_two" from locales/fr.json',
    )
  })

  it('reads a cardinal sibling extra only from the same locale', () => {
    const run = (extraLocale: string) =>
      runChecks(
        program({
          config: config({ catalogFormat: 'i18next', locales: ['de', 'en', 'fr'] }),
          messages: [
            message({
              key: 'place_ordinal',
              bodies: [
                i18nextBody('en', {
                  nodes: [countPlural(['one', 'two', 'few', 'other'], true)],
                  args: [numberArg('count')],
                }),
                i18nextBody('fr', {
                  nodes: [countPlural(['one', 'two', 'other'], true)],
                  args: [numberArg('count')],
                }),
              ],
            }),
          ],
          extras: [extra(extraLocale, 'place')],
        }),
      )

    expect(only(run('de'), 'LZ3013').hint).toBe(
      'fr never selects two; delete "place_ordinal_ordinal_two" from locales/fr.json',
    )
    expect(only(run('fr'), 'LZ3013').hint).toBe(
      'fr never selects two; delete "place_ordinal_two" from locales/fr.json',
    )
  })
})
