import type { LocaleSetup } from '../types'

// A locale scope as the client half sees it: `node:async_hooks` is imported by
// `src/server` alone, so the browser entry stays free of it.
export interface LocaleScope {
  getStore(): string | undefined
}

export interface StoreState {
  raw: string | null
  // Kept apart from `raw` so a stored tag and a detected one stay
  // distinguishable: only the first is a locale somebody asked for.
  detected: string | null
  setup: LocaleSetup | null
  readonly listeners: Set<() => void>
  readonly warned: Set<string>
}

// Immutable handles on globalThis, so duplicated module graphs and duplicate
// installs share one subscriber list and one request scope.
const STORE_KEY: unique symbol = Symbol.for('loclizr.store')
const SCOPE_KEY: unique symbol = Symbol.for('loclizr.locale')

type GlobalSlots = { [key: symbol]: unknown }

function slots(): GlobalSlots {
  return globalThis as unknown as GlobalSlots
}

export function storeState(): StoreState {
  const existing = slots()[STORE_KEY]
  if (existing !== undefined) return existing as StoreState
  const created: StoreState = {
    raw: null,
    detected: null,
    setup: null,
    listeners: new Set(),
    warned: new Set(),
  }
  slots()[STORE_KEY] = created
  return created
}

export function localeScope(): LocaleScope | undefined {
  return slots()[SCOPE_KEY] as LocaleScope | undefined
}

export function setLocaleScope(scope: LocaleScope): void {
  slots()[SCOPE_KEY] = scope
}

export function scopedLocale(): string | undefined {
  return localeScope()?.getStore()
}

// Every call site guards this with a bare `process.env.NODE_ENV !== 'production'`
// rather than calling a helper, because the guard is what a bundler's define
// turns into a constant, and only a constant lets the branch and its message
// text drop out of a production bundle. Wrapping the read costs every app the
// full text of every warning it can never print. Each guarded statement sits in
// a try instead: with neither a define nor a `process` (a page with no bundler,
// an isolate) the read throws, and a skipped warning beats a crash. A `typeof
// process` test would also skip it in a browser dev build, where only the
// define exists.
export function warnOnce(key: string, message: string): void {
  const { warned } = storeState()
  if (warned.has(key)) return
  warned.add(key)
  console.warn(`loclizr: ${message}`)
}
