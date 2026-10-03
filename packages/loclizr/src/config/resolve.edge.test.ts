import { describe, expect, it } from 'vitest'
import type { Config, Diagnostic, DiscoveredCatalog, LoclizrConfig } from '../types'
import { isLocaleTag } from './fields'
import { resolveConfig } from './resolve'
import type { LoadConfigResult } from './resolve'

const ROOT = '/project'

function catalog(
  locale: string,
  file = `locales/${locale}.json`,
  ns: string | null = null,
): DiscoveredCatalog {
  return { locale, ns, file }
}

function run(
  user: Readonly<Record<string, unknown>>,
  discovered: readonly DiscoveredCatalog[] = [catalog('en')],
): LoadConfigResult {
  return resolveConfig({ user: user as LoclizrConfig, root: ROOT, discovered })
}

function codes(diagnostics: readonly Diagnostic[]): readonly string[] {
  return diagnostics.map((diagnostic) => diagnostic.code)
}

function only(diagnostics: readonly Diagnostic[], code: string): Diagnostic {
  const found = diagnostics.filter((diagnostic) => diagnostic.code === code)
  expect(found).toHaveLength(1)
  return found[0] as Diagnostic
}

function config(result: LoadConfigResult): Config {
  expect(result.diagnostics.filter((diagnostic) => diagnostic.fatal)).toEqual([])
  expect(result.config).not.toBeNull()
  return result.config as Config
}

function rejected(result: LoadConfigResult, code: string): Diagnostic {
  expect(result.config).toBeNull()
  return only(result.diagnostics, code)
}

describe('absent versus explicitly undefined', () => {
  it('reads every top-level field set to undefined as absent', () => {
    const user = {
      locales: undefined,
      sourceLocale: undefined,
      catalogs: undefined,
      catalogFormat: undefined,
      i18nextMarkup: undefined,
      meta: undefined,
      outDir: undefined,
      record: undefined,
      cookie: undefined,
      augmentLocale: undefined,
      groups: undefined,
      identifiers: undefined,
      fallback: undefined,
      formats: undefined,
      scan: undefined,
      severity: undefined,
    }
    expect(run(user)).toEqual(run({}))
  })

  it('reads an undefined nested field as absent', () => {
    const resolved = config(
      run({
        formats: { timeZone: undefined, number: undefined, dateTime: undefined },
        scan: { include: undefined, exclude: undefined },
      }),
    )
    expect(resolved.formats).toEqual({ timeZone: null, number: {}, dateTime: {} })
    expect(resolved.scan).toEqual(config(run({})).scan)
  })

  it.each([
    ['locales'],
    ['sourceLocale'],
    ['catalogs'],
    ['meta'],
    ['outDir'],
    ['record'],
    ['cookie'],
    ['augmentLocale'],
    ['groups'],
    ['fallback'],
    ['formats'],
    ['scan'],
    ['severity'],
  ])('rejects %s set to null rather than reading it as absent', (field) => {
    expect(rejected(run({ [field]: null }), 'LZ1001').message).toContain(field)
  })
})

describe('empty and whitespace values', () => {
  it.each([['outDir'], ['cookie'], ['sourceLocale'], ['catalogs']])(
    'rejects an empty %s',
    (field) => {
      expect(rejected(run({ [field]: '' }), 'LZ1001').message).toContain(field)
    },
  )

  it('rejects an empty meta or record rather than switching the feature off', () => {
    expect(rejected(run({ meta: '' }), 'LZ1001').message).toContain('meta')
    expect(rejected(run({ record: '' }), 'LZ1001').message).toContain('record')
  })

  it('rejects an empty locale list', () => {
    expect(rejected(run({ locales: [] }), 'LZ1001').message).toContain('locales')
  })

  it('rejects an empty string inside the locale list', () => {
    expect(rejected(run({ locales: ['en', ''] }), 'LZ1001').message).toContain('locales')
  })

  it('rejects a whitespace-only catalogs pattern as carrying no locale token', () => {
    expect(rejected(run({ catalogs: '   ' }), 'LZ1001').message).toContain('{locale}')
  })

  it('rejects a whitespace-only cookie name', () => {
    expect(rejected(run({ cookie: ' ' }), 'LZ1001').message).toContain('cookie')
  })

  it('rejects an empty group prefix and an empty identifier', () => {
    expect(rejected(run({ groups: { errors: '' } }), 'LZ1001').message).toContain('groups')
    expect(rejected(run({ identifiers: { 'nav.home': '' } }), 'LZ1001').message).toContain(
      'identifiers',
    )
  })

  it('rejects an empty glob inside scan.include', () => {
    expect(rejected(run({ scan: { include: [''] } }), 'LZ1001').message).toContain('scan.include')
  })

  it('takes an empty scan.include as scanning nothing, and still excludes outDir', () => {
    const resolved = config(run({ scan: { include: [], exclude: [] } }))
    expect(resolved.scan).toEqual({ include: [], exclude: ['src/loclizr/**'] })
  })
})

