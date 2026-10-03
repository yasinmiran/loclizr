import { describe, expect, it } from 'vitest'
import type { Program } from '../types'
import { catalog, codes, config, forRule, messageFor, run } from './__fixtures__/program'
import { confusableSkeleton, mangle, namespaceOf, pascalCase } from './index'

function english(entries: Readonly<Record<string, string>>): Program {
  return run({ config: config({ locales: ['en'] }), catalogs: [catalog({ locale: 'en', entries })] })
}

describe('mangle on unicode input', () => {
  it('normalizes a decomposed key to NFC before mangling', () => {
    expect(mangle('café.menu', {})).toBe(mangle('café.menu', {}))
    expect(mangle('café.menu', {})).toBe('café_menu')
  })

  it('turns an astral emoji into one underscore, not one per code unit', () => {
    expect(mangle('a\u{1F44B}b', {})).toBe('a_b')
  })

  it('turns a lone surrogate into an underscore', () => {
    expect(mangle('a\uD800b', {})).toBe('a_b')
  })

  it('turns a right-to-left mark into an underscore', () => {
    expect(mangle('a‏b', {})).toBe('a_b')
  })

  it('prefixes a key that starts with a combining mark, which can continue but not start', () => {
    expect(mangle('́a', {})).toBe('$́a')
  })

  it('reads the first code point, so an astral identifier start needs no prefix', () => {
    expect(mangle('\u{1D4B6}b', {})).toBe('\u{1D4B6}b')
  })

  it('keeps a very long key at its full length', () => {
    const key = 'a'.repeat(10_000)
    expect(mangle(key, {})).toBe(key)
  })
})

describe('mangle on keys that look like numbers', () => {
  it('prefixes every digit-led form', () => {
    expect(mangle('0', {})).toBe('$0')
    expect(mangle('1e21', {})).toBe('$1e21')
    expect(mangle('9007199254740991', {})).toBe('$9007199254740991')
  })

  it('needs no prefix for -0, whose sign becomes a legal leading underscore', () => {
    expect(mangle('-0', {})).toBe('_0')
  })

  it('maps the empty key to the bare prefix', () => {
    expect(mangle('', {})).toBe('$')
  })
})

describe('mangle and the reserved words', () => {
  it('guards the strict-mode-only words an ES module cannot bind', () => {
    for (const word of ['eval', 'arguments', 'let', 'static', 'implements', 'yield', 'await']) {
      expect(mangle(word, {})).toBe(`$${word}`)
    }
  })

  it('leaves contextual keywords that are legal bindings alone', () => {
    for (const word of ['async', 'of', 'get', 'set', 'from', 'as', 'undefined']) {
      expect(mangle(word, {})).toBe(word)
    }
  })

  it('matches reserved words case-sensitively', () => {
    expect(mangle('Class', {})).toBe('Class')
    expect(mangle('NEW', {})).toBe('NEW')
  })
})

describe('mangle and the overrides record', () => {
  it('never reads an inherited property of the overrides object as an override', () => {
    expect(mangle('toString', {})).toBe('toString')
    expect(mangle('constructor', {})).toBe('constructor')
    expect(mangle('__proto__', {})).toBe('__proto__')
    expect(mangle('hasOwnProperty', {})).toBe('hasOwnProperty')
  })

  it('honours an own __proto__ entry, which only JSON or a computed key can create', () => {
    const overrides = JSON.parse('{"__proto__":"protoMessage"}') as Record<string, string>
    expect(mangle('__proto__', overrides)).toBe('protoMessage')
  })

  it('applies an entry to its own key and never to a neighbour', () => {
    expect(mangle('a.b', { 'a.c': 'other' })).toBe('a_b')
  })

  it('runs an entry through the identifier character set, so it always emits a legal name', () => {
    expect(mangle('nav.home', { 'nav.home': 'nav-home' })).toBe('nav_home')
  })
})

describe('namespaceOf at the edges', () => {
  it('names the empty key a root key', () => {
    expect(namespaceOf('')).toBe('_root')
  })

  it('takes the segment before the first dot even when the next segment is empty', () => {
    expect(namespaceOf('a..b')).toBe('a')
    expect(namespaceOf('trailing.')).toBe('trailing')
  })

  it('returns an empty segment for a leading dot', () => {
    expect(namespaceOf('.lead')).toBe('')
  })
})

