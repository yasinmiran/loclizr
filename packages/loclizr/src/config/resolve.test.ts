import { describe, expect, it } from 'vitest'
import type { Config, Diagnostic, DiscoveredCatalog, LoclizrConfig } from '../types'
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

function run(user: LoclizrConfig, discovered: readonly DiscoveredCatalog[]): LoadConfigResult {
  return resolveConfig({ user, root: ROOT, discovered })
}

function loose(user: Readonly<Record<string, unknown>>, ...locales: readonly string[]): LoadConfigResult {
  return run(user as LoclizrConfig, locales.map((locale) => catalog(locale)))
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
  expect(result.config).not.toBeNull()
  return result.config as Config
}

describe('defaults', () => {
  it('fills every field from one discovered source catalog', () => {
    const result = run({}, [catalog('en')])
    expect(result.diagnostics).toEqual([])
    expect(result.config).toEqual({
      root: ROOT,
      locales: ['en'],
      sourceLocale: 'en',
      catalogs: 'locales/{locale}.json',
      catalogFormat: 'auto',
      i18nextMarkup: 'literal',
      meta: 'locales/{sourceLocale}.meta.json',
      outDir: 'src/loclizr',
      record: 'locales/loclizr.context.json',
      cookie: 'locale',
      augmentLocale: true,
      groups: {},
      identifiers: {},
      fallback: 'bcp47',
      formats: { timeZone: null, number: {}, dateTime: {} },
      scan: {
        include: ['src/**/*.{ts,tsx,js,jsx,mts,mjs,svelte,vue,astro}'],
        exclude: ['**/node_modules/**', '**/dist/**', 'src/loclizr/**'],
      },
      severity: {},
    })
  })

  it('takes every discovered locale, sorted, when locales is unset', () => {
    const result = run({}, [catalog('de-AT'), catalog('en'), catalog('de')])
    expect(config(result).locales).toEqual(['de', 'de-AT', 'en'])
  })

  it('keeps the declared locale list verbatim, deduplicated', () => {
    const result = run({ locales: ['en', 'de', 'en'] }, [catalog('en'), catalog('de')])
    expect(config(result).locales).toEqual(['en', 'de'])
  })
})

describe('catalogFormat', () => {
  it('defaults to auto', () => {
    expect(config(run({}, [catalog('en')])).catalogFormat).toBe('auto')
  })

  it('accepts the two forcing values', () => {
    expect(config(run({ catalogFormat: 'icu' }, [catalog('en')])).catalogFormat).toBe('icu')
    expect(config(run({ catalogFormat: 'i18next' }, [catalog('en')])).catalogFormat).toBe('i18next')
  })

  it('rejects anything else as config-invalid', () => {
    const result = loose({ catalogFormat: 'guess' }, 'en')
    expect(result.config).toBeNull()
    expect(only(result.diagnostics, 'LZ1001').message).toContain('catalogFormat')
  })
})

describe('fields the rest of the compiler reads', () => {
  it('carries groups, identifiers, markup and a fallback map through', () => {
    const resolved = config(
      run(
        {
          locales: ['en', 'nb'],
          i18nextMarkup: 'tags',
          groups: { errors: 'errors' },
          identifiers: { 'nav.home': 'navHome' },
          fallback: { nb: ['no'] },
        },
        [catalog('en'), catalog('nb')],
      ),
    )
    expect(resolved.i18nextMarkup).toBe('tags')
    expect(resolved.groups).toEqual({ errors: 'errors' })
    expect(resolved.identifiers).toEqual({ 'nav.home': 'navHome' })
    expect(resolved.fallback).toEqual({ nb: ['no'] })
  })

  it('carries named format styles and the time zone through', () => {
    const resolved = config(
      run(
        {
          formats: {
            timeZone: 'UTC',
            number: { compact: { notation: 'compact', maximumFractionDigits: 1 } },
          },
        },
        [catalog('en')],
      ),
    )
    expect(resolved.formats).toEqual({
      timeZone: 'UTC',
      number: { compact: { notation: 'compact', maximumFractionDigits: 1 } },
      dateTime: {},
    })
  })

  it('rejects a format style that is not an object of Intl options', () => {
    const result = loose({ formats: { number: { compact: 'compact' } } }, 'en')
    expect(result.config).toBeNull()
    expect(only(result.diagnostics, 'LZ1001').message).toContain('formats.number.compact')
  })

  it('rejects a fallback chain that is not a list of tags', () => {
    const result = loose({ fallback: { nb: 'no' } }, 'en')
    expect(result.config).toBeNull()
    expect(only(result.diagnostics, 'LZ1001').message).toContain('fallback.nb')
  })

  it('drops a fallback key no formatter could ever name', () => {
    const resolved = config(run({ fallback: { nb_NO: ['no'], nb: ['no'] } }, [catalog('en')]))
    expect(resolved.fallback).toEqual({ nb: ['no'] })
  })
})