describe('locale tags that only look like tags', () => {
  it.each([
    ['an emoji flag', '\u{1F1E9}\u{1F1EA}'],
    ['a lone surrogate', '\uD800'],
    ['a combining accent', 'én'],
    ['a trailing right-to-left mark', 'en‏'],
    ['a leading byte order mark', '﻿en'],
    ['an underscore separator', 'en_US'],
    ['a primary subtag of nine letters', 'abcdefghi'],
    ['a private use tag with no language', 'x-private'],
    ['a prototype name', '__proto__'],
    ['a constructor name', 'constructor'],
  ])('rejects %s as a declared locale', (_label, tag) => {
    const result = run({ locales: ['en', tag] })
    const diagnostic = rejected(result, 'LZ1002')
    expect(diagnostic.locale).toBe(tag)
    expect(diagnostic.fatal).toBe(true)
  })

  it('rejects a sourceLocale carrying a leading space even when it names a declared locale', () => {
    const diagnostic = rejected(run({ sourceLocale: ' en' }), 'LZ1002')
    expect(diagnostic.locale).toBe(' en')
  })

  it('keeps a tag with a Unicode extension verbatim and finds its base declared', () => {
    const result = run({ locales: ['en', 'en-u-ca-buddhist'] }, [
      catalog('en'),
      catalog('en-u-ca-buddhist'),
    ])
    expect(result.diagnostics).toEqual([])
    expect(config(result).locales).toEqual(['en', 'en-u-ca-buddhist'])
  })

  it('keeps a private use suffix verbatim', () => {
    const tag = 'zh-Hant-TW-x-abcdefgh'
    expect(isLocaleTag(tag)).toBe(true)
    const result = run({ locales: ['en', 'zh', tag] }, [catalog('en'), catalog('zh'), catalog(tag)])
    expect(config(result).locales).toEqual(['en', 'zh', tag])
  })

  it('treats two spellings of one tag as two declared locales, never folding case', () => {
    const result = run({ locales: ['en', 'EN'] })
    expect(config(result).locales).toEqual(['en', 'EN'])
    expect(only(result.diagnostics, 'LZ1005').locale).toBe('EN')
  })

  it('does not infer en from a catalog spelled EN', () => {
    const result = run({}, [catalog('EN'), catalog('de')])
    expect(result.config).toBeNull()
    expect(codes(result.diagnostics)).toEqual(['LZ1004'])
  })

  it('takes a lone EN catalog as the source locale verbatim', () => {
    expect(config(run({}, [catalog('EN')])).sourceLocale).toBe('EN')
  })

  it('accepts und, which Intl canonicalizes', () => {
    expect(config(run({ locales: ['en', 'und'] }, [catalog('en'), catalog('und')])).locales).toEqual(
      ['en', 'und'],
    )
  })
})

