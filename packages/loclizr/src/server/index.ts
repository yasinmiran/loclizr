import { AsyncLocalStorage } from 'node:async_hooks'
import type { NegotiateOptions } from '../types'
import { localeFromHeaders } from '../runtime/negotiate'
import { localeScope, setLocaleScope } from '../runtime/state'

export function runWithLocale<T>(locale: string, fn: () => T): T {
  return scope().run(locale, fn)
}

// withLocale sets Content-Language and lists Accept-Language and Cookie in Vary
// on the response.
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

export function localeFromRequest(request: Request, options: NegotiateOptions): string {
  return localeFromHeaders(
    {
      cookie: request.headers.get('cookie') ?? undefined,
      acceptLanguage: request.headers.get('accept-language') ?? undefined,
    },
    options,
  )
}

function scope(): AsyncLocalStorage<string> {
  const installed = localeScope()
  if (installed !== undefined) return installed as AsyncLocalStorage<string>
  const created = new AsyncLocalStorage<string>()
  setLocaleScope(created)
  return created
}

// Installed on load rather than on the first request, so a getLocale() that
// runs before any request warns the same as one that runs between requests.
scope()

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
  const listed = new Set(fields.map((field) => field.toLowerCase()))
  const missing = LOCALE_INPUTS.filter((field) => !listed.has(field.toLowerCase()))
  if (missing.length > 0) headers.set('Vary', [...fields, ...missing].join(', '))
}

// Vary names the inputs the locale is selected from, not the one that decided
// this response: a cache keyed only on what decided would store a page rendered
// without a cookie and serve it to a viewer who has one.
const LOCALE_INPUTS: readonly string[] = ['Accept-Language', 'Cookie']

export { localeFromHeaders, negotiate } from '../runtime/negotiate'
export type { NegotiateOptions } from '../types'
