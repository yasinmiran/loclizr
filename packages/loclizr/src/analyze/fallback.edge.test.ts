import { describe, expect, it } from 'vitest'
import type { Config, Program } from '../types'
import { bodyFor, catalog, config, messageFor, originFor, run } from './__fixtures__/program'
import { fallbackChain } from './index'

function targetValue(value: string): Program {
  return run({
    config: config({ locales: ['en', 'de'] }),
    catalogs: [
      catalog({ locale: 'en', entries: { 'nav.home': 'Home' } }),
      catalog({ locale: 'de', entries: { 'nav.home': value } }),
    ],
  })
}

describe('fallbackChain on deeper tags', () => {
  const chinese: Config = config({ locales: ['en', 'zh', 'zh-Hant', 'zh-Hant-TW'] })

  it('walks a script and a region subtag down to the language', () => {
    expect(fallbackChain('zh-Hant-TW', chinese)).toEqual(['zh-Hant-TW', 'zh-Hant', 'zh', 'en'])
  })

  it('walks through an extension subtag to the declared region and language', () => {
    const chain = fallbackChain('de-AT-u-ca-buddhist', config({ locales: ['en', 'de', 'de-AT'] }))
    expect(chain).toEqual(['de-AT-u-ca-buddhist', 'de-AT', 'de', 'en'])
  })

  it('still ends at the source for a tag that is not declared at all', () => {
    expect(fallbackChain('fr-CA', config({ locales: ['en', 'de'] }))).toEqual(['fr-CA', 'en'])
  })
})

describe('fallbackChain with a regional source locale', () => {
  const regional: Config = config({ locales: ['en-US', 'en', 'en-GB'], sourceLocale: 'en-US' })

  it('ends the base language at the regional source', () => {
    expect(fallbackChain('en', regional)).toEqual(['en', 'en-US'])
  })

  it('passes a sibling region through the declared base before the source', () => {
    expect(fallbackChain('en-GB', regional)).toEqual(['en-GB', 'en', 'en-US'])
  })

  it('never lists the source twice where it is also the truncation', () => {
    expect(fallbackChain('en-GB', config({ locales: ['en', 'en-GB'] }))).toEqual(['en-GB', 'en'])
  })
})

describe('fallbackChain with an explicit map', () => {
  it('leaves a locale the map does not name on subtag truncation', () => {
    const mapped = config({ locales: ['en', 'de', 'de-AT', 'nb'], fallback: { nb: ['no'] } })
    expect(fallbackChain('de-AT', mapped)).toEqual(['de-AT', 'de', 'en'])
  })

  it('skips a declared truncation when the map gives the locale an empty middle', () => {
    const mapped = config({ locales: ['en', 'de', 'de-AT'], fallback: { 'de-AT': [] } })
    expect(fallbackChain('de-AT', mapped)).toEqual(['de-AT', 'en'])
  })

  it('drops a map step naming the locale itself and a repeated step', () => {
    const mapped = config({ locales: ['en', 'nb', 'no'], fallback: { nb: ['nb', 'no', 'no'] } })
    expect(fallbackChain('nb', mapped)).toEqual(['nb', 'no', 'en'])
  })

  it('moves a source step out of the middle so the walk reaches later steps', () => {
    const mapped = config({ locales: ['en', 'nb', 'no'], fallback: { nb: ['en', 'no'] } })
    expect(fallbackChain('nb', mapped)).toEqual(['nb', 'no', 'en'])
  })
})

describe('what counts as a blank target value', () => {
  for (const [label, value] of [
    ['CRLF', '\r\n'],
    ['a lone CR', '\r'],
    ['a tab', '\t'],
    ['a no-break space', ' '],
    ['a byte order mark', '﻿'],
    ['an ideographic space', '　'],
    ['a line separator', ' '],
  ] as const) {
    it(`falls ${label} through to the source as reason blank with no body`, () => {
      const message = messageFor(targetValue(value), 'nav.home')
      expect(originFor(message, 'de')).toEqual({ status: 'fallback', from: 'en', reason: 'blank' })
      expect(bodyFor(message, 'de')).toBeUndefined()
    })
  }

  it('translates a value with text inside surrounding whitespace', () => {
    const message = messageFor(targetValue('\r\n Startseite \r\n'), 'nav.home')
    expect(originFor(message, 'de')).toEqual({ status: 'translated' })
  })

  it('translates a value identical to the source text', () => {
    const message = messageFor(targetValue('Home'), 'nav.home')
    expect(originFor(message, 'de')).toEqual({ status: 'translated' })
  })

  it('translates a value made only of an emoji', () => {
    const message = messageFor(targetValue('\u{1F3E0}'), 'nav.home')
    expect(originFor(message, 'de')).toEqual({ status: 'translated' })
  })

  it('translates a right-to-left value with embedded direction marks', () => {
    const message = messageFor(targetValue('‏בית‏'), 'nav.home')
    expect(originFor(message, 'de')).toEqual({ status: 'translated' })
  })
})

