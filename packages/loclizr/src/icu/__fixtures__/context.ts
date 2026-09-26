import type { FormatsConfig, Span } from '../../types'
import type { LowerContext } from '../lower'

export const SPAN: Span = { line: 3, column: 5, offset: 42, length: 8 }

export const NO_FORMATS: FormatsConfig = { timeZone: null, number: {}, dateTime: {} }

export function icuContext(overrides: Partial<LowerContext> = {}): LowerContext {
  return {
    key: 'cart.items',
    locale: 'en',
    file: 'locales/en.json',
    span: SPAN,
    catalogFormat: 'icu',
    formats: NO_FORMATS,
    ...overrides,
  }
}

export function withFormats(formats: Partial<FormatsConfig>): LowerContext {
  return icuContext({ formats: { ...NO_FORMATS, ...formats } })
}
