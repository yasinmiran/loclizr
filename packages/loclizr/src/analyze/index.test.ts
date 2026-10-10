import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CatalogMeta, Program } from '../types'
import { calls, resetCalls } from './__fixtures__/icu-double'
import {
  bodyFor,
  catalog,
  codes,
  config,
  forRule,
  messageFor,
  originFor,
  run,
  span,
} from './__fixtures__/program'
import { confusableSkeleton, fallbackChain, mangle, namespaceOf, pascalCase } from './index'

vi.mock('../icu', async () => await import('./__fixtures__/icu-double'))

beforeEach(() => {
  resetCalls()
})

describe('mangle', () => {
  it('replaces every character outside the identifier set', () => {
    expect(mangle('nav.home', {})).toBe('nav_home')
    expect(mangle('a-b c', {})).toBe('a_b_c')
  })

  it('keeps unicode identifier characters intact', () => {
    expect(mangle('カート.タイトル', {})).toBe('カート_タイトル')
    expect(mangle('заказ.статус', {})).toBe('заказ_статус')
  })

  it('prefixes a result that cannot start an identifier', () => {
    expect(mangle('9lives', {})).toBe('$9lives')
  })

  it('prefixes reserved words, default and then', () => {
    expect(mangle('new', {})).toBe('$new')
    expect(mangle('default', {})).toBe('$default')
    expect(mangle('then', {})).toBe('$then')
  })

  it('lets an override replace the whole result and still guards it', () => {
    expect(mangle('nav.home', { 'nav.home': 'navHome' })).toBe('navHome')
    expect(mangle('nav.home', { 'nav.home': 'class' })).toBe('$class')
    expect(mangle('nav.home', { 'nav.home': '1st' })).toBe('$1st')
  })

  it('cannot escape the output directory through a traversal key', () => {
    expect(mangle('../x.y', {})).toBe('___x_y')
  })
})

describe('namespaceOf', () => {
  it('takes the first segment and names a root key _root', () => {
    expect(namespaceOf('nav.home')).toBe('nav')
    expect(namespaceOf('a.b.c')).toBe('a')
    expect(namespaceOf('home')).toBe('_root')
  })
})

describe('pascalCase', () => {
  it('upper-cases each underscore-separated part and joins them', () => {
    expect(pascalCase('nav_main')).toBe('NavMain')
    expect(pascalCase('errors')).toBe('Errors')
  })
})

describe('fallbackChain', () => {
  it('walks declared subtag truncations and ends at the source locale', () => {
    const chain = fallbackChain('de-AT', config({ locales: ['en', 'de', 'de-AT'] }))
    expect(chain).toEqual(['de-AT', 'de', 'en'])
  })

  it('skips a truncation that is not a declared locale', () => {
    const chain = fallbackChain('de-AT', config({ locales: ['en', 'de-AT'] }))
    expect(chain).toEqual(['de-AT', 'en'])
  })

  it('replaces the middle from an explicit map and still ends at the source', () => {
    const chain = fallbackChain('nb', config({ locales: ['en', 'nb'], fallback: { nb: ['no'] } }))
    expect(chain).toEqual(['nb', 'no', 'en'])
  })

  it('never repeats the source locale', () => {
    expect(fallbackChain('en', config({ locales: ['en'] }))).toEqual(['en'])
    expect(
      fallbackChain('nb', config({ locales: ['en', 'nb'], fallback: { nb: ['en'] } })),
    ).toEqual(['nb', 'en'])
  })
})

describe('confusableSkeleton', () => {
  it('folds Cyrillic and Greek homoglyphs onto Latin', () => {
    expect(confusableSkeleton('раy')).toBe(confusableSkeleton('pay'))
    expect(confusableSkeleton('Αlpha')).toBe(confusableSkeleton('Alpha'))
  })

  it('applies NFKC before folding', () => {
    expect(confusableSkeleton('ﬁle')).toBe('file')
  })

  it('leaves keys that differ by more than a homoglyph apart', () => {
    expect(confusableSkeleton('pay')).not.toBe(confusableSkeleton('pai'))
  })

  it('drops the joiners that render as nothing and survive into an identifier', () => {
    for (const invisible of ['\u200d', '\u200c', '\u2060', '\ufeff']) {
      expect(confusableSkeleton(`pa${invisible}y`)).toBe('pay')
    }
  })

  it('keeps a soft hyphen, whose export already differs visibly', () => {
    expect(confusableSkeleton('pa\u00ady')).not.toBe('pay')
  })
})

