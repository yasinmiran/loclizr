import { isAbsolute, relative, resolve } from 'node:path'
import { RULES, diag } from '../diagnostics'
import type { Config, Diagnostic, DiscoveredCatalog, LoclizrConfig, RuleName } from '../types'
import { compareCodepoint, toPosix } from '../util'
import { isLocaleTag, readFields } from './fields'
import { literalMatcher, substituteLocale } from './pattern'

export interface LoadConfigResult {
  readonly config: Config | null
  readonly diagnostics: readonly Diagnostic[]
}

export function resolveConfig(input: {
  readonly user: LoclizrConfig
  readonly root: string
  readonly discovered: readonly DiscoveredCatalog[]
}): LoadConfigResult {
  const root = toPosix(resolve(input.root))
  const { fields, issues } = readFields(input.user)
  if (issues.length > 0) {
    return {
      config: null,
      diagnostics: issues.map((issue) =>
        diag('config-invalid', { message: issue.message, hint: issue.hint ?? undefined }),
      ),
    }
  }

  const outDirAbsolute = resolve(root, toPosix(fields.outDir))
  const outDir = toPosix(relative(root, outDirAbsolute))
  if (outDir === '' || outDir === '..' || outDir.startsWith('../') || isAbsolute(outDir)) {
    return {
      config: null,
      diagnostics: [
        diag('outdir-unsafe', {
          message: `\`outDir\` resolves to ${toPosix(outDirAbsolute)}, outside the project root ${root}.`,
          hint: "outDir must name a directory inside the project, such as 'src/loclizr'. The build prunes everything under it that this emit did not produce.",
        }),
      ],
    }
  }

  const diagnostics: Diagnostic[] = []
  const catalogs = normalize(root, fields.catalogs)
  const meta = fields.meta === false ? false : normalize(root, fields.meta)
  const record = fields.record === false ? false : normalize(root, fields.record)

  const swallowed = swallowedByOutDir(outDir, { meta, record })
  if (swallowed.length > 0) {
    return {
      config: null,
      diagnostics: swallowed.map(([field, path]) =>
        diag('config-invalid', {
          message: `\`outDir\` is \`${outDir}\`, which holds the resolved \`${field}\` path \`${path}\`.`,
          hint: `the generated tree writes a self-ignoring .gitignore into outDir, so ${path} would stop being committed. Give outDir a directory of its own, such as 'src/loclizr'.`,
        }),
      ),
    }
  }

  // A rule the user took out of error stops being fatal (section 9), and M10
  // never gets the chance to apply that override on a null config, so the three
  // re-levelable `always` rules are resolved here and resolution carries on
  // wherever the remaining fields still describe a buildable project.
  const blocks = (rule: RuleName): boolean =>
    (fields.severity[rule] ?? RULES[rule].severity) === 'error'

  const usable = usableCatalogs(input.discovered, [meta, record], diagnostics)
  if (usable.length === 0) {
    diagnostics.push(
      diag('no-catalogs-found', {
        message: `No catalog file matched \`${catalogs}\`.`,
        hint: `write locales/${fields.sourceLocale ?? 'en'}.json, or point \`catalogs\` at the layout you already have, such as 'public/locales/{locale}/{ns}.json'.`,
      }),
    )
    if (blocks('no-catalogs-found')) return { config: null, diagnostics }
  }

  const discoveredLocales = unique(usable.map((catalog) => catalog.locale)).sort(compareCodepoint)
  if (fields.locales === undefined) {
    const named = new Set<string>()
    for (const catalog of usable) {
      if (named.has(catalog.locale) || !isReservedPrimarySubtag(catalog.locale)) continue
      named.add(catalog.locale)
      diagnostics.push(
        diag('catalog-undeclared', {
          message: `${catalog.file} matched \`${catalogs}\`, so \`${catalog.locale}\` is now a declared locale, and BCP 47 registers no language subtag of five to eight letters.`,
          hint: 'declare `locales` explicitly so discovery stops deciding, or move the file out of the catalog pattern.',
          file: catalog.file,
          locale: catalog.locale,
        }),
      )
    }
  }
  const declared = fields.locales === undefined ? discoveredLocales : unique(fields.locales)
  const rejected = new Set<string>()
  if (fields.locales !== undefined) {
    for (const tag of declared) {
      if (isLocaleTag(tag)) continue
      rejected.add(tag)
      diagnostics.push(
        diag('locale-tag-invalid', {
          message: `\`locales\` declares \`${tag}\`, which is not a valid BCP 47 language tag.`,
          hint: 'Intl.getCanonicalLocales rejects it, so no formatter could be built for it.',
          locale: tag,
        }),
      )
    }
  }
  const invalidSource =
    fields.sourceLocale !== undefined && !isLocaleTag(fields.sourceLocale) ? fields.sourceLocale : null
  if (invalidSource !== null) {
    if (!rejected.has(invalidSource)) {
      diagnostics.push(
        diag('locale-tag-invalid', {
          message: `\`sourceLocale\` is \`${invalidSource}\`, which is not a valid BCP 47 language tag.`,
          hint: 'Intl.getCanonicalLocales rejects it, so no formatter could be built for it.',
          locale: invalidSource,
        }),
      )
    }
    rejected.add(invalidSource)
  }
  if (rejected.size > 0 && blocks('locale-tag-invalid')) return { config: null, diagnostics }
  const declaredSource = invalidSource === null ? fields.sourceLocale : undefined

  // A tag no formatter can be built for is dropped rather than carried, because
  // every locale here reaches `Intl.PluralRules` in generated code.
  const locales = declared.filter((tag) => !rejected.has(tag))
  const [firstLocale] = locales
  // Nothing is inferable from an empty locale set, and a second fatal stacked on
  // the one the user already saw is noise.
  if (firstLocale === undefined) return { config: null, diagnostics }

  // With nothing on disk, LZ1003 has already said the only thing there is to
  // say, and a source catalog nobody has is the same fact a second time.
  const emptyTree = usable.length === 0
  const inferred = declaredSource ?? inferSourceLocale(locales)
  if (inferred === null && !emptyTree) {
    diagnostics.push(
      diag('source-catalog-missing', {
        message: `The source locale cannot be inferred: no \`en\` catalog and ${locales.length} locales to choose between.`,
        hint: pasteableConfig(locales, usable),
      }),
    )
    if (blocks('source-catalog-missing')) return { config: null, diagnostics }
  }
  const sourceLocale = inferred ?? firstLocale

  const localesWithCatalog = new Set(usable.map((catalog) => catalog.locale))
  if (inferred !== null && !emptyTree && !localesWithCatalog.has(sourceLocale)) {
    diagnostics.push(
      diag('source-catalog-missing', {
        message: `No catalog file for the source locale \`${sourceLocale}\`.`,
        hint: pasteableConfig(discoveredLocales, usable),
        file: substituteLocale(catalogs, sourceLocale),
        locale: sourceLocale,
      }),
    )
    if (blocks('source-catalog-missing')) return { config: null, diagnostics }
  }
  if (!locales.includes(sourceLocale)) {
    diagnostics.push(
      diag('config-invalid', {
        message: `\`sourceLocale\` is \`${sourceLocale}\`, which \`locales\` does not declare.`,
        hint: `every fallback chain ends at the source locale, so add '${sourceLocale}' to locales.`,
        locale: sourceLocale,
      }),
    )
    return { config: null, diagnostics }
  }

  for (const locale of locales) {
    if (localesWithCatalog.has(locale)) continue
    diagnostics.push(
      diag('catalog-missing', {
        message: `\`locales\` declares \`${locale}\` and no catalog file exists for it.`,
        hint: `every message will fall back to \`${sourceLocale}\`. Write the catalog, or drop the locale.`,
        file: substituteLocale(catalogs, locale),
        locale,
      }),
    )
  }

  const declaredSet = new Set(locales)
  for (const locale of discoveredLocales) {
    if (declaredSet.has(locale)) continue
    diagnostics.push(
      diag('catalog-undeclared', {
        message: `A catalog exists for \`${locale}\` and \`locales\` does not declare it, so it is ignored.`,
        hint: `add '${locale}' to locales, or move the file out of \`${catalogs}\`.`,
        file: firstFileFor(usable, locale),
        locale,
      }),
    )
  }

  for (const locale of locales) {
    if (locale === sourceLocale) continue
    const base = baseTagOf(locale)
    if (base === null || declaredSet.has(base)) continue
    diagnostics.push(
      diag('locale-base-missing', {
        message: `\`${locale}\` is declared and its base tag \`${base}\` is not, so a browser sending \`Accept-Language: ${base}\` gets \`${sourceLocale}\`.`,
        hint: `add '${base}', or expect Accept-Language: ${base} to fall back to ${sourceLocale}.`,
        locale,
      }),
    )
  }

  return {
    config: {
      root,
      locales,
      sourceLocale,
      catalogs,
      catalogFormat: fields.catalogFormat,
      i18nextMarkup: fields.i18nextMarkup,
      meta,
      outDir,
      record,
      cookie: fields.cookie,
      augmentLocale: fields.augmentLocale,
      groups: fields.groups,
      identifiers: fields.identifiers,
      fallback: fields.fallback,
      formats: fields.formats,
      scan: { include: fields.scanInclude, exclude: unique([...fields.scanExclude, `${outDir}/**`]) },
      severity: fields.severity,
    },
    diagnostics,
  }
}

