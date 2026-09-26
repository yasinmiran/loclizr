import { describe, expect, it } from 'vitest'
import { sortDiagnostics } from '../diagnostics'
import type { Program } from '../types'
import {
  argNode,
  at,
  body,
  branch,
  config,
  dateArg,
  dateTimeNode,
  extra,
  fellBack,
  markupArg,
  markupNode,
  message,
  numberArg,
  option,
  plural,
  pound,
  program,
  selectArg,
  selectNode,
  text,
  translated,
} from './__fixtures__/program'
import { runChecks } from './index'

// The arrays whose order carries no meaning, so a replay reverses them.
function reversed(source: Program): Program {
  return {
    ...source,
    messages: [...source.messages].reverse().map((each) => ({
      ...each,
      bodies: [...each.bodies].reverse(),
      origins: [...each.origins].reverse(),
      spans: [...each.spans].reverse(),
    })),
    extras: [...source.extras].reverse(),
  }
}

function everyRule(): Program {
  return program({
    config: config({ locales: ['de', 'en', 'fr'], sourceLocale: 'en' }),
    extras: [extra('de', 'nav.legacy'), extra('fr', 'nav.ancien')],
    messages: [
      message({
        key: 'cart.items',
        source: '{count, plural, one {# item} other {# items}}',
        bodies: [
          body('en', {
            nodes: [
              plural({ name: 'count', branches: [branch('one', pound()), branch('other', pound())] }),
            ],
            args: [numberArg('count')],
          }),
          body('de', {
            nodes: [
              plural({
                name: 'count',
                branches: [branch('zero', text('leer')), branch('other', pound())],
              }),
            ],
            args: [numberArg('count')],
          }),
          body('fr', { nodes: [dateTimeNode('count')], args: [dateArg('count')] }),
        ],
        origins: [translated('en'), translated('de'), translated('fr')],
        spans: [at('en', 3, 5), at('de', 3, 5), at('fr', 3, 5)],
      }),
      message({
        key: 'order.status',
        source: '{state, select, shipped {On its way} other {Processing}}',
        bodies: [
          body('en', {
            nodes: [
              selectNode('state', [
                option('shipped', text('On its way')),
                option('other', text('Processing')),
              ]),
            ],
            args: [selectArg('state', ['shipped'])],
          }),
          body('de', {
            nodes: [
              selectNode('state', [
                option('storniert', text('Storniert')),
                option('other', text('In Bearbeitung')),
              ]),
            ],
            args: [selectArg('state', ['storniert'])],
          }),
        ],
        origins: [translated('en'), translated('de'), fellBack('fr', 'en', 'missing')],
        spans: [at('en', 8, 5), at('de', 8, 5)],
      }),
      message({
        key: 'terms.accept',
        source: 'Read our <link>terms</link>',
        kind: 'markup',
        bodies: [
          body('en', {
            nodes: [text('Read our '), markupNode('link', text('terms'))],
            args: [markupArg('link')],
            markupTags: ['link'],
          }),
          body('de', { nodes: [text('Lies die AGB')] }),
          body('fr', {
            nodes: [markupNode('lien', text('CGU'))],
            args: [markupArg('lien')],
            markupTags: ['lien'],
          }),
        ],
        origins: [translated('en'), translated('de'), fellBack('fr', 'en', 'invalid')],
        spans: [at('en', 20, 5), at('de', 20, 5), at('fr', 20, 5)],
      }),
      message({
        key: 'cart.updated',
        source: 'Updated {at, date, medium}',
        bodies: [
          body('en', { nodes: [text('Updated '), dateTimeNode('at')], args: [dateArg('at')] }),
          body('de', { nodes: [text('Aktualisiert')] }),
        ],
        origins: [translated('en'), translated('de'), fellBack('fr', 'en', 'missing')],
        spans: [at('en', 25, 5), at('de', 25, 5)],
      }),
      message({
        key: 'nav.open',
        source: 'Open',
        bodies: [body('en', { nodes: [text('Open')] })],
        origins: [translated('en'), fellBack('de', 'en', 'missing'), fellBack('fr', 'en', 'blank')],
        spans: [at('en', 12, 5), at('fr', 12, 5)],
      }),
      message({
        key: 'file.open',
        source: 'Open',
        bodies: [body('en', { nodes: [text('Open')] })],
        origins: [translated('en'), fellBack('de', 'en', 'missing'), fellBack('fr', 'en', 'missing')],
        spans: [at('en', 31, 7)],
      }),
      message({
        key: 'status.open',
        source: 'Open',
        description: 'Badge on a ticket that is not closed',
        bodies: [body('en', { nodes: [text('Open')] })],
        origins: [translated('en'), translated('de'), translated('fr')],
        spans: [at('en', 58, 3)],
      }),
      message({
        key: 'nav.tip',
        source: '{hint}',
        bodies: [
          body('en', { nodes: [argNode('hint')], args: [numberArg('hint')] }),
          body('de', { nodes: [dateTimeNode('hint')], args: [dateArg('hint')] }),
          body('fr', { nodes: [argNode('hint')], args: [numberArg('hint')] }),
        ],
        origins: [translated('en'), translated('de'), translated('fr')],
        spans: [at('en', 40, 5), at('de', 40, 5), at('fr', 40, 5)],
      }),
    ],
  })
}

function reversedExtrasAndOrigins(source: Program): Program {
  return {
    ...source,
    messages: source.messages.map((each) => ({ ...each, origins: [...each.origins].reverse() })),
    extras: [...source.extras].reverse(),
  }
}

describe('the same inputs in a different order', () => {
  it('produces one diagnostic set whichever way the unordered arrays are stored', () => {
    const forward = everyRule()

    expect(sortDiagnostics(runChecks(reversed(forward)))).toStrictEqual(
      sortDiagnostics(runChecks(forward)),
    )
  })

  it('returns the two arrays it prints in its own order, not the order they arrived in', () => {
    const forward = everyRule()

    expect(runChecks(reversedExtrasAndOrigins(forward))).toStrictEqual(runChecks(forward))
  })

  it('exercises more than a handful of rules, so the comparison above is worth something', () => {
    const found = new Set(runChecks(everyRule()).map((entry) => entry.code))

    expect([...found].sort()).toEqual([
      'LZ3001',
      'LZ3002',
      'LZ3003',
      'LZ3004',
      'LZ3005',
      'LZ3006',
      'LZ3007',
      'LZ3008',
      'LZ3009',
      'LZ3010',
      'LZ3011',
      'LZ3012',
      'LZ3013',
    ])
  })

  it('leaves the program it was handed exactly as it found it', () => {
    const subject = everyRule()
    const before = structuredClone(subject)

    runChecks(subject)

    expect(subject).toStrictEqual(before)
  })

  it('answers twice with the same diagnostics', () => {
    const subject = everyRule()

    expect(runChecks(subject)).toStrictEqual(runChecks(subject))
  })

  it('says nothing about a program with no messages and no extras', () => {
    expect(runChecks(program())).toEqual([])
  })
})
