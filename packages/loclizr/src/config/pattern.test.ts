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
const SPLIT = 'public/locales/{locale}/{ns}.json'

function match(pattern: string, file: string): { locale: string; ns: string | null } | null {
  const matcher = catalogMatcher(pattern)
  if (matcher === null) throw new Error(`no matcher for ${pattern}`)
  const found = matcher(file)
  return found === null ? null : { locale: found.locale, ns: found.ns }
}

describe('countToken', () => {
  it('counts occurrences of a token', () => {
    expect(countToken(DEFAULT, '{locale}')).toBe(1)
    expect(countToken(SPLIT, '{ns}')).toBe(1)
    expect(countToken('{locale}/{locale}.json', '{locale}')).toBe(2)
    expect(countToken(DEFAULT, '{ns}')).toBe(0)
  })

  it('does not see {locale} inside {sourceLocale}', () => {
    expect(countToken('locales/{sourceLocale}.meta.json', '{locale}')).toBe(0)
    expect(countToken('locales/{sourceLocale}.meta.json', '{sourceLocale}')).toBe(1)
  })
})

describe('patternToGlob', () => {
  it('expands every token to one segment wildcard', () => {
    expect(patternToGlob(DEFAULT)).toBe('locales/*.json')
    expect(patternToGlob(SPLIT)).toBe('public/locales/*/*.json')
    expect(patternToGlob('locales/{sourceLocale}.meta.json')).toBe('locales/*.meta.json')
  })

  it('leaves a pattern with no token alone', () => {
    expect(patternToGlob('locales/all.json')).toBe('locales/all.json')
  })
})

describe('catalogMatcher', () => {
  it('reads the locale out of the basename stem', () => {
    expect(match(DEFAULT, 'locales/en.json')).toEqual({ locale: 'en', ns: null })
    expect(match(DEFAULT, 'locales/de-AT.json')).toEqual({ locale: 'de-AT', ns: null })
  })

  it('never crosses a dot, so the meta sidecar and the record are not locales', () => {
    expect(match(DEFAULT, 'locales/en.meta.json')).toBeNull()
    expect(match(DEFAULT, 'locales/loclizr.context.json')).toBeNull()
  })

  it('never crosses a slash', () => {
    expect(match(DEFAULT, 'locales/nested/en.json')).toBeNull()
    expect(match(SPLIT, 'public/locales/de/deep/common.json')).toBeNull()
  })

  it('anchors both ends', () => {
    expect(match(DEFAULT, 'app/locales/en.json')).toBeNull()
    expect(match(DEFAULT, 'locales/en.json.bak')).toBeNull()
  })

  it('treats literal characters literally', () => {
    expect(match(DEFAULT, 'locales/enXjson')).toBeNull()
  })

  it('reads the namespace segment of a split catalog', () => {
    expect(match(SPLIT, 'public/locales/de/common.json')).toEqual({ locale: 'de', ns: 'common' })
    expect(match(SPLIT, 'public/locales/de/my_ns.json')).toEqual({ locale: 'de', ns: 'my_ns' })
    expect(match(SPLIT, 'public/locales/de/common.extra.json')).toBeNull()
  })

  it('rejects a locale segment outside [A-Za-z0-9-]', () => {
    expect(match(DEFAULT, 'locales/en_US.json')).toBeNull()
    expect(match(SPLIT, 'public/locales/en_US/common.json')).toBeNull()
  })

  it('refuses a pattern it cannot read a single locale out of', () => {
    expect(catalogMatcher('locales/all.json')).toBeNull()
    expect(catalogMatcher('{locale}/{locale}.json')).toBeNull()
    expect(catalogMatcher('locales/{sourceLocale}.json')).toBeNull()
    expect(catalogMatcher('{ns}/{ns}/{locale}.json')).toBeNull()
  })
})

