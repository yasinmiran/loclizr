import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Diagnostic, Summary } from '../types'
import { diag, renderHuman, renderJson } from './index'

// Everything a terminal reads as a command rather than as text: the C0 set
// without tab and newline, DEL, and the C1 set a UTF-8 terminal also honours.
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/u

const ERASE_LINE = '\u001b[2K'
const CURSOR_UP = '\u001b[1A'
const OSC_LINK = '\u001b]8;;https://example.invalid\u0007click\u001b]8;;\u0007'
const CSI = '\u009b'

const SUMMARY: Summary = { errors: 0, warnings: 0, messages: 0, locales: 0, fellBack: [] }

function rendered(diagnostic: Diagnostic): string {
  return renderHuman([diagnostic], { color: false })
}

afterEach(() => {
  vi.unstubAllEnvs()
})

// A catalog is attacker influenced wherever a TMS round trip or an outside
// translator can land a string, and every field below carries catalog text
// straight into a developer's terminal and into a CI log.
describe('control characters carried by catalog text into the human reporter', () => {
  test('neutralizes a cursor move and a line erase carried by a key', () => {
    const out = rendered(
      diag('duplicate-key', {
        message: 'defined twice in this file.',
        key: `cart.items${CURSOR_UP}${ERASE_LINE}`,
        file: 'locales/en.json',
      }),
    )
    expect(out).not.toMatch(CONTROL)
    expect(out).toContain('cart.items<U+001B>[1A<U+001B>[2K')
  })

  test('neutralizes a forged diagnostic row carried by the message body', () => {
    const out = rendered(
      diag('ambiguous-source', {
        message: `Two keys share "Open${ERASE_LINE}${CURSOR_UP}error  LZ0000  all clear".`,
        file: 'locales/en.json',
      }),
    )
    expect(out).not.toMatch(CONTROL)
  })

  test('neutralizes an OSC 8 hyperlink carried by a hint', () => {
    const out = rendered(
      diag('i18next-context-detected', {
        message: 'carries a context suffix.',
        hint: `replace them with one message: ${OSC_LINK}`,
        file: 'locales/en.json',
      }),
    )
    expect(out).not.toMatch(CONTROL)
  })

  test('neutralizes every column of a related row', () => {
    const out = rendered(
      diag('ambiguous-source', {
        message: 'Two keys share one source text.',
        file: 'locales/en.json',
        related: [
          {
            file: `locales/de${ERASE_LINE}.json`,
            locale: 'de',
            key: `dialog.open${CURSOR_UP}`,
            span: null,
            message: `no description${OSC_LINK}`,
          },
        ],
      }),
    )
    expect(out).not.toMatch(CONTROL)
  })

  test('neutralizes a bare C1 control introducer, which needs no escape byte', () => {
    const out = rendered(
      diag('duplicate-key', { message: `defined twice${CSI}2K.`, key: `cart${CSI}[1A.items` }),
    )
    expect(out).not.toMatch(CONTROL)
    expect(out).toContain('<U+009B>')
  })

  test('keeps the surrounding text legible rather than dropping the whole field', () => {
    const out = rendered(
      diag('duplicate-key', {
        message: 'defined twice in this file.',
        key: `cart.${ERASE_LINE}items`,
        file: 'locales/en.json',
      }),
    )
    expect(out).toContain('items')
  })

  test('leaves a diagnostic carrying no control character byte identical', () => {
    expect(
      rendered(
        diag('duplicate-key', {
          message: 'defined twice in this file.',
          hint: 'delete one of the two.',
          key: 'cart.items',
          file: 'locales/en.json',
        }),
      ),
    ).toBe(
      [
        'error  LZ1011  duplicate-key  locales/en.json  cart.items',
        '',
        '  defined twice in this file.',
        '',
        '  fix  delete one of the two.',
      ].join('\n'),
    )
  })

  test('keeps tab, which a terminal reads as text', () => {
    expect(rendered(diag('duplicate-key', { message: 'a\tb' }))).toContain('a\tb')
  })

  test('sanitizes content and not the reporter own colour codes', () => {
    vi.stubEnv('NO_COLOR', '')
    const out = renderHuman([diag('arg-missing', { message: 'name' })], { color: true })
    expect(out).toContain('\u001b[')
  })
})

describe('control characters reaching the json reporter', () => {
  test('escapes DEL and the C1 block, which JSON.stringify emits raw', () => {
    const out = renderJson([diag('duplicate-key', { message: `open${CSI}2K\u007f` })], SUMMARY)
    expect(out).not.toMatch(CONTROL)
    expect(out).toContain('\\u009b')
    expect(out).toContain('\\u007f')
  })

  test('escapes losslessly, so a parser still reads the bytes the catalog held', () => {
    const message = `open${CSI}2K\u007f\u0080\u009f`
    const parsed = JSON.parse(renderJson([diag('duplicate-key', { message })], SUMMARY)) as {
      readonly diagnostics: readonly Diagnostic[]
    }
    expect(parsed.diagnostics[0]?.message).toBe(message)
  })
})