describe('formats nothing downstream can validate', () => {
  it('rejects an option set Intl cannot build, naming the style', () => {
    for (const [formats, field] of [
      [{ timeZone: 'UTC+2' }, 'formats.timeZone'],
      [{ number: { compact: { notation: 'compacted' } } }, 'formats.number.compact'],
      [{ number: { money: { style: 'currency' } } }, 'formats.number.money'],
      [{ dateTime: { day: { dateStyle: 'medium', weekday: 'long' } } }, 'formats.dateTime.day'],
    ] as const) {
      const result = loose({ formats }, 'en')
      expect(result.config).toBeNull()
      expect(only(result.diagnostics, 'LZ1001').message).toContain(field)
    }
  })

  it('hands the reason Intl gave to the user as the hint', () => {
    const result = loose({ formats: { timeZone: 'Mars/Olympus' } }, 'en')
    expect(only(result.diagnostics, 'LZ1001').hint).toContain('time zone')
  })

  it('accepts a zone and named styles Intl can build', () => {
    const resolved = config(
      run(
        {
          formats: {
            timeZone: 'Europe/Oslo',
            number: { compact: { notation: 'compact', maximumFractionDigits: 1 } },
            dateTime: { weekday: { weekday: 'long', month: 'long', day: 'numeric' } },
          },
        },
        [catalog('en')],
      ),
    )
    expect(resolved.formats.timeZone).toBe('Europe/Oslo')
    expect(resolved.formats.dateTime).toEqual({
      weekday: { weekday: 'long', month: 'long', day: 'numeric' },
    })
  })
})

describe('the cookie name has to survive a round trip', () => {
  it('rejects a name a document.cookie write would not read back', () => {
    for (const cookie of ['app locale', 'locale=de', 'locale;path=/', 'locale,lang', 'lo"cale']) {
      const result = loose({ cookie }, 'en')
      expect(result.config).toBeNull()
      expect(only(result.diagnostics, 'LZ1001').message).toContain('cookie')
    }
  })

  it('accepts the punctuation the token grammar allows', () => {
    for (const cookie of ['locale', 'locale-v2', '_lang', 'app.locale', 'i18n!next']) {
      expect(config(run({ cookie }, [catalog('en')])).cookie).toBe(cookie)
    }
  })
})

describe('path normalization', () => {
  it('normalizes every path-valued field to POSIX relative to root', () => {
    const resolved = config(
      run({ outDir: './src/generated/', catalogs: './locales/{locale}.json' }, [catalog('en')]),
    )
    expect(resolved.outDir).toBe('src/generated')
    expect(resolved.catalogs).toBe('locales/{locale}.json')
  })

  it('leaves every token unsubstituted', () => {
    const resolved = config(
      run({ catalogs: 'public/locales/{locale}/{ns}.json' }, [
        catalog('en', 'public/locales/en/common.json', 'common'),
      ]),
    )
    expect(resolved.catalogs).toBe('public/locales/{locale}/{ns}.json')
    expect(resolved.meta).toBe('locales/{sourceLocale}.meta.json')
  })

  it('carries meta and record false through', () => {
    const resolved = config(run({ meta: false, record: false }, [catalog('en')]))
    expect(resolved.meta).toBe(false)
    expect(resolved.record).toBe(false)
  })

  it('always excludes outDir from the scan', () => {
    const resolved = config(
      run({ outDir: 'app/gen', scan: { exclude: ['**/vendor/**'] } }, [catalog('en')]),
    )
    expect(resolved.scan.exclude).toEqual(['**/vendor/**', 'app/gen/**'])
  })
})

