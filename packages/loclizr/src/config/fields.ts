import type { FormatsConfig, IntlOptions, LoclizrConfig, RuleName, Severity } from '../types'
import { RULES } from '../diagnostics'
import { countToken, globMetacharacterIn } from './pattern'

export interface UserFields {
  readonly locales: readonly string[] | undefined
  readonly sourceLocale: string | undefined
  readonly catalogs: string
  readonly catalogFormat: 'auto' | 'icu' | 'i18next'
  readonly i18nextMarkup: 'literal' | 'tags'
  readonly meta: string | false
  readonly outDir: string
  readonly record: string | false
  readonly cookie: string
  readonly augmentLocale: boolean
  readonly groups: Readonly<Record<string, string>>
  readonly identifiers: Readonly<Record<string, string>>
  readonly fallback: 'bcp47' | Readonly<Record<string, readonly string[]>>
  readonly formats: FormatsConfig
  readonly scanInclude: readonly string[]
  readonly scanExclude: readonly string[]
  readonly severity: Readonly<Partial<Record<RuleName, Severity>>>
}

export interface FieldIssue {
  readonly message: string
  readonly hint: string | null
}

export interface FieldsResult {
  readonly fields: UserFields
  readonly issues: readonly FieldIssue[]
}

export const DEFAULT_CATALOGS = 'locales/{locale}.json'
export const DEFAULT_META = 'locales/{sourceLocale}.meta.json'
export const DEFAULT_OUT_DIR = 'src/loclizr'
export const DEFAULT_RECORD = 'locales/loclizr.context.json'
export const DEFAULT_COOKIE = 'locale'
export const DEFAULT_SCAN_INCLUDE: readonly string[] = ['src/**/*.{ts,tsx,js,jsx,mts,mjs}']
export const DEFAULT_SCAN_EXCLUDE: readonly string[] = ['**/node_modules/**', '**/dist/**']

const NOT_RELEVELABLE: readonly RuleName[] = ['config-invalid', 'outdir-unsafe', 'output-unwritable']

const SEVERITIES: readonly string[] = ['off', 'warn', 'error']

const SEVERITY_EXAMPLE = "severity: { 'ambiguous-source': 'error' }"
const NUMBER_EXAMPLE = "formats: { number: { compact: { notation: 'compact' } } }"
const DATE_TIME_EXAMPLE = "formats: { dateTime: { weekday: { weekday: 'long' } } }"
const INCLUDE_EXAMPLE = "scan: { include: ['src/**/*.{ts,tsx}'] }"
const EXCLUDE_EXAMPLE = "scan: { exclude: ['**/legacy/**'] }"
const IDENTIFIERS_EXAMPLE = "identifiers: { 'nav.home': 'navHome' }"
const ZONE_EXAMPLE = "formats: { timeZone: 'UTC' }"

