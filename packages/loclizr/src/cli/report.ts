import { renderHuman, renderJson, sortDiagnostics } from '../diagnostics'
import type { BuildResult, Config, Program, Summary } from '../types'

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
  const program = result.program
  if (program !== null && (!options.quiet || accountsForHidden)) {
    blocks.push(renderSummary(result, program, options.quiet))
  }

  return blocks.length === 0 ? '' : `${blocks.join('\n\n')}\n`
}

function renderSummary(result: BuildResult, program: Program, quiet: boolean): string {
  const lines = quiet ? [] : [...artifactLines(result, program.config)]
  lines.push(counts(result.summary, program.sourceLocale))
  if (result.summary.fellBack.length > 0) {
    const fellBack = result.summary.fellBack
      .map((entry) => `${entry.locale} ${entry.count}`)
      .join(', ')
    lines.push(`fell back to source text: ${fellBack}`)
  }
  return lines.join('\n')
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
// of it anywhere in the run.
function counts(summary: Summary, sourceLocale: string): string {
  return [
    countOf(summary.messages, 'message'),
    `${countOf(summary.locales, 'locale')} (source ${sourceLocale})`,
    countOf(summary.errors, 'error'),
    countOf(summary.warnings, 'warning'),
  ].join(', ')
}

function countOf(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}