function swallowedByOutDir(
  outDir: string,
  paths: Readonly<Record<string, string | false>>,
): readonly (readonly [string, string])[] {
  const inside: (readonly [string, string])[] = []
  for (const [field, path] of Object.entries(paths)) {
    if (path === false) continue
    if (path === outDir || path.startsWith(`${outDir}/`)) inside.push([field, path])
  }
  return inside
}

function usableCatalogs(
  discovered: readonly DiscoveredCatalog[],
  reserved: readonly (string | false)[],
  diagnostics: Diagnostic[],
): readonly DiscoveredCatalog[] {
  const excluded = reserved
    .filter((path): path is string => path !== false)
    .map((path) => literalMatcher(path))
  const usable: DiscoveredCatalog[] = []
  for (const catalog of [...discovered].sort((a, b) => compareCodepoint(a.file, b.file))) {
    if (excluded.some((matcher) => matcher.test(catalog.file))) continue
    if (!isLocaleTag(catalog.locale)) {
      diagnostics.push(
        diag('catalog-undeclared', {
          message: `\`${catalog.locale}\` is not a valid locale tag, so ${catalog.file} was skipped.`,
          hint: 'rename it to a BCP 47 tag, or declare `locales` explicitly so the pattern stops reaching this file.',
          file: catalog.file,
        }),
      )
      continue
    }
    usable.push(catalog)
  }
  return usable
}