// RFC 6265 cookie-name. A name outside it is written verbatim into
// `document.cookie` and never reads back, so the locale stops persisting.
const COOKIE_NAME = /^[A-Za-z0-9!#$%&'*+\-.^_`|~]+$/

// Whether an option set builds a formatter is locale independent, so a fixed
// probe locale keeps the verdict the same on every machine.
const PROBE_LOCALE = 'en'

export function isLocaleTag(tag: string): boolean {
  try {
    Intl.getCanonicalLocales(tag)
    return true
  } catch {
    return false
  }
}

export function readFields(user: LoclizrConfig): FieldsResult {
  const issues: FieldIssue[] = []
  // A config file is arbitrary JavaScript, so every field is re-checked here
  // whatever its declared type says.
  const raw = user as unknown as Readonly<Record<string, unknown>>
  const scan = readNested(raw, 'scan', INCLUDE_EXAMPLE, issues)
  const formats = readNested(raw, 'formats', ZONE_EXAMPLE, issues)
  return {
    fields: {
      locales: readLocales(raw, issues),
      sourceLocale: readString(raw, 'sourceLocale', "sourceLocale: 'en'", issues),
      catalogs: readCatalogs(raw, issues),
      catalogFormat: readEnum(raw, 'catalogFormat', ['auto', 'icu', 'i18next'], 'auto', issues),
      i18nextMarkup: readEnum(raw, 'i18nextMarkup', ['literal', 'tags'], 'literal', issues),
      meta: readStringOrFalse(raw, 'meta', DEFAULT_META, issues),
      outDir: readString(raw, 'outDir', `outDir: '${DEFAULT_OUT_DIR}'`, issues) ?? DEFAULT_OUT_DIR,
      record: readStringOrFalse(raw, 'record', DEFAULT_RECORD, issues),
      cookie: readCookie(raw, issues),
      augmentLocale: readBoolean(raw, 'augmentLocale', issues) ?? true,
      groups: readStringRecord(raw, 'groups', "groups: { errors: 'errors' }", issues),
      identifiers: readStringRecord(raw, 'identifiers', IDENTIFIERS_EXAMPLE, issues),
      fallback: readFallback(raw, issues),
      formats: readFormats(formats, issues),
      scanInclude:
        readGlobs(scan, 'scan.include', 'include', INCLUDE_EXAMPLE, issues) ?? DEFAULT_SCAN_INCLUDE,
      scanExclude:
        readGlobs(scan, 'scan.exclude', 'exclude', EXCLUDE_EXAMPLE, issues) ?? DEFAULT_SCAN_EXCLUDE,
      severity: readSeverity(raw, issues),
    },
    issues,
  }
}

function readNested(
  raw: Readonly<Record<string, unknown>>,
  field: string,
  example: string,
  issues: FieldIssue[],
): Readonly<Record<string, unknown>> {
  const value = raw[field]
  if (value === undefined) return {}
  if (!isPlainObject(value)) {
    issues.push(expected(field, 'an object', example))
    return {}
  }
  return value
}

function readLocales(
  raw: Readonly<Record<string, unknown>>,
  issues: FieldIssue[],
): readonly string[] | undefined {
  const value = raw['locales']
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length === 0 || !value.every(isNonEmptyString)) {
    issues.push(expected('locales', 'a non-empty array of locale tags', "locales: ['en', 'de']"))
    return undefined
  }
  return value
}

function readCatalogs(raw: Readonly<Record<string, unknown>>, issues: FieldIssue[]): string {
  const value = readString(raw, 'catalogs', `catalogs: '${DEFAULT_CATALOGS}'`, issues)
  if (value === undefined) return DEFAULT_CATALOGS
  if (
    countToken(value, '{locale}') !== 1 ||
    countToken(value, '{ns}') > 1 ||
    countToken(value, '{sourceLocale}') !== 0
  ) {
    issues.push({
      message:
        '`catalogs` must carry exactly one `{locale}` token, at most one `{ns}` token, and no `{sourceLocale}` token.',
      hint: `catalogs: '${DEFAULT_CATALOGS}'`,
    })
    return DEFAULT_CATALOGS
  }
  const metacharacter = globMetacharacterIn(value)
  if (metacharacter !== null) {
    issues.push({
      message: `\`catalogs\` carries the glob character \`${metacharacter}\`, which no catalog file can match.`,
      hint: `catalogs is a path with tokens, not a glob: '${DEFAULT_CATALOGS}' or 'public/locales/{locale}/{ns}.json'.`,
    })
    return DEFAULT_CATALOGS
  }
  return value
}

function readCookie(raw: Readonly<Record<string, unknown>>, issues: FieldIssue[]): string {
  const value = readString(raw, 'cookie', `cookie: '${DEFAULT_COOKIE}'`, issues)
  if (value === undefined) return DEFAULT_COOKIE
  if (!COOKIE_NAME.test(value)) {
    issues.push({
      message: `\`cookie\` is \`${value}\`, which is not a cookie name.`,
      hint: "a cookie name carries no space, `;`, `=` or comma, so a name outside that set never reads back: cookie: 'locale'.",
    })
    return DEFAULT_COOKIE
  }
  return value
}

