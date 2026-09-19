import type { CatalogMeta, Config, Diagnostic, RawCatalog, RawEntry, Span } from '../types'

export interface CatalogReadResult {
  readonly catalogs: readonly RawCatalog[]
  readonly meta: CatalogMeta | null
  readonly diagnostics: readonly Diagnostic[]
}

export function readCatalogs(config: Config): Promise<CatalogReadResult> {
  throw new Error('not implemented')
}

export function parseJsonWithSpans(
  text: string,
  file: string,
): {
  readonly value: unknown
  readonly spans: ReadonlyMap<string, Span>
  readonly duplicates: readonly string[]
  readonly diagnostics: readonly Diagnostic[]
} {
  throw new Error('not implemented')
}

export function flatten(input: {
  readonly value: unknown
  readonly file: string
  readonly locale: string
  readonly ns: string | null
  readonly spans: ReadonlyMap<string, Span>
}): { readonly entries: readonly RawEntry[]; readonly diagnostics: readonly Diagnostic[] } {
  throw new Error('not implemented')
}

export function toIcu(
  value: string,
  context: {
    readonly key: string
    readonly locale: string
    readonly file: string
    readonly span: Span
    readonly markup: 'literal' | 'tags'
  },
): { readonly icu: string; readonly diagnostics: readonly Diagnostic[] } {
  throw new Error('not implemented')
}

export function foldPluralSuffixes(
  entries: readonly RawEntry[],
  locale: string,
  file: string,
): { readonly entries: readonly RawEntry[]; readonly diagnostics: readonly Diagnostic[] } {
  throw new Error('not implemented')
}