describe('the fallback seam', () => {
  const seam = (): Program =>
    run({
      config: config({ locales: ['en', 'de', 'de-AT'] }),
      catalogs: [
        catalog({
          locale: 'en',
          entries: {
            'one.a': 'Home',
            'two.b': 'Cart',
            'three.c': 'Hi {name}',
          },
        }),
        catalog({
          locale: 'de',
          entries: {
            'one.a': 'Startseite',
            'two.b': '   ',
            'three.c': 'Hallo {nmae}',
          },
        }),
        catalog({ locale: 'de-AT', entries: {} }),
      ],
    })

  it('keeps only each locale own body, never a copy of another locale nodes', () => {
    const program = seam()
    expect(messageFor(program, 'one.a').bodies.map((body) => body.locale)).toEqual(['en', 'de'])
    expect(messageFor(program, 'two.b').bodies.map((body) => body.locale)).toEqual(['en'])
    expect(messageFor(program, 'three.c').bodies.map((body) => body.locale)).toEqual(['en', 'de'])
  })

  it('inherits a present ancestor body with no diagnostic of its own', () => {
    const message = messageFor(seam(), 'one.a')
    expect(originFor(message, 'de')).toEqual({ status: 'translated' })
    expect(originFor(message, 'de-AT')).toEqual({ status: 'inherited', from: 'de' })
  })

  it('falls a blank value through to the source and inherits that resolution', () => {
    const message = messageFor(seam(), 'two.b')
    expect(originFor(message, 'de')).toEqual({ status: 'fallback', from: 'en', reason: 'blank' })
    expect(originFor(message, 'de-AT')).toEqual({
      status: 'fallback',
      from: 'en',
      reason: 'missing',
    })
  })

  it('falls an unknown argument through to the source as reason invalid', () => {
    const message = messageFor(seam(), 'three.c')
    expect(originFor(message, 'de')).toEqual({ status: 'fallback', from: 'en', reason: 'invalid' })
    expect(originFor(message, 'de-AT')).toEqual({
      status: 'fallback',
      from: 'en',
      reason: 'missing',
    })
  })

  it('keeps the unrenderable body so the cross-locale check can still read it', () => {
    const body = bodyFor(messageFor(seam(), 'three.c'), 'de')
    expect(body?.args.map((arg) => arg.name)).toEqual(['nmae'])
  })

  it('never lets the typo reach the printed argument set', () => {
    expect(messageFor(seam(), 'three.c').args.map((arg) => arg.name)).toEqual(['name'])
  })

  it('stamps one origin per declared locale on every message', () => {
    for (const message of seam().messages) {
      expect(message.origins.map((origin) => origin.locale)).toEqual(['en', 'de', 'de-AT'])
    }
  })

  it('always names a body emit can print', () => {
    for (const message of seam().messages) {
      const present = message.bodies.map((body) => body.locale)
      for (const { locale, origin } of message.origins) {
        expect(present).toContain(origin.status === 'translated' ? locale : origin.from)
      }
    }
  })

  it('counts two fallbacks for each target locale', () => {
    const program = seam()
    const fellBack = (locale: string): number =>
      program.messages.filter((message) => originFor(message, locale).status === 'fallback').length
    expect(fellBack('de')).toBe(2)
    expect(fellBack('de-AT')).toBe(2)
    expect(fellBack('en')).toBe(0)
  })
})

