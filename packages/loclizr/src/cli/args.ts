import { parseArgs } from 'node:util'

export interface GlobalOptions {
  readonly cwd: string | undefined
  readonly configPath: string | undefined
  readonly reporter: 'human' | 'json'
  readonly maxWarnings: number
  readonly quiet: boolean
}

export type Command =
  | { readonly kind: 'build'; readonly options: GlobalOptions; readonly failOnError: boolean }
  | { readonly kind: 'check'; readonly options: GlobalOptions }
  | { readonly kind: 'init'; readonly options: GlobalOptions }
  | { readonly kind: 'help' }
  | { readonly kind: 'version' }
  | { readonly kind: 'usage'; readonly message: string }

export const USAGE: string = `loclizr <command> [options]

Commands
  init     write loclizr.config.ts and a seed catalog, then print the
           package.json scripts and the CI step
  build    read the catalogs, check them, write the generated tree and the
           context record
  check    everything build does with no writes, plus the output and record
           gates

Options
  --cwd <dir>             directory to run in, default the current one
  --config <path>         config file to load, or the one init writes
  --reporter human|json   diagnostic format, default human
  --max-warnings <n>      exit 1 above this many warnings, --max-warnings=-1
                          for no cap, which is also the default
  --quiet                 print errors only, plus a summary line when warnings
                          were dropped
  --no-fail               build only: report everything, exit 0 once output
                          was written
  -v, --version           print the installed loclizr version
  -h, --help              print this`

interface Flags {
  readonly cwd?: string | undefined
  readonly config?: string | undefined
  readonly reporter?: string | undefined
  readonly 'max-warnings'?: string | undefined
  readonly quiet?: boolean | undefined
  readonly 'no-fail'?: boolean | undefined
  readonly help?: boolean | undefined
  readonly version?: boolean | undefined
}

export function parseCommand(argv: readonly string[]): Command {
  let flags: Flags
  let positionals: readonly string[]
  try {
    const parsed = parseArgs({
      args: [...argv],
      options: {
        cwd: { type: 'string' },
        config: { type: 'string' },
        reporter: { type: 'string' },
        'max-warnings': { type: 'string' },
        quiet: { type: 'boolean' },
        'no-fail': { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
      allowPositionals: true,
    })
    flags = parsed.values
    positionals = parsed.positionals
  } catch (error) {
    return { kind: 'usage', message: parseFailure(error) }
  }

  if (flags.help === true) return { kind: 'help' }
  if (flags.version === true) return { kind: 'version' }

  const [name, ...rest] = positionals
  if (name === undefined) return { kind: 'usage', message: 'missing command' }
  if (rest.length > 0) return { kind: 'usage', message: `unexpected argument '${rest[0]}'` }
  if (name !== 'build' && name !== 'check' && name !== 'init') {
    return { kind: 'usage', message: `unknown command '${name}'` }
  }

  const noFail = flags['no-fail'] === true
  if (noFail && name === 'check') {
    return {
      kind: 'usage',
      message: '--no-fail is not accepted by `loclizr check`, which is the gate',
    }
  }
  if (noFail && name === 'init') {
    return { kind: 'usage', message: '--no-fail is accepted by `loclizr build` only' }
  }

  const reporter = flags.reporter ?? 'human'
  if (reporter !== 'human' && reporter !== 'json') {
    return { kind: 'usage', message: `--reporter must be human or json, got '${reporter}'` }
  }

  const maxWarnings = parseMaxWarnings(flags['max-warnings'])
  if (maxWarnings === null) {
    return {
      kind: 'usage',
      message: `--max-warnings must be an integer, got '${flags['max-warnings'] ?? ''}'`,
    }
  }

  const options: GlobalOptions = {
    cwd: flags.cwd,
    configPath: flags.config,
    reporter,
    maxWarnings,
    quiet: flags.quiet === true,
  }

  if (name === 'build') return { kind: 'build', options, failOnError: !noFail }
  if (name === 'check') return { kind: 'check', options }
  return { kind: 'init', options }
}

// parseArgs answers an unknown flag with advice about positional arguments
// starting with a dash, which no loclizr command takes, and it leaves the
// quoting in that sentence unbalanced. Every other parseArgs failure names the
// option and the value, so those pass through as written.
function parseFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (codeOf(error) !== 'ERR_PARSE_ARGS_UNKNOWN_OPTION') return message
  const name = /^Unknown option '([^']+)'/.exec(message)?.[1]
  return name === undefined ? message : `unknown option '${name}'`
}

function codeOf(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null
  const code: unknown = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : null
}

// Absent and negative both mean no cap, matching eslint's -1. Null is a
// parse failure, which POSITIVE_INFINITY cannot stand in for.
function parseMaxWarnings(raw: string | undefined): number | null {
  if (raw === undefined) return Number.POSITIVE_INFINITY
  if (!/^-?\d+$/.test(raw)) return null
  const value = Number(raw)
  return value < 0 ? Number.POSITIVE_INFINITY : value
}
