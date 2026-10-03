import { describe, expect, it } from 'vitest'
import type { Command, GlobalOptions } from './args'
import { USAGE, parseCommand } from './args'

function optionsOf(command: Command): GlobalOptions {
  if (command.kind === 'help' || command.kind === 'usage') {
    throw new Error(`expected a runnable command, got ${command.kind}`)
  }
  return command.options
}

function messageOf(command: Command): string {
  if (command.kind !== 'usage') throw new Error(`expected usage, got ${command.kind}`)
  return command.message
}

describe('a repeated flag takes its last value', () => {
  it('reads the last --reporter', () => {
    expect(optionsOf(parseCommand(['build', '--reporter', 'json', '--reporter', 'human'])).reporter).toBe(
      'human',
    )
  })

  it('reads the last --cwd', () => {
    expect(optionsOf(parseCommand(['build', '--cwd', 'a', '--cwd', 'b'])).cwd).toBe('b')
  })

  it('validates only the last --max-warnings', () => {
    expect(optionsOf(parseCommand(['build', '--max-warnings', 'x', '--max-warnings', '2'])).maxWarnings).toBe(2)
    expect(messageOf(parseCommand(['build', '--max-warnings', '1', '--max-warnings', 'x']))).toBe(
      "--max-warnings must be an integer, got 'x'",
    )
  })

  it('keeps a repeated --no-fail on build as one flag', () => {
    expect(parseCommand(['build', '--no-fail', '--no-fail'])).toMatchObject({
      kind: 'build',
      failOnError: false,
    })
  })

  it('keeps a repeated --quiet as quiet', () => {
    expect(optionsOf(parseCommand(['check', '--quiet', '--quiet'])).quiet).toBe(true)
  })
})

describe('--help wins over everything it can see', () => {
  it('reads a doubled short flag as help', () => {
    expect(parseCommand(['build', '-hh'])).toEqual({ kind: 'help' })
  })

  it('prints help even beside a --reporter value it would otherwise reject', () => {
    expect(parseCommand(['--help', '--reporter', 'xml'])).toEqual({ kind: 'help' })
  })

  it('prints help even beside a --max-warnings value it would otherwise reject', () => {
    expect(parseCommand(['build', '--max-warnings=abc', '-h'])).toEqual({ kind: 'help' })
  })

  it('prints help for check --no-fail, which is otherwise refused', () => {
    expect(parseCommand(['check', '--help', '--no-fail'])).toEqual({ kind: 'help' })
  })

  it('prints help after an unknown command or a stray positional', () => {
    expect(parseCommand(['lower', '--help'])).toEqual({ kind: 'help' })
    expect(parseCommand(['build', 'extra', '-h'])).toEqual({ kind: 'help' })
  })

  it('refuses a value on the boolean help flag', () => {
    expect(parseCommand(['--help=1']).kind).toBe('usage')
  })
})

describe('flag names are exact', () => {
  it('rejects a differently cased flag', () => {
    expect(messageOf(parseCommand(['build', '--Quiet']))).toBe("unknown option '--Quiet'")
    expect(messageOf(parseCommand(['build', '-H']))).toBe("unknown option '-H'")
  })

  it('names a non ASCII flag verbatim', () => {
    expect(messageOf(parseCommand(['build', '--rëporter=json']))).toBe("unknown option '--rëporter'")
  })

  it('has no short form for any flag but help', () => {
    for (const short of ['-q', '-c', '-r']) {
      expect(messageOf(parseCommand(['build', short]))).toBe(`unknown option '${short}'`)
    }
  })
})

describe('command names carrying invisible or composed characters', () => {
  const lookalikes = [
    'build\u200b',
    '\u200fbuild',
    'buil\u0064\u0301',
    'ｂｕｉｌｄ',
    'check\u0000',
    'init\r',
    '🛠',
  ]

  it('rejects each one as invalid usage', () => {
    for (const name of lookalikes) expect(parseCommand([name]).kind).toBe('usage')
  })

  it('echoes the name verbatim, so the invisible part is in the message', () => {
    for (const name of lookalikes) {
      expect(messageOf(parseCommand([name]))).toBe(`unknown command '${name}'`)
    }
  })

  it('echoes an unexpected second positional verbatim', () => {
    expect(messageOf(parseCommand(['build', 'ﾉ\u200d']))).toBe("unexpected argument 'ﾉ\u200d'")
  })
})

