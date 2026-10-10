import { describe, expect, it } from 'vitest'
import { RULES } from '../diagnostics'
import type { Diagnostic, IntlOptions, Node } from '../types'
import {
  argNode,
  at,
  body,
  branch,
  config,
  dateArg,
  dateTimeNode,
  exactBranch,
  extra,
  fellBack,
  inherited,
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
  span,
  stringishArg,
  text,
  translated,
} from './__fixtures__/program'
import { runChecks } from './index'

function codes(diagnostics: readonly Diagnostic[]): readonly string[] {
  return diagnostics.map((entry) => entry.code)
}

function withCode(diagnostics: readonly Diagnostic[], code: string): readonly Diagnostic[] {
  return diagnostics.filter((entry) => entry.code === code)
}

function only(diagnostics: readonly Diagnostic[], code: string): Diagnostic {
  const found = withCode(diagnostics, code)
  const [first] = found
  if (first === undefined || found.length !== 1) {
    throw new Error(`expected exactly one ${code}, got ${found.length} of ${codes(diagnostics)}`)
  }
  return first
}

describe('missing and blank translations', () => {
  it('names the catalog pattern for a locale with no entry to point at', () => {
    const diagnostics = runChecks(
      program({
        config: config({ locales: ['de', 'de-AT', 'en'] }),
        messages: [
          message({
            key: 'nav.home',
            bodies: [body('en')],
            origins: [
              translated('en'),
              fellBack('de', 'en', 'missing'),
              fellBack('de-AT', 'en', 'missing'),
            ],
            spans: [at('en', 2, 3)],
          }),
        ],
      }),
    )

    expect(codes(diagnostics)).toEqual(['LZ3001', 'LZ3001'])
    const [first] = withCode(diagnostics, 'LZ3001')
    expect(first).toMatchObject({
      rule: 'missing-translation',
      severity: 'error',
      fatal: false,
      file: 'locales/de.json',
      locale: 'de',
      key: 'nav.home',
      span: null,
    })
  })

  it('fills both tokens of a split-catalog pattern from the key namespace', () => {
    const diagnostics = runChecks(
      program({
        config: config({ catalogs: 'public/locales/{locale}/{ns}.json' }),
        messages: [
          message({
            key: 'common.nav.home',
            bodies: [body('en')],
            origins: [translated('en'), fellBack('de', 'en', 'missing')],
            spans: [at('en', 1, 1, 'public/locales/en/common.json')],
          }),
        ],
      }),
    )

    expect(only(diagnostics, 'LZ3001').file).toBe('public/locales/de/common.json')
  })

  it('reports a blank value at the span the catalog gave it', () => {
    const diagnostics = runChecks(
      program({
        messages: [
          message({
            key: 'nav.home',
            bodies: [body('en')],
            origins: [translated('en'), fellBack('de', 'en', 'blank')],
            spans: [at('en', 2, 3), at('de', 7, 5)],
          }),
        ],
      }),
    )

    const blank = only(diagnostics, 'LZ3002')
    expect(blank).toMatchObject({
      rule: 'blank-translation',
      severity: 'error',
      locale: 'de',
      file: 'locales/de.json',
    })
    expect(blank.span?.line).toBe(7)
  })

  it('stays quiet on a blank value under a blank source value', () => {
    const blankUnder = (source: string): readonly Diagnostic[] =>
      runChecks(
        program({
          messages: [
            message({
              key: 'spacer',
              source,
              bodies: [body('en', { nodes: source === '' ? [] : [text(source)] })],
              origins: [translated('en'), fellBack('de', 'en', 'blank')],
            }),
          ],
        }),
      )

    expect(withCode(blankUnder(''), 'LZ3002')).toEqual([])
    expect(withCode(blankUnder(' \n\t'), 'LZ3002')).toEqual([])
    expect(only(blankUnder('Spacer'), 'LZ3002').locale).toBe('de')
  })

  it('stays quiet for translated and inherited locales', () => {
    const diagnostics = runChecks(
      program({
        config: config({ locales: ['de', 'de-AT', 'en'] }),
        messages: [
          message({
            key: 'nav.home',
            bodies: [body('en'), body('de')],
            origins: [translated('en'), translated('de'), inherited('de-AT', 'de')],
            spans: [at('en', 1, 1), at('de', 1, 1)],
          }),
        ],
      }),
    )

    expect(diagnostics).toEqual([])
  })

  it('leaves a fallback for reason invalid to the rule that already reported it', () => {
    const diagnostics = runChecks(
      program({
        messages: [
          message({
            key: 'nav.home',
            bodies: [body('en')],
            origins: [translated('en'), fellBack('de', 'en', 'invalid')],
            spans: [at('en', 1, 1), at('de', 1, 1)],
          }),
        ],
      }),
    )

    expect(diagnostics).toEqual([])
  })
})

