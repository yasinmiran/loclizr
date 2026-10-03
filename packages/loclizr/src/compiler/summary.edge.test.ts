import { describe, expect, it } from 'vitest'
import { diag } from '../diagnostics'
import type { LocaleOrigin } from '../types'
import { message, program } from './__fixtures__/program'
import { summarize } from './summary'

function fallback(locale: string): LocaleOrigin {
  return { locale, origin: { status: 'fallback', from: 'en', reason: 'missing' } }
}

describe('summarize', () => {
  it('reports no messages and no fallbacks for a run that never built a program', () => {
    expect(summarize([], null, 5)).toEqual({ errors: 0, warnings: 0, messages: 0, locales: 5, fellBack: [] })
  })

  it('takes the locale count it is handed over the one the program declares', () => {
    expect(summarize([], program(), 7).locales).toBe(7)
  })

  it('counts every diagnostic that is not an error as a warning', () => {
    const summary = summarize(
      [
        diag('extra-translation', { message: 'warn' }),
        diag('missing-translation', { message: 'error' }),
        diag('icu-data-incomplete', { message: 'warn' }),
      ],
      null,
      0,
    )

    expect(summary).toMatchObject({ errors: 1, warnings: 2 })
  })

  it('lists fallback locales in code point order, uppercase first', () => {
    const messages = [
      message({ key: 'a', origins: [fallback('en'), fallback('de-AT'), fallback('Zu'), fallback('de')] }),
    ]

    expect(summarize([], program({ messages }), 4).fellBack.map((entry) => entry.locale)).toEqual([
      'Zu',
      'de',
      'de-AT',
      'en',
    ])
  })

  it('leaves out a locale whose messages were all translated or inherited', () => {
    const messages = [
      message({
        key: 'a',
        origins: [
          { locale: 'en', origin: { status: 'translated' } },
          { locale: 'de-AT', origin: { status: 'inherited', from: 'de' } },
          fallback('de'),
        ],
      }),
    ]

    expect(summarize([], program({ messages }), 3).fellBack).toEqual([{ locale: 'de', count: 1 }])
  })

  it('counts one message falling back in two locales once in each', () => {
    const messages = [
      message({ key: 'a', origins: [fallback('de'), fallback('fr')] }),
      message({ key: 'b', origins: [fallback('de')] }),
    ]

    expect(summarize([], program({ messages }), 3).fellBack).toEqual([
      { locale: 'de', count: 2 },
      { locale: 'fr', count: 1 },
    ])
  })

  it('counts each fallback reason alike', () => {
    const messages = (['missing', 'blank', 'invalid'] as const).map((reason, index) =>
      message({
        key: `k${index}`,
        origins: [{ locale: 'de', origin: { status: 'fallback', from: 'en', reason } }],
      }),
    )

    expect(summarize([], program({ messages }), 2).fellBack).toEqual([{ locale: 'de', count: 3 }])
  })

  it('counts messages, not keys of a nested catalog', () => {
    const messages = [message({ key: 'a.b.c' }), message({ key: 'a.b' }), message({ key: '' })]

    expect(summarize([], program({ messages }), 1).messages).toBe(3)
  })
})