describe('bodies', () => {
  it('drops the message when the source value fails to lower', () => {
    const program = run({
      config: config({ locales: ['en', 'de'] }),
      catalogs: [
        catalog({ locale: 'en', entries: { 'a.broken': 'Hi {name', 'a.ok': 'Fine' } }),
        catalog({ locale: 'de', entries: { 'a.broken': 'Hallo', 'a.ok': 'Gut' } }),
      ],
    })
    expect(program.messages.map((message) => message.key)).toEqual(['a.ok'])
    expect(codes(program.diagnostics)).toContain('LZ2001')
  })

  it('keeps the message when a target value fails to lower', () => {
    const program = run({
      config: config({ locales: ['en', 'de'] }),
      catalogs: [
        catalog({ locale: 'en', entries: { 'a.b': 'Hi' } }),
        catalog({ locale: 'de', entries: { 'a.b': 'Hallo {name' } }),
      ],
    })
    const message = messageFor(program, 'a.b')
    expect(message.bodies.map((body) => body.locale)).toEqual(['en'])
    expect(originFor(message, 'de')).toEqual({ status: 'fallback', from: 'en', reason: 'invalid' })
    expect(codes(program.diagnostics)).toContain('LZ2001')
  })

  it('carries the format each body was read as, file by file', () => {
    const program = run({
      config: config({ locales: ['en', 'de'] }),
      catalogs: [
        catalog({ locale: 'en', entries: { 'a.b': 'Hi' } }),
        catalog({ locale: 'de', entries: { 'a.b': 'Hallo' }, format: 'i18next' }),
      ],
    })
    const message = messageFor(program, 'a.b')
    expect(bodyFor(message, 'en')?.format).toBe('icu')
    expect(bodyFor(message, 'de')?.format).toBe('i18next')
  })

  it('lowers an empty source value to a message with no nodes', () => {
    const program = run({
      config: config({ locales: ['en'] }),
      catalogs: [catalog({ locale: 'en', entries: { 'a.b': '' } })],
    })
    const message = messageFor(program, 'a.b')
    expect(message.bodies.map((body) => body.locale)).toEqual(['en'])
    expect(message.bodies[0]?.nodes).toEqual([])
    expect(message.source).toBe('')
  })

  it('never lowers a blank target value', () => {
    run({
      config: config({ locales: ['en', 'de'] }),
      catalogs: [
        catalog({ locale: 'en', entries: { 'a.b': 'Hi' } }),
        catalog({ locale: 'de', entries: { 'a.b': '\t\n ' } }),
      ],
    })
    expect(calls.map((call) => call.locale)).toEqual(['en'])
  })
})

describe('lower context', () => {
  it('passes each catalog own format through, never a project-wide guess', () => {
    run({
      config: config({ locales: ['en', 'de', 'de-AT'] }),
      catalogs: [
        catalog({ locale: 'en', entries: { 'cart.greeting': 'Hi {name}' } }),
        catalog({ locale: 'de', format: 'icu', entries: { 'cart.greeting': 'Hallo {name}' } }),
        catalog({
          locale: 'de-AT',
          format: 'i18next',
          entries: { 'cart.greeting': 'Servus {name}' },
        }),
      ],
    })
    expect(calls.map((call) => [call.locale, call.catalogFormat])).toEqual([
      ['en', 'icu'],
      ['de', 'icu'],
      ['de-AT', 'i18next'],
    ])
  })

  it('carries the key, the file and the span of the entry it lowers', () => {
    run({
      config: config({ locales: ['en'] }),
      catalogs: [
        catalog({ locale: 'en', file: 'locales/en/common.json', entries: { 'common.nav': 'Home' } }),
      ],
    })
    expect(calls[0]?.key).toBe('common.nav')
    expect(calls[0]?.file).toBe('locales/en/common.json')
    expect(calls[0]?.span).toEqual(span(1, 4))
  })

  it('hands the resolved format config to every call', () => {
    const formats = { timeZone: 'UTC', number: {}, dateTime: {} }
    run({
      config: config({ locales: ['en'], formats }),
      catalogs: [catalog({ locale: 'en', entries: { 'a.b': 'Hi' } })],
    })
    expect(calls[0]?.formats).toBe(formats)
  })
})

