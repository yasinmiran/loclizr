import { describe, expect, it } from 'vitest'
import type { Diagnostic } from '../types'
import {
  argNode,
  at,
  body,
  config,
  message,
  option,
  program,
  selectArg,
  selectNode,
  stringishArg,
  text,
  translated,
} from './__fixtures__/program'
import { runChecks } from './index'

function codes(diagnostics: readonly Diagnostic[]): readonly string[] {
  return diagnostics.map((entry) => entry.code)
}

function withCode(diagnostics: readonly Diagnostic[], code: string): readonly Diagnostic[] {
  return diagnostics.filter((entry) => entry.code === code)
}

function messages(diagnostics: readonly Diagnostic[], code: string): readonly string[] {
  return withCode(diagnostics, code).map((entry) => entry.message)
}

const twoLocales = config({ locales: ['de', 'en'], sourceLocale: 'en' })

describe('select branches a call site can reach', () => {
  it('never calls a target branch unreachable when the source select carries only other', () => {
    const diagnostics = runChecks(
      program({
        config: twoLocales,
        messages: [
          message({
            key: 'order.status',
            source: '{state, select, other {Processing}}',
            bodies: [
              body('en', {
                nodes: [selectNode('state', [option('other', text('Processing'))])],
                args: [selectArg('state', [])],
              }),
              body('de', {
                nodes: [
                  selectNode('state', [
                    option('shipped', text('Unterwegs')),
                    option('other', text('In Bearbeitung')),
                  ]),
                ],
                args: [selectArg('state', ['shipped'])],
              }),
            ],
            origins: [translated('de'), translated('en')],
            spans: [at('de', 4, 5), at('en', 4, 5)],
          }),
        ],
      }),
    )

    expect(codes(diagnostics)).toEqual([])
  })

  it('takes the reachable option set from the source type, not from every select sharing the name', () => {
    const diagnostics = runChecks(
      program({
        config: twoLocales,
        messages: [
          message({
            key: 'order.status',
            source: '{state, select, a {A} other {O}} {state, select, b {B} other {O}}',
            bodies: [
              body('en', {
                nodes: [
                  selectNode('state', [option('a', text('A')), option('other', text('O'))]),
                  text(' '),
                  selectNode('state', [option('b', text('B')), option('other', text('O'))]),
                ],
                args: [selectArg('state', ['a'])],
              }),
              body('de', {
                nodes: [selectNode('state', [option('b', text('B')), option('other', text('O'))])],
                args: [selectArg('state', ['b'])],
              }),
            ],
            origins: [translated('de'), translated('en')],
            spans: [at('de', 4, 5), at('en', 4, 5)],
          }),
        ],
      }),
    )

    expect(messages(diagnostics, 'LZ3009')).toHaveLength(1)
    expect(messages(diagnostics, 'LZ3009')[0] ?? '').toContain('"b"')
  })

  it('leaves a translation free to branch on a source argument that is plain text', () => {
    const diagnostics = runChecks(
      program({
        config: twoLocales,
        messages: [
          message({
            key: 'order.status',
            source: '{state}',
            bodies: [
              body('en', { nodes: [argNode('state')], args: [stringishArg('state')] }),
              body('de', {
                nodes: [
                  selectNode('state', [
                    option('shipped', text('Unterwegs')),
                    option('other', text('In Bearbeitung')),
                  ]),
                ],
                args: [selectArg('state', ['shipped'])],
              }),
            ],
            origins: [translated('de'), translated('en')],
            spans: [at('de', 4, 5), at('en', 4, 5)],
          }),
        ],
      }),
    )

    expect(codes(diagnostics)).toEqual([])
  })

  // Pinned, not endorsed: no rule in the catalog covers a target that keeps the
  // argument and renders it raw, and LZ3008's text names a collapse into other.
  it('says nothing when a translation keeps the argument and drops the select', () => {
    const diagnostics = runChecks(
      program({
        config: twoLocales,
        messages: [
          message({
            key: 'order.status',
            source: '{state, select, shipped {On its way} other {Processing}}',
            bodies: [
              body('en', {
                nodes: [
                  selectNode('state', [
                    option('shipped', text('On its way')),
                    option('other', text('Processing')),
                  ]),
                ],
                args: [selectArg('state', ['shipped'])],
              }),
              body('de', { nodes: [argNode('state')], args: [stringishArg('state')] }),
            ],
            origins: [translated('de'), translated('en')],
            spans: [at('de', 4, 5), at('en', 4, 5)],
          }),
        ],
      }),
    )

    expect(codes(diagnostics)).toEqual([])
  })

  it('compares option names that are object prototype members without reaching the prototype', () => {
    const diagnostics = runChecks(
      program({
        config: twoLocales,
        messages: [
          message({
            key: 'order.status',
            source: '{state, select, __proto__ {A} constructor {B} other {O}}',
            bodies: [
              body('en', {
                nodes: [
                  selectNode('state', [
                    option('__proto__', text('A')),
                    option('constructor', text('B')),
                    option('other', text('O')),
                  ]),
                ],
                args: [selectArg('state', ['__proto__', 'constructor'])],
              }),
              body('de', {
                nodes: [
                  selectNode('state', [
                    option('hasOwnProperty', text('C')),
                    option('other', text('O')),
                  ]),
                ],
                args: [selectArg('state', ['hasOwnProperty'])],
              }),
            ],
            origins: [translated('de'), translated('en')],
            spans: [at('de', 4, 5), at('en', 4, 5)],
          }),
        ],
      }),
    )

    const collapsed = messages(diagnostics, 'LZ3008')
    expect(collapsed).toHaveLength(2)
    expect(collapsed.join('\n')).toContain('"__proto__"')
    expect(collapsed.join('\n')).toContain('"constructor"')
    expect(messages(diagnostics, 'LZ3009')).toHaveLength(1)
    expect(messages(diagnostics, 'LZ3009')[0] ?? '').toContain('"hasOwnProperty"')
  })

  it('treats a case-only difference as two distinct branches', () => {
    const diagnostics = runChecks(
      program({
        config: twoLocales,
        messages: [
          message({
            key: 'order.status',
            source: '{state, select, Shipped {On its way} other {Processing}}',
            bodies: [
              body('en', {
                nodes: [
                  selectNode('state', [
                    option('Shipped', text('On its way')),
                    option('other', text('Processing')),
                  ]),
                ],
                args: [selectArg('state', ['Shipped'])],
              }),
              body('de', {
                nodes: [
                  selectNode('state', [
                    option('shipped', text('Unterwegs')),
                    option('other', text('In Bearbeitung')),
                  ]),
                ],
                args: [selectArg('state', ['shipped'])],
              }),
            ],
            origins: [translated('de'), translated('en')],
            spans: [at('de', 4, 5), at('en', 4, 5)],
          }),
        ],
      }),
    )

    expect(codes(diagnostics).slice().sort()).toEqual(['LZ3008', 'LZ3009'])
  })

  it('treats a decomposed option name as a branch the source does not have', () => {
    const composed = 'café'
    const decomposed = 'café'
    const diagnostics = runChecks(
      program({
        config: twoLocales,
        messages: [
          message({
            key: 'order.place',
            source: `{where, select, ${composed} {Cafe} other {Elsewhere}}`,
            bodies: [
              body('en', {
                nodes: [
                  selectNode('where', [
                    option(composed, text('Cafe')),
                    option('other', text('Elsewhere')),
                  ]),
                ],
                args: [selectArg('where', [composed])],
              }),
              body('de', {
                nodes: [
                  selectNode('where', [
                    option(decomposed, text('Cafe')),
                    option('other', text('Woanders')),
                  ]),
                ],
                args: [selectArg('where', [decomposed])],
              }),
            ],
            origins: [translated('de'), translated('en')],
            spans: [at('de', 4, 5), at('en', 4, 5)],
          }),
        ],
      }),
    )

    expect(codes(diagnostics).slice().sort()).toEqual(['LZ3008', 'LZ3009'])
  })
})
