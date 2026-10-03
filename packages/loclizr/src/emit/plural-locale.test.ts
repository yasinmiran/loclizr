import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { EmittedFile, Message } from '../types'
import { emit } from './index'
import {
  body,
  config,
  fellBack,
  inherited,
  markup,
  message,
  plural,
  pound,
  program,
  text,
  translated,
} from './__fixtures__/program'

// A plural arm selects its category with the rules of the locale whose body it
// prints, and formats `#` with the requesting locale. The two decisions are
// pinned here side by side so neither drifts to the other's locale.

const RUNTIME = new URL('../index.ts', import.meta.url).href

function sessions(): Message {
  return message({
    key: 'sessions',
    source: '{count, plural, one {# active session} other {# active sessions}}',
    args: [{ name: 'count', type: { kind: 'number' } }],
    bodies: [
      body('en', [
        plural('count', {
          branches: [
            { keyword: 'one', body: [pound(), text(' active session')] },
            { keyword: 'other', body: [pound(), text(' active sessions')] },
          ],
        }),
      ]),
    ],
    origins: [
      translated('en'),
      fellBack('fr', 'en', 'missing'),
      fellBack('ja', 'en', 'missing'),
      fellBack('ru', 'en', 'missing'),
    ],
  })
}

function files(): Message {
  return message({
    key: 'files',
    source: '{count, plural, one {# file} other {# files}}',
    args: [{ name: 'count', type: { kind: 'number' } }],
    bodies: [
      body('en', [
        plural('count', {
          branches: [
            { keyword: 'one', body: [pound(), text(' file')] },
            { keyword: 'other', body: [pound(), text(' files')] },
          ],
        }),
      ]),
      body('de', [
        plural('count', {
          branches: [
            { keyword: 'one', body: [pound(), text(' Datei')] },
            { keyword: 'other', body: [pound(), text(' Dateien')] },
          ],
        }),
      ]),
    ],
    origins: [translated('en'), translated('de'), inherited('de-AT', 'de')],
  })
}

function place(): Message {
  return message({
    key: 'place',
    source: '{n, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}',
    args: [{ name: 'n', type: { kind: 'number' } }],
    bodies: [
      body('en', [
        plural('n', {
          ordinal: true,
          branches: [
            { keyword: 'one', body: [pound(), text('st')] },
            { keyword: 'two', body: [pound(), text('nd')] },
            { keyword: 'few', body: [pound(), text('rd')] },
            { keyword: 'other', body: [pound(), text('th')] },
          ],
        }),
      ]),
    ],
    origins: [translated('en'), fellBack('ja', 'en', 'missing')],
  })
}

function unread(): Message {
  return message({
    key: 'unread',
    source: 'You have {count, plural, one {<b>one file</b>} other {<b>many files</b>}} to read',
    kind: 'markup',
    args: [
      { name: 'count', type: { kind: 'number' } },
      { name: 'b', type: { kind: 'markup' } },
    ],
    bodies: [
      body('en', [
        text('You have '),
        plural('count', {
          branches: [
            { keyword: 'one', body: [markup('b', [text('one file')])] },
            { keyword: 'other', body: [markup('b', [text('many files')])] },
          ],
        }),
        text(' to read'),
      ]),
    ],
    origins: [translated('en'), fellBack('ja', 'en', 'missing')],
  })
}

function tree(messages: readonly Message[], locales: readonly string[]): readonly EmittedFile[] {
  const result = emit(program({ messages, config: config({ locales }) }))
  expect(result.diagnostics).toEqual([])
  return result.files
}

function contentsOf(files: readonly EmittedFile[], path: string): string {
  const file = files.find((candidate) => candidate.path === path)
  if (file === undefined) throw new Error(`no emitted file at ${path}`)
  return file.contents
}

describe('a fallback arm selects its plural category with the rules of the body it prints', () => {
  const emitted = contentsOf(tree([sessions()], ['en', 'fr', 'ja', 'ru']), 'messages/_root.js')

  test('the source arm names the source locale, not the requesting one', () => {
    expect(emitted).toContain("switch ($plural1('en', n0, false)) {")
    expect(emitted).not.toContain('$plural1(l,')
  })

  test('every locale that fell back to the source shares the default arm', () => {
    expect(emitted).not.toContain("case 'fr':")
    expect(emitted).not.toContain("case 'ja':")
    expect(emitted).not.toContain("case 'ru':")
  })

  test('# in that arm still formats with the requesting locale', () => {
    expect(emitted).toContain('$number1(l, n0, $f')
  })
})