describe('Message.args', () => {
  it('narrows a source stringish argument to a target typed use', () => {
    const program = run({
      config: config({ locales: ['en', 'de'] }),
      catalogs: [
        catalog({ locale: 'en', entries: { 'a.b': 'Hi {count}' } }),
        catalog({ locale: 'de', entries: { 'a.b': 'Hallo {count, number}' } }),
      ],
    })
    expect(messageFor(program, 'a.b').args).toEqual([{ name: 'count', type: { kind: 'number' } }])
  })

  it('keeps the source type where unification fails across locales', () => {
    const program = run({
      config: config({ locales: ['en', 'de', 'fr'] }),
      catalogs: [
        catalog({ locale: 'en', entries: { 'a.b': 'Hi {x}' } }),
        catalog({ locale: 'de', entries: { 'a.b': 'Hallo {x, number}' } }),
        catalog({ locale: 'fr', entries: { 'a.b': 'Salut {x, date}' } }),
      ],
    })
    expect(messageFor(program, 'a.b').args).toEqual([{ name: 'x', type: { kind: 'stringish' } }])
  })

  it('keeps the source body first-appearance order', () => {
    const program = run({
      config: config({ locales: ['en', 'de'] }),
      catalogs: [
        catalog({ locale: 'en', entries: { 'a.b': '{second} {first}' } }),
        catalog({ locale: 'de', entries: { 'a.b': '{first} {second}' } }),
      ],
    })
    expect(messageFor(program, 'a.b').args.map((arg) => arg.name)).toEqual(['second', 'first'])
  })

  it('still folds the types of a body nothing will render', () => {
    const program = run({
      config: config({ locales: ['en', 'de'] }),
      catalogs: [
        catalog({ locale: 'en', entries: { 'a.b': 'Hi {count}' } }),
        catalog({ locale: 'de', entries: { 'a.b': 'Hallo {count, number} {extra}' } }),
      ],
    })
    const message = messageFor(program, 'a.b')
    expect(originFor(message, 'de')).toEqual({ status: 'fallback', from: 'en', reason: 'invalid' })
    expect(message.args).toEqual([{ name: 'count', type: { kind: 'number' } }])
  })

  it('ignores a target argument the source does not have', () => {
    const program = run({
      config: config({ locales: ['en', 'de'] }),
      catalogs: [
        catalog({ locale: 'en', entries: { 'a.b': 'Hi {name}' } }),
        catalog({ locale: 'de', entries: { 'a.b': 'Hallo {name} {extra}' } }),
      ],
    })
    expect(messageFor(program, 'a.b').args.map((arg) => arg.name)).toEqual(['name'])
  })

  it('leaves a target that drops a source argument renderable', () => {
    const program = run({
      config: config({ locales: ['en', 'de'] }),
      catalogs: [
        catalog({ locale: 'en', entries: { 'a.b': 'Hi {name}' } }),
        catalog({ locale: 'de', entries: { 'a.b': 'Hallo' } }),
      ],
    })
    expect(originFor(messageFor(program, 'a.b'), 'de')).toEqual({ status: 'translated' })
  })
})

describe('markup', () => {
  it('takes kind and tags from the source locale', () => {
    const program = run({
      config: config({ locales: ['en', 'de'] }),
      catalogs: [
        catalog({ locale: 'en', entries: { 'terms.accept': 'Read our <link>terms</link>' } }),
        catalog({ locale: 'de', entries: { 'terms.accept': 'Lies unsere AGB' } }),
      ],
    })
    const message = messageFor(program, 'terms.accept')
    expect(message.kind).toBe('markup')
    expect(message.markupTags).toEqual(['link'])
    expect(message.args).toEqual([{ name: 'link', type: { kind: 'markup' } }])
  })

  it('resolves a target that introduces a tag the source lacks to the source body', () => {
    const program = run({
      config: config({ locales: ['en', 'de'] }),
      catalogs: [
        catalog({ locale: 'en', entries: { 'terms.accept': 'Read our terms' } }),
        catalog({ locale: 'de', entries: { 'terms.accept': 'Lies unsere <b>AGB</b>' } }),
      ],
    })
    const message = messageFor(program, 'terms.accept')
    expect(message.kind).toBe('text')
    expect(originFor(message, 'de')).toEqual({ status: 'fallback', from: 'en', reason: 'invalid' })
    const body = bodyFor(message, 'de')
    expect(body?.markupTags).toEqual(['b'])
    expect(body?.args).toEqual([{ name: 'b', type: { kind: 'markup' } }])
  })

  it('leaves a target that keeps the source tags translated', () => {
    const program = run({
      config: config({ locales: ['en', 'de'] }),
      catalogs: [
        catalog({ locale: 'en', entries: { 'terms.accept': 'Read our <link>terms</link>' } }),
        catalog({ locale: 'de', entries: { 'terms.accept': 'Lies unsere <link>AGB</link>' } }),
      ],
    })
    expect(originFor(messageFor(program, 'terms.accept'), 'de')).toEqual({ status: 'translated' })
  })
})

