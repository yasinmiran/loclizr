import { describe, expect, it } from 'vitest'
import { hasNamespace, namespaceOfFile, substituteLocale, toGlob } from './pattern'

describe('pattern', () => {
  it('substitutes the locale token wherever it sits', () => {
    expect(substituteLocale('locales/{locale}.json', 'de-AT')).toBe('locales/de-AT.json')
    expect(substituteLocale('public/locales/{locale}/{ns}.json', 'de')).toBe(
      'public/locales/de/{ns}.json',
    )
  })

  it('expands the namespace token to one segment wildcard', () => {
    expect(hasNamespace('locales/{locale}.json')).toBe(false)
    expect(toGlob('public/locales/de/{ns}.json')).toBe('public/locales/de/*.json')
  })

  it('reads the namespace out of a matched file', () => {
    expect(namespaceOfFile('public/locales/de/{ns}.json', 'public/locales/de/common.json')).toBe(
      'common',
    )
    expect(namespaceOfFile('locales/{ns}/de.json', 'locales/errors/de.json')).toBe('errors')
  })

  it('refuses a stem that crosses a dot or a slash', () => {
    expect(namespaceOfFile('locales/en/{ns}.json', 'locales/en/en.meta.json')).toBeNull()
    expect(namespaceOfFile('locales/en/{ns}.json', 'locales/en/deep/common.json')).toBeNull()
    expect(namespaceOfFile('locales/en/{ns}.json', 'other/en/common.json')).toBeNull()
  })
})
