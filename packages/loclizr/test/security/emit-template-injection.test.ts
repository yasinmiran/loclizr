import { describe, expect, test } from 'vitest'
import { emit } from '../../src/emit'
import type { EmittedFile } from '../../src/types'
import { singleMessageProgram } from './__fixtures__/catalog'

type Arm = (args: Readonly<Record<string, unknown>>) => unknown

function moduleFor(key: string, value: string): string {
  const namespace = key.includes('.') ? (key.split('.')[0] ?? '_root') : '_root'
  const files: readonly EmittedFile[] = emit(singleMessageProgram(key, value)).files
  const file = files.find((candidate) => candidate.path === `messages/${namespace}.js`)
  if (file === undefined) throw new Error(`no emitted module for ${key}`)
  return file.contents
}

function compileArm(module: string, id: string): Arm {
  const chunk = module.split('\n\n').find((part) => part.startsWith(`export function ${id}(`))
  if (chunk === undefined) throw new Error(`no function ${id} in the emitted module`)
  const factory = new Function(
    '$l',
    '$plural1',
    '$number1',
    `'use strict';\nreturn ${chunk.slice('export '.length)}`,
  ) as (...deps: readonly unknown[]) => Arm
  return factory(
    () => 'en',
    (locale: string, value: number, ordinal: boolean) =>
      new Intl.PluralRules(locale, { type: ordinal ? 'ordinal' : 'cardinal' }).select(value),
    (locale: string, value: number) => new Intl.NumberFormat(locale).format(value),
  )
}

// A generated module is ESM the app imports, so one that does not parse takes
// every other message in its namespace down with it.
function parse(source: string): void {
  const script = source
    .split('\n')
    .filter((line) => !line.startsWith('import '))
    .map((line) => line.replace(/^export /u, ''))
    .join('\n')
  new Function(`'use strict';\n${script}`)
}

// Emit escapes `${` inside one text node, and a catalog can put the `$` and the
// `{` in two. A collapsed branch renders its body straight into the enclosing
// template with no wrapper, so the two halves meet and the result is a live
// interpolation of whatever the catalog named.
describe('a dollar and a brace split across two nodes', () => {
  test('renders the literal text a collapsed plural left beside a quoted brace', () => {
    const module = moduleFor('dev.split', "{n, plural, other {$}}'{opts}'")
    expect(module).toContain('\\${opts}')
    expect(compileArm(module, 'dev_split')({ n: 1 })).toBe('${opts}')
  })

  test('renders the literal text a collapsed select left beside a quoted brace', () => {
    const module = moduleFor('dev.choice', "{state, select, other {$}}'{opts}'")
    expect(module).toContain('\\${opts}')
    expect(compileArm(module, 'dev_choice')({ state: 'any' })).toBe('${opts}')
  })

  test('reads no argument the catalog text was never given', () => {
    const module = moduleFor('dev.reach', "{n, plural, other {$}}'{args.n}'")
    expect(module).toContain('\\${args.n}')
    expect(compileArm(module, 'dev_reach')({ n: 42 })).toBe('${args.n}')
  })

  test('emits a module that parses when the brace run never closes', () => {
    expect(() => parse(moduleFor('dev.open', "{n, plural, other {$}}'{'"))).not.toThrow()
  })

  test('escapes a lone trailing dollar so no following text can complete it', () => {
    const module = moduleFor('dev.trailing', "{n, plural, other {price: $}}'{opts}'")
    expect(module).toContain('price: \\${opts}')
    expect(compileArm(module, 'dev_trailing')({ n: 1 })).toBe('price: ${opts}')
  })
})
