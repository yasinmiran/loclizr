import { createHash } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import { hash16 } from './index'

// The expected bytes are written out by hand from the WTF-8 table rather than
// derived, so a slip in the encoder's bit arithmetic cannot cancel itself here.
function headOf(...parts: readonly (string | readonly number[])[]): string {
  const hash = createHash('sha256')
  for (const part of parts) hash.update(typeof part === 'string' ? part : Uint8Array.from(part))
  return hash.digest('hex').slice(0, 16)
}

describe('hash16 on an unpaired low surrogate', () => {
  test('keeps a lone low half apart from U+FFFD and from another low half', () => {
    expect(hash16('\udc00')).not.toBe(hash16('�'))
    expect(hash16('\udc00')).not.toBe(hash16('\udfff'))
  })

  test('encodes a lone low half as its own three bytes', () => {
    expect(hash16('\udc00')).toBe(headOf([0xed, 0xb0, 0x80]))
    expect(hash16('\udfff')).toBe(headOf([0xed, 0xbf, 0xbf]))
  })

  test('encodes a lone low half between well-formed text', () => {
    expect(hash16('x\udc3dy')).toBe(headOf('x', [0xed, 0xb0, 0xbd], 'y'))
  })
})

describe('hash16 on a surrogate whose low six bits are all in use', () => {
  test('writes every one of those bits into the last byte', () => {
    expect(hash16('\ud83d')).toBe(headOf([0xed, 0xa0, 0xbd]))
    expect(hash16('\ud83f')).toBe(headOf([0xed, 0xa0, 0xbf]))
    expect(hash16('\ud820')).not.toBe(hash16('\ud800'))
  })
})