describe('the fallback seam', () => {
  const threeLocales = config({ locales: ['de', 'de-AT', 'en'] })

  const inheritedKey = message({
    key: 'nav.home',
    bodies: [body('en'), body('de')],
    origins: [translated('en'), translated('de'), inherited('de-AT', 'de')],
    spans: [at('en', 1, 1), at('de', 1, 1)],
  })

  const blankKey = message({
    key: 'nav.cart',
    bodies: [body('en')],
    origins: [
      translated('en'),
      fellBack('de', 'en', 'blank'),
      fellBack('de-AT', 'en', 'missing'),
    ],
    spans: [at('en', 2, 1), at('de', 2, 1)],
  })

  const unknownArgumentKey = message({
    key: 'cart.greeting',
    source: 'Hi {name}',
    args: [stringishArg('name')],
    bodies: [
      body('en', { nodes: [text('Hi '), argNode('name')], args: [stringishArg('name')] }),
      body('de', {
        nodes: [text('Hallo '), argNode('name'), text(' '), argNode('nmae')],
        args: [stringishArg('name'), stringishArg('nmae')],
      }),
    ],
    origins: [
      translated('en'),
      fellBack('de', 'en', 'invalid'),
      fellBack('de-AT', 'en', 'missing'),
    ],
    spans: [at('en', 3, 1), at('de', 3, 1)],
  })

  const diagnostics = runChecks(
    program({
      config: threeLocales,
      messages: [inheritedKey, blankKey, unknownArgumentKey],
    }),
  )

  it('raises nothing for the locale that inherits a sibling body', () => {
    expect(diagnostics.filter((entry) => entry.key === 'nav.home')).toEqual([])
  })

  it('reports each locale its own reason, never its ancestor reason', () => {
    expect(codes(diagnostics).toSorted()).toEqual(['LZ3001', 'LZ3001', 'LZ3002', 'LZ3005'])
    expect(only(diagnostics, 'LZ3002')).toMatchObject({ locale: 'de', key: 'nav.cart' })
    expect(
      withCode(diagnostics, 'LZ3001').map((entry) => [entry.locale, entry.key]),
    ).toEqual([
      ['de-AT', 'nav.cart'],
      ['de-AT', 'cart.greeting'],
    ])
  })

  it('still reads arg-extra off a body a fallback origin stops from rendering', () => {
    expect(only(diagnostics, 'LZ3005')).toMatchObject({
      rule: 'arg-extra',
      locale: 'de',
      key: 'cart.greeting',
      file: 'locales/de.json',
    })
  })
})

