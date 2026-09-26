import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { BuildOptions } from '../compiler'
import { build, check } from '../compiler'
import type { BuildResult } from '../types'
import type { GlobalOptions } from './args'
import { USAGE, parseCommand } from './args'
import { runInit } from './init'
import { io } from './io'
import { renderReport } from './report'

export async function run(argv: readonly string[]): Promise<number> {
  const command = parseCommand(argv)
  if (command.kind === 'help') {
    io.out(`${USAGE}\n`)
    return 0
  }
  if (command.kind === 'usage') return usage(command.message)

  try {
    if (command.kind === 'init') {
      const result = await runInit({
        cwd: command.options.cwd ?? process.cwd(),
        configPath: command.options.configPath,
      })
      if (result.ok) io.out(result.output)
      else io.err(result.output)
      return result.ok ? 0 : 2
    }

    const unusable = await unusableCwd(command.options.cwd)
    if (unusable !== null) return usage(unusable)

    if (command.kind === 'build') {
      const options = { ...compilerOptions(command.options), failOnError: command.failOnError }
      return report(await build(options), command.options)
    }
    return report(await check(compilerOptions(command.options)), command.options)
  } catch (error) {
    io.err(`loclizr: ${error instanceof Error ? error.message : String(error)}\n`)
    return 2
  }
}

function usage(message: string): number {
  io.err(`loclizr: ${message}\n\n${USAGE}\n`)
  return 2
}

// A mistyped `--config` already names the path it could not find. Without the
// same check here a mistyped `--cwd` reaches the compiler, which finds no
// catalogs under it and reports the catalog layout, naming the directory
// nowhere. `init` is left out: it creates the tree it was pointed at.
async function unusableCwd(cwd: string | undefined): Promise<string | null> {
  if (cwd === undefined) return null
  const message = `--cwd must name a directory that exists, got '${cwd}'`
  try {
    return (await stat(resolve(cwd))).isDirectory() ? null : message
  } catch {
    return message
  }
}

function compilerOptions(options: GlobalOptions): BuildOptions {
  return {
    cwd: options.cwd,
    configPath: options.configPath,
    maxWarnings: options.maxWarnings,
  }
}

// The exit code is whatever the compiler decided. --no-fail reaches it as
// `failOnError`, and nothing here re-derives a code from the diagnostics.
function report(result: BuildResult, options: GlobalOptions): number {
  const text = renderReport(result, {
    reporter: options.reporter,
    quiet: options.quiet,
    color: process.stdout.isTTY === true,
  })
  if (text !== '') io.out(text)
  return result.exitCode
}
