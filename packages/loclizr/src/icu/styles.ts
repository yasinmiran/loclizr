import type { IntlOptions } from '../types'

// A style token straight out of a catalog indexes these tables, so they carry no
// prototype: `{x, number, toString}` must miss and raise LZ2002 rather than
// resolving to a function.
function styleTable(styles: Record<string, IntlOptions>): Readonly<Record<string, IntlOptions>> {
  const table: Record<string, IntlOptions> = Object.create(null) as Record<string, IntlOptions>
  for (const [name, options] of Object.entries(styles)) table[name] = Object.freeze(options)
  return Object.freeze(table)
}

export const NAMED_NUMBER_STYLES: Readonly<Record<string, IntlOptions>> = styleTable({
  integer: { maximumFractionDigits: 0 },
  percent: { style: 'percent' },
})

export const NAMED_DATE_STYLES: Readonly<Record<string, IntlOptions>> = styleTable({
  short: { dateStyle: 'short' },
  medium: { dateStyle: 'medium' },
  long: { dateStyle: 'long' },
  full: { dateStyle: 'full' },
})

export const NAMED_TIME_STYLES: Readonly<Record<string, IntlOptions>> = styleTable({
  short: { timeStyle: 'short' },
  medium: { timeStyle: 'medium' },
  long: { timeStyle: 'long' },
  full: { timeStyle: 'full' },
})

export const BARE_NUMBER_OPTIONS: IntlOptions = Object.freeze({})

export const BARE_DATE_OPTIONS: IntlOptions = Object.freeze({ dateStyle: 'medium' })

export const BARE_TIME_OPTIONS: IntlOptions = Object.freeze({ timeStyle: 'medium' })
