import type { BuildOptions } from '../../compiler'
import type { BuildResult } from '../../types'
import { buildResult } from './results'

export interface RecordedCall {
  readonly command: 'build' | 'check'
  readonly options: BuildOptions | undefined
}

export const calls: RecordedCall[] = []

const state: { result: BuildResult } = { result: buildResult() }

export function reset(result?: BuildResult): void {
  calls.length = 0
  state.result = result ?? buildResult()
}

export function build(options?: BuildOptions): Promise<BuildResult> {
  calls.push({ command: 'build', options })
  return Promise.resolve(state.result)
}

export function check(options?: BuildOptions): Promise<BuildResult> {
  calls.push({ command: 'check', options })
  return Promise.resolve(state.result)
}
