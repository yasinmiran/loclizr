import { analyze } from '../analyze'
import { readCatalogs } from '../catalog'
import { runChecks } from '../check'
import { loadConfig } from '../config'
import { emit } from '../emit'
import { buildRecord, checkDescriptions, serializeRecord } from '../record'
import { scan } from '../scan'
import type { BuildResult } from '../types'
import type { PipelineOptions, Stages } from './pipeline'
import { runPipeline } from './pipeline'
import { icuDataComplete } from './probe'

export interface BuildOptions {
  readonly cwd?: string | undefined
  readonly configPath?: string | undefined
  readonly emit?: boolean | undefined
  readonly maxWarnings?: number | undefined
  // Default true. False is `build --no-fail`: diagnostics are unchanged and a
  // run that reached the write step reports exit 0. `check` ignores it.
  readonly failOnError?: boolean | undefined
}

const STAGES: Stages = {
  icuDataComplete,
  loadConfig,
  readCatalogs,
  analyze,
  runChecks,
  checkDescriptions,
  scan,
  emit,
  buildRecord,
  serializeRecord,
}

export function build(options?: BuildOptions): Promise<BuildResult> {
  return runPipeline(STAGES, pipelineOptions(options, 'build'))
}

export function check(options?: BuildOptions): Promise<BuildResult> {
  return runPipeline(STAGES, pipelineOptions(options, 'check'))
}

function pipelineOptions(
  options: BuildOptions | undefined,
  mode: 'build' | 'check',
): PipelineOptions {
  return {
    mode,
    cwd: options?.cwd ?? process.cwd(),
    configPath: options?.configPath,
    emit: options?.emit ?? true,
    maxWarnings: options?.maxWarnings ?? Number.POSITIVE_INFINITY,
    failOnError: options?.failOnError ?? true,
  }
}

export type {
  BuildResult,
  ContextRecord,
  Diagnostic,
  EmittedFile,
  Program,
  Summary,
} from '../types'
