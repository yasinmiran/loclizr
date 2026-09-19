import type { NegotiateOptions } from '../types'

export function runWithLocale<T>(locale: string, fn: () => T): T {
  throw new Error('not implemented')
}

// withLocale sets Content-Language and Vary: Accept-Language on the response.
export function withLocale<A extends unknown[]>(
  handler: (request: Request, ...rest: A) => Response | Promise<Response>,
  options: NegotiateOptions,
): (request: Request, ...rest: A) => Promise<Response> {
  throw new Error('not implemented')
}

export function negotiate(accepted: readonly string[], options: NegotiateOptions): string {
  throw new Error('not implemented')
}

export function localeFromRequest(request: Request, options: NegotiateOptions): string {
  throw new Error('not implemented')
}
