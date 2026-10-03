import { describe, expect, it } from 'vitest'
import type { CatalogMeta, Config, Program, RawCatalog } from '../types'
import { hash16 } from '../util'
import { catalog, config, messageFor, originFor, run, span } from './__fixtures__/program'

function meta(entries: CatalogMeta['entries']): CatalogMeta {
  return { file: 'locales/en.meta.json', entries }
}

describe('empty input', () => {
  it('returns an empty program for no catalogs at all', () => {
    const program = run({ config: config({ locales: ['en', 'de'] }), catalogs: [] })
    expect(program).toMatchObject({ messages: [], extras: [], groups: [], usages: [], diagnostics: [] })
  })

  it('returns no messages for an empty source catalog', () => {
    const program = run({
      config: config({ locales: ['en'] }),
      catalogs: [catalog({ locale: 'en', entries: {} })],
    })
    expect(program.messages).toEqual([])
  })

  it('puts every target key in extras when the source catalog is absent', () => {
    const program = run({
      config: config({ locales: ['en', 'de'] }),
      catalogs: [catalog({ locale: 'de', entries: { 'nav.home': 'Startseite' } })],
    })
    expect(program.messages).toEqual([])
    expect(program.extras.map((extra) => extra.key)).toEqual(['nav.home'])
  })

  it('still reports a configured group as empty when there are no catalogs', () => {
    const program = run({ config: config({ groups: { errors: 'errors' } }), catalogs: [] })
    expect(program.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['LZ4004'])
  })
})

describe('prototype-named keys in the catalog index', () => {
  const prototypes = (): Program =>
    run({
      config: config({ locales: ['en', 'de'] }),
      catalogs: [
        catalog({ locale: 'en', entries: { ['__proto__']: 'Proto', toString: 'Text' } }),
        catalog({
          locale: 'de',
          entries: { ['__proto__']: 'Proto de', toString: 'Text de', constructor: 'Ctor' },
        }),
      ],
    })

  it('keeps a __proto__ key as a message with a translated target', () => {
    const message = messageFor(prototypes(), '__proto__')
    expect(message.source).toBe('Proto')
    expect(originFor(message, 'de')).toEqual({ status: 'translated' })
  })

  it('never confuses an Object.prototype member with a catalog key', () => {
    expect(prototypes().messages.map((message) => message.key)).toEqual(['__proto__', 'toString'])
  })

  it('lists a target-only constructor key in extras', () => {
    expect(prototypes().extras.map((extra) => extra.key)).toEqual(['constructor'])
  })
})

describe('source text that is not plain ASCII', () => {
  const single = (value: string): Program =>
    run({ config: config({ locales: ['en'] }), catalogs: [catalog({ locale: 'en', entries: { k: value } })] })

  it('keeps right-to-left text, direction marks and emoji in the source verbatim', () => {
    const value = '‏שלום {name} \u{1F44B}'
    expect(messageFor(single(value), 'k').source).toBe(value)
  })

  it('keeps combining characters in the source as written', () => {
    expect(messageFor(single('café'), 'k').source).toBe('café')
  })

  it('hashes a very long source value to sixteen hex characters', () => {
    const message = messageFor(single('x'.repeat(100_000)), 'k')
    expect(message.source).toHaveLength(100_000)
    expect(message.sourceHash).toMatch(/^[0-9a-f]{16}$/)
  })

  it('hashes the empty source to the digest of the empty string', () => {
    expect(messageFor(single(''), 'k').sourceHash).toBe(hash16(''))
  })

  it('gives two keys with one source text the same hash', () => {
    const program = run({
      config: config({ locales: ['en'] }),
      catalogs: [catalog({ locale: 'en', entries: { a: 'Same', b: 'Same' } })],
    })
    expect(messageFor(program, 'a').sourceHash).toBe(messageFor(program, 'b').sourceHash)
  })
})

describe('meta notes', () => {
  const source = (): RawCatalog => catalog({ locale: 'en', entries: { 'nav.home': 'Home' } })

  it('defaults to no description and no placeholders without meta', () => {
    const message = messageFor(run({ config: config(), catalogs: [source()] }), 'nav.home')
    expect(message.description).toBeNull()
    expect(message.placeholders).toEqual([])
  })

  it('ignores a note for a key the source catalog does not have', () => {
    const program = run({
      config: config(),
      catalogs: [source()],
      meta: meta([{ key: 'nav.gone', description: 'Stale', placeholders: [], span: span(1, 4) }]),
    })
    expect(messageFor(program, 'nav.home').description).toBeNull()
  })

  it('keeps an explicit null description null', () => {
    const program = run({
      config: config(),
      catalogs: [source()],
      meta: meta([{ key: 'nav.home', description: null, placeholders: [], span: span(1, 4) }]),
    })
    expect(messageFor(program, 'nav.home').description).toBeNull()
  })

  it('attaches a note to a __proto__ key', () => {
    const program = run({
      config: config(),
      catalogs: [catalog({ locale: 'en', entries: { ['__proto__']: 'Proto' } })],
      meta: meta([{ key: '__proto__', description: 'Odd key', placeholders: [], span: span(1, 4) }]),
    })
    expect(messageFor(program, '__proto__').description).toBe('Odd key')
  })
})

describe('Message.args across several targets', () => {
  const three = (locales: readonly string[]): Program =>
    run({
      config: config({ locales }),
      catalogs: [
        catalog({ locale: 'en', entries: { 'cart.items': '{count} items' } }),
        catalog({ locale: 'de', entries: { 'cart.items': '{count, number} Artikel' } }),
        catalog({ locale: 'fr', entries: { 'cart.items': '{count} articles' } }),
      ],
    })

  it('narrows through a typed use in any target', () => {
    expect(messageFor(three(['en', 'de', 'fr']), 'cart.items').args).toEqual([
      { name: 'count', type: { kind: 'number' } },
    ])
  })

  it('does not depend on the order the locales are declared in', () => {
    expect(messageFor(three(['en', 'fr', 'de']), 'cart.items').args).toEqual(
      messageFor(three(['en', 'de', 'fr']), 'cart.items').args,
    )
  })
})

describe('determinism of the whole program', () => {
  const resolved: Config = config({ locales: ['en', 'de'], groups: { errors: 'errors' } })
  const catalogs: readonly RawCatalog[] = [
    catalog({ locale: 'en', entries: { 'errors.a': '{x}', 'errors.b': '{x, number}', 'a.b': 'x', a_b: 'y' } }),
    catalog({ locale: 'de', entries: { 'errors.a': '   ', 'de.only': 'Nur', 'de.too': 'Auch' } }),
  ]

  it('returns deeply equal programs, extras and diagnostics included, across two runs', () => {
    expect(run({ config: resolved, catalogs })).toEqual(run({ config: resolved, catalogs }))
  })

  it('does not depend on catalog arrival order for diagnostics', () => {
    expect(run({ config: resolved, catalogs: [...catalogs].reverse() }).diagnostics).toEqual(
      run({ config: resolved, catalogs }).diagnostics,
    )
  })
})