describe('argument presence', () => {
  it('reports a source argument the translation dropped', () => {
    const diagnostics = runChecks(
      program({
        messages: [
          message({
            key: 'cart.greeting',
            bodies: [
              body('en', { nodes: [argNode('name')], args: [stringishArg('name')] }),
              body('de', { nodes: [text('Hallo')] }),
            ],
            spans: [at('en', 1, 1), at('de', 4, 2)],
          }),
        ],
      }),
    )

    expect(only(diagnostics, 'LZ3004')).toMatchObject({
      rule: 'arg-missing',
      severity: 'error',
      fatal: false,
      locale: 'de',
      key: 'cart.greeting',
      file: 'locales/de.json',
    })
  })

  it('reports both directions when a translator mistypes a name', () => {
    const diagnostics = runChecks(
      program({
        messages: [
          message({
            key: 'cart.greeting',
            bodies: [
              body('en', { nodes: [argNode('name')], args: [stringishArg('name')] }),
              body('de', { nodes: [argNode('nmae')], args: [stringishArg('nmae')] }),
            ],
          }),
        ],
      }),
    )

    expect(codes(diagnostics).toSorted()).toEqual(['LZ3004', 'LZ3005'])
  })

  it('never compares the source locale against itself', () => {
    const diagnostics = runChecks(
      program({
        config: config({ locales: ['en'] }),
        messages: [
          message({
            key: 'cart.greeting',
            bodies: [body('en', { nodes: [argNode('name')], args: [stringishArg('name')] })],
          }),
        ],
      }),
    )

    expect(diagnostics).toEqual([])
  })

  it('compares nothing for a declared locale that contributed no body', () => {
    const diagnostics = runChecks(
      program({
        config: config({ locales: ['de', 'de-AT', 'en'] }),
        messages: [
          message({
            key: 'cart.greeting',
            bodies: [body('en', { nodes: [argNode('name')], args: [stringishArg('name')] })],
            origins: [translated('en'), inherited('de', 'en'), inherited('de-AT', 'en')],
            spans: [at('en', 1, 1)],
          }),
        ],
      }),
    )

    expect(diagnostics).toEqual([])
  })
})

describe('markup', () => {
  const sourceBody = body('en', {
    nodes: [text('Read our '), markupNode('link', text('terms'))],
    args: [markupArg('link')],
    markupTags: ['link'],
  })

  it('reports a dropped tag once, as markup-mismatch and not as a missing argument', () => {
    const diagnostics = runChecks(
      program({
        messages: [
          message({
            key: 'terms.accept',
            kind: 'markup',
            bodies: [sourceBody, body('de', { nodes: [text('Lies unsere AGB')] })],
          }),
        ],
      }),
    )

    expect(codes(diagnostics)).toEqual(['LZ3010'])
    expect(only(diagnostics, 'LZ3010')).toMatchObject({
      rule: 'markup-mismatch',
      severity: 'error',
      locale: 'de',
      key: 'terms.accept',
    })
    expect(only(diagnostics, 'LZ3010').message).toContain('<link>')
  })

  it('reports a tag the translation invented once, as arg-extra and not as a mismatch', () => {
    const diagnostics = runChecks(
      program({
        messages: [
          message({
            key: 'terms.accept',
            kind: 'markup',
            bodies: [
              sourceBody,
              body('de', {
                nodes: [markupNode('link', text('AGB')), markupNode('em', text('jetzt'))],
                args: [markupArg('link'), markupArg('em')],
                markupTags: ['em', 'link'],
              }),
            ],
          }),
        ],
      }),
    )

    expect(codes(diagnostics)).toEqual(['LZ3005'])
    expect(only(diagnostics, 'LZ3005').message).toContain('<em>')
  })

  it('compares tag sets, so renesting and repetition are both fine', () => {
    const diagnostics = runChecks(
      program({
        messages: [
          message({
            key: 'terms.accept',
            kind: 'markup',
            bodies: [
              body('en', {
                nodes: [markupNode('b', markupNode('i', text('x'))), markupNode('b', text('y'))],
                args: [markupArg('b'), markupArg('i')],
                markupTags: ['b', 'b', 'i'],
              }),
              body('de', {
                nodes: [markupNode('i', markupNode('b', text('x')))],
                args: [markupArg('b'), markupArg('i')],
                markupTags: ['i', 'b'],
              }),
            ],
          }),
        ],
      }),
    )

    expect(diagnostics).toEqual([])
  })
})

