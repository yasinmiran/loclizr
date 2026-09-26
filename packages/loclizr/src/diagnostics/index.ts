import pc from 'picocolors'
import type {
  Config,
  Diagnostic,
  DiagnosticFields,
  FatalScope,
  Related,
  Rule,
  RuleName,
  Severity,
  Summary,
} from '../types'
import { compareCodepoint } from '../util'

export const RULES: Readonly<Record<RuleName, Rule>> = {
  'config-invalid': { code: 'LZ1001', name: 'config-invalid', severity: 'error', fatal: 'always', exitTwo: true, owner: 'M9' },
  'locale-tag-invalid': { code: 'LZ1002', name: 'locale-tag-invalid', severity: 'error', fatal: 'always', exitTwo: false, owner: 'M9' },
  'no-catalogs-found': { code: 'LZ1003', name: 'no-catalogs-found', severity: 'error', fatal: 'always', exitTwo: false, owner: 'M9' },
  'source-catalog-missing': { code: 'LZ1004', name: 'source-catalog-missing', severity: 'error', fatal: 'always', exitTwo: false, owner: 'M9' },
  'catalog-missing': { code: 'LZ1005', name: 'catalog-missing', severity: 'error', fatal: 'never', exitTwo: false, owner: 'M9' },
  'catalog-undeclared': { code: 'LZ1006', name: 'catalog-undeclared', severity: 'warn', fatal: 'never', exitTwo: false, owner: 'M9' },
  'outdir-unsafe': { code: 'LZ1007', name: 'outdir-unsafe', severity: 'error', fatal: 'always', exitTwo: true, owner: 'M9' },
  'catalog-unreadable': { code: 'LZ1008', name: 'catalog-unreadable', severity: 'error', fatal: 'ifSource', exitTwo: false, owner: 'M2' },
  'catalog-json-syntax': { code: 'LZ1009', name: 'catalog-json-syntax', severity: 'error', fatal: 'ifSource', exitTwo: false, owner: 'M2' },
  'catalog-shape-invalid': { code: 'LZ1010', name: 'catalog-shape-invalid', severity: 'error', fatal: 'never', exitTwo: false, owner: 'M2' },
  'duplicate-key': { code: 'LZ1011', name: 'duplicate-key', severity: 'error', fatal: 'never', exitTwo: false, owner: 'M2' },
  'i18next-nesting-unsupported': { code: 'LZ1012', name: 'i18next-nesting-unsupported', severity: 'error', fatal: 'never', exitTwo: false, owner: 'M2' },
  'i18next-format-unsupported': { code: 'LZ1013', name: 'i18next-format-unsupported', severity: 'error', fatal: 'never', exitTwo: false, owner: 'M2' },
  'plural-suffix-orphan': { code: 'LZ1014', name: 'plural-suffix-orphan', severity: 'warn', fatal: 'never', exitTwo: false, owner: 'M2' },
  'meta-orphan': { code: 'LZ1015', name: 'meta-orphan', severity: 'warn', fatal: 'never', exitTwo: false, owner: 'M2' },
  'i18next-markup-literal': { code: 'LZ1016', name: 'i18next-markup-literal', severity: 'warn', fatal: 'never', exitTwo: false, owner: 'M2' },
  'i18next-context-detected': { code: 'LZ1017', name: 'i18next-context-detected', severity: 'warn', fatal: 'never', exitTwo: false, owner: 'M2' },
  'locale-base-missing': { code: 'LZ1018', name: 'locale-base-missing', severity: 'warn', fatal: 'never', exitTwo: false, owner: 'M9' },
  'icu-data-incomplete': { code: 'LZ1019', name: 'icu-data-incomplete', severity: 'warn', fatal: 'never', exitTwo: false, owner: 'M10' },
  'icu-in-i18next-file': { code: 'LZ1020', name: 'icu-in-i18next-file', severity: 'warn', fatal: 'never', exitTwo: false, owner: 'M2' },
  'outdir-foreign-file': { code: 'LZ1021', name: 'outdir-foreign-file', severity: 'warn', fatal: 'never', exitTwo: false, owner: 'M10' },
  'icu-syntax': { code: 'LZ2001', name: 'icu-syntax', severity: 'error', fatal: 'message', exitTwo: false, owner: 'M3' },
  'icu-style-unknown': { code: 'LZ2002', name: 'icu-style-unknown', severity: 'error', fatal: 'never', exitTwo: false, owner: 'M3' },
  'icu-skeleton-invalid': { code: 'LZ2003', name: 'icu-skeleton-invalid', severity: 'error', fatal: 'never', exitTwo: false, owner: 'M3' },
  'plural-other-missing': { code: 'LZ2004', name: 'plural-other-missing', severity: 'error', fatal: 'message', exitTwo: false, owner: 'M3' },
  'select-other-missing': { code: 'LZ2005', name: 'select-other-missing', severity: 'error', fatal: 'message', exitTwo: false, owner: 'M3' },
  'plural-category-unknown': { code: 'LZ2006', name: 'plural-category-unknown', severity: 'error', fatal: 'never', exitTwo: false, owner: 'M3' },
  'arg-name-invalid': { code: 'LZ2007', name: 'arg-name-invalid', severity: 'error', fatal: 'never', exitTwo: false, owner: 'M3' },
  'pound-literal': { code: 'LZ2008', name: 'pound-literal', severity: 'warn', fatal: 'never', exitTwo: false, owner: 'M3' },
  'arg-type-conflict-local': { code: 'LZ2009', name: 'arg-type-conflict-local', severity: 'error', fatal: 'message', exitTwo: false, owner: 'M3' },
  'missing-translation': { code: 'LZ3001', name: 'missing-translation', severity: 'error', fatal: 'never', exitTwo: false, owner: 'M5' },
  'blank-translation': { code: 'LZ3002', name: 'blank-translation', severity: 'error', fatal: 'never', exitTwo: false, owner: 'M5' },
  'extra-translation': { code: 'LZ3003', name: 'extra-translation', severity: 'warn', fatal: 'never', exitTwo: false, owner: 'M5' },
  'arg-missing': { code: 'LZ3004', name: 'arg-missing', severity: 'error', fatal: 'never', exitTwo: false, owner: 'M5' },
  'arg-extra': { code: 'LZ3005', name: 'arg-extra', severity: 'error', fatal: 'never', exitTwo: false, owner: 'M5' },
  'arg-type-conflict': { code: 'LZ3006', name: 'arg-type-conflict', severity: 'error', fatal: 'never', exitTwo: false, owner: 'M5' },
  'plural-category-incomplete': { code: 'LZ3007', name: 'plural-category-incomplete', severity: 'warn', fatal: 'never', exitTwo: false, owner: 'M5' },
  'select-option-missing': { code: 'LZ3008', name: 'select-option-missing', severity: 'warn', fatal: 'never', exitTwo: false, owner: 'M5' },
  'select-option-extra': { code: 'LZ3009', name: 'select-option-extra', severity: 'error', fatal: 'never', exitTwo: false, owner: 'M5' },
  'markup-mismatch': { code: 'LZ3010', name: 'markup-mismatch', severity: 'error', fatal: 'never', exitTwo: false, owner: 'M5' },
  'date-without-timezone': { code: 'LZ3011', name: 'date-without-timezone', severity: 'off', fatal: 'never', exitTwo: false, owner: 'M5' },
  'ambiguous-source': { code: 'LZ3012', name: 'ambiguous-source', severity: 'warn', fatal: 'never', exitTwo: false, owner: 'M5' },
  'plural-category-unreachable': { code: 'LZ3013', name: 'plural-category-unreachable', severity: 'warn', fatal: 'never', exitTwo: false, owner: 'M5' },
  'identifier-collision': { code: 'LZ4001', name: 'identifier-collision', severity: 'error', fatal: 'always', exitTwo: false, owner: 'M4' },
  'identifier-reserved': { code: 'LZ4002', name: 'identifier-reserved', severity: 'error', fatal: 'always', exitTwo: false, owner: 'M4' },
  'confusable-key': { code: 'LZ4003', name: 'confusable-key', severity: 'error', fatal: 'never', exitTwo: false, owner: 'M4' },
  'group-empty': { code: 'LZ4004', name: 'group-empty', severity: 'error', fatal: 'never', exitTwo: false, owner: 'M4' },
  'nondeterministic-output': { code: 'LZ4005', name: 'nondeterministic-output', severity: 'error', fatal: 'always', exitTwo: false, owner: 'M6' },
  'group-args-heterogeneous': { code: 'LZ4006', name: 'group-args-heterogeneous', severity: 'warn', fatal: 'never', exitTwo: false, owner: 'M4' },
  'output-unwritable': { code: 'LZ5001', name: 'output-unwritable', severity: 'error', fatal: 'always', exitTwo: true, owner: 'M10' },
  'output-stale': { code: 'LZ5002', name: 'output-stale', severity: 'error', fatal: 'never', exitTwo: false, owner: 'M10' },
  'record-stale': { code: 'LZ5003', name: 'record-stale', severity: 'error', fatal: 'never', exitTwo: false, owner: 'M10' },
  'scan-found-nothing': { code: 'LZ5004', name: 'scan-found-nothing', severity: 'warn', fatal: 'never', exitTwo: false, owner: 'M7' },
  'unused-message': { code: 'LZ5005', name: 'unused-message', severity: 'off', fatal: 'never', exitTwo: false, owner: 'M7' },
  'missing-description': { code: 'LZ5006', name: 'missing-description', severity: 'off', fatal: 'never', exitTwo: false, owner: 'M8' },
  'record-rewritten': { code: 'LZ5007', name: 'record-rewritten', severity: 'warn', fatal: 'never', exitTwo: false, owner: 'M10' },
}

