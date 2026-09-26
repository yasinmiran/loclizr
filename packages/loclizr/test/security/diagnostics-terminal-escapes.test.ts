import { describe, expect, test } from 'vitest'
import { diag, renderHuman } from '../../src/diagnostics'
import type { Diagnostic } from '../../src/types'

// Everything a terminal reads as a command rather than as text: the C0 set
// without tab and newline, DEL, and the C1 set a UTF-8 terminal also honours.
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/u

const ERASE_LINE = '\u001b[2K'
const CURSOR_UP = '\u001b[1A'
const OSC_LINK = '\u001b]8;;https://example.invalid\u0007click\u001b]8;;\u0007'

function rendered(diagnostic: Diagnostic): string {
  return renderHuman([diagnostic], { color: false })
}

// A catalog is attacker influenced wherever a TMS round trip or an outside
// translator can land a string, and every one of these fields carries catalog
// text straight into a developer's terminal and into a CI log.
describe('catalog text reaching the human reporter', () => {
  test('neutralizes an escape sequence carried by a key', () => {
    const diagnostic = diag('duplicate-key', {
      message: 'defined twice in this file.',
      key: `cart.items${CURSOR_UP}${ERASE_LINE}`,
      file: 'locales/en.json',
    })
    expect(rendered(diagnostic)).not.toMatch(CONTROL)
  })

  test('neutralizes an escape sequence carried by the message body', () => {
    const diagnostic = diag('ambiguous-source', {
      message: `Two keys share the source text "Open${ERASE_LINE}${CURSOR_UP}error  LZ0000  all clear".`,
      file: 'locales/en.json',
    })
    expect(rendered(diagnostic)).not.toMatch(CONTROL)
  })

  test('neutralizes an escape sequence carried by a hint', () => {
    const diagnostic = diag('i18next-context-detected', {
      message: 'carries a context suffix.',
      hint: `replace them with one message: ${OSC_LINK}`,
      file: 'locales/en.json',
    })
    expect(rendered(diagnostic)).not.toMatch(CONTROL)
  })

  test('neutralizes an escape sequence carried by a related row', () => {
    const diagnostic = diag('ambiguous-source', {
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
    })
    expect(rendered(diagnostic)).not.toMatch(CONTROL)
  })

  test('keeps the text itself legible rather than dropping it', () => {
    const diagnostic = diag('duplicate-key', {
      message: 'defined twice in this file.',
      key: `cart.${ERASE_LINE}items`,
      file: 'locales/en.json',
    })
    expect(rendered(diagnostic)).toContain('items')
  })

  test('leaves a diagnostic carrying no control character byte identical', () => {
    const diagnostic = diag('duplicate-key', {
      message: 'defined twice in this file.',
      hint: 'delete one of the two.',
      key: 'cart.items',
      file: 'locales/en.json',
    })
    expect(rendered(diagnostic)).toBe(
      [
        'error  LZ1011  duplicate-key  locales/en.json  cart.items',
        '',
        '  defined twice in this file.',
        '',
        '  fix  delete one of the two.',
      ].join('\n'),
    )
  })
})
