import type { FormatsConfig, IntlOptions, LoclizrConfig, RuleName, Severity } from '../types'
import { RULES } from '../diagnostics'
import { countToken } from './pattern'

export interface UserFields {
  readonly locales: readonly string[] | undefined
  readonly sourceLocale: string | undefined
  readonly catalogs: string
  readonly catalogFormat: 'i18next' | 'icu'
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

export function readFields(user: LoclizrConfig): FieldsResult {
  const issues: FieldIssue[] = []
  // A config file is arbitrary JavaScript, so every field is re-checked here
  // whatever its declared type says.
  const raw = user as unknown as Readonly<Record<string, unknown>>
  const scan = readNested(raw, 'scan', issues)
  const formats = readNested(raw, 'formats', issues)
  return {
    fields: {
      locales: readLocales(raw, issues),
      sourceLocale: readString(raw, 'sourceLocale', issues),
      catalogs: readCatalogs(raw, issues),
      catalogFormat: readEnum(raw, 'catalogFormat', ['i18next', 'icu'], 'i18next', issues),
      i18nextMarkup: readEnum(raw, 'i18nextMarkup', ['literal', 'tags'], 'literal', issues),
      meta: readStringOrFalse(raw, 'meta', DEFAULT_META, issues),
      outDir: readString(raw, 'outDir', issues) ?? DEFAULT_OUT_DIR,
      record: readStringOrFalse(raw, 'record', DEFAULT_RECORD, issues),
      cookie: readString(raw, 'cookie', issues) ?? DEFAULT_COOKIE,
      augmentLocale: readBoolean(raw, 'augmentLocale', issues) ?? true,
      groups: readStringRecord(raw, 'groups', issues),
      identifiers: readStringRecord(raw, 'identifiers', issues),
      fallback: readFallback(raw, issues),
      formats: readFormats(formats, issues),
      scanInclude: readGlobs(scan, 'scan.include', 'include', issues) ?? DEFAULT_SCAN_INCLUDE,
      scanExclude: readGlobs(scan, 'scan.exclude', 'exclude', issues) ?? DEFAULT_SCAN_EXCLUDE,
      severity: readSeverity(raw, issues),
    },
    issues,
  }
}

function readNested(
  raw: Readonly<Record<string, unknown>>,
  field: string,
  issues: FieldIssue[],
): Readonly<Record<string, unknown>> {
  const value = raw[field]
  if (value === undefined) return {}
  if (!isPlainObject(value)) {
    issues.push(expected(field, 'an object'))
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
    issues.push(expected('locales', 'a non-empty array of locale tags'))
    return undefined
  }
  return value
}

function readCatalogs(raw: Readonly<Record<string, unknown>>, issues: FieldIssue[]): string {
  const value = readString(raw, 'catalogs', issues)
  if (value === undefined) return DEFAULT_CATALOGS
  if (countToken(value, '{locale}') !== 1 || countToken(value, '{ns}') > 1) {
    issues.push({
      message: '`catalogs` must carry exactly one `{locale}` token and at most one `{ns}` token.',
      hint: `catalogs: '${DEFAULT_CATALOGS}'`,
    })
    return DEFAULT_CATALOGS
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
    issues.push(expected('fallback', "'bcp47' or a map of locale tag to locale tags"))
    return 'bcp47'
  }
  const chains: Record<string, readonly string[]> = {}
  for (const [locale, chain] of Object.entries(value)) {
    if (!Array.isArray(chain) || !chain.every(isNonEmptyString)) {
      issues.push(expected(`fallback.${locale}`, 'an array of locale tags'))
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
    issues.push(expected('formats.timeZone', 'an IANA time zone name'))
  }
  return {
    timeZone: isNonEmptyString(timeZone) ? timeZone : null,
    number: readOptionsRecord(raw, 'number', issues),
    dateTime: readOptionsRecord(raw, 'dateTime', issues),
  }
}

function readOptionsRecord(
  raw: Readonly<Record<string, unknown>>,
  field: string,
  issues: FieldIssue[],
): Readonly<Record<string, IntlOptions>> {
  const value = raw[field]
  if (value === undefined) return {}
  if (!isPlainObject(value)) {
    issues.push(expected(`formats.${field}`, 'an object of named Intl option sets'))
    return {}
  }
  const styles: Record<string, IntlOptions> = {}
  for (const [name, options] of Object.entries(value)) {
    if (!isPlainObject(options) || !Object.values(options).every(isOptionValue)) {
      issues.push(expected(`formats.${field}.${name}`, 'an object of Intl options'))
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
    issues.push(expected('severity', 'a map of rule name to off, warn or error'))
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
      issues.push(expected(`severity.${rule}`, "'off', 'warn' or 'error'"))
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
  issues: FieldIssue[],
): readonly string[] | undefined {
  const value = raw[field]
  if (value === undefined) return undefined
  if (!Array.isArray(value) || !value.every(isNonEmptyString)) {
    issues.push(expected(label, 'an array of glob patterns'))
    return undefined
  }
  return value
}

function readStringRecord(
  raw: Readonly<Record<string, unknown>>,
  field: string,
  issues: FieldIssue[],
): Readonly<Record<string, string>> {
  const value = raw[field]
  if (value === undefined) return {}
  if (!isPlainObject(value) || !Object.values(value).every(isNonEmptyString)) {
    issues.push(expected(field, 'a map of string to string'))
    return {}
  }
  return value as Readonly<Record<string, string>>
}

function readString(
  raw: Readonly<Record<string, unknown>>,
  field: string,
  issues: FieldIssue[],
): string | undefined {
  const value = raw[field]
  if (value === undefined) return undefined
  if (!isNonEmptyString(value)) {
    issues.push(expected(field, 'a non-empty string'))
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
    issues.push(expected(field, 'a path or false'))
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
    issues.push(expected(field, 'a boolean'))
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
    issues.push(expected(field, allowed.map((one) => `'${one}'`).join(' or ')))
    return fallback
  }
  return value as T
}

function expected(field: string, shape: string): FieldIssue {
  return { message: `\`${field}\` must be ${shape}.`, hint: null }
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
