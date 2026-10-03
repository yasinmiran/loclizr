import { describe, expect, it } from 'vitest'
import type { Config, Group, Program } from '../types'
import { catalog, config, forRule, run } from './__fixtures__/program'

function english(input: {
  readonly config: Config
  readonly entries: Readonly<Record<string, string>>
}): Program {
  return run({ config: input.config, catalogs: [catalog({ locale: 'en', entries: input.entries })] })
}

function groupNamed(program: Program, name: string): Group {
  const group = program.groups.find((candidate) => candidate.name === name)
  if (group === undefined) throw new Error(`no group ${name}`)
  return group
}

describe('which lowering errors drop a message', () => {
  // Section 7.2: an argument name failing LZ2007 still reaches emit, because
  // only a message-scoped fatal rule removes the message.
  it('keeps a message whose only error is a fatal: never rule', () => {
    const program = english({ config: config(), entries: { count: '{9x} items' } })
    expect(forRule(program, 'arg-name-invalid')).toHaveLength(1)
    expect(program.messages.map((message) => message.key)).toEqual(['count'])
  })
})

describe('Object as an identifier', () => {
  // Only the groups module calls the bare global, so a key outside every group
  // may export under that name.
  it('reserves nothing for a root key named Object when no group exists', () => {
    const program = english({ config: config(), entries: { Object: 'Thing' } })
    expect(program.diagnostics).toEqual([])
  })

  it('reserves a group whose overridden id is Object', () => {
    const program = english({
      config: config({ groups: { x: 'x' }, identifiers: { x: 'Object' } }),
      entries: { 'x.a': 'A' },
    })
    expect(groupNamed(program, 'x').id).toBe('Object')
    expect(forRule(program, 'identifier-reserved')).toHaveLength(1)
  })

  it('accepts a group named Object once an override moves its id', () => {
    const program = english({
      config: config({ groups: { Object: 'things' }, identifiers: { Object: 'appObject' } }),
      entries: { 'things.a': 'A' },
    })
    expect(groupNamed(program, 'Object').id).toBe('appObject')
    expect(forRule(program, 'identifier-reserved')).toEqual([])
  })
})

describe('group ids under an identifiers entry', () => {
  // Section 3: one identifiers map is also looked up by group name.
  it('renames the group export and its type base, keeping the config name', () => {
    const program = english({
      config: config({ groups: { errors: 'errors' }, identifiers: { errors: 'appErrors' } }),
      entries: { 'errors.forbidden': 'Forbidden' },
    })
    const group = groupNamed(program, 'errors')
    expect(group).toMatchObject({ name: 'errors', id: 'appErrors', typeBase: 'AppErrors' })
  })
})

describe('a group id equal to a member id', () => {
  // Key order, group id order and member order all put a.x first here, so the
  // anchor does not depend on which order "first" is read in.
  it('anchors the collision on the first member key carrying that id', () => {
    const program = english({
      config: config({
        groups: { dup: 'a', other: 'b' },
        identifiers: { 'a.x': 'dup', 'b.y': 'dup' },
      }),
      entries: { 'a.x': 'X', 'b.y': 'Y' },
    })
    const collisions = forRule(program, 'identifier-collision')
    expect(collisions).toHaveLength(2)
    expect(collisions.map((diagnostic) => diagnostic.key)).toEqual(['a.x', 'a.x'])
  })
})