describe('argument types across locales', () => {
  it('narrows a stringish source against a typed translation', () => {
    const diagnostics = runChecks(
      program({
        messages: [
          message({
            key: 'cart.total',
            bodies: [
              body('en', { nodes: [argNode('amount')], args: [stringishArg('amount')] }),
              body('de', { args: [numberArg('amount')] }),
            ],
          }),
        ],
      }),
    )

    expect(diagnostics).toEqual([])
  })

  it('reports the pair that cannot unify and names the locale that set the type', () => {
    const diagnostics = runChecks(
      program({
        config: config({ locales: ['de', 'en', 'fr'] }),
        messages: [
          message({
            key: 'cart.total',
            bodies: [
              body('en', { nodes: [argNode('amount')], args: [stringishArg('amount')] }),
              body('de', { args: [numberArg('amount')] }),
              body('fr', { args: [dateArg('amount')] }),
            ],
          }),
        ],
      }),
    )

    const conflict = only(diagnostics, 'LZ3006')
    expect(conflict).toMatchObject({ rule: 'arg-type-conflict', severity: 'error', locale: 'fr' })
    expect(conflict.related).toHaveLength(1)
    expect(conflict.related[0]).toMatchObject({ locale: 'de', key: 'cart.total' })
  })

  it('points at the source locale when the source itself carries the other type', () => {
    const diagnostics = runChecks(
      program({
        messages: [
          message({
            key: 'cart.updated',
            bodies: [
              body('en', { args: [numberArg('at')] }),
              body('de', { args: [dateArg('at')] }),
            ],
          }),
        ],
      }),
    )

    expect(only(diagnostics, 'LZ3006').related[0]).toMatchObject({ locale: 'en' })
  })
})

describe('plural categories', () => {
  function pluralMessage(locale: string, ...keywords: readonly string[]) {
    return message({
      key: 'cart.items',
      bodies: [
        body('en', {
          nodes: [
            plural({
              name: 'count',
              branches: [branch('one', pound()), branch('other', pound())],
            }),
          ],
          args: [numberArg('count')],
        }),
        body(locale, {
          nodes: [
            plural({
              name: 'count',
              branches: keywords.map((keyword) => branch(keyword, pound())),
            }),
          ],
          args: [numberArg('count')],
        }),
      ],
      spans: [at('en', 1, 1), at(locale, 2, 1)],
    })
  }

  it('says nothing when every required category is present', () => {
    const diagnostics = runChecks(
      program({ messages: [pluralMessage('de', 'one', 'other')] }),
    )

    expect(diagnostics).toEqual([])
  })

  it('lists the categories the locale selects and the message does not provide', () => {
    const diagnostics = runChecks(
      program({
        config: config({ locales: ['en', 'ru'] }),
        messages: [pluralMessage('ru', 'one', 'other')],
      }),
    )

    const incomplete = only(diagnostics, 'LZ3007')
    expect(incomplete).toMatchObject({
      rule: 'plural-category-incomplete',
      severity: 'warn',
      fatal: false,
      locale: 'ru',
    })
    expect(incomplete.message).toContain('few, many')
  })

  it('counts keyword branches only, so an exact branch does not stand in for one', () => {
    const diagnostics = runChecks(
      program({
        config: config({ locales: ['en'] }),
        messages: [
          message({
            key: 'cart.items',
            bodies: [
              body('en', {
                nodes: [
                  plural({
                    name: 'count',
                    exact: [exactBranch(0, text('empty')), exactBranch(1, text('one thing'))],
                    branches: [branch('other', pound())],
                  }),
                ],
                args: [numberArg('count')],
              }),
            ],
          }),
        ],
      }),
    )

    expect(only(diagnostics, 'LZ3007').message).toContain('one')
  })

  it('reads ordinal categories for a selectordinal', () => {
    const diagnostics = runChecks(
      program({
        config: config({ locales: ['en'] }),
        messages: [
          message({
            key: 'race.place',
            bodies: [
              body('en', {
                nodes: [
                  plural({
                    name: 'place',
                    ordinal: true,
                    branches: [branch('one', text('st')), branch('other', text('th'))],
                  }),
                ],
                args: [numberArg('place')],
              }),
            ],
          }),
        ],
      }),
    )

    const incomplete = only(diagnostics, 'LZ3007')
    expect(incomplete.message).toContain('two, few')
    expect(incomplete.message).toContain('selectordinal')
  })

  it('checks a plural nested inside a select branch', () => {
    const diagnostics = runChecks(
      program({
        config: config({ locales: ['en'] }),
        messages: [
          message({
            key: 'cart.items',
            bodies: [
              body('en', {
                nodes: [
                  selectNode('kind', [
                    option(
                      'book',
                      plural({ name: 'count', branches: [branch('other', pound())] }),
                    ),
                    option('other', text('x')),
                  ]),
                ],
                args: [selectArg('kind', ['book', 'other']), numberArg('count')],
              }),
            ],
          }),
        ],
      }),
    )

    expect(codes(diagnostics)).toEqual(['LZ3007'])
  })
})

