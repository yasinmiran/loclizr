import type { CatalogReadResult } from '../catalog'
import type { LoadConfigResult } from '../config'
import { applySeverity, diag, exitCodeFor, hasError, sortDiagnostics } from '../diagnostics'
import type { ScanGroup, ScanResult } from '../scan'
import type {
  BuildResult,
  CatalogMeta,
  Config,
  ContextRecord,
  Diagnostic,
  EmitResult,
  Group,
  Program,
  RawCatalog,
  RuleName,
} from '../types'
import type { RecordOutput } from './output'
import { syncOutput } from './output'
import { localesWithoutPluralData } from './probe'
import { summarize } from './summary'

export interface Stages {
  readonly icuDataComplete: () => boolean
  readonly loadConfig: (input: {
    readonly cwd: string
    readonly configPath?: string | undefined
  }) => Promise<LoadConfigResult>
  readonly readCatalogs: (config: Config) => Promise<CatalogReadResult>
  readonly analyze: (input: {
    readonly config: Config
    readonly catalogs: readonly RawCatalog[]
    readonly meta: CatalogMeta | null
  }) => Program
  readonly runChecks: (program: Program) => readonly Diagnostic[]
  readonly checkDescriptions: (program: Program) => readonly Diagnostic[]
  readonly scan: (input: {
    readonly config: Config
    readonly ids: readonly string[]
    readonly groups: readonly ScanGroup[]
  }) => Promise<ScanResult>
  readonly emit: (program: Program) => EmitResult
  readonly buildRecord: (program: Program) => ContextRecord
  readonly serializeRecord: (record: ContextRecord) => string
}

export interface PipelineOptions {
  readonly mode: 'build' | 'check'
  readonly cwd: string
  readonly configPath: string | undefined
  readonly emit: boolean
  readonly maxWarnings: number
  readonly failOnError: boolean
}

export async function runPipeline(
  stages: Stages,
  options: PipelineOptions,
): Promise<BuildResult> {
  const collected: Diagnostic[] = []

  const icuComplete = stages.icuDataComplete()
  if (!icuComplete) collected.push(icuDataIncomplete())

  const loaded = await stages.loadConfig({ cwd: options.cwd, configPath: options.configPath })
  collected.push(...loaded.diagnostics)
  const config = loaded.config
  if (config === null) return halt(collected, {}, options, 0)

  const overrides = severityOverrides(config, icuComplete)
  if (blocksOutput(collected)) {
    return halt(collected, overrides, options, config.locales.length)
  }

  // Skipped under a truncated ICU, where the override above has already taken
  // both category rules out for every locale and named the one real cause.
  const guessed = icuComplete ? localesWithoutPluralData(config.locales) : []
  for (const locale of guessed) collected.push(pluralDataMissing(locale))

  const read = await stages.readCatalogs(config)
  collected.push(...read.diagnostics)
  if (blocksOutput(collected)) {
    return halt(collected, overrides, options, config.locales.length)
  }

  const analyzed = stages.analyze({ config, catalogs: read.catalogs, meta: read.meta })
  collected.push(...analyzed.diagnostics)
  collected.push(...withoutGuessedCategories(stages.runChecks(analyzed), guessed))
  collected.push(...stages.checkDescriptions(analyzed))

  const scanned = await stages.scan({
    config,
    ids: analyzed.messages.map((message) => message.id),
    groups: analyzed.groups.map(membership),
  })
  collected.push(...scanned.diagnostics)

  const program: Program = { ...analyzed, usages: scanned.usages }
  // An `always` fatality means no correct artifact is producible, so emit and
  // its replay re-emit are skipped rather than run for a tree nobody may write.
  const emitted: EmitResult = blocksOutput(collected)
    ? { files: [], diagnostics: [] }
    : stages.emit(program)
  collected.push(...emitted.diagnostics)

  const record = recordStep(stages, config, program)

  const levelled = applySeverity(collected, overrides)
  const reachedOutput = !blocksOutput(collected) && options.emit
  const output = reachedOutput
    ? await syncOutput({
        mode: options.mode,
        root: config.root,
        outDir: config.outDir,
        files: emitted.files,
        record: record?.output ?? null,
      })
    : { written: [], diagnostics: [] }

  const diagnostics = sortDiagnostics([
    ...levelled,
    ...applySeverity(output.diagnostics, overrides),
  ])
  const exitCode = resolveExitCode(diagnostics, options, reachedOutput)
  return {
    ok: !hasError(diagnostics),
    exitCode,
    program,
    diagnostics,
    files: emitted.files,
    record: record?.record ?? null,
    written: output.written,
    summary: summarize(diagnostics, program, program.locales.length),
  }
}

