import { describe, expect, it } from 'vitest'
import type { Program } from '../types'
import {
  bodyFor,
  catalog,
  codes,
  config,
  messageFor,
  originFor,
  run,
} from './__fixtures__/program'

function overlay(value: string): Program {
  return run({
    config: config({ locales: ['en', 'de', 'de-AT'] }),
    catalogs: [
      catalog({ locale: 'en', entries: { 'cart.greeting': 'Hi {name}' } }),
      catalog({ locale: 'de', entries: { 'cart.greeting': 'Hallo {name}' } }),
      catalog({ locale: 'de-AT', entries: { 'cart.greeting': value } }),
    ],
  })
}

describe('a regional overlay whose own value must not render', () => {
  it('resolves an unknown argument to the source locale even under a translated ancestor', () => {
    const message = messageFor(overlay('Servus {nmae}'), 'cart.greeting')
    expect(originFor(message, 'de-AT')).toEqual({
      status: 'fallback',
      from: 'en',
      reason: 'invalid',
    })
  })

  it('resolves a value that failed to lower to the source locale under a translated ancestor', () => {
    const message = messageFor(overlay('Servus {name'), 'cart.greeting')
    expect(originFor(message, 'de-AT')).toEqual({
      status: 'fallback',
      from: 'en',
      reason: 'invalid',
    })
  })

  it('keeps the body of the locale that named an unknown argument', () => {
    const message = messageFor(overlay('Servus {nmae}'), 'cart.greeting')
    expect(bodyFor(message, 'de-AT')?.args.map((arg) => arg.name)).toEqual(['nmae'])
    expect(message.args.map((arg) => arg.name)).toEqual(['name'])
  })

  it('keeps no body for the locale whose value failed to lower', () => {
    const message = messageFor(overlay('Servus {name'), 'cart.greeting')
    expect(bodyFor(message, 'de-AT')).toBeUndefined()
  })
})

describe('the worked example', () => {
  const EN: Readonly<Record<string, string>> = {
    'nav.home': 'Home',
    'nav.cart': 'Cart',
    'cart.greeting': 'Hi {name}, your cart is ready',
    'cart.items':
      '{count, plural, =0 {Your cart is empty} one {# item in your cart} other {# items in your cart}}',
    'cart.total': 'Total: {amount, number, ::currency/USD}',
    'cart.updated': 'Updated {at, date, medium}',
    'order.status': '{state, select, shipped {On its way} delivered {Delivered} other {Processing}}',
    'errors.forbidden': 'You do not have access',
    'errors.not_found': 'We could not find that page',
    'errors.rate_limited': 'Too many requests. Try again in {seconds, number} seconds.',
    'terms.accept': 'Read our <link>terms</link> before you continue.',
  }

  const DE: Readonly<Record<string, string>> = {
    'nav.home': 'Startseite',
    'nav.cart': 'Warenkorb',
    'cart.greeting': 'Hallo {name}, dein Warenkorb ist fertig',
    'cart.items':
      '{count, plural, =0 {Dein Warenkorb ist leer} one {{count} Artikel in deinem Warenkorb} other {{count} Artikel in deinem Warenkorb}}',
    'cart.total': 'Summe: {amount, number, ::currency/USD}',
    'cart.updated': 'Aktualisiert {at, date, medium}',
    'order.status': '{state, select, shipped {Unterwegs} delivered {Zugestellt} other {In Bearbeitung}}',
    'errors.forbidden': 'Du hast keinen Zugriff',
    'errors.not_found': 'Wir konnten die Seite nicht finden',
    'errors.rate_limited': 'Zu viele Anfragen. Versuche es in {seconds, number} Sekunden erneut.',
    'terms.accept': 'Lies unsere <link>AGB</link>, bevor du fortfährst.',
  }

  const worked = (): Program =>
    run({
      config: config({ locales: ['en', 'de', 'de-AT'], groups: { errors: 'errors' } }),
      catalogs: [
        catalog({ locale: 'en', entries: EN }),
        catalog({ locale: 'de', entries: DE }),
        catalog({
          locale: 'de-AT',
          format: 'i18next',
          entries: { 'cart.greeting': 'Servus {name}, dein Warenkorb ist fertig' },
        }),
      ],
    })

  it('prints the canonical source and hashes it to the published digest', () => {
    const program = worked()
    expect(messageFor(program, 'nav.home').source).toBe('Home')
    expect(messageFor(program, 'nav.home').sourceHash).toBe('3a78695388b38b5c')
    expect(messageFor(program, 'cart.items').source).toBe(EN['cart.items'])
    expect(messageFor(program, 'cart.items').sourceHash).toBe('a826cf6a40d3293e')
  })

  it('inherits the sparse overlay from its base and keeps its own override translated', () => {
    const program = worked()
    expect(originFor(messageFor(program, 'nav.home'), 'de-AT')).toEqual({
      status: 'inherited',
      from: 'de',
    })
    expect(originFor(messageFor(program, 'cart.greeting'), 'de-AT')).toEqual({
      status: 'translated',
    })
    expect(bodyFor(messageFor(program, 'nav.home'), 'de-AT')).toBeUndefined()
  })

  it('types the select from the source options in source order', () => {
    expect(messageFor(worked(), 'order.status').args).toEqual([
      { name: 'state', type: { kind: 'select', options: ['shipped', 'delivered'] } },
    ])
  })

  it('takes kind and tags from the source even where a target renders plain text', () => {
    const message = messageFor(worked(), 'terms.accept')
    expect(message.kind).toBe('markup')
    expect(message.markupTags).toEqual(['link'])
    expect(message.args).toEqual([{ name: 'link', type: { kind: 'markup' } }])
  })

  it('keeps the plural selector a number where a target stringifies it', () => {
    expect(messageFor(worked(), 'cart.items').args).toEqual([
      { name: 'count', type: { kind: 'number' } },
    ])
  })

  it('reports only the heterogeneous group and nothing else', () => {
    expect(codes(worked().diagnostics)).toEqual(['LZ4006'])
  })

  it('names a body that exists for every declared locale of every message', () => {
    for (const message of worked().messages) {
      for (const { locale, origin } of message.origins) {
        const named = origin.status === 'translated' ? locale : origin.from
        expect(bodyFor(message, named)).toBeDefined()
      }
    }
  })
})

