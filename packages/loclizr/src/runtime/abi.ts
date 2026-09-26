import type { IntlOptions, LocaleResolver, LocaleSetup } from '../types'
import { getRawLocale, matchLocale, registerDefaults } from './store'

// Keyed by the identity of the hoisted options object, never by a serialized
// key, so two namespaces sharing a format share one formatter.
const numberFormats = new WeakMap<IntlOptions, Map<string, Intl.NumberFormat>>()
const dateTimeFormats = new WeakMap<IntlOptions, Map<string, Intl.DateTimeFormat>>()
const pluralRules = new Map<string, Intl.PluralRules>()

export function $configure1(setup: LocaleSetup): LocaleResolver {
  registerDefaults(setup)
  const { locales, sourceLocale } = setup
  return (options) => matchLocale(options?.locale ?? getRawLocale(), locales, sourceLocale)
}

export function $plural1(locale: string, value: number, ordinal: boolean): string {
  const key = `${locale}\u0000${ordinal ? 'o' : 'c'}`
  let rules = pluralRules.get(key)
  if (rules === undefined) {
    rules = new Intl.PluralRules(locale, { type: ordinal ? 'ordinal' : 'cardinal' })
    pluralRules.set(key, rules)
  }
  return rules.select(value)
}

export function $number1(locale: string, value: number, options: IntlOptions): string {
  return cached(
    numberFormats,
    locale,
    options,
    () => new Intl.NumberFormat(locale, options as unknown as Intl.NumberFormatOptions),
  ).format(value)
}

export function $dateTime1(locale: string, value: Date | number, options: IntlOptions): string {
  return cached(
    dateTimeFormats,
    locale,
    options,
    () => new Intl.DateTimeFormat(locale, options as unknown as Intl.DateTimeFormatOptions),
  ).format(value)
}

function cached<F>(
  cache: WeakMap<IntlOptions, Map<string, F>>,
  locale: string,
  options: IntlOptions,
  create: () => F,
): F {
  let byLocale = cache.get(options)
  if (byLocale === undefined) {
    byLocale = new Map()
    cache.set(options, byLocale)
  }
  let formatter = byLocale.get(locale)
  if (formatter === undefined) {
    formatter = create()
    byLocale.set(locale, formatter)
  }
  return formatter
}