describe('the source locale against what is on disk', () => {
  it('reports a declared source locale that has no catalog, naming the file it looked for', () => {
    const result = run({ sourceLocale: 'en' }, [catalog('de')])
    expect(result.config).toBeNull()
    const diagnostic = only(result.diagnostics, 'LZ1004')
    expect(diagnostic.file).toBe('locales/en.json')
    expect(diagnostic.locale).toBe('en')
  })

  it('refuses a source locale that differs from the declared one only by case', () => {
    const result = run({ locales: ['en'], sourceLocale: 'EN' })
    expect(result.config).toBeNull()
    expect(result.diagnostics.every((diagnostic) => diagnostic.locale === 'EN')).toBe(true)
    expect(result.diagnostics.some((diagnostic) => diagnostic.fatal)).toBe(true)
  })

  it('names the undeclared source locale once the missing catalog is turned down', () => {
    const result = run({
      locales: ['en'],
      sourceLocale: 'EN',
      severity: { 'source-catalog-missing': 'off' },
    })
    expect(rejected(result, 'LZ1001').locale).toBe('EN')
  })
})

describe('prototype names in the maps the config hands over', () => {
  it('keeps a fallback key that is both a prototype method and a valid tag', () => {
    expect(isLocaleTag('toString')).toBe(true)
    const fallback = config(run({ fallback: { toString: ['en'] } })).fallback
    expect(fallback).toEqual({ toString: ['en'] })
  })

  it('drops a fallback key Intl rejects, constructor included', () => {
    const fallback = config(run({ fallback: { constructor: ['en'], de: ['en'] } })).fallback
    expect(fallback).toEqual({ de: ['en'] })
    expect(Object.getPrototypeOf(fallback)).toBeNull()
  })

  it('accepts an empty fallback chain', () => {
    expect(config(run({ fallback: { de: [] } })).fallback).toEqual({ de: [] })
  })

  it('rejects a fallback chain holding an empty tag', () => {
    expect(rejected(run({ fallback: { de: ['en', ''] } }), 'LZ1001').message).toContain(
      'fallback.de',
    )
  })

  it('rejects a fallback given as an array', () => {
    expect(rejected(run({ fallback: ['en'] }), 'LZ1001').message).toContain('fallback')
  })

  it('keeps a parsed __proto__ named style out of the style map and its prototype', () => {
    const number = JSON.parse('{"__proto__":{"notation":"compact"}}') as unknown
    const styles = config(run({ formats: { number } })).formats.number
    expect(Object.getPrototypeOf(styles)).toBeNull()
    expect(Object.keys(styles)).toEqual(['__proto__'])
  })

  it('never resolves a named style through the prototype', () => {
    const styles = config(run({ formats: { number: { compact: { notation: 'compact' } } } })).formats
      .number
    expect(styles['toString']).toBeUndefined()
  })

  it('rejects a severity entry named after a prototype method as an unknown rule', () => {
    expect(rejected(run({ severity: { toString: 'off' } }), 'LZ1001').message).toContain('toString')
  })
})

describe('severity spellings', () => {
  it('rejects a rule named by its code rather than its name', () => {
    expect(rejected(run({ severity: { LZ1003: 'warn' } }), 'LZ1001').message).toContain('LZ1003')
  })

  it.each([['Warn'], ['ERROR'], ['warning'], [' off'], [0], [false]])(
    'rejects the level %s',
    (level) => {
      const result = run({ severity: { 'no-catalogs-found': level } })
      expect(rejected(result, 'LZ1001').message).toContain('severity.no-catalogs-found')
    },
  )

  it('rejects a severity map given as an array', () => {
    expect(rejected(run({ severity: [['no-catalogs-found', 'off']] }), 'LZ1001').message).toContain(
      'severity',
    )
  })
})

