import { describe, expect, it } from 'vitest'
import { CORPUS } from './__fixtures__/corpus'
import { icuContext } from './__fixtures__/context'
import { lower } from './lower'
import { printIcu } from './print'

describe('printIcu is the inverse of lower', () => {
  it.each(CORPUS)('round trips %j', (value) => {
    const first = lower(value, icuContext())
    expect(first.diagnostics.filter((entry) => entry.rule === 'icu-syntax')).toEqual([])

    const printed = printIcu(first.nodes)
    const second = lower(printed, icuContext())

    expect(second.diagnostics.filter((entry) => entry.rule === 'icu-syntax')).toEqual([])
    expect(second.nodes).toStrictEqual(first.nodes)
    expect(second.args).toStrictEqual(first.args)
    expect(second.markupTags).toStrictEqual(first.markupTags)
    expect(second.kind).toBe(first.kind)
    expect(printIcu(second.nodes)).toBe(printed)
  })

  it.each(CORPUS)('exposes normalized as printIcu of its own nodes for %j', (value) => {
    const result = lower(value, icuContext())
    expect(result.normalized).toBe(printIcu(result.nodes))
  })
})