function inferSourceLocale(locales: readonly string[]): string | null {
  if (locales.includes('en')) return 'en'
  return locales.length === 1 ? (locales[0] ?? null) : null
}

// Intl accepts any five-to-eight-letter primary subtag, so `settings.json` and
// `shared/` both canonicalize and both become locales. No ISO 639 code is that
// long, so the shape names the mistake with no registry lookup.
function isReservedPrimarySubtag(locale: string): boolean {
  const [primary = ''] = locale.split('-')
  return /^[A-Za-z]{5,8}$/.test(primary)
}

// Every locale carries the file it was discovered from, because the block is
// meant to be pasted and a junk basename is invisible inside a one-line array.
function pasteableConfig(
  locales: readonly string[],
  catalogs: readonly DiscoveredCatalog[],
): string {
  const cells = locales.map((locale) => `'${locale}',`)
  const width = cells.reduce((widest, cell) => Math.max(widest, cell.length), 0)
  const lines = locales.map((locale, index) => {
    const cell = cells[index] ?? ''
    const file = firstFileFor(catalogs, locale)
    return file === undefined ? `    ${cell}` : `    ${cell.padEnd(width)}  // ${file}`
  })
  return [
    'name the source locale in loclizr.config.ts:',
    'export default defineConfig({',
    '  locales: [',
    ...lines,
    '  ],',
    `  sourceLocale: '${locales[0] ?? 'en'}',`,
    '})',
  ].join('\n')
}

function firstFileFor(catalogs: readonly DiscoveredCatalog[], locale: string): string | undefined {
  return catalogs.find((catalog) => catalog.locale === locale)?.file
}

function baseTagOf(locale: string): string | null {
  const [base] = locale.split('-')
  return base === undefined || base === locale ? null : base
}

function normalize(root: string, value: string): string {
  return toPosix(relative(root, resolve(root, toPosix(value))))
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}