describe('numbers at the limits inside a named style', () => {
  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['1e21', 1e21],
    ['MAX_SAFE_INTEGER', Number.MAX_SAFE_INTEGER],
    ['-1', -1],
  ])('rejects maximumFractionDigits %s, which Intl cannot build', (_label, digits) => {
    const result = run({ formats: { number: { x: { maximumFractionDigits: digits } } } })
    expect(rejected(result, 'LZ1001').message).toContain('formats.number.x')
  })

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ])('rejects hour12 %s, which Intl would coerce to a boolean and build', (_label, value) => {
    const result = run({ formats: { dateTime: { x: { hour: 'numeric', hour12: value } } } })
    expect(rejected(result, 'LZ1001').message).toBe(
      '`formats.dateTime.x.hour12` must be a finite number.',
    )
  })

  it.each([
    ['0', 0],
    ['-0', -0],
    ['100', 100],
  ])('accepts maximumFractionDigits %s', (_label, digits) => {
    const styles = config(run({ formats: { number: { x: { maximumFractionDigits: digits } } } }))
      .formats.number
    expect(styles['x']).toEqual({ maximumFractionDigits: digits })
  })

  it('rejects a nested object inside an option set', () => {
    const result = run({ formats: { dateTime: { x: { weekday: { long: true } } } } })
    expect(rejected(result, 'LZ1001').message).toContain('formats.dateTime.x')
  })

  it('rejects a style whose own time zone Intl refuses', () => {
    const result = run({ formats: { dateTime: { x: { timeZone: 'Mars/Olympus' } } } })
    expect(rejected(result, 'LZ1001').message).toContain('formats.dateTime.x')
  })

  it('reports every bad style in one pass and keeps none of them', () => {
    const result = run({
      formats: {
        number: { a: { style: 'nope' }, b: { notation: 'nope' } },
        dateTime: { c: { weekday: 'nope' } },
      },
    })
    expect(result.config).toBeNull()
    expect(codes(result.diagnostics)).toEqual(['LZ1001', 'LZ1001', 'LZ1001'])
  })
})

describe('formats.timeZone at the boundary', () => {
  it('rejects a zone carrying a leading space', () => {
    expect(rejected(run({ formats: { timeZone: ' UTC' } }), 'LZ1001').message).toContain(
      'formats.timeZone',
    )
  })

  it('rejects a zone that is not a string', () => {
    expect(rejected(run({ formats: { timeZone: 0 } }), 'LZ1001').message).toContain(
      'formats.timeZone',
    )
  })

  it('keeps an accepted zone verbatim rather than canonicalizing it', () => {
    expect(config(run({ formats: { timeZone: 'utc' } })).formats.timeZone).toBe('utc')
  })
})

describe('cookie names at the boundary', () => {
  it.each([['lócale'], ['\u{1F36A}'], ['a\tb'], ['a"b'], ['a/b'], ['a\\b'], ['(a)'], ['a\u0000b']])(
    'rejects %j',
    (cookie) => {
      expect(rejected(run({ cookie }), 'LZ1001').message).toContain('cookie')
    },
  )

  it('accepts a single character name', () => {
    expect(config(run({ cookie: 'l' })).cookie).toBe('l')
  })
})

describe('outDir at the boundary', () => {
  it('keeps a non-ASCII directory name as written', () => {
    expect(config(run({ outDir: 'src/ロケ' })).outDir).toBe('src/ロケ')
  })

  it('accepts an outDir whose name only starts with the record path', () => {
    const resolved = config(run({ outDir: 'src/loclizr', record: 'src/loclizr-ctx.json' }))
    expect(resolved.record).toBe('src/loclizr-ctx.json')
  })

  it('accepts a record whose name only starts with outDir', () => {
    const resolved = config(run({ outDir: 'locales/gen', record: 'locales/generated.ctx.json' }))
    expect(resolved.outDir).toBe('locales/gen')
  })

  it('rejects an outDir that is the record path itself', () => {
    const diagnostic = rejected(run({ outDir: 'src/ctx.json', record: 'src/ctx.json' }), 'LZ1001')
    expect(diagnostic.message).toContain('record')
  })

  it('rejects an outDir that holds a record spelled through a parent segment', () => {
    const result = run({ outDir: 'gen', record: 'locales/../gen/ctx.json' })
    expect(rejected(result, 'LZ1001').message).toContain('gen/ctx.json')
  })

  it('checks outDir safety before the shape of the paths it might swallow', () => {
    const result = run({ outDir: '..', record: '../ctx.json' })
    expect(result.config).toBeNull()
    expect(codes(result.diagnostics)).toEqual(['LZ1007'])
  })

  it('rejects an outDir escaping the root by a trailing parent segment', () => {
    expect(rejected(run({ outDir: 'src/loclizr/../../..' }), 'LZ1007').fatal).toBe(true)
  })

  it('accepts an outDir whose first segment only begins with two dots', () => {
    expect(config(run({ outDir: '..gen' })).outDir).toBe('..gen')
  })

  it('folds a scan.exclude entry that repeats outDir into one', () => {
    const resolved = config(run({ scan: { exclude: ['src/loclizr/**', 'a', 'a'] } }))
    expect(resolved.scan.exclude).toEqual(['src/loclizr/**', 'a'])
  })
})

