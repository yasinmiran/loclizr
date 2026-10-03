import { describe, expect, it } from 'vitest'
import {
  catalogMatcher,
  countToken,
  globMetacharacterIn,
  literalMatcher,
  looseCatalogMatcher,
  patternBase,
  patternToGlob,
  substituteLocale,
  withNamespaceToken,
} from './pattern'

const DEFAULT = 'locales/{locale}.json'

function match(pattern: string, file: string): { locale: string; ns: string | null } | null {
  const matcher = catalogMatcher(pattern)
  if (matcher === null) throw new Error(`no matcher for ${pattern}`)
  const found = matcher(file)
  return found === null ? null : { locale: found.locale, ns: found.ns }
}

function loose(pattern: string, file: string): { locale: string; ns: string | null } | null {
  const matcher = looseCatalogMatcher(pattern)
  if (matcher === null) throw new Error(`no matcher for ${pattern}`)
  const found = matcher(file)
  return found === null ? null : { locale: found.locale, ns: found.ns }
}

describe('catalogMatcher on hostile basenames', () => {
  it.each([
    ['an emoji', 'locales/\u{1F1E9}\u{1F1EA}.json'],
    ['a right-to-left mark', 'locales/de‏.json'],
    ['a combining accent', 'locales/é.json'],
    ['a byte order mark', 'locales/﻿en.json'],
    ['a space', 'locales/en US.json'],
    ['an empty stem', 'locales/.json'],
    ['a prototype name', 'locales/__proto__.json'],
  ])('refuses %s in the locale stem', (_label, file) => {
    expect(match(DEFAULT, file)).toBeNull()
  })

  it('reads an extension subtag as part of the locale', () => {
    expect(match(DEFAULT, 'locales/en-u-ca-buddhist.json')).toEqual({
      locale: 'en-u-ca-buddhist',
      ns: null,
    })
  })

  it('reads a stem of dashes alone, leaving Intl to reject it', () => {
    expect(match(DEFAULT, 'locales/-.json')).toEqual({ locale: '-', ns: null })
  })

  it('is case sensitive about the extension', () => {
    expect(match(DEFAULT, 'locales/en.JSON')).toBeNull()
  })

  it('refuses a CRLF or lone CR tail, because the stem class has no line ending in it', () => {
    expect(match(DEFAULT, 'locales/en.json\r\n')).toBeNull()
    expect(match(DEFAULT, 'locales/en\r.json')).toBeNull()
  })

  it('refuses a file that only matches across a newline', () => {
    expect(match(DEFAULT, 'locales/en.json\nlocales/de.json')).toBeNull()
  })

  it('treats a regex metacharacter in a literal part literally', () => {
    expect(match('i18n+x/{locale}.json', 'i18n+x/en.json')).toEqual({ locale: 'en', ns: null })
    expect(match('i18n+x/{locale}.json', 'i18nnx/en.json')).toBeNull()
    expect(match('a$b/{locale}.json', 'a$b/en.json')).toEqual({ locale: 'en', ns: null })
  })

  it('reads a namespace directory that comes before the locale', () => {
    expect(match('locales/{ns}/{locale}.json', 'locales/common/en.json')).toEqual({
      locale: 'en',
      ns: 'common',
    })
  })

  it('reads a numeric and a reserved-word namespace as plain names', () => {
    const split = 'locales/{locale}/{ns}.json'
    expect(match(split, 'locales/en/404.json')).toEqual({ locale: 'en', ns: '404' })
    expect(match(split, 'locales/en/default.json')).toEqual({ locale: 'en', ns: 'default' })
  })

  it('reads a very long stem in one piece', () => {
    const stem = `en-${'a'.repeat(5000)}`
    expect(match(DEFAULT, `locales/${stem}.json`)).toEqual({ locale: stem, ns: null })
  })

  it('answers the same twice, since the expression is not global', () => {
    const matcher = catalogMatcher(DEFAULT)
    expect(matcher?.('locales/en.json')).toEqual({ locale: 'en', ns: null })
    expect(matcher?.('locales/en.json')).toEqual({ locale: 'en', ns: null })
  })
})

describe('looseCatalogMatcher on hostile basenames', () => {
  it('reads a non-ASCII stem so it can be reported', () => {
    expect(loose(DEFAULT, 'locales/日本.json')).toEqual({ locale: '日本', ns: null })
  })

  it('reads an emoji stem so it can be reported', () => {
    expect(loose(DEFAULT, 'locales/\u{1F1E9}\u{1F1EA}.json')).toEqual({
      locale: '\u{1F1E9}\u{1F1EA}',
      ns: null,
    })
  })

  it('still refuses an empty stem', () => {
    expect(loose(DEFAULT, 'locales/.json')).toBeNull()
  })
})

describe('countToken and globMetacharacterIn at the edges', () => {
  it('counts nothing in an empty pattern', () => {
    expect(countToken('', '{locale}')).toBe(0)
  })

  it('counts adjacent tokens separately', () => {
    expect(countToken('{locale}{locale}', '{locale}')).toBe(2)
  })

  it('sees a brace that only half spells a token', () => {
    expect(globMetacharacterIn('locales/{locale.json')).toBe('{')
    expect(globMetacharacterIn('locales/locale}/{locale}.json')).toBe('}')
  })

  it('sees a token spelled with odd casing as a glob brace', () => {
    expect(globMetacharacterIn('locales/{Locale}.json')).toBe('{')
  })

  it('finds nothing in an empty pattern', () => {
    expect(globMetacharacterIn('')).toBeNull()
  })
})

describe('patternToGlob and substituteLocale', () => {
  it('turns adjacent tokens into adjacent wildcards', () => {
    expect(patternToGlob('{locale}{ns}.json')).toBe('**.json')
  })

  it('substitutes every locale token, not just the first', () => {
    expect(substituteLocale('{locale}/{sourceLocale}/{locale}.json', 'de')).toBe('de/de/de.json')
  })
})

describe('literalMatcher at the edges', () => {
  it('matches a path with no token as itself and nothing else', () => {
    const matcher = literalMatcher('locales/loclizr.context.json')
    expect(matcher.test('locales/loclizr.context.json')).toBe(true)
    expect(matcher.test('locales/loclizr.context.json.bak')).toBe(false)
    expect(matcher.test('x/locales/loclizr.context.json')).toBe(false)
  })

  it('holds {ns} to its own character class', () => {
    const matcher = literalMatcher('locales/{ns}.meta.json')
    expect(matcher.test('locales/my_ns.meta.json')).toBe(true)
    expect(matcher.test('locales/a.b.meta.json')).toBe(false)
  })
})

describe('patternBase and withNamespaceToken at the edges', () => {
  it('reads a pattern that leaves the root through a parent segment', () => {
    expect(patternBase('../shared/{locale}.json')).toBe('../shared')
  })

  it('has no base for an empty pattern', () => {
    expect(patternBase('')).toBeNull()
  })

  it('has nothing to add to an empty pattern', () => {
    expect(withNamespaceToken('')).toBeNull()
  })

  it('splits a per-locale file one level deep in a parent-relative tree', () => {
    expect(withNamespaceToken('../shared/{locale}.json')).toBe('../shared/{locale}/{ns}.json')
  })
})
