import type { NegotiateOptions } from '../types'
import { readCookie } from './cookie'
import { matchLocale } from './store'

// Pure, so the browser entry carries them too: a client-rendered app
// negotiates its first locale from navigator.languages with the cookie reader
// the store and the server share.

interface AcceptedRange {
  readonly tag: string
  readonly quality: number
  readonly order: number
}

export function negotiate(accepted: readonly string[], options: NegotiateOptions): string {
  const ranked: AcceptedRange[] = accepted
    .map(parseRange)
    .filter((range) => range.quality > 0 && range.tag !== '' && range.tag !== '*')
    .sort((a, b) => b.quality - a.quality || a.order - b.order)
  for (const range of ranked) {
    // The empty fallback separates "this range matched nothing" from "this
    // range matched the source locale", so a later range still gets its turn.
    const matched = matchLocale(range.tag, options.locales, '')
    if (matched !== '') return matched
  }
  return options.sourceLocale
}

// The primitive. loclizr/server's localeFromRequest is a thin wrapper that
// reads the two headers off a Fetch Request and calls this, so the two cannot
// drift.
export function localeFromHeaders(
  headers: {
    readonly cookie?: string | undefined
    readonly acceptLanguage?: string | undefined
  },
  options: NegotiateOptions,
): string {
  const cookie =
    headers.cookie === undefined ? null : readCookie(headers.cookie, options.cookie ?? 'locale')
  // A cookie that matches nothing resolves to the source locale rather than
  // falling through to Accept-Language, because the client reads the same
  // cookie through the same matcher and the two answers have to agree across
  // the hydration boundary.
  if (cookie !== null) return matchLocale(cookie, options.locales, options.sourceLocale)
  const accepted = headers.acceptLanguage
  if (accepted !== undefined && accepted.trim() !== '') {
    return negotiate(accepted.split(','), options)
  }
  return options.sourceLocale
}

function parseRange(entry: string, order: number): AcceptedRange {
  const [head = '', ...parameters] = entry.split(';')
  let quality = 1
  for (const parameter of parameters) {
    const [name = '', value = ''] = parameter.split('=')
    if (name.trim().toLowerCase() !== 'q') continue
    quality = parseQuality(value.trim())
  }
  return { tag: head.trim(), quality, order }
}

// A weight that is not a plain decimal reads as 0 and drops the range, and one
// above 1 counts as 1, so a malformed or hand-built weight cannot jump ahead of
// a range the client listed earlier at full quality.
function parseQuality(value: string): number {
  if (!/^(?:\d+\.?\d*|\.\d+)$/.test(value)) return 0
  return Math.min(Number(value), 1)
}
