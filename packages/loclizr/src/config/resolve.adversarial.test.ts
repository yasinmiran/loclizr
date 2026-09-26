import { describe, expect, it } from 'vitest'
import { RULES } from '../diagnostics'
import type { Config, Diagnostic, DiscoveredCatalog, LoclizrConfig, RuleName } from '../types'
import { resolveConfig } from './resolve'
import type { LoadConfigResult } from './resolve'

const ROOT = '/project'

const GATE_RULES: readonly RuleName[] = ['config-invalid', 'outdir-unsafe', 'output-unwritable']

const RELEVELABLE: readonly RuleName[] = (Object.keys(RULES) as readonly RuleName[]).filter(
  (rule) => !GATE_RULES.includes(rule),
)

function catalog(
  locale: string,
  file = `locales/${locale}.json`,
  ns: string | null = null,
): DiscoveredCatalog {
  return { locale, ns, file }
}

function run(user: LoclizrConfig, discovered: readonly DiscoveredCatalog[]): LoadConfigResult {
  return resolveConfig({ user, root: ROOT, discovered })
}

function loose(
  user: Readonly<Record<string, unknown>>,
  ...locales: readonly string[]
): LoadConfigResult {
  return run(
    user as LoclizrConfig,
    locales.map((locale) => catalog(locale)),
  )
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

describe('severity, the whole table', () => {
  it('accepts every rule outside the three that decide whether the tool can run', () => {
    const severity = Object.fromEntries(
      RELEVELABLE.map((rule) => [rule, 'off']),
    ) as LoclizrConfig['severity']
    const resolved = config(run({ severity }, [catalog('en')]))
    expect(Object.keys(resolved.severity)).toHaveLength(RELEVELABLE.length)
    expect(RELEVELABLE).toHaveLength(Object.keys(RULES).length - GATE_RULES.length)
  })

  it.each([['off'], ['warn'], ['error']])('refuses to re-level a gate rule to %s', (level) => {
    for (const rule of GATE_RULES) {
      const result = loose({ severity: { [rule]: level } }, 'en')
      expect(result.config).toBeNull()
      expect(only(result.diagnostics, 'LZ1001').message).toContain(rule)
    }
  })

  it.each([['toString'], ['constructor'], ['hasOwnProperty'], ['valueOf']])(
    'reads the prototype property %s as an unknown rule name',
    (name) => {
      const result = loose({ severity: { [name]: 'off' } }, 'en')
      expect(result.config).toBeNull()
      expect(only(result.diagnostics, 'LZ1001').message).toContain(name)
    },
  )

  it('reports a parsed __proto__ entry rather than carrying it into the overrides', () => {
    const severity = JSON.parse('{"__proto__":"off"}') as Readonly<Record<string, string>>
    const result = loose({ severity }, 'en')
    expect(result.config).toBeNull()
    expect(only(result.diagnostics, 'LZ1001').message).toContain('__proto__')
  })
})

describe('maps the config file can hand over', () => {
  it('keeps a parsed __proto__ entry out of the fallback map and its prototype', () => {
    const fallback = JSON.parse('{"__proto__":["no"],"nb":["no"]}') as Readonly<
      Record<string, readonly string[]>
    >
    const resolved = config(run({ fallback }, [catalog('en')]))
    expect(resolved.fallback).not.toBe('bcp47')
    expect(Array.isArray(Object.getPrototypeOf(resolved.fallback))).toBe(false)
    expect(resolved.fallback).toEqual({ nb: ['no'] })
  })

  it('rejects a scalar where a path or false belongs', () => {
    for (const [user, field] of [
      [{ meta: true }, 'meta'],
      [{ record: 0 }, 'record'],
      [{ outDir: '' }, 'outDir'],
      [{ augmentLocale: 'false' }, 'augmentLocale'],
    ] as const) {
      const result = loose(user, 'en')
      expect(result.config).toBeNull()
      expect(only(result.diagnostics, 'LZ1001').message).toContain(field)
    }
  })

  it('rejects a locales field that is not a list of tags', () => {
    for (const locales of ['en', ['en', 7], [['en']], [''], {}]) {
      const result = loose({ locales }, 'en')
      expect(result.config).toBeNull()
      expect(only(result.diagnostics, 'LZ1001').message).toContain('locales')
    }
  })
})

describe('locale tags at the boundary', () => {
  it('rejects a tag carrying stray whitespace rather than taking it as a locale', () => {
    const result = run({ locales: ['en', ' de'] }, [catalog('en'), catalog('de')])
    expect(result.config).toBeNull()
    const diagnostic = only(result.diagnostics, 'LZ1002')
    expect(diagnostic.fatal).toBe(true)
    expect(diagnostic.locale).toBe(' de')
  })

  it('stays fatal for a declared tag Intl rejects even when its catalog is on disk', () => {
    const result = run({ locales: ['en', '123'] }, [catalog('en'), catalog('123', 'locales/123.json')])
    expect(result.config).toBeNull()
    const diagnostic = only(result.diagnostics, 'LZ1002')
    expect(diagnostic.fatal).toBe(true)
    expect(diagnostic.locale).toBe('123')
  })

  it('warns about the missing base tag even when a fallback chain names it', () => {
    const result = run({ locales: ['en', 'de-AT'], fallback: { 'de-AT': ['de'] } }, [
      catalog('en'),
      catalog('de-AT'),
    ])
    const diagnostic = only(result.diagnostics, 'LZ1018')
    expect(diagnostic.locale).toBe('de-AT')
    expect(config(result).fallback).toEqual({ 'de-AT': ['de'] })
  })
})

describe('paths the config file spells its own way', () => {
  it.each([
    ['src/gen/', 'src/gen'],
    ['./src/./gen', 'src/gen'],
    ['src\\gen', 'src/gen'],
    ['src/a/../gen', 'src/gen'],
    ['/project/src/gen', 'src/gen'],
  ])('normalizes outDir %s to %s', (given, expected) => {
    expect(config(run({ outDir: given }, [catalog('en')])).outDir).toBe(expected)
  })

  it.each([['src/../../escape'], ['locales/../..'], ['/'], ['../../..'], ['\\']])(
    'rejects outDir %s as unsafe',
    (outDir) => {
      const result = run({ outDir }, [catalog('en')])
      expect(result.config).toBeNull()
      expect(codes(result.diagnostics)).toEqual(['LZ1007'])
    },
  )

  it('normalizes every path field to POSIX and leaves the tokens unsubstituted', () => {
    const resolved = config(
      run(
        {
          outDir: 'src\\gen',
          catalogs: 'locales\\{locale}.json',
          meta: './locales/./{sourceLocale}.meta.json',
          record: 'locales//ctx.json',
        },
        [catalog('en')],
      ),
    )
    expect(resolved.catalogs).toBe('locales/{locale}.json')
    expect(resolved.meta).toBe('locales/{sourceLocale}.meta.json')
    expect(resolved.record).toBe('locales/ctx.json')
    expect(resolved.outDir).toBe('src/gen')
    expect(resolved.scan.exclude).toContain('src/gen/**')
  })

  it.each([
    ['locales/{ns}.json'],
    ['{sourceLocale}/{locale}.json'],
    ['locales/{locale}/{ns}/{ns}.json'],
  ])('rejects the catalogs pattern %s', (catalogs) => {
    const result = loose({ catalogs }, 'en')
    expect(result.config).toBeNull()
    expect(only(result.diagnostics, 'LZ1001').message).toContain('catalogs')
  })

  it('names the missing catalog with the locale filled in and the namespace left alone', () => {
    const result = run({ catalogs: 'public/locales/{locale}/{ns}.json', locales: ['en', 'de'] }, [
      catalog('en', 'public/locales/en/common.json', 'common'),
    ])
    expect(only(result.diagnostics, 'LZ1005').file).toBe('public/locales/de/{ns}.json')
  })
})

describe('a fatal rule the user turned down', () => {
  function resolved(result: LoadConfigResult): Config {
    expect(result.config).not.toBeNull()
    return result.config as Config
  }

  it('keeps stamping the default severity, so M10 is still the one that re-levels', () => {
    const result = run({ locales: ['en'], severity: { 'no-catalogs-found': 'warn' } }, [])
    const diagnostic = only(result.diagnostics, 'LZ1003')
    expect(diagnostic.severity).toBe('error')
    expect(diagnostic.fatal).toBe(true)
  })

  it('resolves against declared locales with nothing on disk yet', () => {
    const result = run({ locales: ['en', 'de'], severity: { 'no-catalogs-found': 'off' } }, [])
    const built = resolved(result)
    expect(built.locales).toEqual(['en', 'de'])
    expect(built.sourceLocale).toBe('en')
    expect(codes(result.diagnostics)).toEqual(['LZ1003', 'LZ1005', 'LZ1005'])
  })

  it('says the empty tree once rather than stacking the source catalog on top of it', () => {
    const result = run({ severity: { 'no-catalogs-found': 'off' } }, [])
    expect(result.config).toBeNull()
    expect(codes(result.diagnostics)).toEqual(['LZ1003'])
  })

  it('drops the tag no formatter could be built for and keeps the rest', () => {
    const result = run({ locales: ['en', 'not a locale'], severity: { 'locale-tag-invalid': 'warn' } }, [
      catalog('en'),
    ])
    expect(resolved(result).locales).toEqual(['en'])
    expect(codes(result.diagnostics)).toEqual(['LZ1002'])
  })

  it('infers a source locale from the first declared one once the rule is off', () => {
    const result = run({ severity: { 'source-catalog-missing': 'off' } }, [
      catalog('de'),
      catalog('fr'),
    ])
    expect(resolved(result).sourceLocale).toBe('de')
    expect(codes(result.diagnostics)).toEqual(['LZ1004'])
  })

  it('still refuses a sourceLocale the locale list does not declare, which is not re-levelable', () => {
    const result = run(
      { locales: ['de'], sourceLocale: 'fr', severity: { 'source-catalog-missing': 'off' } },
      [catalog('de'), catalog('fr')],
    )
    expect(result.config).toBeNull()
    expect(only(result.diagnostics, 'LZ1001').locale).toBe('fr')
  })

  it.each([[{}], [{ severity: { 'no-catalogs-found': 'error' } }]])(
    'blocks exactly as before under %o',
    (user) => {
      const result = run({ ...user, locales: ['en', 'de'] } as LoclizrConfig, [])
      expect(result.config).toBeNull()
      expect(codes(result.diagnostics)).toEqual(['LZ1003'])
    },
  )
})

describe('a discovered basename no language uses', () => {
  it('warns before the paste-ready block can declare it forever', () => {
    const result = run({}, [catalog('de'), catalog('settings')])
    expect(result.config).toBeNull()
    const undeclared = only(result.diagnostics, 'LZ1006')
    expect(undeclared.file).toBe('locales/settings.json')
    expect(undeclared.locale).toBe('settings')
    expect(undeclared.severity).toBe('warn')
    expect(undeclared.fatal).toBe(false)
  })

  it('shows every locale beside the file it came from, so the junk entry is visible', () => {
    const result = run({}, [catalog('de'), catalog('settings')])
    const hint = only(result.diagnostics, 'LZ1004').hint ?? ''
    expect(hint).toContain("'de',        // locales/de.json")
    expect(hint).toContain("'settings',  // locales/settings.json")
  })

  it.each([['shared'], ['defaults'], ['fallback'], ['index']])(
    'catches %s, which Intl canonicalizes without complaint',
    (name) => {
      const result = run({}, [catalog('en'), catalog(name)])
      expect(only(result.diagnostics, 'LZ1006').locale).toBe(name)
      expect(config(result).locales).toEqual(['en', name].sort())
    },
  )

  it.each([['en'], ['de-AT'], ['fra'], ['zh-Hans']])('leaves the real tag %s alone', (tag) => {
    const result = run({}, [catalog('en'), catalog(tag)])
    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'LZ1006')).toEqual([])
  })

  it('says nothing where the user declared the locale list themselves', () => {
    const result = run({ locales: ['en', 'shared'] }, [catalog('en'), catalog('shared')])
    expect(result.diagnostics).toEqual([])
    expect(config(result).locales).toEqual(['en', 'shared'])
  })
})