describe('the root', () => {
  it('drops a trailing slash', () => {
    const resolved = resolveConfig({ user: {}, root: '/project/', discovered: [catalog('en')] })
    expect(config(resolved).root).toBe('/project')
  })

  it('normalizes a root spelled with a parent segment', () => {
    const resolved = resolveConfig({
      user: {},
      root: '/elsewhere/../project',
      discovered: [catalog('en')],
    })
    expect(config(resolved).root).toBe('/project')
  })
})

describe('catalogs patterns the reader can still use', () => {
  it('keeps a pattern that leaves the root as written', () => {
    const result = run({ catalogs: '../shared/{locale}.json' }, [
      catalog('en', '../shared/en.json'),
    ])
    expect(config(result).catalogs).toBe('../shared/{locale}.json')
  })

  it('keeps a namespace directory that comes before the locale', () => {
    const result = run({ catalogs: 'locales/{ns}/{locale}.json' }, [
      catalog('en', 'locales/common/en.json', 'common'),
    ])
    expect(config(result).catalogs).toBe('locales/{ns}/{locale}.json')
  })

  it.each([['!'], ['('], [')'], ['?'], [']']])(
    'names the glob character %s it found',
    (character) => {
      const result = run({ catalogs: `locales${character}/{locale}.json` })
      expect(rejected(result, 'LZ1001').message).toContain(`\`${character}\``)
    },
  )
})

describe('diagnostic order', () => {
  it('does not depend on the order the config spelled its fields', () => {
    const forward = run({ cookie: 'a b', catalogFormat: 'x', augmentLocale: 'yes', outDir: 7 })
    const backward = run({ outDir: 7, augmentLocale: 'yes', catalogFormat: 'x', cookie: 'a b' })
    expect(forward.diagnostics).toEqual(backward.diagnostics)
    expect(codes(forward.diagnostics)).toEqual(['LZ1001', 'LZ1001', 'LZ1001', 'LZ1001'])
  })

  it('resolves to the same answer twice', () => {
    const user = {
      locales: ['en', 'de-AT', 'fr'],
      fallback: { 'de-AT': ['de'] },
      formats: { timeZone: 'UTC', number: { b: { style: 'percent' }, a: { notation: 'compact' } } },
    }
    const discovered = [catalog('fr'), catalog('en'), catalog('de-AT')]
    expect(run(user, discovered)).toEqual(run(user, discovered))
  })

  it('keeps named styles in the order the config wrote them', () => {
    const styles = config(
      run({ formats: { number: { zeta: { style: 'percent' }, alpha: { notation: 'compact' } } } }),
    ).formats.number
    expect(Object.keys(styles)).toEqual(['zeta', 'alpha'])
  })
})

describe('very long input', () => {
  it('accepts a long declared locale list and keeps its order', () => {
    const regions = Array.from({ length: 200 }, (_unused, index) => `en-${String(index).padStart(3, '0')}`)
    const result = run({ locales: ['en', ...regions] })
    expect(config(result).locales).toHaveLength(201)
    expect(codes(result.diagnostics).filter((code) => code === 'LZ1005')).toHaveLength(200)
  })

  it('accepts a deep outDir', () => {
    const outDir = Array.from({ length: 64 }, () => 'd').join('/')
    expect(config(run({ outDir })).outDir).toBe(outDir)
  })
})
