import { describe, expect, it } from 'vitest'
import { hasNamespace, namespaceOfFile, substituteLocale, toGlob } from './pattern'

describe('substituteLocale', () => {
  it('replaces every occurrence of the token', () => {
    expect(substituteLocale('locales/{locale}/{locale}.json', 'fr')).toBe('locales/fr/fr.json')
  })

  it('writes a tag with extension and private use subtags verbatim', () => {
    expect(substituteLocale('locales/{locale}.json', 'de-u-co-phonebk')).toBe(
      'locales/de-u-co-phonebk.json',
    )
    expect(substituteLocale('locales/{locale}.json', 'en-x-twain')).toBe('locales/en-x-twain.json')
  })

  it('keeps the casing it was handed', () => {
    expect(substituteLocale('locales/{locale}.json', 'zh-Hant-TW')).toBe('locales/zh-Hant-TW.json')
  })

  it('leaves a token spelled with other casing alone', () => {
    expect(substituteLocale('locales/{Locale}.json', 'en')).toBe('locales/{Locale}.json')
  })
})

describe('hasNamespace and toGlob', () => {
  it('is case sensitive about the token', () => {
    expect(hasNamespace('locales/en/{NS}.json')).toBe(false)
  })

  it('turns every namespace token into a wildcard', () => {
    expect(toGlob('locales/{ns}/en/{ns}.json')).toBe('locales/*/en/*.json')
  })
})

describe('namespaceOfFile', () => {
  it('reads a namespace with digits, dashes and underscores', () => {
    expect(namespaceOfFile('locales/en/{ns}.json', 'locales/en/checkout_v2-beta.json')).toBe(
      'checkout_v2-beta',
    )
  })

  it('keeps the casing the file has', () => {
    expect(namespaceOfFile('locales/en/{ns}.json', 'locales/en/Common.json')).toBe('Common')
  })

  it('refuses a namespace outside the ASCII token class', () => {
    expect(namespaceOfFile('locales/es/{ns}.json', 'locales/es/común.json')).toBeNull()
    expect(namespaceOfFile('locales/en/{ns}.json', 'locales/en/a b.json')).toBeNull()
  })

  it('refuses an empty stem', () => {
    expect(namespaceOfFile('locales/en/{ns}.json', 'locales/en/.json')).toBeNull()
  })

  it('treats regular expression syntax in the fixed part as literal text', () => {
    expect(namespaceOfFile('app/(site)/en/{ns}.json', 'app/(site)/en/common.json')).toBe('common')
    expect(namespaceOfFile('app/[lang]/en/{ns}.json', 'app/[lang]/en/common.json')).toBe('common')
    expect(namespaceOfFile('a+b/$x^/en/{ns}.json', 'a+b/$x^/en/common.json')).toBe('common')
    expect(namespaceOfFile('app/(site)/en/{ns}.json', 'app/site/en/common.json')).toBeNull()
  })

  it('refuses a dot in the fixed part matching any other character', () => {
    expect(namespaceOfFile('locales/en/{ns}.json', 'locales/en/commonXjson')).toBeNull()
  })

  it('matches a namespace at the root of the pattern', () => {
    expect(namespaceOfFile('{ns}.json', 'common.json')).toBe('common')
    expect(namespaceOfFile('{ns}.json', 'nested/common.json')).toBeNull()
  })

  it('finds nothing in a pattern without the token', () => {
    expect(namespaceOfFile('locales/en.json', 'locales/en.json')).toBeNull()
  })

  it('anchors at both ends of the path', () => {
    expect(namespaceOfFile('locales/en/{ns}.json', 'x/locales/en/common.json')).toBeNull()
    expect(namespaceOfFile('locales/en/{ns}.json', 'locales/en/common.json.bak')).toBeNull()
  })
})