describe('inheritance', () => {
  it('skips an ancestor whose own body is unrenderable', () => {
    const program = run({
      config: config({ locales: ['en', 'de', 'de-AT'] }),
      catalogs: [
        catalog({ locale: 'en', entries: { 'a.b': 'Hi {name}' } }),
        catalog({ locale: 'de', entries: { 'a.b': 'Hallo {nmae}' } }),
        catalog({ locale: 'de-AT', entries: {} }),
      ],
    })
    expect(originFor(messageFor(program, 'a.b'), 'de-AT')).toEqual({
      status: 'fallback',
      from: 'en',
      reason: 'missing',
    })
  })

  it('resolves a blank overlay value to the source even under a translated ancestor', () => {
    const program = run({
      config: config({ locales: ['en', 'de', 'de-AT'] }),
      catalogs: [
        catalog({ locale: 'en', entries: { 'a.b': 'Hi' } }),
        catalog({ locale: 'de', entries: { 'a.b': 'Hallo' } }),
        catalog({ locale: 'de-AT', entries: { 'a.b': '  ' } }),
      ],
    })
    expect(originFor(messageFor(program, 'a.b'), 'de-AT')).toEqual({
      status: 'fallback',
      from: 'en',
      reason: 'blank',
    })
  })

  it('inherits an ancestor only where the locale wrote no value of its own', () => {
    const program = run({
      config: config({ locales: ['en', 'de', 'de-AT'] }),
      catalogs: [
        catalog({ locale: 'en', entries: { 'a.b': 'Hi' } }),
        catalog({ locale: 'de', entries: { 'a.b': 'Hallo' } }),
        catalog({ locale: 'de-AT', entries: {} }),
      ],
    })
    expect(originFor(messageFor(program, 'a.b'), 'de-AT')).toEqual({
      status: 'inherited',
      from: 'de',
    })
  })

  it('resolves a value that failed to lower to the source, never to a usable ancestor', () => {
    const program = run({
      config: config({ locales: ['en', 'de', 'de-AT'] }),
      catalogs: [
        catalog({ locale: 'en', entries: { 'a.b': 'Hi' } }),
        catalog({ locale: 'de', entries: { 'a.b': 'Hallo' } }),
        catalog({ locale: 'de-AT', entries: { 'a.b': 'Servus {' } }),
      ],
    })
    const message = messageFor(program, 'a.b')
    expect(originFor(message, 'de-AT')).toEqual({
      status: 'fallback',
      from: 'en',
      reason: 'invalid',
    })
    expect(message.bodies.map((body) => body.locale)).toEqual(['en', 'de'])
    expect(codes(program.diagnostics)).toEqual(['LZ2001'])
    expect(program.diagnostics[0]?.locale).toBe('de-AT')
    expect(program.diagnostics[0]?.file).toBe('locales/de-AT.json')
  })

  it('follows an explicit fallback map through an undeclared locale', () => {
    const program = run({
      config: config({ locales: ['en', 'nb'], fallback: { nb: ['no'] } }),
      catalogs: [
        catalog({ locale: 'en', entries: { 'a.b': 'Home' } }),
        catalog({ locale: 'no', entries: { 'a.b': 'Hjem' } }),
      ],
    })
    const message = messageFor(program, 'a.b')
    expect(originFor(message, 'nb')).toEqual({ status: 'inherited', from: 'no' })
    expect(message.bodies.map((body) => body.locale)).toEqual(['en', 'no'])
  })

  it('names a body emit can print even when the ancestor is undeclared', () => {
    const program = run({
      config: config({ locales: ['en', 'nb'], fallback: { nb: ['no'] } }),
      catalogs: [
        catalog({ locale: 'en', entries: { 'a.b': 'Home', 'a.c': 'Cart' } }),
        catalog({ locale: 'no', entries: { 'a.b': 'Hjem' } }),
      ],
    })
    for (const message of program.messages) {
      const present = message.bodies.map((body) => body.locale)
      for (const { locale, origin } of message.origins) {
        expect(present).toContain(origin.status === 'translated' ? locale : origin.from)
      }
    }
  })

  it('gives the source locale a translated origin', () => {
    const program = run({
      config: config({ locales: ['en', 'de'] }),
      catalogs: [catalog({ locale: 'en', entries: { 'a.b': 'Home' } })],
    })
    const message = messageFor(program, 'a.b')
    expect(originFor(message, 'en')).toEqual({ status: 'translated' })
    expect(originFor(message, 'de')).toEqual({ status: 'fallback', from: 'en', reason: 'missing' })
    expect(message.bodies.map((body) => body.locale)).toEqual(['en'])
  })
})