const NOT_RELEVELABLE: ReadonlySet<RuleName> = new Set<RuleName>([
  'config-invalid',
  'outdir-unsafe',
  'output-unwritable',
])

const RELATED_KEY_GAP = 4
const RELATED_LOCATION_GAP = 5

export function diag(rule: RuleName, fields: DiagnosticFields): Diagnostic {
  const definition = RULES[rule]
  return {
    code: definition.code,
    rule,
    severity: definition.severity === 'off' ? 'warn' : definition.severity,
    fatal: resolveFatal(definition.fatal, fields.fatal),
    message: fields.message,
    hint: fields.hint ?? null,
    file: fields.file ?? null,
    locale: fields.locale ?? null,
    key: fields.key ?? null,
    span: fields.span ?? null,
    related: fields.related ?? [],
  }
}

export function applySeverity(
  diagnostics: readonly Diagnostic[],
  overrides: Config['severity'],
): readonly Diagnostic[] {
  const kept: Diagnostic[] = []
  for (const diagnostic of diagnostics) {
    if (NOT_RELEVELABLE.has(diagnostic.rule)) {
      kept.push(diagnostic)
      continue
    }
    const effective: Severity = overrides[diagnostic.rule] ?? RULES[diagnostic.rule].severity
    if (effective === 'off') continue
    kept.push(diagnostic.severity === effective ? diagnostic : { ...diagnostic, severity: effective })
  }
  return kept
}

