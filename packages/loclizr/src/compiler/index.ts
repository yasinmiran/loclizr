import type { BuildResult } from '../types'

export interface BuildOptions {
  readonly cwd?: string | undefined
  readonly configPath?: string | undefined
  readonly emit?: boolean | undefined
  readonly maxWarnings?: number | undefined
}

export function build(options?: BuildOptions): Promise<BuildResult> {
  throw new Error('not implemented')
}

export function check(options?: BuildOptions): Promise<BuildResult> {
  throw new Error('not implemented')
}

export type {
  BuildResult,
  ContextRecord,
  Diagnostic,
  EmittedFile,
  Program,
  Summary,
} from '../types'