describe('an inherited arm selects with the rules of the ancestor it prints', () => {
  const emitted = contentsOf(tree([files()], ['en', 'de', 'de-AT']), 'messages/_root.js')

  test('de and de-AT keep sharing one case and select as German', () => {
    expect(emitted).toContain(["    case 'de':", "    case 'de-AT':", "      switch ($plural1('de', n0, false)) {"].join('\n'))
  })

  test('the source arm selects as English', () => {
    expect(emitted).toContain("    default:\n      switch ($plural1('en', n0, false)) {")
  })
})

describe('selectordinal and markup branches follow the same rule', () => {
  test('a selectordinal fallback arm names the body locale', () => {
    const emitted = contentsOf(tree([place()], ['en', 'ja']), 'messages/_root.js')
    expect(emitted).toContain("switch ($plural1('en', n0, true)) {")
    expect(emitted).not.toContain("case 'ja':")
  })

  test('a plural branch holding a tag names the body locale in its conditional', () => {
    const emitted = contentsOf(tree([unread()], ['en', 'ja']), 'messages/_root.js')
    expect(emitted).toContain("...($plural1('en', n0, false) === 'one'")
    expect(emitted).not.toContain("case 'ja':")
  })
})

describe('a translated body whose text equals the source still selects as its own locale', () => {
  test('the arm is kept apart from the default arm', () => {
    const same = message({
      key: 'files',
      source: '{count, plural, one {# file} other {# files}}',
      args: [{ name: 'count', type: { kind: 'number' } }],
      bodies: [
        body('en', [
          plural('count', {
            branches: [
              { keyword: 'one', body: [pound(), text(' file')] },
              { keyword: 'other', body: [pound(), text(' files')] },
            ],
          }),
        ]),
        body('fr', [
          plural('count', {
            branches: [
              { keyword: 'one', body: [pound(), text(' file')] },
              { keyword: 'other', body: [pound(), text(' files')] },
            ],
          }),
        ]),
      ],
      origins: [translated('en'), translated('fr')],
    })
    const emitted = contentsOf(tree([same], ['en', 'fr']), 'messages/_root.js')
    expect(emitted).toContain("    case 'fr':\n      switch ($plural1('fr', n0, false)) {")
    expect(emitted).toContain("    default:\n      switch ($plural1('en', n0, false)) {")
  })
})

describe('the generated module, executed', () => {
  let root = ''
  let generated: Record<string, (args: Record<string, unknown>, opts?: { locale?: string }) => unknown>

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'loclizr-plural-locale-'))
    const emitted = emit(
      program({
        messages: [sessions(), files(), place()],
        config: config({ locales: ['en', 'de', 'de-AT', 'fr', 'ja', 'ru'] }),
      }),
    )
    expect(emitted.diagnostics).toEqual([])
    await writeFile(join(root, 'package.json'), '{ "type": "module" }\n', 'utf8')
    for (const file of emitted.files) {
      const absolute = join(root, file.path)
      await mkdir(dirname(absolute), { recursive: true })
      await writeFile(absolute, file.contents.replaceAll("from 'loclizr'", `from '${RUNTIME}'`), 'utf8')
    }
    generated = (await import(pathToFileURL(join(root, 'messages/_root.js')).href)) as typeof generated
  })

  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  const render = (id: string, args: Record<string, unknown>, locale: string): unknown =>
    generated[id]?.(args, { locale })

  test('ja renders the English body with English categories', () => {
    expect(render('sessions', { count: 1 }, 'ja')).toBe('1 active session')
    expect(render('sessions', { count: 2 }, 'ja')).toBe('2 active sessions')
  })

  test('fr at zero and ru at twenty-one take the branch English grammar wants', () => {
    expect(render('sessions', { count: 0 }, 'fr')).toBe('0 active sessions')
    expect(render('sessions', { count: 21 }, 'ru')).toBe('21 active sessions')
  })

  test('ja renders English ordinals', () => {
    expect(render('place', { n: 1 }, 'ja')).toBe('1st')
    expect(render('place', { n: 2 }, 'ja')).toBe('2nd')
    expect(render('place', { n: 3 }, 'ja')).toBe('3rd')
    expect(render('place', { n: 11 }, 'ja')).toBe('11th')
  })

  test('de-AT renders the German body with German categories and Austrian number formatting', () => {
    expect(render('files', { count: 1 }, 'de-AT')).toBe('1 Datei')
    const austrian = new Intl.NumberFormat('de-AT').format(1234)
    expect(render('files', { count: 1234 }, 'de-AT')).toBe(`${austrian} Dateien`)
  })

  test('the source locale is unaffected', () => {
    expect(render('sessions', { count: 1 }, 'en')).toBe('1 active session')
    expect(render('files', { count: 1 }, 'de')).toBe('1 Datei')
  })
})
