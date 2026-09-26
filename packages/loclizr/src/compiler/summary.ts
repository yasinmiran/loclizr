import type { Diagnostic, Program, Summary } from '../types'
import { compareCodepoint } from '../util'

export function summarize(
  diagnostics: readonly Diagnostic[],
  program: Program | null,
  locales: number,
): Summary {
  let errors = 0
  let warnings = 0
  for (const diagnostic of diagnostics) {
    if (diagnostic.severity === 'error') errors += 1
    else warnings += 1
  }
  return {
    errors,
    warnings,
    messages: program?.messages.length ?? 0,
    locales,
    fellBack: fellBack(program),
  }
}

function fellBack(
  program: Program | null,
): readonly { readonly locale: string; readonly count: number }[] {
  if (program === null) return []
  const counts = new Map<string, number>()
  for (const message of program.messages) {
    for (const entry of message.origins) {
      if (entry.origin.status !== 'fallback') continue
      counts.set(entry.locale, (counts.get(entry.locale) ?? 0) + 1)
    }
  }
  return [...counts]
    .sort(([left], [right]) => compareCodepoint(left, right))
    .map(([locale, count]) => ({ locale, count }))
}