function readFallback(
  raw: Readonly<Record<string, unknown>>,
  issues: FieldIssue[],
): 'bcp47' | Readonly<Record<string, readonly string[]>> {
  const value = raw['fallback']
  if (value === undefined || value === 'bcp47') return 'bcp47'
  if (!isPlainObject(value)) {
    const shape = "'bcp47' or a map of locale tag to locale tags"
    issues.push(expected('fallback', shape, "fallback: { nb: ['no'] }"))
    return 'bcp47'
  }
  // A null prototype, because a config parsed from JSON can carry `__proto__` as
  // an own key and assigning it on a plain object would run the setter instead.
  const chains = Object.create(null) as Record<string, readonly string[]>
  for (const [locale, chain] of Object.entries(value)) {
    // A key no formatter could name can never be a declared locale, so no chain
    // keyed by it is ever walked.
    if (!isLocaleTag(locale)) continue
    if (!Array.isArray(chain) || !chain.every(isNonEmptyString)) {
      const example = `fallback: { '${locale}': ['en'] }`
      issues.push(expected(`fallback.${locale}`, 'an array of locale tags', example))
      continue
    }
    chains[locale] = chain
  }
  return chains
}

function readFormats(
  raw: Readonly<Record<string, unknown>>,
  issues: FieldIssue[],
): FormatsConfig {
  const timeZone = raw['timeZone']
  if (timeZone !== undefined && !isNonEmptyString(timeZone)) {
    issues.push(expected('formats.timeZone', 'an IANA time zone name', ZONE_EXAMPLE))
  }
  const zone = isNonEmptyString(timeZone) ? timeZone : null
  // The zone is merged into every date and time option set and nothing later in
  // the pipeline builds a formatter, so a zone Intl cannot take first throws in
  // the viewer's browser, on every date message at once.
  const rejection =
    zone === null ? null : buildFailure(() => buildDateTimeFormat({ timeZone: zone }))
  if (rejection !== null) {
    issues.push({
      message: `\`formats.timeZone\` is \`${zone}\`, which Intl rejects.`,
      hint: rejection,
    })
  }
  return {
    timeZone: rejection === null ? zone : null,
    number: readOptionsRecord(raw, 'number', NUMBER_EXAMPLE, buildNumberFormat, issues),
    dateTime: readOptionsRecord(raw, 'dateTime', DATE_TIME_EXAMPLE, buildDateTimeFormat, issues),
  }
}

function buildNumberFormat(options: IntlOptions): void {
  new Intl.NumberFormat(PROBE_LOCALE, options as Intl.NumberFormatOptions)
}

function buildDateTimeFormat(options: IntlOptions): void {
  new Intl.DateTimeFormat(PROBE_LOCALE, options as Intl.DateTimeFormatOptions)
}

