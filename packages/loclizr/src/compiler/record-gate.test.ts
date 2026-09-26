import { describe, expect, it } from 'vitest'
import { recordsAgree } from './record-gate'

interface RecordShape {
  readonly schema?: number
  readonly sourceLocale?: string
  readonly locales?: readonly string[]
  readonly messages?: readonly Record<string, unknown>[]
}

function bytes(overrides: RecordShape = {}): string {
  return `${JSON.stringify(
    {
      schema: overrides.schema ?? 1,
      sourceLocale: overrides.sourceLocale ?? 'en',
      locales: overrides.locales ?? ['de', 'en'],
      messages: overrides.messages ?? [navHome()],
    },
    null,
    2,
  )}\n`
}

function navHome(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    key: 'nav.home',
    id: 'nav_home',
    module: 'messages/nav.js',
    kind: 'text',
    source: 'Home',
    sourceHash: '3a78695388b38b5c',
    description: null,
    args: [],
    variants: [],
    markup: [],
    translations: [{ locale: 'de', status: 'translated', from: null, reason: null }],
    usage: [],
    ...overrides,
  }
}

describe('recordsAgree', () => {
  it('agrees with itself', () => {
    expect(recordsAgree(bytes(), bytes())).toBe(true)
  })

  it('ignores the key order of the committed file', () => {
    const reordered = `${JSON.stringify({
      messages: [navHome()],
      locales: ['de', 'en'],
      sourceLocale: 'en',
      schema: 1,
    })}\n`

    expect(recordsAgree(reordered, bytes())).toBe(true)
  })

  it('ignores a usage array that moved', () => {
    const committed = bytes({ messages: [navHome({ usage: [{ file: 'a.tsx', scope: 'A' }] })] })
    const fresh = bytes({ messages: [navHome({ usage: [{ file: 'b.tsx', scope: 'B' }] })] })

    expect(recordsAgree(committed, fresh)).toBe(true)
  })

  it('ignores a translation batch that landed', () => {
    const fresh = bytes({
      messages: [
        navHome({
          translations: [{ locale: 'de', status: 'fallback', from: 'en', reason: 'missing' }],
        }),
      ],
    })

    expect(recordsAgree(bytes(), fresh)).toBe(true)
  })

  it('catches edited copy through source and sourceHash', () => {
    expect(recordsAgree(bytes(), bytes({ messages: [navHome({ source: 'Start' })] }))).toBe(false)
    expect(recordsAgree(bytes(), bytes({ messages: [navHome({ sourceHash: 'ffff' })] }))).toBe(false)
  })

  it('catches a changed argument set', () => {
    const fresh = bytes({
      messages: [navHome({ args: [{ name: 'name', type: 'text', options: null, note: null }] })],
    })

    expect(recordsAgree(bytes(), fresh)).toBe(false)
  })

  it('catches argument order, which the declaration prints verbatim', () => {
    const first = { name: 'a', type: 'text', options: null, note: null }
    const second = { name: 'b', type: 'text', options: null, note: null }
    const committed = bytes({ messages: [navHome({ args: [first, second] })] })
    const fresh = bytes({ messages: [navHome({ args: [second, first] })] })

    expect(recordsAgree(committed, fresh)).toBe(false)
  })

  it('catches an added message and a changed header field', () => {
    expect(recordsAgree(bytes(), bytes({ messages: [navHome(), navHome({ key: 'nav.cart' })] }))).toBe(
      false,
    )
    expect(recordsAgree(bytes(), bytes({ locales: ['de', 'de-AT', 'en'] }))).toBe(false)
    expect(recordsAgree(bytes(), bytes({ sourceLocale: 'de' }))).toBe(false)
  })

  it('treats an unparseable committed record as differing', () => {
    expect(recordsAgree('{ not json', bytes())).toBe(false)
    expect(recordsAgree('', bytes())).toBe(false)
  })

  it('compares a record whose messages field is not an array rather than throwing', () => {
    expect(recordsAgree('{"schema":1,"messages":"none"}', bytes())).toBe(false)
  })
})
