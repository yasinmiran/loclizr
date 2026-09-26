import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { $configure1 } from './abi'
import { resetRuntime } from './__fixtures__/reset'
import { getLocale, getRawLocale, registerDefaults, setLocale, subscribe } from './store'

const SETUP = { locales: ['de', 'de-AT', 'en'], sourceLocale: 'en', cookie: 'locale' } as const

const SRC = dirname(dirname(fileURLToPath(import.meta.url)))

const RUNTIME_TYPES = [
  'EmptyArgs',
  'IntlOptions',
  'Locale',
  'LocaleListener',
  'LocaleRegistry',
  'LocaleResolver',
  'LocaleSetup',
  'LoclizrConfig',
  'MessageOptions',
  'NegotiateOptions',
  'SetLocaleOptions',
]

function reachableFrom(entry: string): readonly string[] {
  const pending = [entry]
  const seen = new Set<string>()
  while (pending.length > 0) {
    const file = pending.pop()
    if (file === undefined || seen.has(file)) continue
    seen.add(file)
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(/(?:from|import)\s*'([^']+)'/g)) {
      const specifier = match[1]
      if (specifier === undefined || !specifier.startsWith('.')) continue
      const target = `${resolve(dirname(file), specifier)}.ts`
      if (existsSync(target)) pending.push(target)
    }
  }
  return [...seen]
}

function sourceOf(file: string): string {
  return readFileSync(resolve(SRC, file), 'utf8')
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window')
  vi.unstubAllEnvs()
  resetRuntime()
  vi.restoreAllMocks()
})

describe('a runtime with a window and no document', () => {
  test('keeps an in-memory store, notifies subscribers and persists nothing', () => {
    ;(globalThis as unknown as Record<string, unknown>)['window'] = {}
    expect(typeof window).not.toBe('undefined')
    expect(typeof document).toBe('undefined')
    registerDefaults(SETUP)
    const listener = vi.fn()
    subscribe(listener)
    expect(() => setLocale('de-at')).not.toThrow()
    expect(listener).toHaveBeenCalledTimes(1)
    expect(getRawLocale()).toBe('de-at')
    expect(getLocale()).toBe('de-AT')
  })

  test('detects no initial locale rather than reading a fake document', () => {
    ;(globalThis as unknown as Record<string, unknown>)['window'] = {
      document: { cookie: 'locale=de', documentElement: { lang: 'de' } },
    }
    const resolver = $configure1(SETUP)
    expect(getRawLocale()).toBe('')
    expect(resolver()).toBe('en')
  })
})

describe('production', () => {
  // Each warning sits behind a bare `process.env.NODE_ENV` read, which is what
  // lets a define fold the message text out of a production bundle and what
  // makes a runtime with neither a define nor a `process` throw on that line.
  // The resolved path never reaches one, so answering a locale never depends
  // on either being there.
  test('answers a registered locale with no process at all', () => {
    const host = globalThis as unknown as Record<string, unknown>
    const original = host['process']
    Reflect.deleteProperty(globalThis, 'process')
    try {
      registerDefaults(SETUP)
      setLocale('de-at')
      expect(getRawLocale()).toBe('de-at')
      expect(getLocale()).toBe('de-AT')
      expect($configure1(SETUP)()).toBe('de-AT')
    } finally {
      host['process'] = original
    }
  })

  test('silences the unregistered warning without changing the answer', () => {
    vi.stubEnv('NODE_ENV', 'production')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(getLocale()).toBe('en')
    setLocale('de')
    expect(getLocale()).toBe('de')
    expect(warn).not.toHaveBeenCalled()
  })

  test('silences the second registration without letting it win', () => {
    vi.stubEnv('NODE_ENV', 'production')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const first = $configure1(SETUP)
    const second = $configure1({ locales: ['en', 'fr'], sourceLocale: 'fr', cookie: 'lang' })
    setLocale('fr')
    expect(warn).not.toHaveBeenCalled()
    expect(getLocale()).toBe('en')
    expect(second()).toBe('fr')
    expect(first()).toBe('en')
  })
})

describe('the loclizr entry', () => {
  test('reaches no node builtin and no server or react file', () => {
    const reachable = reachableFrom(resolve(SRC, 'index.ts'))
    expect(reachable.length).toBeGreaterThan(1)
    for (const file of reachable) {
      expect(file).not.toContain(`${SRC}/server/`)
      expect(file).not.toContain(`${SRC}/react/`)
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/from '(?:node:|react)/)
    }
  })

  test('re-exports every runtime type, which is what makes the augmentation land', () => {
    const text = sourceOf('index.ts')
    for (const name of RUNTIME_TYPES) {
      expect(text, name).toMatch(new RegExp(`\\b${name}\\b`))
    }
    expect(text).toMatch(/export type \{[\s\S]*\} from '\.\/types'/)
  })

  test('keeps the four ABI helpers on their versioned names', () => {
    const text = sourceOf('index.ts')
    for (const name of ['$configure1', '$dateTime1', '$number1', '$plural1']) {
      expect(text, name).toContain(name)
    }
  })
})

describe('the react and server entries', () => {
  test('publish their three and five functions and no internals', async () => {
    const react = await import('../react/index')
    const server = await import('../server/index')
    expect(Object.keys(react).sort()).toEqual(['Parts', 'useLocale', 'useSetLocale'])
    expect(Object.keys(server).sort()).toEqual([
      'localeFromHeaders',
      'localeFromRequest',
      'negotiate',
      'runWithLocale',
      'withLocale',
    ])
  })
})