function buildFailure(build: () => void): string | null {
  try {
    build()
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

function readOptionsRecord(
  raw: Readonly<Record<string, unknown>>,
  field: string,
  example: string,
  build: (options: IntlOptions) => void,
  issues: FieldIssue[],
): Readonly<Record<string, IntlOptions>> {
  const value = raw[field]
  if (value === undefined) return {}
  if (!isPlainObject(value)) {
    issues.push(expected(`formats.${field}`, 'an object of named Intl option sets', example))
    return {}
  }
  // A null prototype: a config parsed from JSON can carry `__proto__` as an own
  // key, and the named style lookup downstream must not reach `toString`.
  const styles = Object.create(null) as Record<string, IntlOptions>
  for (const [name, options] of Object.entries(value)) {
    if (!isPlainObject(options) || !Object.values(options).every(isOptionValue)) {
      issues.push(expected(`formats.${field}.${name}`, 'an object of Intl options', example))
      continue
    }
    const rejection = buildFailure(() => build(options as IntlOptions))
    if (rejection !== null) {
      issues.push({
        message: `\`formats.${field}.${name}\` is not an option set Intl can build.`,
        hint: rejection,
      })
      continue
    }
    styles[name] = options as IntlOptions
  }
  return styles
}

function readSeverity(
  raw: Readonly<Record<string, unknown>>,
  issues: FieldIssue[],
): Readonly<Partial<Record<RuleName, Severity>>> {
  const value = raw['severity']
  if (value === undefined) return {}
  if (!isPlainObject(value)) {
    issues.push(expected('severity', 'a map of rule name to off, warn or error', SEVERITY_EXAMPLE))
    return {}
  }
  const overrides: Partial<Record<RuleName, Severity>> = {}
  for (const [rule, level] of Object.entries(value)) {
    if (!Object.hasOwn(RULES, rule)) {
      issues.push({
        message: `\`severity\` names an unknown rule \`${rule}\`.`,
        hint: 'rule names are the ones printed beside each diagnostic code.',
      })
      continue
    }
    if (NOT_RELEVELABLE.includes(rule as RuleName)) {
      issues.push({
        message: `\`severity\` cannot re-level \`${rule}\`.`,
        hint: `${RULES[rule as RuleName].code} decides whether the tool can run at all, so turning it down would let a broken build exit 0.`,
      })
      continue
    }
    if (typeof level !== 'string' || !SEVERITIES.includes(level)) {
      const example = `severity: { '${rule}': 'warn' }`
      issues.push(expected(`severity.${rule}`, "'off', 'warn' or 'error'", example))
      continue
    }
    overrides[rule as RuleName] = level as Severity
  }
  return overrides
}

function readGlobs(
  raw: Readonly<Record<string, unknown>>,
  label: string,
  field: string,
  example: string,
  issues: FieldIssue[],
): readonly string[] | undefined {
  const value = raw[field]
  if (value === undefined) return undefined
  if (!Array.isArray(value) || !value.every(isNonEmptyString)) {
    issues.push(expected(label, 'an array of glob patterns', example))
    return undefined
  }
  return value
}

function readStringRecord(
  raw: Readonly<Record<string, unknown>>,
  field: string,
  example: string,
  issues: FieldIssue[],
): Readonly<Record<string, string>> {
  const value = raw[field]
  if (value === undefined) return {}
  if (!isPlainObject(value) || !Object.values(value).every(isNonEmptyString)) {
    issues.push(expected(field, 'a map of string to string', example))
    return {}
  }
  return value as Readonly<Record<string, string>>
}

function readString(
  raw: Readonly<Record<string, unknown>>,
  field: string,
  example: string,
  issues: FieldIssue[],
): string | undefined {
  const value = raw[field]
  if (value === undefined) return undefined
  if (!isNonEmptyString(value)) {
    issues.push(expected(field, 'a non-empty string', example))
    return undefined
  }
  return value
}

function readStringOrFalse(
  raw: Readonly<Record<string, unknown>>,
  field: string,
  fallback: string,
  issues: FieldIssue[],
): string | false {
  const value = raw[field]
  if (value === undefined) return fallback
  if (value === false) return false
  if (!isNonEmptyString(value)) {
    issues.push(expected(field, 'a path or false', `${field}: '${fallback}'`))
    return fallback
  }
  return value
}

function readBoolean(
  raw: Readonly<Record<string, unknown>>,
  field: string,
  issues: FieldIssue[],
): boolean | undefined {
  const value = raw[field]
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') {
    issues.push(expected(field, 'a boolean', `${field}: false`))
    return undefined
  }
  return value
}

function readEnum<T extends string>(
  raw: Readonly<Record<string, unknown>>,
  field: string,
  allowed: readonly T[],
  fallback: T,
  issues: FieldIssue[],
): T {
  const value = raw[field]
  if (value === undefined) return fallback
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    const shape = allowed.map((one) => `'${one}'`).join(' or ')
    issues.push(expected(field, shape, `${field}: '${fallback}'`))
    return fallback
  }
  return value as T
}

// Every rule in the compiler ships a line the reader can paste, and a rejected
// config field is the first diagnostic a new project ever sees.
function expected(field: string, shape: string, example: string): FieldIssue {
  return { message: `\`${field}\` must be ${shape}.`, hint: example }
}

function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== ''
}

function isOptionValue(value: unknown): boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}