describe('LZ1007 outdir-unsafe', () => {
  it.each([['../elsewhere'], ['..'], ['/etc'], ['.'], ['src/../..']])(
    'rejects outDir %s',
    (outDir) => {
      const result = run({ outDir }, [catalog('en')])
      expect(result.config).toBeNull()
      expect(codes(result.diagnostics)).toEqual(['LZ1007'])
      expect(result.diagnostics[0]?.fatal).toBe(true)
    },
  )

  it.each([['.'], ['src/..']])('names the root itself when outDir %s resolves to it', (outDir) => {
    const diagnostic = only(run({ outDir }, [catalog('en')]).diagnostics, 'LZ1007')
    expect(diagnostic.message).toBe('`outDir` resolves to the project root /project itself.')
    expect(diagnostic.hint).toContain('inside the project')
  })

  it('accepts a directory deep inside the root', () => {
    expect(config(run({ outDir: 'packages/app/src/loclizr' }, [catalog('en')])).outDir).toBe(
      'packages/app/src/loclizr',
    )
  })
})

describe('an outDir that would swallow the catalogs it was built from', () => {
  it('rejects the catalogs, meta and record paths landing inside it', () => {
    const result = run({ outDir: 'locales' }, [catalog('en')])
    expect(result.config).toBeNull()
    expect(codes(result.diagnostics)).toEqual(['LZ1001', 'LZ1001', 'LZ1001'])
    expect(result.diagnostics[0]?.message).toContain('catalogs')
    expect(result.diagnostics[1]?.message).toContain('meta')
    expect(result.diagnostics[2]?.message).toContain('record')
  })

  it('rejects a record the user pointed inside outDir', () => {
    const result = run({ outDir: 'src/gen', record: 'src/gen/context.json', meta: false }, [
      catalog('en'),
    ])
    expect(result.config).toBeNull()
    expect(only(result.diagnostics, 'LZ1001').message).toContain('src/gen/context.json')
  })

  it('rejects an outDir over the catalogs even with neither artifact landing there', () => {
    const result = run({ outDir: 'locales', meta: false, record: false }, [catalog('en')])
    expect(result.config).toBeNull()
    expect(only(result.diagnostics, 'LZ1001').message).toBe(
      '`outDir` is `locales`, which holds the `catalogs` path `locales/{locale}.json`.',
    )
  })

  it('rejects an outDir that one locale of a split layout would sit inside', () => {
    const result = run(
      { outDir: 'locales/en', catalogs: 'locales/{locale}/{ns}.json', meta: false, record: false },
      [catalog('en', 'locales/en/common.json', 'common')],
    )
    expect(only(result.diagnostics, 'LZ1001').message).toContain('catalogs')
  })

  it('rejects an outDir above the catalog directory', () => {
    const result = run(
      { outDir: 'src', catalogs: 'src/locales/{locale}.json', meta: false, record: false },
      [catalog('en', 'src/locales/en.json')],
    )
    expect(only(result.diagnostics, 'LZ1001').message).toContain('catalogs')
  })

  it('accepts an outDir beside the catalogs that no catalog path can reach', () => {
    expect(config(run({ outDir: 'locales/en' }, [catalog('en')])).outDir).toBe('locales/en')
  })

  it('substitutes the source locale before asking whether outDir holds meta or record', () => {
    for (const field of ['meta', 'record']) {
      const result = run({ outDir: 'locales/en', [field]: 'locales/{sourceLocale}/file.json' }, [
        catalog('en'),
      ])
      expect(result.config).toBeNull()
      expect(only(result.diagnostics, 'LZ1001').message).toBe(
        `\`outDir\` is \`locales/en\`, which holds the resolved \`${field}\` path \`locales/en/file.json\`.`,
      )
    }
  })

  it('substitutes a declared source locale before reading the catalogs on disk', () => {
    const result = run(
      { outDir: 'locales/fr', sourceLocale: 'fr', meta: 'locales/{sourceLocale}/meta.json' },
      [],
    )
    expect(codes(result.diagnostics)).toEqual(['LZ1001'])
  })

  it('substitutes the inferred source locale when the declared one is dropped as invalid', () => {
    const result = run(
      {
        sourceLocale: 'en_US',
        locales: ['en'],
        outDir: 'locales/en',
        meta: 'locales/{sourceLocale}/m.json',
        severity: { 'locale-tag-invalid': 'warn' },
      },
      [catalog('en')],
    )
    expect(result.config).toBeNull()
    expect(codes(result.diagnostics)).toEqual(['LZ1002', 'LZ1001'])
    expect(result.diagnostics[1]?.message).toContain('locales/en/m.json')
  })

  it('never substitutes a declared source locale that is not a valid tag', () => {
    const result = run(
      { sourceLocale: 'en_US', outDir: 'locales/en_US', meta: 'locales/{sourceLocale}/m.json' },
      [catalog('en')],
    )
    expect(codes(result.diagnostics)).toEqual(['LZ1002'])
  })

  it('leaves an outDir alone that is named after another locale than the source', () => {
    const resolved = config(
      run({ outDir: 'locales/de', meta: 'locales/{sourceLocale}/meta.json' }, [catalog('en')]),
    )
    expect(resolved.meta).toBe('locales/{sourceLocale}/meta.json')
  })

  it('compares without case, since macOS and Windows resolve both spellings to one directory', () => {
    for (const outDir of ['Locales', 'LOCALES']) {
      const result = run({ outDir }, [catalog('en')])
      expect(result.config).toBeNull()
      expect(codes(result.diagnostics)).toEqual(['LZ1001', 'LZ1001', 'LZ1001'])
    }
  })
})

