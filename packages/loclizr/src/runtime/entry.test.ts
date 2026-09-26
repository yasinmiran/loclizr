import { describe, expect, test } from 'vitest'
import * as entry from '../index'

// The ABI is enforced by the JS import rather than by types, so a stale
// generated tree has to fail at link time on a missing named export.
const ABI = ['$configure1', '$dateTime1', '$number1', '$plural1']
const PUBLIC = ['defineConfig', 'getLocale', 'setLocale', 'subscribe']

describe('the loclizr entry', () => {
  test('exports the four ABI helpers and the public store, and nothing else', () => {
    expect(Object.keys(entry).sort()).toEqual([...ABI, ...PUBLIC].sort())
  })

  test('defineConfig is the identity function', () => {
    const config = { locales: ['en', 'de'] } as const
    expect(entry.defineConfig(config)).toBe(config)
  })
})