describe('argument names across locales', () => {
  it('treats a decomposed target name and a composed source name as one argument', () => {
    const program = run({
      config: config({ locales: ['en', 'de'] }),
      catalogs: [
        catalog({ locale: 'en', entries: { 'a.b': 'Hi {café}' } }),
        catalog({ locale: 'de', entries: { 'a.b': 'Hallo {café}' } }),
      ],
    })
    const message = messageFor(program, 'a.b')
    expect(message.args.map((arg) => arg.name)).toEqual(['café'])
    expect(originFor(message, 'de')).toEqual({ status: 'translated' })
  })

  it('composes a decomposed source name before it reaches the printed set', () => {
    const program = run({
      config: config({ locales: ['en', 'de'] }),
      catalogs: [
        catalog({ locale: 'en', entries: { 'a.b': 'Hi {café}' } }),
        catalog({ locale: 'de', entries: { 'a.b': 'Hallo {café}' } }),
      ],
    })
    const message = messageFor(program, 'a.b')
    expect(message.args.map((arg) => arg.name)).toEqual(['café'])
    expect(message.source).toBe('Hi {café}')
    expect(originFor(message, 'de')).toEqual({ status: 'translated' })
  })

  it('narrows a bare source selector to the number a target plural forces', () => {
    const program = run({
      config: config({ locales: ['en', 'de'] }),
      catalogs: [
        catalog({ locale: 'en', entries: { 'a.b': 'Hi {n}' } }),
        catalog({ locale: 'de', entries: { 'a.b': '{n, plural, one {# Ding} other {# Dinge}}' } }),
      ],
    })
    expect(messageFor(program, 'a.b').args).toEqual([{ name: 'n', type: { kind: 'number' } }])
  })

  it('keeps a source plural selector a number where a target passes it through bare', () => {
    const program = run({
      config: config({ locales: ['en', 'de'] }),
      catalogs: [
        catalog({ locale: 'en', entries: { 'a.b': '{n, plural, one {# thing} other {# things}}' } }),
        catalog({ locale: 'de', entries: { 'a.b': '{n} Dinge' } }),
      ],
    })
    expect(messageFor(program, 'a.b').args).toEqual([{ name: 'n', type: { kind: 'number' } }])
  })
})