describe('unreachable plural branches', () => {
  function branchMessage(locale: string, keyword: string) {
    return program({
      config: config({ locales: [locale] , sourceLocale: locale }),
      messages: [
        message({
          key: 'cart.items',
          bodies: [
            body(locale, {
              nodes: [
                plural({
                  name: 'count',
                  branches: [
                    branch(keyword, text('none')),
                    branch('one', pound()),
                    branch('other', pound()),
                  ],
                }),
              ],
              args: [numberArg('count')],
            }),
          ],
        }),
      ],
    })
  }

  it('reports a zero branch German can never select, and names the exact branch', () => {
    const unreachable = only(runChecks(branchMessage('de', 'zero')), 'LZ3013')

    expect(unreachable).toMatchObject({
      rule: 'plural-category-unreachable',
      severity: 'warn',
      fatal: false,
      locale: 'de',
    })
    expect(unreachable.hint).toContain('=0')
  })

  it('keeps a zero branch for a locale whose category set has one', () => {
    expect(withCode(runChecks(branchMessage('lv', 'zero')), 'LZ3013')).toEqual([])
    expect(withCode(runChecks(branchMessage('ar', 'zero')), 'LZ3013')).toEqual([])
  })

  it('reports any other category the locale never selects', () => {
    expect(only(runChecks(branchMessage('en', 'many')), 'LZ3013').message).toContain('many')
  })

  it('leaves a keyword that is not a CLDR category to the parser rule', () => {
    expect(withCode(runChecks(branchMessage('en', 'banana')), 'LZ3013')).toEqual([])
  })
})

describe('select options', () => {
  function statusMessage(sourceOptions: readonly string[], targetOptions: readonly string[]) {
    return program({
      messages: [
        message({
          key: 'order.status',
          bodies: [
            body('en', {
              nodes: [
                selectNode(
                  'state',
                  sourceOptions.map((name) => option(name, text(name))),
                ),
              ],
              args: [selectArg('state', sourceOptions)],
            }),
            body('de', {
              nodes: [
                selectNode(
                  'state',
                  targetOptions.map((name) => option(name, text(name))),
                ),
              ],
              args: [selectArg('state', targetOptions)],
            }),
          ],
        }),
      ],
    })
  }

  it('reports a source branch the translation collapsed into other', () => {
    const missing = only(
      runChecks(statusMessage(['shipped', 'delivered', 'other'], ['shipped', 'other'])),
      'LZ3008',
    )

    expect(missing).toMatchObject({
      rule: 'select-option-missing',
      severity: 'warn',
      fatal: false,
      locale: 'de',
    })
    expect(missing.message).toContain('delivered')
  })

  it('reports a branch no call site can ever reach', () => {
    const extraOption = only(
      runChecks(statusMessage(['shipped', 'other'], ['shipped', 'cancelled', 'other'])),
      'LZ3009',
    )

    expect(extraOption).toMatchObject({ rule: 'select-option-extra', severity: 'error' })
    expect(extraOption.message).toContain('cancelled')
  })

  it('never reports the other branch in either direction', () => {
    expect(runChecks(statusMessage(['shipped', 'other'], ['shipped', 'other']))).toEqual([])
  })

  it('finds a select nested inside a plural branch', () => {
    const diagnostics = runChecks(
      program({
        messages: [
          message({
            key: 'cart.items',
            bodies: [
              body('en', {
                nodes: [
                  plural({
                    name: 'count',
                    branches: [
                      branch('one', selectNode('state', [option('shipped', text('x')), option('other', text('y'))])),
                      branch('other', pound()),
                    ],
                  }),
                ],
                args: [numberArg('count'), selectArg('state', ['shipped', 'other'])],
              }),
              body('de', {
                nodes: [
                  plural({
                    name: 'count',
                    branches: [
                      branch('one', selectNode('state', [option('other', text('y'))])),
                      branch('other', pound()),
                    ],
                  }),
                ],
                args: [numberArg('count'), selectArg('state', ['other'])],
              }),
            ],
          }),
        ],
      }),
    )

    expect(codes(diagnostics)).toEqual(['LZ3008'])
  })
})

