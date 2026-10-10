import { renderHuman, renderJson, sortDiagnostics } from '../diagnostics'
import type { BuildResult, Config, Diagnostic, Program, Summary } from '../types'

export interface ReportOptions {
  readonly reporter: 'human' | 'json'
  readonly quiet: boolean
  readonly color: boolean
}

export function renderReport(result: BuildResult, options: ReportOptions): string {
  // The JSON payload is a machine contract whose summary counts have to agree
  // with the diagnostics beside them, so --quiet does not thin it.
  if (options.reporter === 'json') return `${renderJson(result.diagnostics, result.summary)}\n`

  const shown = options.quiet
    ? result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')
    : result.diagnostics

  // A quiet run whose only diagnostics were warnings still exits 1 under
  // --max-warnings, so the summary stays as the one line that accounts for what
  // the filter dropped. It is keyed on the filter rather than on the exit code,
  // because --no-fail moves the code and must move nothing that is printed.
  const accountsForHidden = shown.length < result.diagnostics.length
  const blocks: string[] = []
  const diagnostics = renderHuman(sortDiagnostics(shown), { color: options.color })
  if (diagnostics !== '') blocks.push(diagnostics)
  // Only a run that exits 2 with no program never got far enough to count
  // anything. A run a fatal diagnostic blocked built no program yet still exits
  // 1 and owes its counts, and an unwritable output (exit 2) analyzed every
  // message first. --no-fail never touches 2, so this gate is safe from it.
  const counted = result.program !== null || result.exitCode !== 2
  const blocked = blockedLine(result.diagnostics)
  const showCounts = !options.quiet || accountsForHidden
  if (counted && (showCounts || blocked !== null)) {
    blocks.push(renderSummary(result, result.program, { quiet: options.quiet, showCounts, blocked }))
  }

  return blocks.length === 0 ? '' : `${blocks.join('\n\n')}\n`
}

interface SummaryOptions {
  readonly quiet: boolean
  readonly showCounts: boolean
  readonly blocked: string | null
}

function renderSummary(result: BuildResult, program: Program | null, options: SummaryOptions): string {
  const lines =
    options.blocked !== null
      ? [options.blocked]
      : options.quiet || program === null
        ? []
        : [...artifactLines(result, program.config)]
  if (options.showCounts) lines.push(counts(result.summary, program?.sourceLocale ?? null))
  // The fallback counts describe a tree, and a blocked run rendered none.
  if (options.showCounts && options.blocked === null && result.summary.fellBack.length > 0) {
    const fellBack = result.summary.fellBack
      .map((entry) => `${entry.locale} ${entry.count}`)
      .join(', ')
    lines.push(`fell back to source text: ${fellBack}`)
  }
  return lines.join('\n')
}

// A blocked run and an unchanged rerun both print no `wrote` line, so this is
// what tells them apart and points at the code that stopped the tree. It reads
// the stamped fatality, as the write decision does, because a fatal rule turned
// down to warn or off blocks all the same. LZ5001 is left out: the write step
// raises it after the decision to write, so the tree may be on disk, and its
// message names what was not written. Codes only, because a key is catalog text
// that only the diagnostic renderer sanitizes.
function blockedLine(diagnostics: readonly Diagnostic[]): string | null {
  const fatal = sortDiagnostics(diagnostics).filter(
    (diagnostic) => diagnostic.fatal && diagnostic.rule !== 'output-unwritable',
  )
  if (fatal.length === 0) return null
  const codes = [...new Set(fatal.map((diagnostic) => diagnostic.code))]
  return `nothing generated: ${fatal.length} fatal (${codes.join(', ')})`
}

// The record is the artifact meant to land in the pull request, and a run that
// names only its counts leaves the user to discover it from LZ5003 later.
function artifactLines(result: BuildResult, config: Config): readonly string[] {
  const record = typeof config.record === 'string' ? config.record : null
  const wroteRecord = record !== null && result.written.includes(record)
  const generated = result.written.filter((path) => path.startsWith(`${config.outDir}/`)).length

  const parts: string[] = []
  if (generated > 0) parts.push(`${config.outDir} (${countOf(generated, 'file')})`)
  if (wroteRecord && record !== null) parts.push(record)
  if (parts.length === 0) return []

  const lines = [`wrote ${parts.join(' and ')}`]
  // LZ5007 already says to commit the record it rewrote, so the reminder is for
  // the run that produced one without a warning to carry it.
  const rewritten = result.diagnostics.some((d) => d.rule === 'record-rewritten')
  if (wroteRecord && record !== null && !rewritten) {
    lines.push(`commit ${record}; \`loclizr check\` compares it`)
  }
  return lines
}

// The source locale is inferred where no config declares it, and a project
// holding only `locales/de.json` compiles with `de` as source and no other sign
// of it anywhere in the run. A run blocked before analysis built no program to
// name it from.
function counts(summary: Summary, sourceLocale: string | null): string {
  const locales = countOf(summary.locales, 'locale')
  return [
    countOf(summary.messages, 'message'),
    sourceLocale === null ? locales : `${locales} (source ${sourceLocale})`,
    countOf(summary.errors, 'error'),
    countOf(summary.warnings, 'warning'),
  ].join(', ')
}

function countOf(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}
