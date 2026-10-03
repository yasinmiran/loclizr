import { describe, expect, it } from 'vitest'
import type { Diagnostic, Message, Node } from '../types'
import {
  argNode,
  at,
  body,
  branch,
  config,
  dateArg,
  dateTimeNode,
  exactBranch,
  extra,
  fellBack,
  markupArg,
  markupNode,
  message,
  numberArg,
  option,
  plural,
  pound,
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

function only(diagnostics: readonly Diagnostic[], code: string): Diagnostic {
  const found = withCode(diagnostics, code)
  const [first] = found
  if (first === undefined || found.length !== 1) {
    throw new Error(`expected exactly one ${code}, got ${found.length} of ${codes(diagnostics)}`)
  }
  return first
}

function hintLines(diagnostic: Diagnostic): readonly string[] {
  return (diagnostic.hint ?? '').split('\n')
}

function pasteLines(diagnostic: Diagnostic): readonly string[] {
  return hintLines(diagnostic).filter((line) => line.endsWith('{ "description": "" }'))
}

function pastedKey(line: string): unknown {
  const label = line.trim().replace(/:\s+\{ "description": "" \}$/u, '')
  return JSON.parse(label)
}

function sharing(source: string, key: string, description: string | null = null): Message {
  return message({
    key,
    source,
    description,
    bodies: [body('en', { nodes: [text(source)] })],
    origins: [translated('en')],
    spans: [at('en', 1, 1)],
  })
}

function missingIn(key: string, ...locales: readonly string[]): Message {
  return message({
    key,
    bodies: [body('en')],
    origins: [translated('en'), ...locales.map((locale) => fellBack(locale, 'en', 'missing'))],
    spans: [at('en', 1, 1)],
  })
}

function pluralBody(locale: string, keywords: readonly string[], ordinal = false) {
  return body(locale, {
    nodes: [
      plural({
        name: 'count',
        ordinal,
        branches: keywords.map((keyword) => branch(keyword, pound())),
      }),
    ],
    args: [numberArg('count')],
  })
}

function pluralMessage(locale: string, keywords: readonly string[]): Message {
  return message({
    key: 'cart.items',
    bodies: [pluralBody('en', ['one', 'other']), pluralBody(locale, keywords)],
    spans: [at('en', 1, 1), at(locale, 2, 1)],
  })
}

describe('a target that splits one argument across several selects', () => {
  const genderSource = body('en', {
    nodes: [
      selectNode('gender', [
        option('male', text('He')),
        option('female', text('She')),
        option('other', text('They')),
      ]),
    ],
    args: [selectArg('gender', ['female', 'male'])],
  })

  it('reads the union of every target select, so two halves cover the source', () => {
    const diagnostics = runChecks(
      program({
        messages: [
          message({
            key: 'profile.pronoun',
            bodies: [
              genderSource,
              body('de', {
                nodes: [
                  selectNode('gender', [option('male', text('Er')), option('other', text('Sie'))]),
                  text(' '),
                  selectNode('gender', [option('female', text('Sie')), option('other', text('Sie'))]),
                ],
                args: [selectArg('gender', ['female', 'male'])],
              }),
            ],
          }),
        ],
      }),
    )

    expect(withCode(diagnostics, 'LZ3008')).toEqual([])
  })

  it('reports a branch every target select invents once, not once per select', () => {
    const diagnostics = runChecks(
      program({
        messages: [
          message({
            key: 'profile.pronoun',
            bodies: [
              genderSource,
              body('de', {
                nodes: [
                  selectNode('gender', [
                    option('male', text('Er')),
                    option('female', text('Sie')),
                    option('divers', text('Dey')),
                    option('other', text('Sie')),
                  ]),
                  selectNode('gender', [
                    option('divers', text('Dey')),
                    option('other', text('Sie')),
                  ]),
                ],
                args: [selectArg('gender', ['divers', 'female', 'male'])],
              }),
            ],
          }),
        ],
      }),
    )

    expect(only(diagnostics, 'LZ3009').message).toContain('"divers"')
  })

  it('reports a source option once even when two target selects both lack it', () => {
    const diagnostics = runChecks(
      program({
        messages: [
          message({
            key: 'profile.pronoun',
            bodies: [
              genderSource,
              body('de', {
                nodes: [
                  selectNode('gender', [option('male', text('Er')), option('other', text('Sie'))]),
                  selectNode('gender', [option('male', text('Er')), option('other', text('Sie'))]),
                ],
                args: [selectArg('gender', ['male'])],
              }),
            ],
          }),
        ],
      }),
    )

    expect(only(diagnostics, 'LZ3008').message).toContain('"female"')
  })

  it('finds a target select nested inside a select of the same name', () => {
    const diagnostics = runChecks(
      program({
        messages: [
          message({
            key: 'profile.pronoun',
            bodies: [
              genderSource,
              body('de', {
                nodes: [
                  selectNode('gender', [
                    option('male', text('Er')),
                    option(
                      'other',
                      selectNode('gender', [
                        option('female', text('Sie')),
                        option('other', text('Sie')),
                      ]),
                    ),
                  ]),
                ],
                args: [selectArg('gender', ['female', 'male'])],
              }),
            ],
          }),
        ],
      }),
    )

    expect(diagnostics).toEqual([])
  })

  it('reports each missing option in the order the source type lists them', () => {
    const diagnostics = runChecks(
      program({
        messages: [
          message({
            key: 'profile.pronoun',
            bodies: [
              genderSource,
              body('de', {
                nodes: [selectNode('gender', [option('other', text('Sie'))])],
                args: [selectArg('gender', [])],
              }),
            ],
          }),
        ],
      }),
    )

    const missing = withCode(diagnostics, 'LZ3008').map((entry) => entry.message)
    expect(missing).toHaveLength(2)
    expect(missing[0]).toContain('"female"')
    expect(missing[1]).toContain('"male"')
  })
})

describe('nodes reached only through an exact plural branch', () => {
  function insideZero(...inner: readonly Node[]): Node {
    return plural({
      name: 'n',
      exact: [exactBranch(0, ...inner)],
      branches: [branch('one', pound()), branch('other', pound())],
    })
  }

  it('compares a select that lives inside =0', () => {
    const diagnostics = runChecks(
      program({
        messages: [
          message({
            key: 'inbox.summary',
            bodies: [
              body('en', {
                nodes: [
                  insideZero(
                    selectNode('kind', [option('mail', text('m')), option('other', text('o'))]),
                  ),
                ],
                args: [numberArg('n'), selectArg('kind', ['mail'])],
              }),
              body('de', {
                nodes: [insideZero(selectNode('kind', [option('other', text('o'))]))],
                args: [numberArg('n'), selectArg('kind', [])],
              }),
            ],
          }),
        ],
      }),
    )

    expect(only(diagnostics, 'LZ3008').message).toContain('"mail"')
  })

  it('checks the categories of a plural that lives inside =0', () => {
    const diagnostics = runChecks(
      program({
        config: config({ locales: ['en', 'ru'] }),
        messages: [
          message({
            key: 'inbox.summary',
            bodies: [
              body('en', {
                nodes: [
                  insideZero(
                    plural({ name: 'm', branches: [branch('one', pound()), branch('other', pound())] }),
                  ),
                ],
                args: [numberArg('n'), numberArg('m')],
              }),
              body('ru', {
                nodes: [
                  plural({
                    name: 'n',
                    exact: [
                      exactBranch(
                        0,
                        plural({
                          name: 'm',
                          branches: [branch('one', pound()), branch('other', pound())],
                        }),
                      ),
                    ],
                    branches: [
                      branch('one', pound()),
                      branch('few', pound()),
                      branch('many', pound()),
                      branch('other', pound()),
                    ],
                  }),
                ],
                args: [numberArg('n'), numberArg('m')],
              }),
            ],
          }),
        ],
      }),
    )

    const incomplete = only(diagnostics, 'LZ3007')
    expect(incomplete.locale).toBe('ru')
    expect(incomplete.message).toContain('{m}')
  })

  it('finds an unzoned date that lives inside =0', () => {
    const diagnostics = runChecks(
      program({
        config: config({ locales: ['en'] }),
        messages: [
          message({
            key: 'inbox.summary',
            bodies: [
              body('en', {
                nodes: [insideZero(dateTimeNode('since'))],
                args: [numberArg('n'), dateArg('since')],
              }),
            ],
          }),
        ],
      }),
    )

    expect(only(diagnostics, 'LZ3011').message).toContain('{since}')
  })
})

describe('the wording of an incomplete plural', () => {
  it('says it for a single missing category', () => {
    const diagnostics = runChecks(program({ messages: [pluralMessage('de', ['other'])] }))

    const incomplete = only(diagnostics, 'LZ3007')
    expect(incomplete.message).toMatch(/has no branch for it\.$/u)
    expect(incomplete.hint).toBe('add one {...} to {count, plural, ...} in locales/de.json')
  })

  it('says them for two or more missing categories', () => {
    const diagnostics = runChecks(
      program({
        config: config({ locales: ['en', 'ru'] }),
        messages: [pluralMessage('ru', ['one', 'other'])],
      }),
    )

    expect(only(diagnostics, 'LZ3007').message).toMatch(/has no branch for them\.$/u)
  })

  it('names selectordinal in the hint for an ordinal plural', () => {
    const diagnostics = runChecks(
      program({
        config: config({ locales: ['en'] }),
        messages: [
          message({
            key: 'race.place',
            bodies: [pluralBody('en', ['one', 'other'], true)],
          }),
        ],
      }),
    )

    expect(only(diagnostics, 'LZ3007').hint).toBe(
      'add two {...} few {...} to {count, selectordinal, ...} in locales/en.json',
    )
  })

  it('treats a locale with one category as complete with only other', () => {
    const diagnostics = runChecks(
      program({
        config: config({ locales: ['en', 'ja'] }),
        messages: [pluralMessage('ja', ['other'])],
      }),
    )

    expect(diagnostics).toEqual([])
  })

  it('reports every Japanese keyword branch but other as unreachable', () => {
    const diagnostics = runChecks(
      program({
        config: config({ locales: ['en', 'ja'] }),
        messages: [pluralMessage('ja', ['one', 'other'])],
      }),
    )

    expect(only(diagnostics, 'LZ3013').message).toContain('"one"')
  })

  it('accepts every category for Welsh, which selects all six', () => {
    const diagnostics = runChecks(
      program({
        config: config({ locales: ['cy', 'en'] }),
        messages: [pluralMessage('cy', ['zero', 'one', 'two', 'few', 'many', 'other'])],
      }),
    )

    expect(diagnostics).toEqual([])
  })

  it('leaves a repeated keyword branch alone when the locale selects it', () => {
    const diagnostics = runChecks(
      program({ messages: [pluralMessage('de', ['one', 'one', 'other'])] }),
    )

    expect(diagnostics).toEqual([])
  })
})

describe('locale tags with an odd shape', () => {
  it('resolves Arabic categories for a tag carrying a unicode extension', () => {
    const diagnostics = runChecks(
      program({
        config: config({ locales: ['ar-u-nu-latn', 'en'] }),
        messages: [pluralMessage('ar-u-nu-latn', ['one', 'other'])],
      }),
    )

    const incomplete = only(diagnostics, 'LZ3007')
    expect(incomplete.message).toContain('zero, two, few, many')
    expect(incomplete.locale).toBe('ar-u-nu-latn')
    expect(incomplete.file).toBe('locales/ar-u-nu-latn.json')
  })

  it('resolves Arabic categories for an upper case tag and keeps the tag as given', () => {
    const diagnostics = runChecks(
      program({
        config: config({ locales: ['AR', 'en'] }),
        messages: [pluralMessage('AR', ['one', 'other'])],
      }),
    )

    const incomplete = only(diagnostics, 'LZ3007')
    expect(incomplete.message).toMatch(/^AR selects zero, two, few, many /u)
    expect(incomplete.locale).toBe('AR')
  })

  it('builds the fallback file from a tag with a script and a region', () => {
    const diagnostics = runChecks(
      program({
        config: config({ locales: ['en', 'zh-Hant-TW'] }),
        messages: [missingIn('nav.home', 'zh-Hant-TW')],
      }),
    )

    expect(only(diagnostics, 'LZ3001').file).toBe('locales/zh-Hant-TW.json')
  })
})

describe('the catalog file a diagnostic names', () => {
  it('substitutes every occurrence of the locale token', () => {
    const diagnostics = runChecks(
      program({
        config: config({ catalogs: 'locales/{locale}/{locale}.json' }),
        messages: [missingIn('nav.home', 'de')],
      }),
    )

    expect(only(diagnostics, 'LZ3001').file).toBe('locales/de/de.json')
  })

  it('prefers the file the catalog span carries over the pattern', () => {
    const diagnostics = runChecks(
      program({
        messages: [
          message({
            key: 'nav.home',
            bodies: [body('en')],
            origins: [translated('en'), fellBack('de', 'en', 'blank')],
            spans: [at('en', 1, 1), at('de', 4, 2, 'translations/german.json')],
          }),
        ],
      }),
    )

    const blank = only(diagnostics, 'LZ3002')
    expect(blank.file).toBe('translations/german.json')
    expect(blank.hint).toBe('write a de value for "nav.home" in translations/german.json')
  })

  it('uses the whole key as the namespace when the key has no dot', () => {
    const diagnostics = runChecks(
      program({
        config: config({ catalogs: 'public/locales/{locale}/{ns}.json' }),
        messages: [missingIn('title', 'de')],
      }),
    )

    expect(only(diagnostics, 'LZ3001').file).toBe('public/locales/de/title.json')
  })

  it('substitutes every occurrence of the source locale token in the meta path', () => {
    const diagnostics = runChecks(
      program({
        config: config({ meta: 'i18n/{sourceLocale}/{sourceLocale}.meta.json' }),
        messages: [sharing('Open', 'a.open'), sharing('Open', 'b.open')],
      }),
    )

    expect(hintLines(only(diagnostics, 'LZ3012'))[0]).toBe(
      'add descriptions in i18n/en/en.meta.json:',
    )
  })

  it('reads a source locale other than en from the program, not a default', () => {
    const diagnostics = runChecks(
      program({
        config: config({ locales: ['de', 'en'], sourceLocale: 'de' }),
        messages: [
          message({
            key: 'nav.home',
            bodies: [body('de')],
            origins: [translated('de'), fellBack('en', 'de', 'missing')],
            spans: [at('de', 1, 1)],
          }),
        ],
      }),
    )

    const missing = only(diagnostics, 'LZ3001')
    expect(missing.locale).toBe('en')
    expect(missing.message).toContain('renders de text')
  })
})

describe('code point ordering of what is reported', () => {
  it('reports missing locales in code point order whatever order the origins arrive in', () => {
    const diagnostics = runChecks(
      program({
        config: config({ locales: ['de', 'de-AT', 'en', 'zh-Hans', 'zh-Hant'] }),
        messages: [missingIn('nav.home', 'zh-Hant', 'zh-Hans', 'de-AT', 'de')],
      }),
    )

    expect(withCode(diagnostics, 'LZ3001').map((entry) => entry.locale)).toEqual([
      'de',
      'de-AT',
      'zh-Hans',
      'zh-Hant',
    ])
  })

  it('sorts extras with upper case before lower case and 10 before 9', () => {
    const diagnostics = runChecks(
      program({
        extras: [extra('de', 'a'), extra('de', '9'), extra('de', 'Z'), extra('de', '10')],
      }),
    )

    expect(diagnostics.map((entry) => entry.key)).toEqual(['10', '9', 'Z', 'a'])
  })

  it('sorts an astral key after U+FFFF, where UTF-16 order would put it first', () => {
    const astral = '\u{1F600}'
    const diagnostics = runChecks(
      program({ extras: [extra('de', astral), extra('de', '￿')] }),
    )

    expect(diagnostics.map((entry) => entry.key)).toEqual(['￿', astral])
  })

  it('lists colliding keys in code point order and points the header at the first', () => {
    const astral = '\u{1F600}.open'
    const diagnostics = runChecks(
      program({
        messages: [sharing('Open', astral), sharing('Open', '￿.open')],
      }),
    )

    const ambiguous = only(diagnostics, 'LZ3012')
    expect(ambiguous.related.map((entry) => entry.key)).toEqual(['￿.open', astral])
    expect(pasteLines(ambiguous).map(pastedKey)).toEqual(['￿.open', astral])
  })

  it('orders groups by their first key, not by the source text', () => {
    const diagnostics = runChecks(
      program({
        messages: [
          sharing('Alpha', 'z.one'),
          sharing('Alpha', 'z.two'),
          sharing('Zulu', 'a.one'),
          sharing('Zulu', 'a.two'),
        ],
      }),
    )

    const groups = withCode(diagnostics, 'LZ3012').map((entry) => entry.related[0]?.key)
    expect(groups).toEqual(['a.one', 'z.one'])
  })
})

describe('source text with line breaks', () => {
  it('collapses a CRLF into one space in the header', () => {
    const diagnostics = runChecks(
      program({
        messages: [sharing('Open\r\nfile', 'a.open'), sharing('Open\r\nfile', 'b.open')],
      }),
    )

    expect(only(diagnostics, 'LZ3012').message).toContain('source text "Open file"')
  })

  it('collapses a lone CR into one space in the header', () => {
    const diagnostics = runChecks(
      program({ messages: [sharing('Open\rfile', 'a.open'), sharing('Open\rfile', 'b.open')] }),
    )

    expect(only(diagnostics, 'LZ3012').message).toContain('source text "Open file"')
  })

  it('collapses a run of blank lines into one space', () => {
    const diagnostics = runChecks(
      program({
        messages: [sharing('Open\n\n\nfile', 'a.open'), sharing('Open\n\n\nfile', 'b.open')],
      }),
    )

    const [headline] = only(diagnostics, 'LZ3012').message.split('\n')
    expect(headline).toBe('2 keys share the source text "Open file" and 2 have no description.')
  })

  it('keeps CRLF and LF sources apart even though they print alike', () => {
    const diagnostics = runChecks(
      program({ messages: [sharing('Open\r\nfile', 'a.open'), sharing('Open\nfile', 'b.open')] }),
    )

    expect(withCode(diagnostics, 'LZ3012')).toEqual([])
  })

  it('keeps sources that differ only by trailing whitespace apart', () => {
    const diagnostics = runChecks(
      program({ messages: [sharing('Open', 'a.open'), sharing('Open ', 'b.open')] }),
    )

    expect(withCode(diagnostics, 'LZ3012')).toEqual([])
  })
})

describe('keys and descriptions at the edge of the character set', () => {
  it('escapes a lone surrogate so the pasted meta entry still parses', () => {
    const lone = 'a.\uD800'
    const diagnostics = runChecks(
      program({ messages: [sharing('Open', lone), sharing('Open', 'b.open')] }),
    )

    const lines = pasteLines(only(diagnostics, 'LZ3012'))
    expect(lines).toHaveLength(2)
    expect(lines.some((line) => line.includes('\\ud800'))).toBe(true)
    expect(lines.map(pastedKey)).toEqual([lone, 'b.open'])
  })

  it('pads every paste line to one column across keys of different widths', () => {
    const diagnostics = runChecks(
      program({
        messages: [sharing('Open', 'a'), sharing('Open', 'a.much.longer.key')],
      }),
    )

    const columns = pasteLines(only(diagnostics, 'LZ3012')).map((line) => line.indexOf('{'))
    expect(new Set(columns).size).toBe(1)
  })

  it('treats a no-break space description as no description', () => {
    const diagnostics = runChecks(
      program({
        messages: [sharing('Open', 'a.open', ' '), sharing('Open', 'b.open', 'Opens a file')],
      }),
    )

    const ambiguous = only(diagnostics, 'LZ3012')
    expect(pasteLines(ambiguous).map(pastedKey)).toEqual(['a.open'])
  })

  it('treats an ideographic space description as no description', () => {
    const diagnostics = runChecks(
      program({
        messages: [sharing('Open', 'a.open', '　'), sharing('Open', 'b.open', '　')],
      }),
    )

    expect(pasteLines(only(diagnostics, 'LZ3012'))).toHaveLength(2)
  })

  it('buckets emoji and RTL source text by bytes like any other string', () => {
    const source = '‏פתח \u{1F4C2}'
    const diagnostics = runChecks(
      program({ messages: [sharing(source, 'a.open'), sharing(source, 'b.open')] }),
    )

    expect(only(diagnostics, 'LZ3012').message).toContain(`"${source}"`)
  })

  it('buckets an empty source text shared by two keys', () => {
    const diagnostics = runChecks(
      program({ messages: [sharing('', 'a.empty'), sharing('', 'b.empty')] }),
    )

    expect(only(diagnostics, 'LZ3012').message).toContain('share the source text ""')
  })

  it('reports a missing translation for a key named after a prototype member', () => {
    const diagnostics = runChecks(
      program({ messages: [missingIn('__proto__', 'de'), missingIn('constructor', 'de')] }),
    )

    expect(withCode(diagnostics, 'LZ3001').map((entry) => entry.key)).toEqual([
      '__proto__',
      'constructor',
    ])
  })

  it('reports an extra key named after a prototype member', () => {
    const diagnostics = runChecks(
      program({ extras: [extra('de', 'toString'), extra('de', '__proto__')] }),
    )

    expect(diagnostics.map((entry) => entry.key)).toEqual(['__proto__', 'toString'])
  })
})

describe('many keys sharing one source text', () => {
  const count = 3000
  const keys = Array.from({ length: count }, (_, index) => `k${String(index).padStart(4, '0')}`)
  const diagnostics = runChecks(
    program({ messages: keys.map((key) => sharing('Save', key)) }),
  )

  it('raises a single diagnostic', () => {
    expect(withCode(diagnostics, 'LZ3012')).toHaveLength(1)
  })

  it('names every key in related and in the paste block', () => {
    const ambiguous = only(diagnostics, 'LZ3012')
    expect(ambiguous.related).toHaveLength(count)
    expect(pasteLines(ambiguous)).toHaveLength(count)
    expect(ambiguous.message).toContain(`${count} keys share`)
    expect(ambiguous.message).toContain(`${count} have no description`)
  })
})

describe('dates without a zone, listed once per name', () => {
  it('lists an argument formatted as a date and as a time once', () => {
    const diagnostics = runChecks(
      program({
        config: config({ locales: ['en'] }),
        messages: [
          message({
            key: 'event.when',
            bodies: [
              body('en', {
                nodes: [
                  dateTimeNode('at'),
                  text(' '),
                  dateTimeNode('at', { timeStyle: 'short' }),
                ],
                args: [dateArg('at')],
              }),
            ],
          }),
        ],
      }),
    )

    const unzoned = only(diagnostics, 'LZ3011')
    expect(unzoned.message).toMatch(/^\{at\} formats a date/u)
  })

  it('lists names in the order they appear, not sorted', () => {
    const diagnostics = runChecks(
      program({
        config: config({ locales: ['en'] }),
        messages: [
          message({
            key: 'event.when',
            bodies: [
              body('en', {
                nodes: [dateTimeNode('start'), text(' - '), dateTimeNode('end')],
                args: [dateArg('end'), dateArg('start')],
              }),
            ],
          }),
        ],
      }),
    )

    expect(only(diagnostics, 'LZ3011').message).toMatch(/^\{start\}, \{end\} formats/u)
  })

  it('stays quiet for any IANA zone in the config', () => {
    const diagnostics = runChecks(
      program({
        config: config({
          locales: ['en'],
          formats: { timeZone: 'Asia/Kolkata', number: {}, dateTime: {} },
        }),
        messages: [
          message({
            key: 'event.when',
            bodies: [body('en', { nodes: [dateTimeNode('at')], args: [dateArg('at')] })],
          }),
        ],
      }),
    )

    expect(diagnostics).toEqual([])
  })

  it('attributes the diagnostic to the source catalog even when the source span is absent', () => {
    const diagnostics = runChecks(
      program({
        config: config({ locales: ['en'] }),
        messages: [
          message({
            key: 'event.when',
            bodies: [body('en', { nodes: [dateTimeNode('at')], args: [dateArg('at')] })],
            spans: [],
          }),
        ],
      }),
    )

    expect(only(diagnostics, 'LZ3011')).toMatchObject({
      file: 'locales/en.json',
      locale: 'en',
      span: null,
    })
  })
})

describe('markup against plain arguments', () => {
  it('reports a source tag the translation turned into a plain argument as a mismatch only', () => {
    const diagnostics = runChecks(
      program({
        messages: [
          message({
            key: 'legal.terms',
            kind: 'markup',
            bodies: [
              body('en', {
                nodes: [markupNode('b', text('terms'))],
                args: [markupArg('b')],
                markupTags: ['b'],
              }),
              body('de', { nodes: [argNode('b')], args: [stringishArg('b')] }),
            ],
          }),
        ],
      }),
    )

    expect(codes(diagnostics)).toEqual(['LZ3010'])
  })

  it('reports a tag the translation turned into a number as a conflict and a mismatch', () => {
    const diagnostics = runChecks(
      program({
        messages: [
          message({
            key: 'legal.terms',
            kind: 'markup',
            bodies: [
              body('en', {
                nodes: [markupNode('b', text('terms'))],
                args: [markupArg('b')],
                markupTags: ['b'],
              }),
              body('de', {
                nodes: [{ kind: 'number', name: 'b', style: null, format: { kind: 'number', options: {} } }],
                args: [numberArg('b')],
              }),
            ],
          }),
        ],
      }),
    )

    expect([...codes(diagnostics)].sort()).toEqual(['LZ3006', 'LZ3010'])
  })

  it('treats tags that differ only by case as two tags', () => {
    const diagnostics = runChecks(
      program({
        messages: [
          message({
            key: 'legal.terms',
            kind: 'markup',
            bodies: [
              body('en', {
                nodes: [markupNode('b', text('terms'))],
                args: [markupArg('b')],
                markupTags: ['b'],
              }),
              body('de', {
                nodes: [markupNode('B', text('AGB'))],
                args: [markupArg('B')],
                markupTags: ['B'],
              }),
            ],
          }),
        ],
      }),
    )

    expect([...codes(diagnostics)].sort()).toEqual(['LZ3005', 'LZ3010'])
  })

  it('lists every dropped tag in code point order', () => {
    const diagnostics = runChecks(
      program({
        messages: [
          message({
            key: 'legal.terms',
            kind: 'markup',
            bodies: [
              body('en', {
                nodes: [markupNode('link'), markupNode('b'), markupNode('Em')],
                args: [markupArg('Em'), markupArg('b'), markupArg('link')],
                markupTags: ['link', 'b', 'Em'],
              }),
              body('de'),
            ],
          }),
        ],
      }),
    )

    expect(only(diagnostics, 'LZ3010').message).toContain('<Em>, <b>, <link>')
  })
})