describe('program shape', () => {
  it('sorts messages by key by code point', () => {
    const program = run({
      config: config({ locales: ['en'] }),
      catalogs: [
        catalog({ locale: 'en', entries: { 'c.z': 'Z', 'a.b': 'B', 'B.a': 'A', 'a.A': 'A' } }),
      ],
    })
    expect(program.messages.map((message) => message.key)).toEqual(['B.a', 'a.A', 'a.b', 'c.z'])
  })

  it('names the namespace and the module from the first key segment', () => {
    const program = run({
      config: config({ locales: ['en'] }),
      catalogs: [catalog({ locale: 'en', entries: { 'nav.home': 'Home', loose: 'Loose' } })],
    })
    expect(messageFor(program, 'nav.home').namespace).toBe('nav')
    expect(messageFor(program, 'nav.home').module).toBe('messages/nav.js')
    expect(messageFor(program, 'loose').namespace).toBe('_root')
    expect(messageFor(program, 'loose').module).toBe('messages/_root.js')
  })

  it('merges the several catalogs one locale gets from a namespaced pattern', () => {
    const program = run({
      config: config({ locales: ['en'] }),
      catalogs: [
        catalog({
          locale: 'en',
          ns: 'common',
          file: 'locales/en/common.json',
          entries: { 'common.nav.home': 'Home' },
        }),
        catalog({
          locale: 'en',
          ns: 'cart',
          file: 'locales/en/cart.json',
          entries: { 'cart.title': 'Cart' },
        }),
      ],
    })
    expect(program.messages.map((message) => message.key)).toEqual(['cart.title', 'common.nav.home'])
    expect(messageFor(program, 'cart.title').spans[0]?.file).toBe('locales/en/cart.json')
  })

  it('records a span for every locale carrying the key, blank values included', () => {
    const program = run({
      config: config({ locales: ['en', 'de', 'fr'] }),
      catalogs: [
        catalog({ locale: 'en', entries: { 'a.b': 'Hi' } }),
        catalog({ locale: 'de', entries: { 'a.b': ' ' } }),
        catalog({ locale: 'fr', entries: {} }),
      ],
    })
    expect(messageFor(program, 'a.b').spans.map((entry) => entry.locale)).toEqual(['en', 'de'])
  })

  it('puts a target-only key in extras rather than in messages', () => {
    const program = run({
      config: config({ locales: ['en', 'de'] }),
      catalogs: [
        catalog({ locale: 'en', entries: { 'a.b': 'Hi' } }),
        catalog({ locale: 'de', entries: { 'a.b': 'Hallo', 'a.gone': 'Weg' } }),
      ],
    })
    expect(program.messages.map((message) => message.key)).toEqual(['a.b'])
    expect(program.extras).toEqual([
      { locale: 'de', key: 'a.gone', file: 'locales/de.json', span: span(2, 3) },
    ])
  })

  it('leaves usages empty and carries the config through', () => {
    const resolved = config({ locales: ['en', 'de'] })
    const program = run({
      config: resolved,
      catalogs: [catalog({ locale: 'en', entries: { 'a.b': 'Hi' } })],
    })
    expect(program.usages).toEqual([])
    expect(program.config).toBe(resolved)
    expect(program.sourceLocale).toBe('en')
    expect(program.locales).toEqual(['en', 'de'])
  })

  it('hashes the normalized source rather than the catalog text', () => {
    const program = run({
      config: config({ locales: ['en'] }),
      catalogs: [catalog({ locale: 'en', entries: { 'a.b': 'Hi {  name  }' } })],
    })
    const message = messageFor(program, 'a.b')
    expect(message.source).toBe('Hi {name}')
    expect(message.sourceHash).toHaveLength(16)
  })
})

describe('meta', () => {
  it('attaches the description and the placeholder notes of the source key', () => {
    const meta: CatalogMeta = {
      file: 'locales/en.meta.json',
      entries: [
        {
          key: 'cart.items',
          description: 'Badge under the cart icon',
          placeholders: [{ name: 'count', note: 'Line items, not quantity' }],
          span: span(1, 10),
        },
        { key: 'gone.away', description: 'Orphan', placeholders: [], span: span(2, 10) },
      ],
    }
    const program = run({
      config: config({ locales: ['en'] }),
      catalogs: [catalog({ locale: 'en', entries: { 'cart.items': 'Items', 'nav.home': 'Home' } })],
      meta,
    })
    const items = messageFor(program, 'cart.items')
    expect(items.description).toBe('Badge under the cart icon')
    expect(items.placeholders).toEqual([{ name: 'count', note: 'Line items, not quantity' }])
    expect(messageFor(program, 'nav.home').description).toBeNull()
    expect(messageFor(program, 'nav.home').placeholders).toEqual([])
  })
})