describe('a select option union', () => {
  it('keeps the source options where a target adds a branch', () => {
    const program = run({
      config: config({ locales: ['en', 'de'] }),
      catalogs: [
        catalog({ locale: 'en', entries: { 'a.b': '{s, select, shipped {S} other {O}}' } }),
        catalog({
          locale: 'de',
          entries: { 'a.b': '{s, select, shipped {S} delivered {D} other {O}}' },
        }),
      ],
    })
    expect(messageFor(program, 'a.b').args).toEqual([
      { name: 's', type: { kind: 'select', options: ['shipped'] } },
    ])
  })

  it('never lets a target select close the type of a bare source argument', () => {
    const program = run({
      config: config({ locales: ['en', 'de'] }),
      catalogs: [
        catalog({ locale: 'en', entries: { 'a.b': 'Hi {s}' } }),
        catalog({ locale: 'de', entries: { 'a.b': '{s, select, x {X} other {O}}' } }),
      ],
    })
    const message = messageFor(program, 'a.b')
    expect(message.args).toEqual([{ name: 's', type: { kind: 'stringish' } }])
    expect(originFor(message, 'de')).toEqual({ status: 'translated' })
  })

  it('still narrows a bare source argument through a locale that types it', () => {
    const program = run({
      config: config({ locales: ['en', 'de', 'fr'] }),
      catalogs: [
        catalog({ locale: 'en', entries: { 'a.b': 'Hi {s}' } }),
        catalog({ locale: 'de', entries: { 'a.b': '{s, select, x {X} other {O}}' } }),
        catalog({ locale: 'fr', entries: { 'a.b': 'Salut {s, number}' } }),
      ],
    })
    expect(messageFor(program, 'a.b').args).toEqual([{ name: 's', type: { kind: 'number' } }])
  })
})

describe('chains that point at each other', () => {
  const mutual = (): Program =>
    run({
      config: config({
        locales: ['en', 'de', 'de-AT'],
        fallback: { de: ['de-AT'], 'de-AT': ['de'] },
      }),
      catalogs: [
        catalog({ locale: 'en', entries: { 'a.base': 'Base', 'a.overlay': 'Overlay' } }),
        catalog({ locale: 'de', entries: { 'a.base': 'Basis' } }),
        catalog({ locale: 'de-AT', entries: { 'a.overlay': 'Auflage' } }),
      ],
    })

  it('resolves each direction of a mutual map without walking in circles', () => {
    const base = messageFor(mutual(), 'a.base')
    expect(originFor(base, 'de')).toEqual({ status: 'translated' })
    expect(originFor(base, 'de-AT')).toEqual({ status: 'inherited', from: 'de' })
    const overlaid = messageFor(mutual(), 'a.overlay')
    expect(originFor(overlaid, 'de')).toEqual({ status: 'inherited', from: 'de-AT' })
    expect(originFor(overlaid, 'de-AT')).toEqual({ status: 'translated' })
  })
})

describe('hostile source text', () => {
  it('keeps a whitespace-only source value as a message of its own', () => {
    const program = run({
      config: config({ locales: ['en', 'de'] }),
      catalogs: [
        catalog({ locale: 'en', entries: { 'a.spacer': '   ' } }),
        catalog({ locale: 'de', entries: { 'a.spacer': 'Platz' } }),
      ],
    })
    const message = messageFor(program, 'a.spacer')
    expect(message.source).toBe('   ')
    expect(bodyFor(message, 'en')).toBeDefined()
    expect(originFor(message, 'de')).toEqual({ status: 'translated' })
  })

  it('reaches a fixed point when its own printed source is fed back in', () => {
    const hostile: Readonly<Record<string, string>> = {
      'a.apostrophe': "It's {name}'s cart #1",
      'a.braces': "Use '{'braces'}' for {name}",
      'a.comment': 'Close the block with */ and {name}',
      'a.template': 'A backtick ` and a ${dollar} brace for {name}',
      'a.newline': 'First line\nsecond line {name}',
    }
    const first = run({
      config: config({ locales: ['en'] }),
      catalogs: [catalog({ locale: 'en', entries: hostile })],
    })
    const echoed: Record<string, string> = {}
    for (const message of first.messages) echoed[message.key] = message.source
    const second = run({
      config: config({ locales: ['en'] }),
      catalogs: [catalog({ locale: 'en', entries: echoed })],
    })
    expect(second.messages.map((message) => message.source)).toEqual(
      first.messages.map((message) => message.source),
    )
    expect(second.messages.map((message) => message.sourceHash)).toEqual(
      first.messages.map((message) => message.sourceHash),
    )
    expect(codes(second.diagnostics)).toEqual([])
  })
})

describe('keys the source catalog owns', () => {
  it('leaves a key whose source value failed to lower out of messages and out of extras', () => {
    const program = run({
      config: config({ locales: ['en', 'de'] }),
      catalogs: [
        catalog({ locale: 'en', entries: { 'a.broken': 'Hi {name', 'a.ok': 'Fine' } }),
        catalog({ locale: 'de', entries: { 'a.broken': 'Hallo', 'a.ok': 'Gut' } }),
      ],
    })
    expect(program.messages.map((message) => message.key)).toEqual(['a.ok'])
    expect(program.extras.map((extra) => extra.key)).toEqual([])
  })
})