describe('a meta or record path the catalogs pattern reads as a catalog', () => {
  it('rejects a record named like a catalog, which the build would write over', () => {
    const result = run({ record: 'locales/de.json' }, [catalog('en'), catalog('de')])
    expect(result.config).toBeNull()
    const diagnostic = only(result.diagnostics, 'LZ1001')
    expect(diagnostic.message).toBe(
      '`record` is `locales/de.json`, which the `catalogs` pattern `locales/{locale}.json` also matches.',
    )
    expect(diagnostic.hint).toContain('locales/loclizr.context.json')
  })

  it('rejects it whether or not the catalog exists yet', () => {
    expect(codes(run({ record: 'locales/de.json' }, [catalog('en')]).diagnostics)).toEqual([
      'LZ1001',
    ])
  })

  it('rejects a meta path that resolves onto a catalog once the source locale is known', () => {
    const result = run({ meta: 'locales/{sourceLocale}-meta.json' }, [catalog('en')])
    expect(result.config).toBeNull()
    expect(only(result.diagnostics, 'LZ1001').message).toContain('locales/en-meta.json')
  })

  it('rejects a spelling that differs from a catalog only by case', () => {
    expect(codes(run({ record: 'Locales/de.json' }, [catalog('en')]).diagnostics)).toEqual([
      'LZ1001',
    ])
  })

  it('accepts the default meta and record, which no locale token can spell', () => {
    expect(run({}, [catalog('en')]).diagnostics).toEqual([])
  })
})

