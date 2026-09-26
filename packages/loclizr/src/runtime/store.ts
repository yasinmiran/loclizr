import type { Locale, LocaleListener, SetLocaleOptions } from '../types'
import { readCookie } from './cookie'
import { localeScope, scopedLocale, storeState, warnOnce } from './state'

const PLAUSIBLE_TAG = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/
const ONE_YEAR = 31536000

export function getLocale(): Locale {
  const state = storeState()
  const raw = getRawLocale()
  // The define read comes last so a build that never substituted it is only
  // reached on the path that was about to warn.
  if (raw === '' && detached() && process.env.NODE_ENV !== 'production') {
    warnOnce(
      'detached',
      'getLocale() ran outside a request scope, so it returned the source locale. Wrap the render in runWithLocale().',
    )
  }
  const { setup } = state
  if (setup === null) {
    if (process.env.NODE_ENV !== 'production') {
      warnOnce(
        'unregistered',
        'getLocale() ran before any generated message module was imported, so no locale list is registered. Import from your generated messages.',
      )
    }
    // The stored tag alone, never a detected one: setLocale took a declared
    // locale, while a cookie is whatever the wire carried.
    return state.raw ?? 'en'
  }
  return matchLocale(raw, setup.locales, setup.sourceLocale)
}

export function setLocale(locale: Locale, options?: SetLocaleOptions): void {
  if (scopedLocale() !== undefined) {
    throw new Error(
      'loclizr: setLocale() cannot run inside a request scope. Pass { locale } per call instead.',
    )
  }
  const state = storeState()
  state.raw = locale
  if (typeof document !== 'undefined') {
    if (options?.persist !== false) {
      document.cookie = `${cookieName()}=${encodeURIComponent(locale)}; path=/; max-age=${ONE_YEAR}; SameSite=Lax`
    }
    document.documentElement.lang = locale
  }
  for (const listener of [...state.listeners]) listener()
}

export function subscribe(listener: LocaleListener): () => void {
  const { listeners } = storeState()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getRawLocale(): string {
  const scoped = scopedLocale()
  if (scoped !== undefined) return scoped
  const state = storeState()
  if (state.raw !== null) return state.raw
  // Latched on the first read, so a cookie written afterwards cannot move a
  // snapshot useSyncExternalStore has already handed out with no notification.
  if (state.detected === null) state.detected = detect()
  return state.detected
}

export function registerDefaults(setup: {
  readonly locales: readonly string[]
  readonly sourceLocale: string
  readonly cookie: string
}): void {
  const state = storeState()
  const registered = state.setup
  if (registered === null) {
    state.setup = setup
    return
  }
  const same =
    registered.sourceLocale === setup.sourceLocale &&
    registered.cookie === setup.cookie &&
    registered.locales.length === setup.locales.length &&
    registered.locales.every((tag, index) => tag === setup.locales[index])
  if (same) return
  if (process.env.NODE_ENV !== 'production') {
    warnOnce(
      'reregistered',
      `a second generated directory registered [${setup.locales.join(', ')}]; the first registration keeps getLocale().`,
    )
  }
}

export function matchLocale(requested: string, known: readonly string[], fallback: string): string {
  if (requested === '' || known.length === 0) return fallback
  let tag = requested.toLowerCase()
  for (;;) {
    for (const candidate of known) {
      if (candidate.toLowerCase() === tag) return candidate
    }
    const cut = tag.lastIndexOf('-')
    if (cut === -1) return fallback
    tag = tag.slice(0, cut)
  }
}

function detached(): boolean {
  const scope = localeScope()
  return scope !== undefined && scope.getStore() === undefined
}

function detect(): string {
  if (typeof document === 'undefined') return ''
  const fromCookie = readCookie(document.cookie, cookieName())
  if (fromCookie !== null) return fromCookie
  const declared = document.documentElement.lang
  return PLAUSIBLE_TAG.test(declared) ? declared : ''
}

function cookieName(): string {
  return storeState().setup?.cookie ?? 'locale'
}