describe('dates without a time zone', () => {
  function dateProgram(options: IntlOptions, timeZone: string | null) {
    return program({
      config: config({ formats: { timeZone, number: {}, dateTime: {} } }),
      messages: [
        message({
          key: 'cart.updated',
          bodies: [
            body('en', { nodes: [dateTimeNode('at', options)], args: [dateArg('at')] }),
            body('de', { nodes: [dateTimeNode('at', options)], args: [dateArg('at')] }),
          ],
        }),
      ],
    })
  }

  it('warns once against the source locale even though the rule defaults to off', () => {
    const diagnostics = runChecks(dateProgram({ dateStyle: 'medium' }, null))

    expect(RULES['date-without-timezone'].severity).toBe('off')
    expect(only(diagnostics, 'LZ3011')).toMatchObject({
      rule: 'date-without-timezone',
      severity: 'warn',
      fatal: false,
      locale: 'en',
      key: 'cart.updated',
      file: 'locales/en.json',
    })
  })

  it('stays quiet once the options or the config pin a zone', () => {
    expect(withCode(runChecks(dateProgram({ dateStyle: 'medium', timeZone: 'UTC' }, null)), 'LZ3011')).toEqual([])
    expect(withCode(runChecks(dateProgram({ dateStyle: 'medium' }, 'UTC')), 'LZ3011')).toEqual([])
  })

  it('raises one diagnostic for a message carrying two unzoned dates', () => {
    const diagnostics = runChecks(
      program({
        messages: [
          message({
            key: 'order.window',
            bodies: [
              body('en', {
                nodes: [dateTimeNode('from'), text(' to '), dateTimeNode('to')],
                args: [dateArg('from'), dateArg('to')],
              }),
            ],
          }),
        ],
      }),
    )

    const unzoned = only(diagnostics, 'LZ3011')
    expect(unzoned.message).toContain('{from}')
    expect(unzoned.message).toContain('{to}')
  })
})

describe('keys only a translation has', () => {
  it('reports every extra the analyzer collected', () => {
    const diagnostics = runChecks(
      program({ extras: [extra('de', 'nav.legacy'), extra('de', 'nav.old')] }),
    )

    expect(codes(diagnostics)).toEqual(['LZ3003', 'LZ3003'])
    expect(diagnostics[0]).toMatchObject({
      rule: 'extra-translation',
      severity: 'warn',
      fatal: false,
      locale: 'de',
      key: 'nav.legacy',
      file: 'locales/de.json',
    })
  })
})

