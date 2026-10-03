import { describe, expect, it } from 'vitest'
import type { Command, GlobalOptions } from './args'
import { parseCommand } from './args'

function optionsOf(command: Command): GlobalOptions {
  if (command.kind === 'help' || command.kind === 'version' || command.kind === 'usage') {
    throw new Error(`expected a runnable command, got ${command.kind}`)
  }
  return command.options
}

describe('parseCommand', () => {
  it('defaults every global flag', () => {
    const command = parseCommand(['build'])

    expect(command.kind).toBe('build')
    expect(optionsOf(command)).toEqual({
      cwd: undefined,
      configPath: undefined,
      reporter: 'human',
      maxWarnings: Number.POSITIVE_INFINITY,
      quiet: false,
    })
  })

  it('reads every global flag', () => {
    const command = parseCommand([
      'check',
      '--cwd',
      'apps/web',
      '--config',
      'tools/loclizr.config.ts',
      '--reporter',
      'json',
      '--max-warnings',
      '4',
      '--quiet',
    ])

    expect(optionsOf(command)).toEqual({
      cwd: 'apps/web',
      configPath: 'tools/loclizr.config.ts',
      reporter: 'json',
      maxWarnings: 4,
      quiet: true,
    })
  })

  it('accepts --no-fail on build and turns it into failOnError false', () => {
    expect(parseCommand(['build', '--no-fail'])).toMatchObject({
      kind: 'build',
      failOnError: false,
    })
    expect(parseCommand(['build'])).toMatchObject({ kind: 'build', failOnError: true })
  })

  it('rejects --no-fail on check, which is the gate', () => {
    const command = parseCommand(['check', '--no-fail'])

    expect(command.kind).toBe('usage')
    expect(command).toMatchObject({ message: expect.stringContaining('--no-fail') })
  })

  it('rejects --no-fail on init', () => {
    expect(parseCommand(['init', '--no-fail']).kind).toBe('usage')
  })

  it('treats a missing command as invalid usage', () => {
    expect(parseCommand([])).toEqual({ kind: 'usage', message: 'missing command' })
  })

  it('treats an unknown command as invalid usage', () => {
    expect(parseCommand(['lower'])).toEqual({ kind: 'usage', message: "unknown command 'lower'" })
  })

  it('treats a second positional as invalid usage', () => {
    expect(parseCommand(['build', 'check'])).toEqual({
      kind: 'usage',
      message: "unexpected argument 'check'",
    })
  })

  it('treats an unknown flag as invalid usage and names only the flag', () => {
    expect(parseCommand(['build', '--watch'])).toEqual({
      kind: 'usage',
      message: "unknown option '--watch'",
    })
  })

  it('treats a flag missing its value as invalid usage', () => {
    expect(parseCommand(['build', '--cwd'])).toMatchObject({
      kind: 'usage',
      message: expect.stringContaining('--cwd'),
    })
  })

  it('rejects a reporter that is neither human nor json', () => {
    expect(parseCommand(['build', '--reporter', 'xml'])).toMatchObject({
      kind: 'usage',
      message: expect.stringContaining('human or json'),
    })
  })

  describe('--max-warnings', () => {
    it('reads zero as a real cap', () => {
      expect(optionsOf(parseCommand(['build', '--max-warnings', '0'])).maxWarnings).toBe(0)
    })

    it('reads a negative value as no cap, matching eslint', () => {
      expect(optionsOf(parseCommand(['build', '--max-warnings=-1'])).maxWarnings).toBe(
        Number.POSITIVE_INFINITY,
      )
    })

    it('rejects a detached negative value, which parseArgs cannot tell from a flag', () => {
      const command = parseCommand(['build', '--max-warnings', '-1'])

      expect(command.kind).toBe('usage')
      expect(command).toMatchObject({ message: expect.stringContaining('--max-warnings=') })
    })

    it('defaults to no cap when absent', () => {
      expect(optionsOf(parseCommand(['build'])).maxWarnings).toBe(Number.POSITIVE_INFINITY)
    })

    it('rejects a value that is not an integer', () => {
      expect(parseCommand(['build', '--max-warnings', 'abc']).kind).toBe('usage')
      expect(parseCommand(['build', '--max-warnings', '1.5']).kind).toBe('usage')
    })
  })

  it('reads --help before any command', () => {
    expect(parseCommand(['--help'])).toEqual({ kind: 'help' })
    expect(parseCommand(['-h'])).toEqual({ kind: 'help' })
    expect(parseCommand(['build', '--help'])).toEqual({ kind: 'help' })
  })

  it('reads --version before any command, and --help over it', () => {
    expect(parseCommand(['--version'])).toEqual({ kind: 'version' })
    expect(parseCommand(['build', '-v'])).toEqual({ kind: 'version' })
    expect(parseCommand(['--version', '--help'])).toEqual({ kind: 'help' })
    expect(parseCommand(['-h', '-v'])).toEqual({ kind: 'help' })
  })
})