describe('flag placement', () => {
  it('reads every flag before the command as well as after it', () => {
    expect(
      optionsOf(parseCommand(['--reporter', 'json', '--quiet', '--max-warnings', '3', 'check'])),
    ).toEqual({
      cwd: undefined,
      configPath: undefined,
      reporter: 'json',
      maxWarnings: 3,
      quiet: true,
    })
  })

  it('reports a missing command when only flags were given', () => {
    expect(messageOf(parseCommand(['--quiet', '--reporter=json']))).toBe('missing command')
  })

  it('names the first of several stray positionals', () => {
    expect(messageOf(parseCommand(['init', 'a', 'b', 'c']))).toBe("unexpected argument 'a'")
  })
})

describe('path flags keep their value byte for byte', () => {
  const paths = [
    'apps/my web',
    'приложение/web',
    'apps/🌍',
    'C:\\work\\app',
    "o'brien",
    'a\u0301',
    'apps/web/',
  ]

  it('keeps --cwd verbatim', () => {
    for (const path of paths) expect(optionsOf(parseCommand(['build', '--cwd', path])).cwd).toBe(path)
  })

  it('keeps --config verbatim', () => {
    for (const path of paths) {
      expect(optionsOf(parseCommand(['check', `--config=${path}`])).configPath).toBe(path)
    }
  })

  it('leaves both undefined rather than empty when absent', () => {
    const options = optionsOf(parseCommand(['init']))

    expect(options.cwd).toBeUndefined()
    expect(options.configPath).toBeUndefined()
  })
})

describe('--max-warnings at the limits of a number', () => {
  it('keeps a value past MAX_SAFE_INTEGER as a finite cap', () => {
    const value = optionsOf(parseCommand(['build', '--max-warnings=99999999999999999999'])).maxWarnings

    expect(Number.isFinite(value)).toBe(true)
    expect(value).toBeGreaterThan(Number.MAX_SAFE_INTEGER)
  })

  it('keeps MAX_SAFE_INTEGER exactly', () => {
    expect(
      optionsOf(parseCommand(['build', `--max-warnings=${Number.MAX_SAFE_INTEGER}`])).maxWarnings,
    ).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('reads a hugely negative value as no cap', () => {
    expect(optionsOf(parseCommand(['build', '--max-warnings=-99999999999999999999'])).maxWarnings).toBe(
      Number.POSITIVE_INFINITY,
    )
  })

  it('reads a negative value with leading zeros as no cap', () => {
    expect(optionsOf(parseCommand(['build', '--max-warnings=-007'])).maxWarnings).toBe(
      Number.POSITIVE_INFINITY,
    )
  })

  it('reads 1 as a cap of one, not as a boolean', () => {
    expect(optionsOf(parseCommand(['build', '--max-warnings=1'])).maxWarnings).toBe(1)
  })

  it('rejects a lone minus sign and a double minus', () => {
    expect(parseCommand(['build', '--max-warnings=-']).kind).toBe('usage')
    expect(parseCommand(['build', '--max-warnings=--1']).kind).toBe('usage')
  })

  it('rejects a value carrying a line ending', () => {
    for (const value of ['1\n', '1\r\n', '1\r', '\n1']) {
      expect(parseCommand(['build', `--max-warnings=${value}`]).kind).toBe('usage')
    }
  })

  it('echoes the rejected value in the message', () => {
    expect(messageOf(parseCommand(['build', '--max-warnings=1e21']))).toBe(
      "--max-warnings must be an integer, got '1e21'",
    )
  })
})

describe('--reporter message', () => {
  it('echoes the rejected value verbatim', () => {
    expect(messageOf(parseCommand(['build', '--reporter=jsön']))).toBe(
      "--reporter must be human or json, got 'jsön'",
    )
  })

  it('rejects a prototype name as a reporter', () => {
    for (const value of ['__proto__', 'constructor', 'toString']) {
      expect(parseCommand(['build', `--reporter=${value}`]).kind).toBe('usage')
    }
  })
})

describe('the order of validation', () => {
  it('names the command problem before a bad flag value', () => {
    expect(messageOf(parseCommand(['lower', '--reporter=xml']))).toBe("unknown command 'lower'")
  })

  it('names --no-fail on check before a bad reporter', () => {
    expect(messageOf(parseCommand(['check', '--no-fail', '--reporter=xml']))).toContain('--no-fail')
  })
})

describe('the usage text', () => {
  it('carries no carriage return and no tab', () => {
    expect(USAGE).not.toMatch(/[\r\t]/)
  })

  it('carries no trailing whitespace on any line', () => {
    for (const line of USAGE.split('\n')) expect(line).toBe(line.trimEnd())
  })

  it('ends without a newline, which run adds once', () => {
    expect(USAGE.endsWith('\n')).toBe(false)
  })

  it('carries no long dash', () => {
    expect(USAGE).not.toMatch(/[\u2013\u2014]/)
  })

  it('documents the = spelling of the no cap value', () => {
    expect(USAGE).toContain('--max-warnings=-1')
  })
})
