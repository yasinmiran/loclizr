import type { IntlOptions } from '../types'

export const NAMED_NUMBER_STYLES: Readonly<Record<string, IntlOptions>> = Object.freeze({
  integer: Object.freeze({ maximumFractionDigits: 0 }),
  percent: Object.freeze({ style: 'percent' }),
})

export const NAMED_DATE_STYLES: Readonly<Record<string, IntlOptions>> = Object.freeze({
  short: Object.freeze({ dateStyle: 'short' }),
  medium: Object.freeze({ dateStyle: 'medium' }),
  long: Object.freeze({ dateStyle: 'long' }),
  full: Object.freeze({ dateStyle: 'full' }),
})

export const NAMED_TIME_STYLES: Readonly<Record<string, IntlOptions>> = Object.freeze({
  short: Object.freeze({ timeStyle: 'short' }),
  medium: Object.freeze({ timeStyle: 'medium' }),
  long: Object.freeze({ timeStyle: 'long' }),
  full: Object.freeze({ timeStyle: 'full' }),
})

export const BARE_NUMBER_OPTIONS: IntlOptions = Object.freeze({})

export const BARE_DATE_OPTIONS: IntlOptions = Object.freeze({ dateStyle: 'medium' })

export const BARE_TIME_OPTIONS: IntlOptions = Object.freeze({ timeStyle: 'medium' })
