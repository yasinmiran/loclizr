import type { Arg, ArgType, Diagnostic, FormatsConfig, IntlOptions, Node, Span } from '../types'

export interface LowerContext {
  readonly key: string
  readonly locale: string
  readonly file: string
  readonly span: Span
  readonly catalogFormat: 'i18next' | 'icu'
  readonly formats: FormatsConfig
}

export interface LowerResult {
  readonly nodes: readonly Node[]
  readonly args: readonly Arg[]
  readonly markupTags: readonly string[]
  readonly kind: 'text' | 'markup'
  readonly normalized: string
  readonly diagnostics: readonly Diagnostic[]
}

export function lower(icu: string, context: LowerContext): LowerResult {
  throw new Error('not implemented')
}

export function unify(a: ArgType, b: ArgType): ArgType | null {
  throw new Error('not implemented')
}

export function printIcu(nodes: readonly Node[]): string {
  throw new Error('not implemented')
}

export const NAMED_NUMBER_STYLES: Readonly<Record<string, IntlOptions>> = {}

export const NAMED_DATE_STYLES: Readonly<Record<string, IntlOptions>> = {}

export const NAMED_TIME_STYLES: Readonly<Record<string, IntlOptions>> = {}
