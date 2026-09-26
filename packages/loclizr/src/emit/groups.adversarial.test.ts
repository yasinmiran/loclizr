import { describe, expect, test } from 'vitest'
import type { EmittedFile, Group, Message } from '../types'
import { emit } from './index'
import { body, config, markup, message, program, text, translated } from './__fixtures__/program'

function contentsOf(files: readonly EmittedFile[], path: string): string {
  const file = files.find((candidate) => candidate.path === path)
  if (file === undefined) throw new Error(`no emitted file at ${path}`)
  return file.contents
}

function parse(source: string): void {
  const script = source
    .split('\n')
    .filter((line) => !line.startsWith('import '))
    .map((line) => line.replace(/^export /u, ''))
    .join('\n')
  new Function(`'use strict';\n${script}`)
}

function withGroup(messages: readonly Message[], group: Group): readonly EmittedFile[] {
  return emit(
    program({
      messages,
      groups: [group],
      config: config({ locales: ['en'], groups: { [group.name]: group.prefix } }),
    }),
  ).files
}

const ACCEPT: Message = message({
  key: 'terms.accept',
  source: 'Read our <link>terms</link> before you continue.',
  kind: 'markup',
  args: [{ name: 'link', type: { kind: 'markup' } }],
  bodies: [body('en', [text('Read our '), markup('link', [text('terms')]), text(' now.')])],
  origins: [translated('en')],
})

const TERMS_GROUP: Group = {
  name: 'terms',
  id: 'terms',
  typeBase: 'Terms',
  prefix: 'terms',
  members: [{ key: 'terms.accept', id: 'terms_accept', member: 'accept' }],
}

describe('a group holding a markup message', () => {
  const declarations = contentsOf(withGroup([ACCEPT], TERMS_GROUP), 'groups.d.ts')

  test('never names a type parameter the file does not introduce', () => {
    const uses = /\bT\b/u.test(declarations)
    const introduces = /<T>/u.test(declarations)
    expect(uses && !introduces).toBe(false)
  })

  test('does not promise a plain string from a member that returns parts', () => {
    expect(declarations).not.toMatch(/=> string$/mu)
  })
})

describe('the typed lookup tier', () => {
  const group: Group = {
    name: 'errors',
    id: 'errors',
    typeBase: 'Errors',
    prefix: 'errors',
    members: [
      { key: 'errors.default', id: 'errors_default', member: 'default' },
      { key: 'errors.constructor', id: 'errors_constructor', member: 'constructor' },
    ],
  }
  const plain = (key: string, id: string): Message =>
    message({
      key,
      source: 'Denied',
      identifier: id,
      bodies: [body('en', [text('Denied')])],
      origins: [translated('en')],
    })
  const files = withGroup([plain('errors.default', 'errors_default'), plain('errors.constructor', 'errors_constructor')], group)

  test('keeps a member named constructor off Object.prototype', () => {
    const record = contentsOf(files, 'groups.js')
    expect(record).toContain('__proto__: null,')
    expect(record.indexOf('__proto__: null,')).toBeLessThan(record.indexOf('constructor:'))
    expect(() => parse(record)).not.toThrow()
  })

  test('requires the args parameter so a dynamic key cannot be called bare', () => {
    const declarations = contentsOf(files, 'groups.d.ts')
    expect(declarations).toContain('(args: ErrorsArgs[K], opts?: MessageOptions) => string')
    expect(declarations).not.toContain('args?: ErrorsArgs')
  })

  test('types a member with no arguments as EmptyArgs', () => {
    expect(contentsOf(files, 'groups.d.ts')).toContain('  constructor: EmptyArgs')
  })
})