export function sortDiagnostics(diagnostics: readonly Diagnostic[]): readonly Diagnostic[] {
  return [...diagnostics].sort(compareDiagnostics)
}

export function hasError(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === 'error')
}

export function hasFatal(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.fatal && diagnostic.severity === 'error')
}

export function exitCodeFor(diagnostics: readonly Diagnostic[], maxWarnings: number): 0 | 1 | 2 {
  let errors = 0
  let warnings = 0
  for (const diagnostic of diagnostics) {
    if (diagnostic.severity !== 'error') {
      warnings += 1
      continue
    }
    if (RULES[diagnostic.rule].exitTwo) return 2
    errors += 1
  }
  return errors > 0 || warnings > maxWarnings ? 1 : 0
}

export function renderHuman(
  diagnostics: readonly Diagnostic[],
  options: { readonly color: boolean },
): string {
  const paint = colors(options.color)
  return diagnostics.map((diagnostic) => renderOne(diagnostic, paint)).join('\n\n')
}

export function renderJson(diagnostics: readonly Diagnostic[], summary: Summary): string {
  return JSON.stringify({ schema: 1, diagnostics: sortDiagnostics(diagnostics), summary }, null, 2)
}

interface Palette {
  readonly severity: (severity: Diagnostic['severity']) => string
  readonly code: (text: string) => string
  readonly location: (text: string) => string
}

