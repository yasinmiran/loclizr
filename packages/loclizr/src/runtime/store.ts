import type { Locale, LocaleListener, SetLocaleOptions } from '../types'

export function getLocale(): Locale {
  throw new Error('not implemented')
}

export function setLocale(locale: Locale, options?: SetLocaleOptions): void {
  throw new Error('not implemented')
}

export function subscribe(listener: LocaleListener): () => void {
  throw new Error('not implemented')
}

export function getRawLocale(): string {
  throw new Error('not implemented')
}

export function registerDefaults(setup: {
  readonly locales: readonly string[]
  readonly sourceLocale: string
  readonly cookie: string
}): void {
  throw new Error('not implemented')
}

export function matchLocale(
  requested: string,
  known: readonly string[],
  fallback: string,
): string {
  throw new Error('not implemented')
}
