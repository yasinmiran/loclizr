import { describe, expect, it } from 'vitest'
import type { Node, PlaceholderNote } from '../types'
import { message, program } from './__fixtures__/program'
import { buildRecord } from './index'

describe('buildRecord', () => {
  it('collects a plural nested in each select branch, after the select, other last', () => {
    const plural = (name: string): Node => ({
      kind: 'plural',
      name,
      ordinal: false,
      offset: 0,
      exact: [],
      branches: [
        { keyword: 'one', body: [{ kind: 'pound' }] },
        { keyword: 'other', body: [{ kind: 'pound' }] },
      ],
    })
    const nodes: readonly Node[] = [
      {
        kind: 'select',
        name: 'gender',
        branches: [
          { option: 'other', body: [plural('guests')] },
          { option: 'female', body: [plural('friends')] },
        ],
      },
    ]

    const record = buildRecord(
      program({ messages: [message({ key: 'a', id: 'a', namespace: 'n', source: 'x', nodes })] }),
    )

    expect(record.messages[0]?.variants).toEqual([
      { arg: 'gender', kind: 'select', matches: ['female', 'other'] },
      { arg: 'friends', kind: 'plural', matches: ['one', 'other'] },
      { arg: 'guests', kind: 'plural', matches: ['one', 'other'] },
    ])
  })

  it('breaks a tie between two non-NFC spellings on the name before the note', () => {
    // Both spellings render as the same glyph and neither is NFC, so only the
    // name's code points can rank them; the notes deliberately sort the other way.
    const acuteFirst = 'cafȩ́'
    const cedillaFirst = 'cafȩ́'
    const name = acuteFirst.normalize('NFC')
    const notes: readonly PlaceholderNote[] = [
      { name: acuteFirst, note: 'Lower spelling' },
      { name: cedillaFirst, note: 'Higher spelling' },
    ]
    const noteOf = (placeholders: readonly PlaceholderNote[]): string | null =>
      buildRecord(
        program({
          messages: [
            message({
              key: 'a',
              id: 'a',
              namespace: 'n',
              source: `{${name}}`,
              args: [{ name, type: { kind: 'stringish' } }],
              placeholders,
            }),
          ],
        }),
      ).messages[0]?.args[0]?.note ?? null

    expect(noteOf(notes)).toBe('Lower spelling')
    expect(noteOf([...notes].reverse())).toBe('Lower spelling')
  })
})