function colors(enabled: boolean): Palette {
  const noColor = (process.env['NO_COLOR'] ?? '') !== ''
  const active = pc.createColors(enabled && !noColor)
  return {
    severity: (severity) => (severity === 'error' ? active.red(severity) : active.yellow(severity)),
    code: (text) => active.dim(text),
    location: (text) => active.cyan(text),
  }
}

function resolveFatal(scope: FatalScope, declared: boolean | undefined): boolean {
  if (scope === 'always') return true
  if (scope === 'ifSource') return declared ?? true
  return false
}

function compareDiagnostics(a: Diagnostic, b: Diagnostic): number {
  return (
    // 'error' precedes 'warn' by code point, which is the order the reporter wants.
    compareCodepoint(a.severity, b.severity) ||
    compareCodepoint(a.code, b.code) ||
    compareNullable(a.file, b.file) ||
    compareNullable(a.locale, b.locale) ||
    compareNullable(a.key, b.key) ||
    (a.span?.offset ?? -1) - (b.span?.offset ?? -1)
  )
}

function compareNullable(a: string | null, b: string | null): number {
  if (a === b) return 0
  if (a === null) return -1
  if (b === null) return 1
  return compareCodepoint(a, b)
}

function renderOne(diagnostic: Diagnostic, paint: Palette): string {
  const lines: string[] = [renderHeader(diagnostic, paint), '']
  for (const line of diagnostic.message.split('\n')) lines.push(indent(line, 2))
  if (diagnostic.related.length > 0) {
    lines.push('')
    for (const line of renderRelated(diagnostic.related)) lines.push(line)
  }
  if (diagnostic.hint !== null) {
    lines.push('')
    for (const line of renderHint(diagnostic.hint)) lines.push(line)
  }
  return lines.join('\n')
}

function renderHeader(diagnostic: Diagnostic, paint: Palette): string {
  const parts = [paint.severity(diagnostic.severity), paint.code(diagnostic.code), diagnostic.rule]
  const location = locationOf(diagnostic.file, diagnostic.span)
  if (location !== '') parts.push(paint.location(location))
  if (diagnostic.locale !== null) parts.push(diagnostic.locale)
  if (diagnostic.key !== null) parts.push(diagnostic.key)
  return parts.join('  ')
}

function renderRelated(related: readonly Related[]): readonly string[] {
  const rows = related.map((entry) => ({
    label: entry.key ?? entry.locale ?? '',
    location: locationOf(entry.file, entry.span),
    message: entry.message,
  }))
  const labelWidth = Math.max(...rows.map((row) => row.label.length))
  const locationWidth = Math.max(...rows.map((row) => row.location.length))
  return rows.map((row) => {
    let line = ''
    if (labelWidth > 0) line += row.label.padEnd(labelWidth + RELATED_KEY_GAP)
    if (locationWidth > 0) line += row.location.padEnd(locationWidth + RELATED_LOCATION_GAP)
    return indent(line + row.message, 4)
  })
}

function renderHint(hint: string): readonly string[] {
  const [first = '', ...rest] = hint.split('\n')
  return [indent(`fix  ${first}`, 2), ...rest.map((line) => indent(line, 2))]
}

function locationOf(file: string | null, span: Diagnostic['span']): string {
  if (file === null) return ''
  return span === null ? file : `${file}:${span.line}:${span.column}`
}

function indent(line: string, width: number): string {
  return line === '' ? '' : `${' '.repeat(width)}${line}`
}
