import { AsyncLocalStorage } from 'node:async_hooks'
import type { NegotiateOptions } from '../types'
import { readCookie } from '../runtime/cookie'
import { localeScope, setLocaleScope } from '../runtime/state'
import { matchLocale } from '../runtime/store'

interface AcceptedRange {
  readonly tag: string
  readonly quality: number
  readonly order: number
}

export function runWithLocale<T>(locale: string, fn: () => T): T {
  return scope().run(locale, fn)
}

// withLocale sets Content-Language and Vary: Accept-Language on the response.
export function withLocale<A extends unknown[]>(
  handler: (request: Request, ...rest: A) => Response | Promise<Response>,
  options: NegotiateOptions,
): (request: Request, ...rest: A) => Promise<Response>
// Bun's fetch handler returns undefined once server.upgrade() has taken the
// socket, and Bun answers the handshake itself.
export function withLocale<A extends unknown[]>(
  handler: (request: Request, ...rest: A) => Response | undefined | Promise<Response | undefined>,
  options: NegotiateOptions,
): (request: Request, ...rest: A) => Promise<Response | undefined>
export function withLocale<A extends unknown[]>(
  handler: (request: Request, ...rest: A) => Response | undefined | Promise<Response | undefined>,
  options: NegotiateOptions,
): (request: Request, ...rest: A) => Promise<Response | undefined> {
  return async (request, ...rest) => {
    const locale = localeFromRequest(request, options)
    const response = await runWithLocale(locale, () => handler(request, ...rest))
    if (response === undefined) return response
    return announce(response, locale)
  }
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

export function localeFromRequest(request: Request, options: NegotiateOptions): string {
  return localeFromHeaders(
    {
      cookie: request.headers.get('cookie') ?? undefined,
      acceptLanguage: request.headers.get('accept-language') ?? undefined,
    },
    options,
  )
}

// The primitive. localeFromRequest is a thin wrapper that reads the two headers
// off a Fetch Request and calls this, so the two cannot drift.
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

function scope(): AsyncLocalStorage<string> {
  const installed = localeScope()
  if (installed !== undefined) return installed as AsyncLocalStorage<string>
  const created = new AsyncLocalStorage<string>()
  setLocaleScope(created)
  return created
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

function announce(response: Response, locale: string): Response {
  try {
    stamp(response.headers, locale)
    return response
  } catch {
    // A network error carries no headers to stamp and status 0, which the
    // Response constructor rejects.
    if (response.type === 'error') return response
    const headers = new Headers(response.headers)
    stamp(headers, locale)
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  }
}

function stamp(headers: Headers, locale: string): void {
  headers.set('Content-Language', locale)
  const fields = (headers.get('Vary') ?? '')
    .split(',')
    .map((field) => field.trim())
    .filter((field) => field !== '')
  const lists = fields.some((field) => field.toLowerCase() === 'accept-language')
  if (!lists) headers.set('Vary', [...fields, 'Accept-Language'].join(', '))
}

export type { NegotiateOptions } from '../types'