function halt(
  collected: readonly Diagnostic[],
  overrides: Config['severity'],
  options: PipelineOptions,
  locales: number,
): BuildResult {
  const diagnostics = sortDiagnostics(applySeverity(collected, overrides))
  return {
    ok: !hasError(diagnostics),
    exitCode: exitCodeFor(diagnostics, options.maxWarnings),
    program: null,
    diagnostics,
    files: [],
    record: null,
    written: [],
    summary: summarize(diagnostics, null, locales),
  }
}

// The stamped fatality, never the re-levelled severity. A rule scoped `always`
// says no correct artifact is producible, and turning it down cannot make one:
// two keys mangling to one identifier still write a module declaring one
// function twice, which Node refuses to parse. Severity moves the exit code,
// fatality decides whether a tree is written at all.
function blocksOutput(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.fatal)
}

// A run that reached the write step has a generated tree to work with, so the
// dev loop keeps going. Exit 2 means the tool could not run at all, and a run
// that wrote nothing would only be caught by the next command anyway.
function resolveExitCode(
  diagnostics: readonly Diagnostic[],
  options: PipelineOptions,
  reachedOutput: boolean,
): 0 | 1 | 2 {
  const ordinary = exitCodeFor(diagnostics, options.maxWarnings)
  if (ordinary !== 1) return ordinary
  if (options.mode !== 'build' || options.failOnError || !reachedOutput) return ordinary
  return 0
}

interface RecordStep {
  readonly record: ContextRecord
  readonly output: RecordOutput
}

function recordStep(stages: Stages, config: Config, program: Program): RecordStep | null {
  if (config.record === false) return null
  const record = stages.buildRecord(program)
  return {
    record,
    output: {
      path: config.record.replaceAll('{sourceLocale}', config.sourceLocale),
      bytes: stages.serializeRecord(record),
    },
  }
}

function severityOverrides(config: Config, icuComplete: boolean): Config['severity'] {
  if (icuComplete) return config.severity
  return {
    ...config.severity,
    'plural-category-incomplete': 'off',
    'plural-category-unreachable': 'off',
  }
}

function membership(group: Group): ScanGroup {
  // A prototype here would swallow the member property `__proto__` and would
  // answer every ordinary property name with an inherited function, which M7
  // would then push into a `UsageSite.id` declared as a string.
  const memberProps: Record<string, string> = Object.create(null) as Record<string, string>
  for (const member of group.members) memberProps[member.member] = member.id
  return {
    id: group.id,
    memberIds: group.members.map((member) => member.id),
    memberProps,
  }
}

const CATEGORY_RULES: ReadonlySet<RuleName> = new Set<RuleName>([
  'plural-category-incomplete',
  'plural-category-unreachable',
])

// A category claim about a locale Intl answered for out of the host's own data
// is a claim about the build machine, so the same catalogs would otherwise
// print different diagnostics on a laptop and in CI. Every other locale keeps
// its claims, because those come from the data the tag itself names.
function withoutGuessedCategories(
  diagnostics: readonly Diagnostic[],
  guessed: readonly string[],
): readonly Diagnostic[] {
  if (guessed.length === 0) return diagnostics
  const silent = new Set(guessed)
  return diagnostics.filter(
    (diagnostic) =>
      !CATEGORY_RULES.has(diagnostic.rule) ||
      diagnostic.locale === null ||
      !silent.has(diagnostic.locale),
  )
}

function icuDataIncomplete(): Diagnostic {
  return diag('icu-data-incomplete', {
    message:
      "This machine's Intl has truncated ICU data: Russian resolves to fewer plural categories than it has, so every locale the build does not recognise silently gets English rules.",
    hint: 'run a Node built with full ICU, or set NODE_ICU_DATA to a full data file. plural-category-incomplete and plural-category-unreachable are off for this run, so no category claim is made at all rather than a wrong one.',
  })
}

// The resolved locale is deliberately absent from both strings: naming it would
// put the build machine's own tag into the diagnostic and reproduce the
// divergence this rule exists to close.
function pluralDataMissing(locale: string): Diagnostic {
  return diag('icu-data-incomplete', {
    message: `Intl has no plural data for the declared locale "${locale}", so it answers for the build machine's own locale instead.`,
    hint: `plural-category-incomplete and plural-category-unreachable are off for "${locale}", because otherwise these catalogs would produce different diagnostics on a laptop and in CI. Under a {ns} catalog pattern with \`locales\` unset every directory name becomes a declared locale, so declare \`locales\` explicitly.`,
    locale,
  })
}
