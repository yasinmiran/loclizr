import { describe, expect, it } from 'vitest'
import type { Config, Group, Program } from '../types'
import { catalog, codes, config, forRule, run } from './__fixtures__/program'

function english(input: {
  readonly config: Config
  readonly entries: Readonly<Record<string, string>>
}): Program {
  return run({ config: input.config, catalogs: [catalog({ locale: 'en', entries: input.entries })] })
}

function only(program: Program): Group {
  const [group] = program.groups
  if (group === undefined) throw new Error('no group')
  return group
}

const errors: Config = config({ groups: { errors: 'errors' } })

describe('member properties from awkward suffixes', () => {
  it('mangles a nested suffix into one property', () => {
    const group = only(english({ config: errors, entries: { 'errors.http.404': 'Not found' } }))
    expect(group.members.map((member) => member.member)).toEqual(['http_404'])
  })

  it('prefixes a numeric suffix so it can start an identifier', () => {
    const group = only(english({ config: errors, entries: { 'errors.404': 'Not found' } }))
    expect(group.members.map((member) => member.member)).toEqual(['$404'])
  })

  it('guards a reserved-word suffix the way mangle guards any identifier', () => {
    const group = only(english({ config: errors, entries: { 'errors.new': 'New' } }))
    expect(group.members.map((member) => member.member)).toEqual(['$new'])
  })

  it('reports nothing for constructor, prototype and toString members', () => {
    const program = english({
      config: errors,
      entries: { 'errors.constructor': 'a', 'errors.prototype': 'b', 'errors.toString': 'c' },
    })
    expect(program.diagnostics).toEqual([])
    expect(only(program).members.map((member) => member.member)).toEqual([
      'constructor',
      'prototype',
      'toString',
    ])
  })

  it('takes the member from the suffix even when an override renames the message', () => {
    const program = english({
      config: config({ groups: { errors: 'errors' }, identifiers: { 'errors.gone': 'goneError' } }),
      entries: { 'errors.gone': 'Gone' },
    })
    expect(only(program).members).toEqual([{ key: 'errors.gone', id: 'goneError', member: 'gone' }])
  })
})

describe('which keys a prefix captures', () => {
  it('leaves out a key equal to the prefix itself', () => {
    const program = english({ config: errors, entries: { errors: 'All', 'errors.x': 'X' } })
    expect(only(program).members.map((member) => member.key)).toEqual(['errors.x'])
  })

  it('treats a prefix with a trailing dot as matching nothing on a single dot boundary', () => {
    const program = english({
      config: config({ groups: { errors: 'errors.' } }),
      entries: { 'errors.x': 'X' },
    })
    expect(codes(forRule(program, 'group-empty'))).toEqual(['LZ4004'])
  })

  it('lists a key under two overlapping groups, with a member property in each', () => {
    const program = english({
      config: config({ groups: { errors: 'errors', http: 'errors.http' } }),
      entries: { 'errors.http.timeout': 'Timed out' },
    })
    expect(program.groups.map((group) => group.members.map((member) => member.member))).toEqual([
      ['http_timeout'],
      ['timeout'],
    ])
  })

  it('reports a group whose only key failed to lower in the source as empty', () => {
    const program = english({ config: errors, entries: { 'errors.broken': 'Hi {name' } })
    expect(only(program).members).toEqual([])
    expect(codes(forRule(program, 'group-empty'))).toEqual(['LZ4004'])
  })

  it('keeps an empty group in the program with no members', () => {
    const program = english({ config: errors, entries: { 'nav.home': 'Home' } })
    expect(only(program)).toMatchObject({ name: 'errors', id: 'errors', members: [] })
  })
})

describe('member order', () => {
  it('sorts members by property by code point, upper case before lower case', () => {
    const program = english({
      config: errors,
      entries: { 'errors.b': 'b', 'errors.a': 'a', 'errors.B': 'B' },
    })
    expect(only(program).members.map((member) => member.member)).toEqual(['B', 'a', 'b'])
  })
})

describe('group names', () => {
  it('derives the id and type base from a Cyrillic name', () => {
    const program = english({
      config: config({ groups: { ошибки: 'errors' } }),
      entries: { 'errors.x': 'X' },
    })
    expect(only(program)).toMatchObject({ name: 'ошибки', id: 'ошибки', typeBase: 'Ошибки' })
  })

  it('guards a reserved-word name and keeps the guard in the type base', () => {
    const program = english({
      config: config({ groups: { default: 'errors' } }),
      entries: { 'errors.x': 'X' },
    })
    expect(only(program)).toMatchObject({ name: 'default', id: '$default', typeBase: '$default' })
  })

  it('mangles a dotted name into one export identifier', () => {
    const program = english({
      config: config({ groups: { 'nav.main': 'nav' } }),
      entries: { 'nav.home': 'Home' },
    })
    expect(only(program)).toMatchObject({ name: 'nav.main', id: 'nav_main', typeBase: 'NavMain' })
  })
})

describe('argument signatures across members', () => {
  it('stays quiet where members name the same arguments in a different order', () => {
    const program = english({
      config: errors,
      entries: { 'errors.a': '{first} then {second}', 'errors.b': '{second} then {first}' },
    })
    expect(forRule(program, 'group-args-heterogeneous')).toEqual([])
  })

  it('warns where members use one name at two kinds', () => {
    const program = english({
      config: errors,
      entries: { 'errors.a': 'Wait {n}', 'errors.b': 'Wait {n, number}' },
    })
    expect(codes(forRule(program, 'group-args-heterogeneous'))).toEqual(['LZ4006'])
  })

  it('names the union of argument names sorted by code point', () => {
    const program = english({
      config: errors,
      entries: { 'errors.a': '{zeta}', 'errors.b': '{Alpha} {beta}' },
    })
    const [warning] = forRule(program, 'group-args-heterogeneous')
    expect(warning?.message).toContain('Alpha, beta, zeta')
  })

  it('stays quiet for a single member with arguments', () => {
    const program = english({ config: errors, entries: { 'errors.a': '{x} {y, number}' } })
    expect(forRule(program, 'group-args-heterogeneous')).toEqual([])
  })
})