describe('LZ1001 config-invalid', () => {
  it('reports one diagnostic per malformed field and resolves nothing', () => {
    const result = loose({ locales: [], cookie: 7, augmentLocale: 'yes', fallback: 3 }, 'en')
    expect(result.config).toBeNull()
    expect(codes(result.diagnostics)).toEqual(['LZ1001', 'LZ1001', 'LZ1001', 'LZ1001'])
    expect(result.diagnostics.every((diagnostic) => diagnostic.fatal)).toBe(true)
  })

  it('rejects a catalogs pattern it cannot expand', () => {
    for (const catalogs of [
      'locales/all.json',
      '{locale}/{locale}.json',
      'locales/{sourceLocale}.json',
      '{ns}/{ns}/{locale}.json',
    ]) {
      const result = loose({ catalogs }, 'en')
      expect(result.config).toBeNull()
      expect(only(result.diagnostics, 'LZ1001').message).toContain('catalogs')
    }
  })

  it('rejects a catalogs pattern carrying a glob character, naming it', () => {
    for (const [catalogs, character] of [
      ['locales/*/{locale}.json', '*'],
      ['**/{locale}.json', '*'],
      ['{loc}/{locale}.json', '{'],
      ['locales/[a-z]/{locale}.json', '['],
      ['locales/{locale}?.json', '?'],
    ] as const) {
      const result = loose({ catalogs }, 'en')
      expect(result.config).toBeNull()
      const diagnostic = only(result.diagnostics, 'LZ1001')
      expect(diagnostic.message).toContain('catalogs')
      expect(diagnostic.message).toContain(character)
    }
  })

  it('accepts one {ns} token beside the locale', () => {
    expect(
      config(
        run({ catalogs: 'public/locales/{locale}/{ns}.json' }, [
          catalog('en', 'public/locales/en/common.json', 'common'),
        ]),
      ).catalogs,
    ).toBe('public/locales/{locale}/{ns}.json')
  })

  it.each([['config-invalid'], ['outdir-unsafe'], ['output-unwritable']])(
    'refuses to re-level %s',
    (rule) => {
      const result = loose({ severity: { [rule]: 'off' } }, 'en')
      expect(result.config).toBeNull()
      const diagnostic = only(result.diagnostics, 'LZ1001')
      expect(diagnostic.message).toContain(rule)
    },
  )

  it('rejects an unknown rule name and an unknown level', () => {
    expect(codes(loose({ severity: { 'no-such-rule': 'off' } }, 'en').diagnostics)).toEqual([
      'LZ1001',
    ])
    expect(codes(loose({ severity: { 'missing-translation': 'loud' } }, 'en').diagnostics)).toEqual([
      'LZ1001',
    ])
  })

  it('keeps a legitimate re-level', () => {
    const resolved = config(
      run({ severity: { 'ambiguous-source': 'error', 'unused-message': 'warn' } }, [catalog('en')]),
    )
    expect(resolved.severity).toEqual({ 'ambiguous-source': 'error', 'unused-message': 'warn' })
  })

  it('rejects a sourceLocale the locale list does not declare', () => {
    const result = run({ locales: ['de'], sourceLocale: 'en' }, [catalog('en'), catalog('de')])
    expect(result.config).toBeNull()
    expect(only(result.diagnostics, 'LZ1001').message).toContain('sourceLocale')
  })

  it('rejects an undeclared sourceLocale the same way when its catalog is missing too', () => {
    const result = run({ locales: ['en', 'de'], sourceLocale: 'fr' }, [catalog('en')])
    expect(result.config).toBeNull()
    expect(codes(result.diagnostics)).toEqual(['LZ1001'])
    expect(result.diagnostics[0]?.locale).toBe('fr')
  })
})

describe('LZ1003 no-catalogs-found', () => {
  it('fires when the pattern matched nothing', () => {
    const result = run({}, [])
    expect(result.config).toBeNull()
    expect(codes(result.diagnostics)).toEqual(['LZ1003'])
    expect(result.diagnostics[0]?.fatal).toBe(true)
  })

  it('names the pattern and never the machine it ran on', () => {
    const diagnostic = only(run({}, []).diagnostics, 'LZ1003')
    expect(diagnostic.message).toContain('locales/{locale}.json')
    expect(diagnostic.message).not.toContain(ROOT)
  })

  it('fires when every match was the meta sidecar or the record', () => {
    const result = run({}, [
      catalog('en.meta', 'locales/en.meta.json'),
      catalog('loclizr.context', 'locales/loclizr.context.json'),
    ])
    expect(codes(result.diagnostics)).toEqual(['LZ1003'])
  })
})