describe('identity rules', () => {
  it('raises LZ4001 once for every key that mangles to one identifier', () => {
    const program = run({
      config: config({ locales: ['en'] }),
      catalogs: [catalog({ locale: 'en', entries: { 'a.b': 'One', 'a-b': 'Two', 'a b': 'Three' } })],
    })
    const collisions = forRule(program, 'identifier-collision')
    expect(collisions).toHaveLength(1)
    expect(collisions[0]?.key).toBe('a b')
    expect(collisions[0]?.related.map((related) => related.key)).toEqual(['a-b', 'a.b'])
    expect(collisions[0]?.fatal).toBe(true)
  })

  it.each([
    '__proto__',
    'constructor',
    'prototype',
    'locales',
    'sourceLocale',
    'getLocale',
    'setLocale',
    'subscribe',
    'cookie',
  ])('raises LZ4002 for the reserved identifier %s', (reserved) => {
    const program = run({
      config: config({ locales: ['en'] }),
      catalogs: [catalog({ locale: 'en', entries: { [reserved]: 'Value' } })],
    })
    expect(codes(program.diagnostics)).toEqual(['LZ4002'])
    expect(program.diagnostics[0]?.key).toBe(reserved)
  })

  it('raises LZ4002 when an identifiers entry lands on a reserved name', () => {
    const program = run({
      config: config({ locales: ['en'], identifiers: { 'nav.home': 'getLocale' } }),
      catalogs: [catalog({ locale: 'en', entries: { 'nav.home': 'Home' } })],
    })
    expect(codes(program.diagnostics)).toEqual(['LZ4002'])
  })

  it('raises LZ4002 for an identifier entering the internal namespace', () => {
    const program = run({
      config: config({ locales: ['en'], identifiers: { 'a.b': '$loader' } }),
      catalogs: [catalog({ locale: 'en', entries: { 'a.b': 'Hi' } })],
    })
    expect(codes(program.diagnostics)).toEqual(['LZ4002'])
  })

  it('does not treat the reserved-word prefix as an internal identifier', () => {
    const program = run({
      config: config({ locales: ['en'] }),
      catalogs: [catalog({ locale: 'en', entries: { then: 'Then', 'new.tab': 'Tab' } })],
    })
    expect(program.diagnostics).toEqual([])
    expect(messageFor(program, 'then').id).toBe('$then')
  })

  it('raises LZ4002 once for a top-level segment naming a generated module', () => {
    const program = run({
      config: config({ locales: ['en'] }),
      catalogs: [
        catalog({
          locale: 'en',
          entries: { '_locale.a': 'A', '_locale.b': 'B', '_formats.c': 'C', '_root.d': 'D' },
        }),
      ],
    })
    const reserved = forRule(program, 'identifier-reserved')
    expect(reserved.map((diagnostic) => diagnostic.key)).toEqual([
      '_formats.c',
      '_locale.a',
      '_root.d',
    ])
  })

  it('leaves a root-level key alone even though its namespace is _root', () => {
    const program = run({
      config: config({ locales: ['en'] }),
      catalogs: [catalog({ locale: 'en', entries: { home: 'Home' } })],
    })
    expect(program.diagnostics).toEqual([])
    expect(messageFor(program, 'home').namespace).toBe('_root')
  })

  it('raises LZ4003 for two keys that differ only by a homoglyph', () => {
    const program = run({
      config: config({ locales: ['en'] }),
      catalogs: [catalog({ locale: 'en', entries: { 'a.pay': 'Pay', 'a.раy': 'Pay' } })],
    })
    const confusable = forRule(program, 'confusable-key')
    expect(confusable).toHaveLength(1)
    expect(confusable[0]?.related).toHaveLength(1)
  })

  it('raises LZ4003 for two keys that differ only by an invisible joiner', () => {
    const program = run({
      config: config({ locales: ['en'] }),
      catalogs: [catalog({ locale: 'en', entries: { pay: 'A', 'pay\u200d': 'B', 'pay\u200c': 'C' } })],
    })
    const confusable = forRule(program, 'confusable-key')
    expect(confusable).toHaveLength(1)
    expect(confusable[0]?.related).toHaveLength(2)
    expect(confusable[0]?.hint).not.toContain('Cyrillic or Greek homoglyph.')
  })

  it('leaves a wholly non-Latin key alone', () => {
    const program = run({
      config: config({ locales: ['en'] }),
      catalogs: [catalog({ locale: 'en', entries: { 'а.раy': 'Pay' } })],
    })
    expect(program.diagnostics).toEqual([])
  })
})