describe('looseCatalogMatcher', () => {
  function loose(pattern: string, file: string): { locale: string; ns: string | null } | null {
    const matcher = looseCatalogMatcher(pattern)
    if (matcher === null) throw new Error(`no matcher for ${pattern}`)
    const found = matcher(file)
    return found === null ? null : { locale: found.locale, ns: found.ns }
  }

  it('reads a stem the locale token cannot spell', () => {
    expect(loose(DEFAULT, 'locales/en_US.json')).toEqual({ locale: 'en_US', ns: null })
    expect(loose(DEFAULT, 'locales/en.meta.json')).toEqual({ locale: 'en.meta', ns: null })
    expect(loose(SPLIT, 'public/locales/pt_BR/common.json')).toEqual({
      locale: 'pt_BR',
      ns: 'common',
    })
  })

  it('keeps the namespace token strict, because a dotted file claims no locale', () => {
    expect(loose(SPLIT, 'public/locales/en/a.b.json')).toBeNull()
  })

  it('still holds the locale to one segment', () => {
    expect(loose(DEFAULT, 'locales/nested/en_US.json')).toBeNull()
    expect(loose(DEFAULT, 'app/locales/en_US.json')).toBeNull()
  })
})

describe('globMetacharacterIn', () => {
  it('finds a glob character in a literal part', () => {
    expect(globMetacharacterIn('locales/*/{locale}.json')).toBe('*')
    expect(globMetacharacterIn('**/{locale}.json')).toBe('*')
    expect(globMetacharacterIn('locales/[a-z]/{locale}.json')).toBe('[')
    expect(globMetacharacterIn('{loc}/{locale}.json')).toBe('{')
  })

  it('leaves the tokens themselves alone', () => {
    expect(globMetacharacterIn(DEFAULT)).toBeNull()
    expect(globMetacharacterIn(SPLIT)).toBeNull()
    expect(globMetacharacterIn('locales/{sourceLocale}.meta.json')).toBeNull()
  })
})

describe('literalMatcher', () => {
  it('matches the token against one whole segment or stem', () => {
    const matcher = literalMatcher('locales/{sourceLocale}.meta.json')
    expect(matcher.test('locales/en.meta.json')).toBe(true)
    expect(matcher.test('locales/de-AT.meta.json')).toBe(true)
    expect(matcher.test('locales/en.json')).toBe(false)
    expect(matcher.test('locales/nested/en.meta.json')).toBe(false)
  })

  it('escapes the literal parts', () => {
    const matcher = literalMatcher('locales/loclizr.context.json')
    expect(matcher.test('locales/loclizr.context.json')).toBe(true)
    expect(matcher.test('locales/loclizrXcontext.json')).toBe(false)
  })
})

describe('substituteLocale', () => {
  it('fills both locale tokens and leaves {ns} alone', () => {
    expect(substituteLocale(DEFAULT, 'de')).toBe('locales/de.json')
    expect(substituteLocale('locales/{sourceLocale}.meta.json', 'en')).toBe('locales/en.meta.json')
    expect(substituteLocale(SPLIT, 'de')).toBe('public/locales/de/{ns}.json')
  })
})

describe('patternBase', () => {
  it('stops at the first segment carrying a token', () => {
    expect(patternBase(DEFAULT)).toBe('locales')
    expect(patternBase(SPLIT)).toBe('public/locales')
    expect(patternBase('i18n/{locale}/strings.json')).toBe('i18n')
  })

  it('has none where a catalog could sit anywhere in the project', () => {
    expect(patternBase('{locale}.json')).toBeNull()
    expect(patternBase('./{locale}.json')).toBeNull()
  })

  it('takes the whole directory part of a pattern with no token', () => {
    expect(patternBase('locales/all.json')).toBe('locales')
  })
})

describe('withNamespaceToken', () => {
  it('splits a per-locale file into a per-namespace directory', () => {
    expect(withNamespaceToken(DEFAULT)).toBe('locales/{locale}/{ns}.json')
    expect(withNamespaceToken('i18n/messages/{locale}.json')).toBe('i18n/messages/{locale}/{ns}.json')
  })

  it('names the namespace where the locale is already a directory', () => {
    expect(withNamespaceToken('i18n/{locale}/strings.json')).toBe('i18n/{locale}/{ns}.json')
  })

  it('has nothing to add to a pattern that already names a namespace', () => {
    expect(withNamespaceToken(SPLIT)).toBeNull()
  })

  it('leaves a pattern it cannot rewrite into a catalog path alone', () => {
    expect(withNamespaceToken('locales/{locale}.yaml')).toBeNull()
    expect(withNamespaceToken('locales/{sourceLocale}.json')).toBeNull()
  })
})
