import type { Locale, LocaleListener, SetLocaleOptions } from '../types'
import { readCookie } from './cookie'
import { localeScope, scopedLocale, storeState, warnOnce } from './state'
import type { StoreState } from './state'

const PLAUSIBLE_TAG = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/
const ONE_YEAR = 31536000

export function getLocale(): Locale {
  const state = storeState()
  const raw = getRawLocale()
  const { setup } = state
  if (setup === null) {
    try {
      if (process.env.NODE_ENV !== 'production') {
        warnOnce(
          'unregistered',
          'getLocale() ran before any generated message module was imported, so no locale list is registered. Import from your generated messages.',
        )
      }
    } catch {}
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
      // A lone surrogate is the one string encodeURIComponent rejects; written
      // as U+FFFD it reads back as an unknown tag, which resolves exactly as the
      // stored one does.
      const stored = locale.replace(/\p{Cs}/gu, '\uFFFD')
      const name = cookieName()
      document.cookie = `${name}=${encodeURIComponent(stored)}; path=/; max-age=${ONE_YEAR}; SameSite=Lax`
      // A file:// page keeps no cookie while navigator.cookieEnabled says true.
      try {
        if (
          process.env.NODE_ENV !== 'production' &&
          (readCookie(document.cookie, name) ?? '') !== stored
        ) {
          warnOnce(
            'unstored',
            'the locale cookie was not stored (file:// or blocked), so the choice ends on reload. Persist it and call setLocale() on startup.',
          )
        }
      } catch {}
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
  // Every locale read, a message call's included, passes through here, so this
  // is the one place an escaped request scope shows. The define read comes last
  // so a build that never substituted it is only reached on the path that was
  // about to warn.
  try {
    if (state.detected === '' && detached() && process.env.NODE_ENV !== 'production') {
      warnOnce(
        'detached',
        'a message or getLocale() ran outside a request scope, so it used the source locale. Wrap the whole request in runWithLocale(): loaders, actions and the render.',
      )
    }
  } catch {}
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
    declarePendingLang(state)
    return
  }
  const same =
    registered.sourceLocale === setup.sourceLocale &&
    registered.cookie === setup.cookie &&
    registered.locales.length === setup.locales.length &&
    registered.locales.every((tag, index) => tag === setup.locales[index])
  if (same) return
  try {
    if (process.env.NODE_ENV !== 'production') {
      warnOnce(
        'reregistered',
        `a second generated directory registered [${setup.locales.join(', ')}]; the first registration keeps getLocale().`,
      )
    }
  } catch {}
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
  if (fromCookie !== null) {
    // Only a cookie can name a locale the document does not already declare.
    const state = storeState()
    state.pendingLang = fromCookie
    declarePendingLang(state)
    return fromCookie
  }
  const declared = document.documentElement.lang
  return PLAUSIBLE_TAG.test(declared) ? declared : ''
}

// Once setLocale has run it owns lang, so a late registration leaves it alone.
// An older copy's store has no pendingLang at all, hence the loose test.
function declarePendingLang(state: StoreState): void {
  if (state.pendingLang == null || state.setup === null || state.raw !== null) return
  const { locales, sourceLocale } = state.setup
  document.documentElement.lang = matchLocale(state.pendingLang, locales, sourceLocale)
  state.pendingLang = null
}

function cookieName(): string {
  return storeState().setup?.cookie ?? 'locale'
}