describe('ambiguous source text', () => {
  function openKeys(descriptions: Readonly<Record<string, string | null>>) {
    return program({
      messages: Object.entries(descriptions).map(([key, description]) =>
        message({
          key,
          source: 'Open',
          description,
          bodies: [body('en', { nodes: [text('Open')] })],
        }),
      ),
    })
  }

  it('fires when any one of the colliding keys lacks a description', () => {
    const diagnostics = runChecks(
      openKeys({
        'dialog.open': null,
        'file.open': null,
        'status.open': 'Badge on a ticket that is not closed',
      }),
    )

    const ambiguous = only(diagnostics, 'LZ3012')
    expect(ambiguous).toMatchObject({
      rule: 'ambiguous-source',
      severity: 'warn',
      fatal: false,
      file: 'locales/en.json',
    })
    expect(ambiguous.message).toContain('3 keys share the source text "Open"')
    expect(ambiguous.related.map((entry) => entry.key)).toEqual([
      'dialog.open',
      'file.open',
      'status.open',
    ])
    expect(ambiguous.related.map((entry) => entry.message)).toEqual([
      'no description',
      'no description',
      '"Badge on a ticket that is not closed"',
    ])
    expect(ambiguous.related[0]).toMatchObject({ file: 'locales/en.json', locale: null })
    expect(ambiguous.related[0]?.span).not.toBeNull()
    expect(ambiguous.hint).toContain('locales/en.meta.json')
    expect(ambiguous.hint).toContain(`severity: { 'ambiguous-source': 'error' }`)
  })

  it('says nothing once every colliding key is described', () => {
    const diagnostics = runChecks(
      openKeys({ 'dialog.open': 'The verb', 'status.open': 'The adjective' }),
    )

    expect(diagnostics).toEqual([])
  })

  it('treats a blank description as no description', () => {
    const diagnostics = runChecks(openKeys({ 'dialog.open': '   ', 'status.open': 'The adjective' }))

    expect(codes(diagnostics)).toEqual(['LZ3012'])
  })

  it('compares the normalized text case sensitively', () => {
    const diagnostics = runChecks(
      program({
        messages: [
          message({ key: 'dialog.open', source: 'Open', bodies: [body('en')] }),
          message({ key: 'file.open', source: 'open', bodies: [body('en')] }),
        ],
      }),
    )

    expect(diagnostics).toEqual([])
  })

  it('raises one diagnostic per source text', () => {
    const diagnostics = runChecks(
      program({
        messages: [
          message({ key: 'dialog.open', source: 'Open', bodies: [body('en')] }),
          message({ key: 'file.open', source: 'Open', bodies: [body('en')] }),
          message({ key: 'dialog.save', source: 'Save', bodies: [body('en')] }),
          message({ key: 'file.save', source: 'Save', bodies: [body('en')] }),
        ],
      }),
    )

    expect(codes(diagnostics)).toEqual(['LZ3012', 'LZ3012'])
    expect(diagnostics.map((entry) => entry.key)).toEqual([null, null])
  })

  it('points at the config when the meta sidecar is switched off', () => {
    const diagnostics = runChecks(
      program({
        config: config({ meta: false }),
        messages: [
          message({ key: 'dialog.open', source: 'Open', bodies: [body('en')] }),
          message({ key: 'file.open', source: 'Open', bodies: [body('en')] }),
        ],
      }),
    )

    expect(only(diagnostics, 'LZ3012').hint).toContain('set meta in loclizr.config.ts')
  })
})

describe('unpaired bidi controls', () => {
  function bidiMessage(nodes: readonly Node[]) {
    return program({
      config: config({ locales: ['en', 'he'] }),
      messages: [
        message({
          key: 'cart.note',
          bodies: [
            body('en', { nodes: [text('Free shipping over '), argNode('amount')], args: [stringishArg('amount')] }),
            body('he', { nodes, args: [stringishArg('amount')] }),
          ],
          spans: [at('en', 2, 13), at('he', 2, 13, 'locales/he.json')],
        }),
      ],
    })
  }

  it('reports an override the value opens and never closes', () => {
    const unpaired = only(
      runChecks(bidiMessage([text('‮משלוח חינם מעל '), argNode('amount')])),
      'LZ3014',
    )

    expect(unpaired).toMatchObject({
      rule: 'bidi-control-unpaired',
      severity: 'warn',
      fatal: false,
      file: 'locales/he.json',
      locale: 'he',
      key: 'cart.note',
      span: span(2, 13),
    })
    expect(unpaired.message).toContain('U+202E RIGHT-TO-LEFT OVERRIDE')
    expect(unpaired.hint).toBe('close it with U+202C in "cart.note" in locales/he.json, or delete it')
  })

  it('names the isolate closer for an isolate left open', () => {
    const unpaired = only(runChecks(bidiMessage([text('⁧'), argNode('amount')])), 'LZ3014')

    expect(unpaired.message).toContain('U+2067 RIGHT-TO-LEFT ISOLATE')
    expect(unpaired.hint).toContain('close it with U+2069')
  })

  it('reports a closer with nothing open to close', () => {
    const unpaired = only(runChecks(bidiMessage([argNode('amount'), text('‬')])), 'LZ3014')

    expect(unpaired.message).toContain('U+202C POP DIRECTIONAL FORMATTING')
    expect(unpaired.message).toContain('nothing open')
  })

  it('accepts pairs around an argument or across a tag, and the marks RTL text needs', () => {
    const diagnostics = runChecks(
      bidiMessage([
        text('‏מעל ‪'),
        argNode('amount'),
        text('‬ ⁨'),
        markupNode('b', text('‫x')),
        text('‬⁩‎'),
      ]),
    )

    expect(withCode(diagnostics, 'LZ3014')).toEqual([])
  })

  it('lets an isolate closer end the embeddings opened inside it', () => {
    expect(withCode(runChecks(bidiMessage([text('⁧‮x⁩')])), 'LZ3014')).toEqual([])
  })

  it('does not let an embedding closer end an isolate', () => {
    const diagnostics = runChecks(bidiMessage([text('⁧x‬')]))

    expect(withCode(diagnostics, 'LZ3014').map((entry) => entry.message.match(/U\+[0-9A-F]{4}/)?.[0])).toEqual([
      'U+202C',
      'U+2067',
    ])
  })

  it('pairs within one branch, since only one branch renders', () => {
    const split = runChecks(
      bidiMessage([
        text('‫'),
        plural({
          name: 'amount',
          branches: [branch('one', pound(), text('‬')), branch('other', pound(), text('‬'))],
        }),
      ]),
    )
    const inside = runChecks(
      bidiMessage([
        plural({
          name: 'amount',
          branches: [branch('one', text('‫'), pound(), text('‬')), branch('other', pound())],
        }),
      ]),
    )

    expect(withCode(split, 'LZ3014').map((entry) => entry.message.match(/U\+[0-9A-F]{4}/)?.[0])).toEqual([
      'U+202B',
      'U+202C',
    ])
    expect(withCode(inside, 'LZ3014')).toEqual([])
  })

  it('reports each unpaired character once per value', () => {
    const diagnostics = runChecks(bidiMessage([text('‮a'), argNode('amount'), text('‮b‮')]))

    expect(withCode(diagnostics, 'LZ3014')).toHaveLength(1)
  })

  it('checks the source value too', () => {
    const diagnostics = runChecks(
      program({
        messages: [message({ key: 'cart.note', bodies: [body('en', { nodes: [text('Free‭')] })] })],
      }),
    )

    expect(only(diagnostics, 'LZ3014')).toMatchObject({ locale: 'en', key: 'cart.note' })
  })
})

