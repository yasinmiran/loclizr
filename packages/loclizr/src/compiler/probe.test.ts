import { describe, expect, it } from 'vitest'
import { icuDataComplete, localesWithoutPluralData } from './probe'

describe('icuDataComplete', () => {
  it('passes on a full ICU build', () => {
    expect(icuDataComplete()).toBe(true)
  })
})

describe('localesWithoutPluralData', () => {
  it('flags a well formed tag Intl has no data for', () => {
    expect(localesWithoutPluralData(['shared', 'und', 'xx', 'tlh', 'qaa'])).toEqual([
      'shared',
      'und',
      'xx',
      'tlh',
      'qaa',
    ])
  })

  it('leaves a regional, script bearing or variant tag alone', () => {
    const declared = ['de-AT', 'en-GB', 'pt-PT', 'zh-Hans-CN', 'sr-Latn', 'es-419', 'de-1901']

    expect(localesWithoutPluralData(declared)).toEqual([])
  })

  it('canonicalizes a deprecated tag before deciding', () => {
    expect(localesWithoutPluralData(['tl', 'in', 'iw', 'art-lojban'])).toEqual([])
  })

  it('leaves the spec quickstart untouched', () => {
    expect(localesWithoutPluralData(['en', 'de', 'de-AT'])).toEqual([])
  })

  it('answers for a mixed set without disturbing the order', () => {
    expect(localesWithoutPluralData(['de', 'shared', 'en', 'und'])).toEqual(['shared', 'und'])
  })

  it('leaves a malformed tag to M9, which rejects it before this runs', () => {
    expect(localesWithoutPluralData(['not a tag', 'en'])).toEqual([])
  })
})
