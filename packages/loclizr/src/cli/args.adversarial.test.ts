import { describe, expect, it } from 'vitest'
import type { Command, GlobalOptions } from './args'
import { USAGE, parseCommand } from './args'

function optionsOf(command: Command): GlobalOptions {
  if (command.kind === 'help' || command.kind === 'version' || command.kind === 'usage') {
    throw new Error(`expected a runnable command, got ${command.kind}`)
  }
  return command.options
}

describe('the usage text promises exactly what v0.1 ships', () => {
  it('names the three commands and every global flag', () => {
    for (const token of [
      'init',
      'build',
      'check',
      '--cwd',
      '--config',
      '--reporter',
      '--max-warnings',
      '--quiet',
      '--no-fail',
    ]) {
      expect(USAGE).toContain(token)
    }
  })

  it('advertises no watch mode, which v0.1 does not have', () => {
    expect(USAGE).not.toContain('--watch')
  })

  it('says --no-fail belongs to build', () => {
    const line = USAGE.split('\n').find((candidate) => candidate.includes('--no-fail')) ?? ''

    expect(line).toContain('build')
  })
})

describe('an unrecognized flag is reported as one', () => {
  // parseArgs answers with advice about positional arguments starting with a
  // dash, which no command here takes, and its closing quote is unbalanced.
  it('names the flag and nothing else, whichever spelling it was', () => {
    expect(parseCommand(['build', '--verbose'])).toEqual({
      kind: 'usage',
      message: "unknown option '--verbose'",
    })
    expect(parseCommand(['build', '-x'])).toEqual({
      kind: 'usage',
      message: "unknown option '-x'",
    })
  })

  it('mentions neither positional arguments nor the terminator', () => {
    const command = parseCommand(['--verbose'])
    const message = command.kind === 'usage' ? command.message : ''

    expect(message).not.toContain('positional')
    expect(message).not.toContain("'--'")
  })

  it('keeps the text the parser wrote for every other parse failure', () => {
    expect(parseCommand(['build', '--reporter'])).toMatchObject({
      kind: 'usage',
      message: expect.stringContaining('argument missing'),
    })
    expect(parseCommand(['build', '--quiet=1'])).toMatchObject({
      kind: 'usage',
      message: expect.stringContaining('does not take an argument'),
    })
  })
})

describe('command names are exact', () => {
  it('rejects a name that differs only in case', () => {
    for (const name of ['Build', 'BUILD', 'Check', 'INIT']) {
      expect(parseCommand([name]).kind).toBe('usage')
    }
  })

  it('rejects a name padded with whitespace', () => {
    expect(parseCommand(['build ']).kind).toBe('usage')
    expect(parseCommand([' build']).kind).toBe('usage')
  })

  it('rejects the empty string as a command', () => {
    expect(parseCommand([''])).toEqual({ kind: 'usage', message: "unknown command ''" })
  })

  it('rejects an Object.prototype name rather than resolving it', () => {
    for (const name of ['__proto__', 'constructor', 'prototype', 'toString', 'valueOf']) {
      expect(parseCommand([name]).kind).toBe('usage')
    }
  })
})

describe('-- ends the flags', () => {
  it('leaves --help past the terminator as a positional, not as help', () => {
    expect(parseCommand(['--', '--help']).kind).toBe('usage')
  })

  it('leaves --no-fail past the terminator as a positional on build', () => {
    expect(parseCommand(['build', '--', '--no-fail'])).toEqual({
      kind: 'usage',
      message: "unexpected argument '--no-fail'",
    })
  })

  it('leaves --reporter past the terminator as a positional', () => {
    expect(parseCommand(['build', '--', '--reporter', 'json']).kind).toBe('usage')
  })

  it('still reads a command that only follows the terminator', () => {
    expect(parseCommand(['--', 'build']).kind).toBe('build')
  })
})

describe('--max-warnings rejects everything that is not a decimal integer', () => {
  const rejected = [
    '+1',
    '1e3',
    '0x10',
    '',
    ' 1',
    '1 ',
    '1_0',
    '1.0',
    'Infinity',
    'NaN',
    '١٢',
    '１２',
    '१',
  ]

  it('rejects each of them as invalid usage', () => {
    for (const value of rejected) {
      expect(parseCommand(['build', `--max-warnings=${value}`]).kind).toBe('usage')
    }
  })

  it('keeps zero as a real cap in the = form', () => {
    expect(optionsOf(parseCommand(['build', '--max-warnings=0'])).maxWarnings).toBe(0)
  })

  it('reads leading zeros as the decimal value', () => {
    expect(optionsOf(parseCommand(['build', '--max-warnings=007'])).maxWarnings).toBe(7)
  })
})

describe('--reporter is one of exactly two tokens', () => {
  it('rejects a differently cased or padded spelling', () => {
    for (const value of ['JSON', 'Json', 'Human', 'HUMAN', 'json ', ' human', '']) {
      expect(parseCommand(['build', `--reporter=${value}`]).kind).toBe('usage')
    }
  })

  it('rejects full width look alikes', () => {
    expect(parseCommand(['build', '--reporter=ｊｓｏｎ']).kind).toBe('usage')
  })
})

describe('a value that looks like a flag is only reachable through =', () => {
  it('refuses to swallow the next flag as a --cwd value', () => {
    expect(parseCommand(['build', '--cwd', '--config', 'x.ts']).kind).toBe('usage')
  })

  it('takes a dash leading value written with =', () => {
    expect(optionsOf(parseCommand(['build', '--cwd=--config'])).cwd).toBe('--config')
  })
})

describe('--no-fail is a build only flag', () => {
  it('is rejected on check whichever side of the command it sits', () => {
    expect(parseCommand(['check', '--no-fail']).kind).toBe('usage')
    expect(parseCommand(['--no-fail', 'check']).kind).toBe('usage')
  })

  it('is rejected on init whichever side of the command it sits', () => {
    expect(parseCommand(['init', '--no-fail']).kind).toBe('usage')
    expect(parseCommand(['--no-fail', 'init']).kind).toBe('usage')
  })

  it('takes no argument', () => {
    expect(parseCommand(['build', '--no-fail=true']).kind).toBe('usage')
    expect(parseCommand(['build', '--no-fail=false']).kind).toBe('usage')
  })
})
