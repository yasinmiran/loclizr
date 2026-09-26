import { describe, expect, it } from 'vitest'
import type { ArgType } from '../types'
import { unify } from './unify'

const STRINGISH: ArgType = { kind: 'stringish' }
const NUMBER: ArgType = { kind: 'number' }
const DATE: ArgType = { kind: 'date' }
const MARKUP: ArgType = { kind: 'markup' }
const SELECT_AB: ArgType = { kind: 'select', options: ['a', 'b'] }
const SELECT_C: ArgType = { kind: 'select', options: ['c'] }

describe('unify', () => {
  it('narrows stringish to the other kind in both directions', () => {
    expect(unify(STRINGISH, NUMBER)).toStrictEqual(NUMBER)
    expect(unify(NUMBER, STRINGISH)).toStrictEqual(NUMBER)
    expect(unify(STRINGISH, DATE)).toStrictEqual(DATE)
    expect(unify(STRINGISH, SELECT_AB)).toStrictEqual(SELECT_AB)
  })

  it('narrows stringish to markup as well, because markup is one of the kinds', () => {
    expect(unify(STRINGISH, MARKUP)).toStrictEqual(MARKUP)
    expect(unify(MARKUP, STRINGISH)).toStrictEqual(MARKUP)
  })

  it('unifies two stringish to stringish', () => {
    expect(unify(STRINGISH, STRINGISH)).toStrictEqual(STRINGISH)
  })

  it('unifies identical kinds to themselves', () => {
    expect(unify(NUMBER, NUMBER)).toStrictEqual(NUMBER)
    expect(unify(DATE, DATE)).toStrictEqual(DATE)
    expect(unify(MARKUP, MARKUP)).toStrictEqual(MARKUP)
  })

  it('keeps the first select option union, so a target locale cannot widen it', () => {
    expect(unify(SELECT_AB, SELECT_C)).toStrictEqual(SELECT_AB)
    expect(unify(SELECT_C, SELECT_AB)).toStrictEqual(SELECT_C)
  })

  it('fails on any other pair', () => {
    expect(unify(NUMBER, DATE)).toBeNull()
    expect(unify(DATE, NUMBER)).toBeNull()
    expect(unify(NUMBER, SELECT_AB)).toBeNull()
    expect(unify(MARKUP, NUMBER)).toBeNull()
    expect(unify(DATE, MARKUP)).toBeNull()
  })
})
