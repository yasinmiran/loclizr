import type { IntlOptions, LocaleResolver, LocaleSetup } from '../types'

export function $configure1(setup: LocaleSetup): LocaleResolver {
  throw new Error('not implemented')
}

export function $plural1(locale: string, value: number, ordinal: boolean): string {
  throw new Error('not implemented')
}

export function $number1(locale: string, value: number, options: IntlOptions): string {
  throw new Error('not implemented')
}

export function $dateTime1(locale: string, value: Date | number, options: IntlOptions): string {
  throw new Error('not implemented')
}
