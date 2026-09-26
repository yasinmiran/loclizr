import type { Stages } from '../pipeline'
import { config, program } from './program'

export function fakeStages(overrides: Partial<Stages> = {}): Stages {
  const defaults: Stages = {
    icuDataComplete: () => true,
    loadConfig: () => Promise.resolve({ config: config(), diagnostics: [] }),
    readCatalogs: () => Promise.resolve({ catalogs: [], meta: null, diagnostics: [] }),
    analyze: (input) => program({ config: input.config }),
    runChecks: () => [],
    checkDescriptions: () => [],
    scan: () => Promise.resolve({ usages: [], diagnostics: [] }),
    emit: () => ({ files: [], diagnostics: [] }),
    buildRecord: (input) => ({
      schema: 1,
      sourceLocale: input.sourceLocale,
      locales: input.locales,
      messages: [],
    }),
    serializeRecord: (record) => `${JSON.stringify(record, null, 2)}\n`,
  }
  return { ...defaults, ...overrides }
}

export function traced(stages: Stages, calls: string[]): Stages {
  return {
    icuDataComplete: () => {
      calls.push('icuDataComplete')
      return stages.icuDataComplete()
    },
    loadConfig: (input) => {
      calls.push('loadConfig')
      return stages.loadConfig(input)
    },
    readCatalogs: (input) => {
      calls.push('readCatalogs')
      return stages.readCatalogs(input)
    },
    analyze: (input) => {
      calls.push('analyze')
      return stages.analyze(input)
    },
    runChecks: (input) => {
      calls.push('runChecks')
      return stages.runChecks(input)
    },
    checkDescriptions: (input) => {
      calls.push('checkDescriptions')
      return stages.checkDescriptions(input)
    },
    scan: (input) => {
      calls.push('scan')
      return stages.scan(input)
    },
    emit: (input) => {
      calls.push('emit')
      return stages.emit(input)
    },
    buildRecord: (input) => {
      calls.push('buildRecord')
      return stages.buildRecord(input)
    },
    serializeRecord: (input) => {
      calls.push('serializeRecord')
      return stages.serializeRecord(input)
    },
  }
}
