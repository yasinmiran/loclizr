import { describe, expect, it } from 'vitest'
import type { Diagnostic, Node } from '../types'
import {
  argNode,
  at,
  body,
  branch,
  config,
  message,
  numberArg,
  plural,
  pound,
  program,
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

const i18next = config({ catalogFormat: 'i18next' })

describe('hints in a catalog read as i18next', () => {
  it('quotes a missing argument the way the file spells it, so the fix builds', () => {
    const diagnostics = runChecks(
      program({
        config: i18next,
        messages: [
          message({
            key: 'a',
            bodies: [
              body('en', {
                nodes: [text('Hi '), argNode('name'), text(' '), argNode('x')],
                args: [stringishArg('name'), stringishArg('x')],
              }),
              body('de', { nodes: [text('Hallo '), argNode('x')], args: [stringishArg('x')] }),
            ],
          }),
        ],
      }),
    )

    const missing = only(diagnostics, 'LZ3004')
    expect(missing.message).toBe('The en text uses {{name}} and the de translation does not.')
    expect(missing.hint).toBe('add {{name}} to "a" in locales/de.json')
  })

  it('quotes an extra argument the way the file spells it', () => {
    const diagnostics = runChecks(
      program({
        config: i18next,
        messages: [
          message({
            key: 'a',
            bodies: [
              body('en', { nodes: [text('Hi '), argNode('x')], args: [stringishArg('x')] }),
              body('de', {
                nodes: [text('Hallo '), argNode('y'), text(' '), argNode('x')],
                args: [stringishArg('y'), stringishArg('x')],
              }),
            ],
          }),
        ],
      }),
    )

    const extra = only(diagnostics, 'LZ3005')
    expect(extra.message).toContain('uses {{y}}, which')
    expect(extra.hint).toBe('check the spelling of {{y}} in locales/de.json, or add it to the en text')
  })

  it('names the plural keys to add rather than ICU branches the file cannot hold', () => {
    const diagnostics = runChecks(
      program({
        config: config({ catalogFormat: 'i18next', locales: ['en', 'ru'] }),
        messages: [
          message({
            key: 'a',
            bodies: [
              body('en', { nodes: [countPlural(['one', 'other'])], args: [numberArg('count')] }),
              body('ru', { nodes: [countPlural(['one', 'other'])], args: [numberArg('count')] }),
            ],
          }),
        ],
      }),
    )

    const incomplete = only(diagnostics, 'LZ3007')
    expect(incomplete.message).toContain('values of {{count}}')
    expect(incomplete.hint).toBe('add "a_few", "a_many" to locales/ru.json')
  })

  it('spells an ordinal plural key with the _ordinal infix', () => {
    const ordinalOnly = runChecks(
      program({
        config: config({ catalogFormat: 'i18next', locales: ['en'] }),
        messages: [
          message({
            key: 'place',
            bodies: [body('en', { nodes: [countPlural(['one', 'other'], true)], args: [numberArg('count')] })],
          }),
        ],
      }),
    )
    expect(only(ordinalOnly, 'LZ3007').hint).toBe(
      'add "place_ordinal_two", "place_ordinal_few" to locales/en.json',
    )

    const besideCardinal = runChecks(
      program({
        config: config({ catalogFormat: 'i18next', locales: ['en'] }),
        messages: [
          message({
            key: 'place',
            bodies: [body('en', { nodes: [countPlural(['one', 'other'])], args: [numberArg('count')] })],
          }),
          message({
            key: 'place_ordinal',
            bodies: [body('en', { nodes: [countPlural(['one', 'other'], true)], args: [numberArg('count')] })],
          }),
        ],
      }),
    )
    expect(only(besideCardinal, 'LZ3007').hint).toBe(
      'add "place_ordinal_two", "place_ordinal_few" to locales/en.json',
    )
  })

  it('keeps the _ordinal infix on an ordinal-only group whose base ends in _ordinal', () => {
    const diagnostics = runChecks(
      program({
        config: config({ catalogFormat: 'i18next', locales: ['en'] }),
        messages: [
          message({
            key: 'rank_ordinal',
            bodies: [body('en', { nodes: [countPlural(['one', 'other'], true)], args: [numberArg('count')] })],
          }),
        ],
      }),
    )
    expect(only(diagnostics, 'LZ3007').hint).toBe(
      'add "rank_ordinal_ordinal_two", "rank_ordinal_ordinal_few" to locales/en.json',
    )
  })

  it('names the key as the namespace file spells it, without the namespace', () => {
    const nsSpans = ['en', 'ru', 'de'].map((locale) => at(locale, 1, 1, `locales/${locale}/common.json`))
    const diagnostics = runChecks(
      program({
        config: config({
          catalogFormat: 'i18next',
          locales: ['en', 'ru', 'de'],
          catalogs: 'locales/{locale}/{ns}.json',
        }),
        messages: [
          message({
            key: 'common.cart.items',
            spans: nsSpans,
            bodies: [
              body('en', { nodes: [countPlural(['one', 'other'])], args: [numberArg('count')] }),
              body('ru', { nodes: [countPlural(['one', 'few', 'many', 'other'])], args: [numberArg('count')] }),
              body('de', { nodes: [countPlural(['one', 'two', 'other'])], args: [numberArg('count')] }),
            ],
          }),
        ],
      }),
    )
    expect(withCode(diagnostics, 'LZ3007')).toHaveLength(0)
    expect(only(diagnostics, 'LZ3013').hint).toBe(
      'de never selects two; delete "cart.items_two" from locales/de/common.json',
    )

    const incomplete = runChecks(
      program({
        config: config({ catalogFormat: 'i18next', locales: ['en', 'ru'], catalogs: 'locales/{locale}/{ns}.json' }),
        messages: [
          message({
            key: 'common.cart.items',
            spans: nsSpans,
            bodies: [
              body('en', { nodes: [countPlural(['one', 'other'])], args: [numberArg('count')] }),
              body('ru', { nodes: [countPlural(['one', 'other'])], args: [numberArg('count')] }),
            ],
          }),
        ],
      }),
    )
    expect(only(incomplete, 'LZ3007').hint).toBe(
      'add "cart.items_few", "cart.items_many" to locales/ru/common.json',
    )
  })

  it('says to delete an unreachable plural key, since an exact branch has no i18next spelling', () => {
    const diagnostics = runChecks(
      program({
        config: i18next,
        messages: [
          message({
            key: 'a',
            bodies: [
              body('en', { nodes: [countPlural(['one', 'other'])], args: [numberArg('count')] }),
              body('de', { nodes: [countPlural(['one', 'two', 'other'])], args: [numberArg('count')] }),
            ],
          }),
        ],
      }),
    )

    const unreachable = only(diagnostics, 'LZ3013')
    expect(unreachable.message).toBe('de never selects "two", so this branch of {{count}} never renders.')
    expect(unreachable.hint).toBe('de never selects two; delete "a_two" from locales/de.json')
  })
})

describe('two plurals on one argument in one body', () => {
  it('raise one LZ3007, not two identical ones', () => {
    const diagnostics = runChecks(
      program({
        config: config({ locales: ['en', 'ru'] }),
        messages: [
          message({
            key: 'cart.items',
            bodies: [
              body('en', { nodes: [countPlural(['one', 'other'])], args: [numberArg('count')] }),
              body('ru', {
                nodes: [countPlural(['one', 'other']), text(' / '), countPlural(['one', 'other'])],
                args: [numberArg('count')],
              }),
            ],
          }),
        ],
      }),
    )

    expect(withCode(diagnostics, 'LZ3007')).toHaveLength(1)
  })

  it('raise one LZ3013, not two identical ones', () => {
    const diagnostics = runChecks(
      program({
        messages: [
          message({
            key: 'cart.items',
            bodies: [
              body('en', { nodes: [countPlural(['one', 'other'])], args: [numberArg('count')] }),
              body('de', {
                nodes: [countPlural(['zero', 'one', 'other']), text(' / '), countPlural(['zero', 'one', 'other'])],
                args: [numberArg('count')],
              }),
            ],
          }),
        ],
      }),
    )

    expect(withCode(diagnostics, 'LZ3013')).toHaveLength(1)
  })
})