describe('pascalCase at the edges', () => {
  it('returns the empty string for the empty string', () => {
    expect(pascalCase('')).toBe('')
  })

  it('drops the separators of doubled, leading and trailing underscores', () => {
    expect(pascalCase('a__b')).toBe('AB')
    expect(pascalCase('_x')).toBe('X')
    expect(pascalCase('x_')).toBe('X')
  })

  it('leaves a guard prefix and a digit lead as they are', () => {
    expect(pascalCase('$then')).toBe('$then')
    expect(pascalCase('$9lives')).toBe('$9lives')
  })

  it('upper-cases a Cyrillic part', () => {
    expect(pascalCase('ошибки_сети')).toBe('ОшибкиСети')
  })

  it('upper-cases an astral first letter by code point, not by surrogate', () => {
    expect(pascalCase('\u{10428}x_\u{10428}y')).toBe('\u{10400}x\u{10400}y')
  })
})

describe('confusableSkeleton at the edges', () => {
  it('returns the empty string for the empty string', () => {
    expect(confusableSkeleton('')).toBe('')
  })

  it('leaves an unmapped Cyrillic letter as it is', () => {
    expect(confusableSkeleton('ж')).toBe('ж')
  })

  it('does not fold case, so two keys differing only in case stay apart', () => {
    expect(confusableSkeleton('Pay')).not.toBe(confusableSkeleton('pay'))
  })

  it('folds a fullwidth Latin letter onto ASCII', () => {
    expect(confusableSkeleton('ｐay')).toBe('pay')
  })
})

describe('identity rules on prototype-named keys', () => {
  it('keeps a root key named __proto__ as a message and reports it reserved', () => {
    const program = english({ ['__proto__']: 'Proto' })
    expect(messageFor(program, '__proto__').id).toBe('__proto__')
    expect(codes(forRule(program, 'identifier-reserved'))).toEqual(['LZ4002'])
  })

  it('reports a root key named constructor reserved', () => {
    expect(codes(english({ constructor: 'Ctor' }).diagnostics)).toEqual(['LZ4002'])
  })

  it('gives a prototype name its own reason, since the barrel exports none of them', () => {
    const [reserved] = forRule(english({ constructor: 'Ctor' }), 'identifier-reserved')
    expect(reserved?.hint).not.toContain('barrel')
  })

  it('gives a barrel export name the barrel as its reason', () => {
    const [reserved] = forRule(english({ locales: 'Languages' }), 'identifier-reserved')
    expect(reserved?.hint).toContain('barrel')
  })

  it('leaves toString and hasOwnProperty alone, which no barrel export shadows', () => {
    expect(english({ toString: 'A', hasOwnProperty: 'B' }).diagnostics).toEqual([])
  })

  it('leaves a barrel export name alone once it is nested under a namespace', () => {
    const program = english({ 'nav.locales': 'Languages' })
    expect(messageFor(program, 'nav.locales').id).toBe('nav_locales')
    expect(program.diagnostics).toEqual([])
  })
})

describe('identity rules on the internal namespace', () => {
  it('reports a key that starts with a dollar and a lowercase letter', () => {
    expect(codes(forRule(english({ '$foo.bar': 'x' }), 'identifier-reserved'))).toEqual(['LZ4002'])
  })

  it('leaves a dollar followed by an upper-case letter, a digit or an underscore alone', () => {
    expect(english({ $Foo: 'a', $1: 'b', $_x: 'c' }).diagnostics).toEqual([])
  })
})

describe('identity rules on unicode keys', () => {
  it('raises LZ4001 for two keys that differ only by normalization form', () => {
    const program = english({ 'café.title': 'A', 'café.title': 'B' })
    expect(program.messages).toHaveLength(2)
    expect(codes(forRule(program, 'identifier-collision'))).toEqual(['LZ4001'])
  })

  it('raises LZ4001 for two keys that are each a single different emoji', () => {
    const program = english({ '\u{1F44B}': 'wave', '\u{1F642}': 'smile' })
    expect(codes(forRule(program, 'identifier-collision'))).toEqual(['LZ4001'])
  })

  it('raises LZ4001 for an RTL mark that mangles onto a dot', () => {
    const program = english({ 'a‏b': 'x', 'a.b': 'y' })
    expect(codes(forRule(program, 'identifier-collision'))).toEqual(['LZ4001'])
  })
})
