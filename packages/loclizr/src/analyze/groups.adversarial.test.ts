import { posix } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Config, Program } from '../types'
import { catalog, codes, config, run } from './__fixtures__/program'

function english(input: {
  readonly config: Config
  readonly entries: Readonly<Record<string, string>>
}): Program {
  return run({ config: input.config, catalogs: [catalog({ locale: 'en', entries: input.entries })] })
}

describe('the lookup tier member properties', () => {
  it('reports two member properties that mangle onto one name', () => {
    const program = english({
      config: config({
        locales: ['en'],
        groups: { errors: 'errors' },
        identifiers: { 'errors.not-found': 'errorsNotFoundLegacy' },
      }),
      entries: { 'errors.not-found': 'Gone', 'errors.not_found': 'Not found' },
    })
    expect(codes(program.diagnostics)).toContain('LZ4001')
  })

  it('reports a member property that collides with the group literal prototype key', () => {
    const program = english({
      config: config({ locales: ['en'], groups: { errors: 'errors' } }),
      entries: { 'errors.__proto__': 'Nope', 'errors.forbidden': 'Forbidden' },
    })
    expect(codes(program.diagnostics)).toContain('LZ4002')
  })
})

describe('a group whose members select on one argument name', () => {
  it('reports the disjoint option unions that make a dynamic call uncallable', () => {
    const program = english({
      config: config({ locales: ['en'], groups: { errors: 'errors' } }),
      entries: {
        'errors.a': '{s, select, shipped {S} other {O}}',
        'errors.b': '{s, select, delivered {D} other {O}}',
      },
    })
    expect(codes(program.diagnostics)).toContain('LZ4006')
  })

  it('stays quiet where every member carries the same option union', () => {
    const program = english({
      config: config({ locales: ['en'], groups: { errors: 'errors' } }),
      entries: {
        'errors.a': '{s, select, shipped {S} other {O}}',
        'errors.b': '{s, select, shipped {Shipped} other {O}}',
      },
    })
    expect(codes(program.diagnostics)).toEqual([])
  })
})

describe('an identifier override used on a namespace segment', () => {
  it('cannot turn a module name into a path out of the output directory', () => {
    const program = english({
      config: config({ locales: ['en'], identifiers: { nav: '../../../../../../etc/evil' } }),
      entries: { 'nav.home': 'Home' },
    })
    const module = program.messages[0]?.module ?? ''
    expect(module).toMatch(/^messages\/[^/\\]+\.js$/u)
    expect(posix.normalize(posix.join('src/loclizr', module))).toMatch(/^src\/loclizr\//u)
  })

  it('renames the module of every key under that segment, not only the key itself', () => {
    const program = english({
      config: config({ locales: ['en'], identifiers: { nav: 'navigation' } }),
      entries: { nav: 'Navigation', 'nav.home': 'Home' },
    })
    expect(program.messages.map((message) => [message.key, message.id, message.module])).toEqual([
      ['nav', 'navigation', 'messages/_root.js'],
      ['nav.home', 'nav_home', 'messages/navigation.js'],
    ])
  })
})