describe('every diagnostic this module produces', () => {
  const mixed = runChecks(
    program({
      config: config({ locales: ['de', 'de-AT', 'en'] }),
      extras: [extra('de', 'nav.legacy')],
      messages: [
        message({
          key: 'cart.items',
          source: 'Open',
          bodies: [
            body('en', {
              nodes: [
                plural({ name: 'count', branches: [branch('other', pound())] }),
                dateTimeNode('at'),
                markupNode('link', text('terms')),
                selectNode('state', [option('shipped', text('x')), option('other', text('y'))]),
              ],
              args: [
                numberArg('count'),
                dateArg('at'),
                markupArg('link'),
                selectArg('state', ['shipped', 'other']),
              ],
              markupTags: ['link'],
            }),
            body('de', {
              nodes: [
                plural({
                  name: 'count',
                  branches: [branch('zero', text('x')), branch('one', pound()), branch('other', pound())],
                }),
                selectNode('state', [option('other', text('y')), option('storniert', text('z'))]),
                argNode('nmae'),
                text('\u202E'),
              ],
              args: [
                numberArg('count'),
                selectArg('state', ['other', 'storniert']),
                stringishArg('nmae'),
              ],
            }),
          ],
          origins: [
            translated('en'),
            fellBack('de', 'en', 'invalid'),
            fellBack('de-AT', 'en', 'missing'),
          ],
        }),
        message({ key: 'nav.open', source: 'Open', bodies: [body('en')] }),
      ],
    }),
  )

  it('covers the LZ3xxx range and nothing else', () => {
    expect(codes(mixed).toSorted()).toEqual([
      'LZ3001',
      'LZ3003',
      'LZ3004',
      'LZ3005',
      'LZ3007',
      'LZ3008',
      'LZ3009',
      'LZ3010',
      'LZ3011',
      'LZ3012',
      'LZ3013',
      'LZ3014',
    ])
  })

  it('stamps the rule default severity and never claims to be fatal', () => {
    for (const diagnostic of mixed) {
      const rule = RULES[diagnostic.rule]
      expect(diagnostic.code).toBe(rule.code)
      expect(diagnostic.severity).toBe(rule.severity === 'off' ? 'warn' : rule.severity)
      expect(diagnostic.fatal).toBe(false)
      expect(rule.owner).toBe('M5')
    }
  })
})
