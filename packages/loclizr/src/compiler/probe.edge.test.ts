import { describe, expect, it } from 'vitest'
import { icuDataComplete, localesWithoutPluralData } from './probe'

describe('icuDataComplete', () => {
  it('answers the same on a second call', () => {
    expect(icuDataComplete()).toBe(icuDataComplete())
  })
})

describe('localesWithoutPluralData', () => {
  it('answers an empty list with an empty list', () => {
    expect(localesWithoutPluralData([])).toEqual([])
  })

  it('leaves a known tag in odd casing alone', () => {
    expect(localesWithoutPluralData(['EN', 'DE-at', 'en-us', 'zH-hANT-tw', 'SR-latn'])).toEqual([])
  })

  it('leaves a tag carrying a unicode extension alone', () => {
    const extended = ['en-u-ca-buddhist', 'ar-u-nu-latn', 'de-DE-u-co-phonebk', 'ja-JP-u-ca-japanese']

    expect(localesWithoutPluralData(extended)).toEqual([])
  })

  it('leaves a tag carrying a private use suffix alone', () => {
    expect(localesWithoutPluralData(['en-x-priv', 'de-AT-x-internal'])).toEqual([])
  })

  it('leaves a tag that canonicalizes onto a different language with data alone', () => {
    expect(localesWithoutPluralData(['sh', 'mo', 'cmn', 'ji', 'jw'])).toEqual([])
  })

  it('leaves the Norwegian macrolanguage and both its written standards alone', () => {
    expect(localesWithoutPluralData(['no', 'nb', 'nn'])).toEqual([])
  })

  it('leaves to M9 the tags Intl refuses to canonicalize', () => {
    expect(localesWithoutPluralData(['x-foo', 'root', 'i-klingon', ''])).toEqual([])
  })

  it('flags a sign language tag that canonicalizes to a code with no plural data', () => {
    expect(localesWithoutPluralData(['sgn-GR'])).toEqual(['sgn-GR'])
  })

  it('keeps a duplicated guess at both of its positions', () => {
    expect(localesWithoutPluralData(['xx', 'en', 'xx'])).toEqual(['xx', 'xx'])
  })

  it('returns the declared spelling, never the canonical one', () => {
    expect(localesWithoutPluralData(['XX', 'Und'])).toEqual(['XX', 'Und'])
  })
})
