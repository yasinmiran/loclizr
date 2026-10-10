import { describe, expect, test } from 'vitest'
import { readCookie } from './cookie'

describe('readCookie on an empty or degenerate header', () => {
  test('finds nothing in an empty header', () => {
    expect(readCookie('', 'locale')).toBeNull()
  })

  test('finds nothing in a header of separators and whitespace', () => {
    expect(readCookie(' ; ;;  ', 'locale')).toBeNull()
  })

  test('skips a pair with no equals sign instead of reading it as a name', () => {
    expect(readCookie('locale; other=x', 'locale')).toBeNull()
    expect(readCookie('flag; locale=de', 'locale')).toBe('de')
  })

  test('treats a whitespace-only value as absent', () => {
    expect(readCookie('locale=   ', 'locale')).toBeNull()
  })
})

describe('readCookie name matching', () => {
  test('trims whitespace around the name and the value', () => {
    expect(readCookie('  locale  =  de-AT  ', 'locale')).toBe('de-AT')
  })

  test('is case sensitive on the name', () => {
    expect(readCookie('Locale=de; LOCALE=fr', 'locale')).toBeNull()
  })

  test('never matches a name that only shares a prefix or a suffix', () => {
    expect(readCookie('xlocale=fr; locale2=es; locale=de', 'locale')).toBe('de')
  })

  test('takes the first of two cookies with one name, which is the more specific path', () => {
    expect(readCookie('locale=de-AT; locale=de', 'locale')).toBe('de-AT')
  })

  test('reads a name that is a prototype key without consulting any object', () => {
    expect(readCookie('__proto__=de; constructor=fr', '__proto__')).toBe('de')
    expect(readCookie('__proto__=de; constructor=fr', 'constructor')).toBe('fr')
    expect(readCookie('locale=de', 'toString')).toBeNull()
  })
})

describe('readCookie values', () => {
  test('keeps every equals sign after the first as part of the value', () => {
    expect(readCookie('locale=de=AT=x', 'locale')).toBe('de=AT=x')
  })

  test('percent-decodes unicode and emoji', () => {
    expect(readCookie(`locale=${encodeURIComponent('ü-DE')}`, 'locale')).toBe('ü-DE')
    expect(readCookie(`locale=${encodeURIComponent('😀')}`, 'locale')).toBe('😀')
  })

  test('returns an encoded lone surrogate escape verbatim rather than throwing', () => {
    expect(readCookie('locale=%ED%A0%80', 'locale')).toBe('%ED%A0%80')
  })

  test('returns a value that decodes to whitespace, which the matcher then rejects', () => {
    expect(readCookie('locale=%20', 'locale')).toBe(' ')
  })

  test('leaves a plus sign alone, since cookies are not form encoded', () => {
    expect(readCookie('locale=de+AT', 'locale')).toBe('de+AT')
  })

  test('strips one surrounding pair of quotes, which RFC 6265 allows around a value', () => {
    expect(readCookie('locale="de"', 'locale')).toBe('de')
    expect(readCookie('locale="de-AT"; other=x', 'locale')).toBe('de-AT')
    expect(readCookie(`locale="${encodeURIComponent('ü-DE')}"`, 'locale')).toBe('ü-DE')
  })

  test('treats a quoted empty value as absent', () => {
    expect(readCookie('locale=""', 'locale')).toBeNull()
  })

  test('leaves an unbalanced or lone quote as is', () => {
    expect(readCookie('locale="de', 'locale')).toBe('"de')
    expect(readCookie('locale=de"', 'locale')).toBe('de"')
    expect(readCookie('locale="', 'locale')).toBe('"')
  })

  test('strips only the outer pair, and keeps a quote that was percent-encoded', () => {
    expect(readCookie('locale=""de""', 'locale')).toBe('"de"')
    expect(readCookie('locale=%22de%22', 'locale')).toBe('"de"')
  })

  test('decodes an encoded separator into one value without splitting on it', () => {
    expect(readCookie(`locale=${encodeURIComponent('de; Path=/')}; other=x`, 'locale')).toBe(
      'de; Path=/',
    )
  })

  test('reads a value from a long header with the name last', () => {
    const noise = Array.from({ length: 500 }, (_, index) => `c${index}=${'v'.repeat(8)}`).join('; ')
    expect(readCookie(`${noise}; locale=de`, 'locale')).toBe('de')
  })
})