describe('LZ1002 locale-tag-invalid', () => {
  it('is fatal for a declared locale Intl rejects', () => {
    const result = run({ locales: ['en', 'not a locale'] }, [catalog('en')])
    expect(result.config).toBeNull()
    const diagnostic = only(result.diagnostics, 'LZ1002')
    expect(diagnostic.fatal).toBe(true)
    expect(diagnostic.locale).toBe('not a locale')
  })

  it('is fatal for an invalid sourceLocale', () => {
    const result = run({ sourceLocale: 'en.meta' }, [catalog('en')])
    expect(result.config).toBeNull()
    expect(only(result.diagnostics, 'LZ1002').locale).toBe('en.meta')
  })

  it('reports one mistake once when the source locale is the invalid declared one', () => {
    const result = run({ locales: ['en', 'sp!'], sourceLocale: 'sp!' }, [catalog('en')])
    expect(result.config).toBeNull()
    expect(codes(result.diagnostics)).toEqual(['LZ1002'])
  })

  it('accepts a tag Intl canonicalizes and keeps it verbatim', () => {
    const resolved = config(
      run({ locales: ['en', 'de-at'], sourceLocale: 'en' }, [
        catalog('en'),
        catalog('de-at', 'locales/de-at.json'),
      ]),
    )
    expect(resolved.locales).toEqual(['en', 'de-at'])
  })
})

describe('LZ1004 source-catalog-missing', () => {
  it('fires when the source locale cannot be inferred', () => {
    const result = run({}, [catalog('de'), catalog('fr')])
    expect(result.config).toBeNull()
    const diagnostic = only(result.diagnostics, 'LZ1004')
    expect(diagnostic.fatal).toBe(true)
    expect(diagnostic.hint).toContain('defineConfig')
    expect(diagnostic.hint).toContain('sourceLocale')
  })

  it('prints a block that is a whole config file, import included', () => {
    const { hint } = only(run({}, [catalog('de'), catalog('fr')]).diagnostics, 'LZ1004')
    expect(hint).toBe(
      [
        'write loclizr.config.ts, or add `locales` and `sourceLocale` to the config you have:',
        "import { defineConfig } from 'loclizr'",
        '',
        'export default defineConfig({',
        '  locales: [',
        "    'de',  // locales/de.json",
        "    'fr',  // locales/fr.json",
        '  ],',
        "  sourceLocale: 'de',",
        '})',
      ].join('\n'),
    )
  })

  it('fires when the source locale has no catalog file, naming the path it looked for', () => {
    const result = run({ locales: ['en', 'de'], sourceLocale: 'en' }, [catalog('de')])
    expect(result.config).toBeNull()
    const diagnostic = only(result.diagnostics, 'LZ1004')
    expect(diagnostic.file).toBe('locales/en.json')
    expect(diagnostic.locale).toBe('en')
  })

  it('infers en whenever an en catalog exists', () => {
    expect(config(run({}, [catalog('de'), catalog('en'), catalog('fr')])).sourceLocale).toBe('en')
  })

  it('infers the single locale when there is only one', () => {
    expect(config(run({}, [catalog('de')])).sourceLocale).toBe('de')
  })

  it('takes an explicit sourceLocale over the inference', () => {
    expect(
      config(run({ locales: ['en', 'de'], sourceLocale: 'de' }, [catalog('en'), catalog('de')]))
        .sourceLocale,
    ).toBe('de')
  })
})

describe('LZ1005 catalog-missing', () => {
  it('reports a declared locale with no catalog and still resolves', () => {
    const result = run({ locales: ['en', 'de'] }, [catalog('en')])
    const diagnostic = only(result.diagnostics, 'LZ1005')
    expect(diagnostic.severity).toBe('error')
    expect(diagnostic.fatal).toBe(false)
    expect(diagnostic.file).toBe('locales/de.json')
    expect(diagnostic.locale).toBe('de')
    expect(config(result).locales).toEqual(['en', 'de'])
  })

  it('substitutes the locale into the configured pattern', () => {
    const result = run({ locales: ['en', 'de'], catalogs: 'i18n/{locale}/strings.json' }, [
      catalog('en', 'i18n/en/strings.json'),
    ])
    expect(only(result.diagnostics, 'LZ1005').file).toBe('i18n/de/strings.json')
  })
})