describe('groups', () => {
  it('collects members on a dot boundary and strips the separator', () => {
    const program = run({
      config: config({ locales: ['en'], groups: { errors: 'errors' } }),
      catalogs: [
        catalog({
          locale: 'en',
          entries: {
            'errors.forbidden': 'Forbidden',
            'errors.not_found': 'Not found',
            'errorsish.other': 'Other',
          },
        }),
      ],
    })
    expect(program.groups).toHaveLength(1)
    expect(program.groups[0]?.members).toEqual([
      { key: 'errors.forbidden', id: 'errors_forbidden', member: 'forbidden' },
      { key: 'errors.not_found', id: 'errors_not_found', member: 'not_found' },
    ])
  })

  it('carries the config name, the export identifier and the type base', () => {
    const program = run({
      config: config({ locales: ['en'], groups: { 'nav.main': 'nav' } }),
      catalogs: [catalog({ locale: 'en', entries: { 'nav.home': 'Home' } })],
    })
    expect(program.groups[0]).toMatchObject({
      name: 'nav.main',
      id: 'nav_main',
      typeBase: 'NavMain',
      prefix: 'nav',
    })
  })

  it('sorts groups by identifier', () => {
    const program = run({
      config: config({ locales: ['en'], groups: { zeta: 'z', alpha: 'a' } }),
      catalogs: [catalog({ locale: 'en', entries: { 'z.one': 'One', 'a.one': 'One' } })],
    })
    expect(program.groups.map((group) => group.id)).toEqual(['alpha', 'zeta'])
  })

  it('raises LZ4004 for a prefix matching zero keys', () => {
    const program = run({
      config: config({ locales: ['en'], groups: { err: 'err' } }),
      catalogs: [catalog({ locale: 'en', entries: { 'errors.forbidden': 'Forbidden' } })],
    })
    expect(codes(program.diagnostics)).toEqual(['LZ4004'])
    expect(program.groups).toEqual([
      { name: 'err', id: 'err', typeBase: 'Err', prefix: 'err', members: [] },
    ])
  })

  it('raises LZ4006 when members do not share one argument set', () => {
    const program = run({
      config: config({ locales: ['en'], groups: { errors: 'errors' } }),
      catalogs: [
        catalog({
          locale: 'en',
          entries: {
            'errors.forbidden': 'Forbidden',
            'errors.rate_limited': 'Try again in {seconds, number}',
          },
        }),
      ],
    })
    const heterogeneous = forRule(program, 'group-args-heterogeneous')
    expect(heterogeneous).toHaveLength(1)
    expect(heterogeneous[0]?.message).toContain('seconds')
    expect(heterogeneous[0]?.severity).toBe('warn')
    expect(heterogeneous[0]?.related.map((related) => related.key)).toEqual([
      'errors.forbidden',
      'errors.rate_limited',
    ])
    expect(heterogeneous[0]?.related.map((related) => related.message)).toEqual([
      'takes no arguments',
      'takes seconds',
    ])
  })

  it('stays quiet when every member takes the same arguments', () => {
    const program = run({
      config: config({ locales: ['en'], groups: { errors: 'errors' } }),
      catalogs: [
        catalog({
          locale: 'en',
          entries: { 'errors.a': 'A {x}', 'errors.b': 'B {x}' },
        }),
      ],
    })
    expect(program.diagnostics).toEqual([])
  })

  it('raises one LZ4001 for two groups that collide as one export identifier', () => {
    const program = run({
      config: config({ locales: ['en'], groups: { 'nav.main': 'nav', nav_main: 'nav' } }),
      catalogs: [catalog({ locale: 'en', entries: { 'nav.home': 'Home' } })],
    })
    const collisions = forRule(program, 'identifier-collision')
    expect(collisions).toHaveLength(1)
    expect(collisions[0]?.message).toContain('export identifier "nav_main"')
  })

  it('raises LZ4001 for two groups whose identifiers differ but whose type bases do not', () => {
    const program = run({
      config: config({ locales: ['en'], groups: { nav_main: 'nav', navMain: 'nav' } }),
      catalogs: [catalog({ locale: 'en', entries: { 'nav.home': 'Home' } })],
    })
    const collisions = forRule(program, 'identifier-collision')
    expect(collisions).toHaveLength(1)
    expect(collisions[0]?.message).toContain('type base "NavMain"')
  })
})
