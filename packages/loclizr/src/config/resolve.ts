import { isAbsolute, relative, resolve } from 'node:path'
import { diag, hasFatal } from '../diagnostics'
import type { Config, Diagnostic, DiscoveredCatalog, LoclizrConfig } from '../types'
import { compareCodepoint, toPosix } from '../util'
import { readFields } from './fields'
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

  const usable = usableCatalogs(input.discovered, [meta, record], diagnostics)
  if (usable.length === 0) {
    diagnostics.push(
      diag('no-catalogs-found', {
        message: `No catalog file matched \`${catalogs}\` under ${root}.`,
        hint: `write locales/${fields.sourceLocale ?? 'en'}.json, or point \`catalogs\` at the layout you already have, such as 'public/locales/{locale}/{ns}.json'.`,
      }),
    )
    return { config: null, diagnostics }
  }

  const discoveredLocales = unique(usable.map((catalog) => catalog.locale)).sort(compareCodepoint)
  const locales = fields.locales === undefined ? discoveredLocales : unique(fields.locales)
  if (fields.locales !== undefined) {
    for (const tag of locales) {
      if (isLocaleTag(tag)) continue
      diagnostics.push(
        diag('locale-tag-invalid', {
          message: `\`locales\` declares \`${tag}\`, which is not a valid BCP 47 language tag.`,
          hint: 'Intl.getCanonicalLocales rejects it, so no formatter could be built for it.',
          locale: tag,
        }),
      )
    }
  }
  if (fields.sourceLocale !== undefined && !isLocaleTag(fields.sourceLocale)) {
    diagnostics.push(
      diag('locale-tag-invalid', {
        message: `\`sourceLocale\` is \`${fields.sourceLocale}\`, which is not a valid BCP 47 language tag.`,
        hint: 'Intl.getCanonicalLocales rejects it, so no formatter could be built for it.',
        locale: fields.sourceLocale,
      }),
    )
  }
  if (hasFatal(diagnostics)) return { config: null, diagnostics }

  const sourceLocale = fields.sourceLocale ?? inferSourceLocale(locales)
  if (sourceLocale === null) {
    diagnostics.push(
      diag('source-catalog-missing', {
        message: `The source locale cannot be inferred: no \`en\` catalog and ${locales.length} locales to choose between.`,
        hint: pasteableConfig(locales),
      }),
    )
    return { config: null, diagnostics }
  }

  const localesWithCatalog = new Set(usable.map((catalog) => catalog.locale))
  if (!localesWithCatalog.has(sourceLocale)) {
    diagnostics.push(
      diag('source-catalog-missing', {
        message: `No catalog file for the source locale \`${sourceLocale}\`.`,
        hint: pasteableConfig(discoveredLocales),
        file: substituteLocale(catalogs, sourceLocale),
        locale: sourceLocale,
      }),
    )
    return { config: null, diagnostics }
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
    if (locale === sourceLocale || localesWithCatalog.has(locale)) continue
    diagnostics.push(
      diag('catalog-missing', {
        message: `\`locales\` declares \`${locale}\` and no catalog file exists for it.`,
        hint: `every message will fall back to \`${sourceLocale}\`. Write the catalog, or drop the locale.`,
        file: substituteLocale(catalogs, locale),
        locale,
      }),
    )
  }

  const declared = new Set(locales)
  for (const locale of discoveredLocales) {
    if (declared.has(locale)) continue
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
    if (base === null || declared.has(base)) continue
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

export function isLocaleTag(tag: string): boolean {
  try {
    Intl.getCanonicalLocales(tag)
    return true
  } catch {
    return false
  }
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

function pasteableConfig(locales: readonly string[]): string {
  const list = locales.map((locale) => `'${locale}'`).join(', ')
  return [
    'name the source locale in loclizr.config.ts:',
    'export default defineConfig({',
    `  locales: [${list}],`,
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