describe('LZ1006 catalog-undeclared', () => {
  it('reports a catalog for a locale the config does not declare', () => {
    const result = run({ locales: ['en'] }, [catalog('en'), catalog('fr')])
    const diagnostic = only(result.diagnostics, 'LZ1006')
    expect(diagnostic.severity).toBe('warn')
    expect(diagnostic.fatal).toBe(false)
    expect(diagnostic.file).toBe('locales/fr.json')
    expect(config(result).locales).toEqual(['en'])
  })

  it('stays quiet when locales is unset, because discovery is the locale set', () => {
    const result = run({}, [catalog('en'), catalog('fr')])
    expect(result.diagnostics).toEqual([])
    expect(config(result).locales).toEqual(['en', 'fr'])
  })

  it('offers only fixes that move the file, since discovery reaches it whatever locales holds', () => {
    const result = run({ locales: ['en'] }, [catalog('en'), catalog('en_US', 'locales/en_US.json')])
    expect(only(result.diagnostics, 'LZ1006').hint).toBe(
      'rename it to a BCP 47 tag, or move it out of the catalog pattern.',
    )
  })

  it('skips a discovered basename Intl rejects rather than failing the build', () => {
    const result = run({}, [catalog('en'), catalog('123', 'locales/123.json')])
    const diagnostic = only(result.diagnostics, 'LZ1006')
    expect(diagnostic.file).toBe('locales/123.json')
    expect(diagnostic.fatal).toBe(false)
    expect(config(result).locales).toEqual(['en'])
  })

  it('keeps a plausible directory name that Intl accepts', () => {
    const result = run({}, [
      catalog('en', 'locales/en/common.json', 'common'),
      catalog('shared', 'locales/shared/common.json', 'common'),
    ])
    expect(config(result).locales).toEqual(['en', 'shared'])
  })
})

describe('the meta and record paths are never catalogs', () => {
  it('excludes the meta sidecar the loose match reached', () => {
    const result = run({}, [catalog('en'), catalog('en.meta', 'locales/en.meta.json')])
    expect(result.diagnostics).toEqual([])
    expect(config(result).locales).toEqual(['en'])
  })

  it('excludes the resolved record path the loose match reached', () => {
    const result = run({ record: 'locales/context.v1.json' }, [
      catalog('en'),
      catalog('context.v1', 'locales/context.v1.json'),
    ])
    expect(result.diagnostics).toEqual([])
    expect(config(result).locales).toEqual(['en'])
  })
})

describe('LZ1018 locale-base-missing', () => {
  it('warns when a declared region tag has no declared base', () => {
    const result = run({ locales: ['en', 'de-AT'] }, [catalog('en'), catalog('de-AT')])
    const diagnostic = only(result.diagnostics, 'LZ1018')
    expect(diagnostic.severity).toBe('warn')
    expect(diagnostic.fatal).toBe(false)
    expect(diagnostic.locale).toBe('de-AT')
    expect(diagnostic.message).toContain('de')
    expect(config(result).locales).toEqual(['en', 'de-AT'])
  })

  it('stays quiet when the base tag is declared too', () => {
    const result = run({ locales: ['en', 'de', 'de-AT'] }, [
      catalog('en'),
      catalog('de'),
      catalog('de-AT'),
    ])
    expect(codes(result.diagnostics)).not.toContain('LZ1018')
  })

  it('truncates to the first subtag', () => {
    const result = run({ locales: ['en', 'zh-Hans-CN'] }, [catalog('en'), catalog('zh-Hans-CN')])
    expect(only(result.diagnostics, 'LZ1018').message).toContain('zh')
  })

  it('warns for a script subtag too, because Accept-Language: zh reaches nothing either', () => {
    const result = run({ locales: ['en', 'zh-Hans'] }, [catalog('en'), catalog('zh-Hans')])
    const diagnostic = only(result.diagnostics, 'LZ1018')
    expect(diagnostic.locale).toBe('zh-Hans')
    expect(diagnostic.message).toContain('zh')
  })

  it('does not fire on the source locale, which every chain already ends at', () => {
    const result = run({ locales: ['en-US', 'de'], sourceLocale: 'en-US' }, [
      catalog('en-US'),
      catalog('de'),
    ])
    expect(codes(result.diagnostics)).not.toContain('LZ1018')
  })
})

describe('determinism', () => {
  it('does not depend on the order discovery returned', () => {
    const found = [
      catalog('en'),
      catalog('de'),
      catalog('de-AT'),
      catalog('123', 'locales/123.json'),
    ]
    const forward = run({ locales: ['en', 'de'] }, found)
    const backward = run({ locales: ['en', 'de'] }, [...found].reverse())
    expect(backward).toEqual(forward)
  })
})
