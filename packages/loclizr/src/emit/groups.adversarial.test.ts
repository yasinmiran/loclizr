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

describe('a group whose type names meet the imported ones', () => {
  const none = (key: string, id: string): Message =>
    message({
      key,
      source: 'Nothing here',
      identifier: id,
      bodies: [body('en', [text('Nothing here')])],
      origins: [translated('en')],
    })
  const tier = (name: string, typeBase: string): Group => ({
    name,
    id: name,
    typeBase,
    prefix: name,
    members: [{ key: `${name}.none`, id: `${name}_none`, member: 'none' }],
  })
  const declarationsOf = (groups: readonly Group[]): string =>
    contentsOf(
      emit(
        program({
          messages: groups.map((group) => none(`${group.prefix}.none`, `${group.id}_none`)),
          groups,
          config: config({ locales: ['en'], groups: Object.fromEntries(groups.map((group) => [group.name, group.prefix])) }),
        }),
      ).files,
      'groups.d.ts',
    )
  const imports = (source: string): ReadonlyMap<string, string> => {
    const clause = /^import type \{ (.*) \} from 'loclizr'$/mu.exec(source)?.[1] ?? ''
    return new Map(
      clause.split(', ').map((entry) => {
        const [imported = '', local = imported] = entry.split(' as ')
        return [imported, local]
      }),
    )
  }
  const declaredTypes = (source: string): readonly string[] =>
    [...source.matchAll(/^export (?:type|interface) ([^\s<=]+)/gmu)].map((match) => match[1] ?? '')

  for (const groups of [[tier('empty', 'Empty')], [tier('empty', 'Empty'), tier('$Empty', '$Empty')]]) {
    test(`binds no imported name a local type declares, for ${groups.map((group) => group.typeBase).join(' and ')}`, () => {
      const source = declarationsOf(groups)
      const bound = imports(source)
      const locals = new Set(declaredTypes(source))
      for (const local of bound.values()) expect(locals.has(local)).toBe(false)
      expect(source).toContain(`  none: ${bound.get('EmptyArgs')}\n`)
      expect(source).toContain(`opts?: ${bound.get('MessageOptions')}) => string`)
    })
  }
})