describe('every rejected field carries a line to paste', () => {
  it.each([
    [{ locales: 7 }, "locales: ['en', 'de']"],
    [{ groups: { errors: 7 } }, "groups: { errors: 'errors' }"],
    [{ identifiers: 7 }, "identifiers: { 'nav.home': 'navHome' }"],
    [{ fallback: 7 }, "fallback: { nb: ['no'] }"],
    [{ sourceLocale: 7 }, "sourceLocale: 'en'"],
    [{ outDir: 7 }, "outDir: 'src/loclizr'"],
    [{ cookie: 7 }, "cookie: 'locale'"],
    [{ meta: 7 }, 'meta:'],
    [{ record: 7 }, 'record:'],
    [{ augmentLocale: 'yes' }, 'augmentLocale: false'],
    [{ catalogFormat: 'yaml' }, "catalogFormat: 'auto'"],
    [{ i18nextMarkup: 'html' }, "i18nextMarkup: 'literal'"],
    [{ severity: 7 }, "severity: { 'ambiguous-source': 'error' }"],
    [{ severity: { 'missing-translation': 'loud' } }, "severity: { 'missing-translation': 'warn' }"],
    [{ scan: 7 }, 'scan:'],
    [{ scan: { include: 7 } }, "scan: { include: ['src/**/*.{ts,tsx}'] }"],
    [{ scan: { exclude: 7 } }, "scan: { exclude: ['**/legacy/**'] }"],
    [{ formats: 7 }, "formats: { timeZone: 'UTC' }"],
    [{ formats: { timeZone: 7 } }, "formats: { timeZone: 'UTC' }"],
    [{ formats: { number: 7 } }, 'formats: { number:'],
    [{ formats: { number: { compact: 7 } } }, 'formats: { number:'],
    [{ formats: { dateTime: 7 } }, 'formats: { dateTime:'],
    [{ fallback: { nb: 7 } }, "fallback: { 'nb': ['en'] }"],
  ] as const)('names the field and shows the shape for %o', (user, example) => {
    const hints = loose(user, 'en')
      .diagnostics.filter((diagnostic) => diagnostic.code === 'LZ1001')
      .map((diagnostic) => diagnostic.hint ?? '')
    expect(hints.some((hint) => hint.includes(example))).toBe(true)
  })
})

describe('determinism', () => {
  it('resolves one answer whatever order a split layout was discovered in', () => {
    const found = [
      catalog('en', 'locales/en/common.json', 'common'),
      catalog('en', 'locales/en/errors.json', 'errors'),
      catalog('de', 'locales/de/common.json', 'common'),
      catalog('123', 'locales/123/common.json', 'common'),
      catalog('fr', 'locales/fr/common.json', 'common'),
    ]
    const user: LoclizrConfig = {
      catalogs: 'locales/{locale}/{ns}.json',
      locales: ['en', 'de', 'de-AT'],
    }
    const forward = run(user, found)
    const backward = run(user, [...found].reverse())
    expect(backward).toEqual(forward)
    expect(codes(forward.diagnostics)).toEqual(['LZ1006', 'LZ1005', 'LZ1006'])
  })

  it('leaves the discovered list it was handed untouched', () => {
    const found = [catalog('fr'), catalog('en'), catalog('de')]
    const before = found.map((entry) => entry.file)
    run({}, found)
    expect(found.map((entry) => entry.file)).toEqual(before)
  })
})