describe('declared locales with nothing on disk', () => {
  const absent = (): Program =>
    run({
      config: config({ locales: ['en', 'fr'] }),
      catalogs: [catalog({ locale: 'en', entries: { 'nav.home': 'Home', 'nav.cart': 'Cart' } })],
    })

  it('falls every key through to the source as missing', () => {
    for (const message of absent().messages) {
      expect(originFor(message, 'fr')).toEqual({ status: 'fallback', from: 'en', reason: 'missing' })
    }
  })

  it('gives that locale no body and no span', () => {
    const message = messageFor(absent(), 'nav.home')
    expect(bodyFor(message, 'fr')).toBeUndefined()
    expect(message.spans.map((span) => span.locale)).toEqual(['en'])
  })
})

describe('a catalog for a locale nothing declares or reaches', () => {
  const stray = (): Program =>
    run({
      config: config({ locales: ['en', 'de'] }),
      catalogs: [
        catalog({ locale: 'en', entries: { 'nav.home': 'Home' } }),
        catalog({ locale: 'de', entries: { 'nav.home': 'Startseite' } }),
        catalog({ locale: 'fr', entries: { 'nav.home': 'Accueil', 'fr.only': 'Seul' } }),
      ],
    })

  it('contributes no body', () => {
    expect(messageFor(stray(), 'nav.home').bodies.map((body) => body.locale)).toEqual(['en', 'de'])
  })

  it('contributes no origin and no span', () => {
    const message = messageFor(stray(), 'nav.home')
    expect(message.origins.map((entry) => entry.locale)).toEqual(['en', 'de'])
    expect(message.spans.map((span) => span.locale)).toEqual(['en', 'de'])
  })

  it('contributes no extras for keys the source lacks', () => {
    expect(stray().extras).toEqual([])
  })
})

describe('inheritance through a three-level chain', () => {
  const chinese = (middle: Readonly<Record<string, string>>): Program =>
    run({
      config: config({ locales: ['en', 'zh', 'zh-Hant', 'zh-Hant-TW'] }),
      catalogs: [
        catalog({ locale: 'en', entries: { 'nav.home': 'Home' } }),
        catalog({ locale: 'zh', entries: { 'nav.home': '首页' } }),
        catalog({ locale: 'zh-Hant', entries: middle }),
        catalog({ locale: 'zh-Hant-TW', entries: {} }),
      ],
    })

  it('skips a middle ancestor with no entry and inherits from the language', () => {
    const message = messageFor(chinese({}), 'nav.home')
    expect(originFor(message, 'zh-Hant-TW')).toEqual({ status: 'inherited', from: 'zh' })
  })

  it('skips a middle ancestor whose own value is blank and inherits from the language', () => {
    const message = messageFor(chinese({ 'nav.home': '  ' }), 'nav.home')
    expect(originFor(message, 'zh-Hant-TW')).toEqual({ status: 'inherited', from: 'zh' })
    expect(originFor(message, 'zh-Hant')).toEqual({ status: 'fallback', from: 'en', reason: 'blank' })
  })

  it('inherits from the nearest ancestor when every level has a value', () => {
    const message = messageFor(chinese({ 'nav.home': '首頁' }), 'nav.home')
    expect(originFor(message, 'zh-Hant-TW')).toEqual({ status: 'inherited', from: 'zh-Hant' })
  })
})

describe('a source locale that is not listed first', () => {
  const reordered = (): Program =>
    run({
      config: config({ locales: ['de', 'en'], sourceLocale: 'en' }),
      catalogs: [
        catalog({ locale: 'de', entries: { 'nav.home': 'Startseite' } }),
        catalog({ locale: 'en', entries: { 'nav.home': 'Home' } }),
      ],
    })

  it('still keys messages on the source catalog', () => {
    expect(messageFor(reordered(), 'nav.home').source).toBe('Home')
  })

  it('stamps both locales translated', () => {
    const message = messageFor(reordered(), 'nav.home')
    expect(originFor(message, 'de')).toEqual({ status: 'translated' })
    expect(originFor(message, 'en')).toEqual({ status: 'translated' })
  })
})
