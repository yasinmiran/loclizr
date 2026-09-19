import type { Config, Diagnostic, MessageUsage, UsageSite } from '../types'

export interface ScanResult {
  readonly usages: readonly MessageUsage[]
  readonly diagnostics: readonly Diagnostic[]
}

export interface ScanGroup {
  readonly id: string
  readonly memberIds: readonly string[]
  readonly memberProps: Readonly<Record<string, string>>
}

export function scan(input: {
  readonly config: Config
  readonly ids: readonly string[]
  readonly groups: readonly ScanGroup[]
}): Promise<ScanResult> {
  throw new Error('not implemented')
}

export function scanFile(input: {
  readonly text: string
  readonly file: string
  readonly outDir: string
  readonly ids: ReadonlySet<string>
  readonly groups: readonly ScanGroup[]
}): readonly (UsageSite & { readonly id: string })[] {
  throw new Error('not implemented')
}
