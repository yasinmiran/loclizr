import { diag } from '../diagnostics'
import type { Diagnostic, Span } from '../types'

export interface ParsedJson {
  readonly value: unknown
  readonly spans: ReadonlyMap<string, Span>
  readonly duplicates: readonly string[]
  readonly diagnostics: readonly Diagnostic[]
}

interface Cursor {
  readonly text: string
  readonly lineStarts: readonly number[]
  index: number
}

interface Paths {
  readonly spans: Map<string, Span>
  readonly duplicates: string[]
  readonly repeated: Set<string>
}

class JsonSyntaxError extends Error {
  readonly offset: number

  constructor(message: string, offset: number) {
    super(message)
    this.offset = offset
  }
}

const ESCAPES: Readonly<Record<string, string>> = {
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
}

const NUMBER = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y

export function parseJsonWithSpans(text: string, file: string): ParsedJson {
  const cursor: Cursor = { text, lineStarts: lineStartsOf(text), index: 0 }
  const paths: Paths = { spans: new Map(), duplicates: [], repeated: new Set() }
  try {
    skipSpace(cursor)
    const value = parseValue(cursor, '', paths)
    skipSpace(cursor)
    if (cursor.index < text.length) {
      throw new JsonSyntaxError(`Unexpected ${describeAt(cursor)} after the top-level value.`, cursor.index)
    }
    return { value, spans: paths.spans, duplicates: paths.duplicates, diagnostics: [] }
  } catch (failure) {
    if (!(failure instanceof JsonSyntaxError)) throw failure
    return {
      value: undefined,
      spans: new Map(),
      duplicates: [],
      diagnostics: [
        diag('catalog-json-syntax', {
          message: failure.message,
          hint: 'a catalog is plain JSON: double-quoted keys, no trailing comma, no comments.',
          file,
          span: spanAt(cursor, failure.offset, failure.offset < text.length ? 1 : 0),
        }),
      ],
    }
  }
}

function parseValue(cursor: Cursor, path: string | null, paths: Paths): unknown {
  const char = cursor.text[cursor.index]
  if (char === undefined) {
    throw new JsonSyntaxError('Unexpected end of file where a value was expected.', cursor.index)
  }
  if (char === '{') return parseObject(cursor, path, paths)
  if (char === '[') return parseArray(cursor, paths)
  if (char === '"') return parseString(cursor)
  if (char === '-' || (char >= '0' && char <= '9')) return parseNumber(cursor)
  for (const [word, value] of [
    ['true', true],
    ['false', false],
    ['null', null],
  ] as const) {
    if (cursor.text.startsWith(word, cursor.index)) {
      cursor.index += word.length
      return value
    }
  }
  throw new JsonSyntaxError(`Unexpected ${describeAt(cursor)} where a value was expected.`, cursor.index)
}

function parseObject(cursor: Cursor, path: string | null, paths: Paths): Record<string, unknown> {
  const result = Object.create(null) as Record<string, unknown>
  cursor.index += 1
  skipSpace(cursor)
  if (cursor.text[cursor.index] === '}') {
    cursor.index += 1
    return result
  }
  for (;;) {
    skipSpace(cursor)
    if (cursor.text[cursor.index] !== '"') {
      throw new JsonSyntaxError(`Unexpected ${describeAt(cursor)} where a quoted key was expected.`, cursor.index)
    }
    const start = cursor.index
    const key = parseString(cursor)
    const child = path === null ? null : path === '' ? key : `${path}.${key}`
    if (child !== null) record(paths, child, spanAt(cursor, start, cursor.index - start))
    skipSpace(cursor)
    if (cursor.text[cursor.index] !== ':') {
      throw new JsonSyntaxError(`Unexpected ${describeAt(cursor)} where ":" was expected.`, cursor.index)
    }
    cursor.index += 1
    skipSpace(cursor)
    result[key] = parseValue(cursor, child, paths)
    skipSpace(cursor)
    const next = cursor.text[cursor.index]
    if (next === ',') {
      cursor.index += 1
      continue
    }
    if (next === '}') {
      cursor.index += 1
      return result
    }
    throw new JsonSyntaxError(`Unexpected ${describeAt(cursor)} where "," or "}" was expected.`, cursor.index)
  }
}

function parseArray(cursor: Cursor, paths: Paths): unknown[] {
  const result: unknown[] = []
  cursor.index += 1
  skipSpace(cursor)
  if (cursor.text[cursor.index] === ']') {
    cursor.index += 1
    return result
  }
  for (;;) {
    skipSpace(cursor)
    result.push(parseValue(cursor, null, paths))
    skipSpace(cursor)
    const next = cursor.text[cursor.index]
    if (next === ',') {
      cursor.index += 1
      continue
    }
    if (next === ']') {
      cursor.index += 1
      return result
    }
    throw new JsonSyntaxError(`Unexpected ${describeAt(cursor)} where "," or "]" was expected.`, cursor.index)
  }
}

function parseString(cursor: Cursor): string {
  const { text } = cursor
  let index = cursor.index + 1
  let out = ''
  for (;;) {
    const char = text[index]
    if (char === undefined) throw new JsonSyntaxError('Unterminated string.', index)
    if (char === '"') {
      cursor.index = index + 1
      return out
    }
    if (char === '\\') {
      const escape = text[index + 1]
      if (escape === undefined) throw new JsonSyntaxError('Unterminated string.', index + 1)
      if (escape === 'u') {
        const digits = text.slice(index + 2, index + 6)
        if (!/^[0-9a-fA-F]{4}$/.test(digits)) {
          throw new JsonSyntaxError('A \\u escape needs four hexadecimal digits.', index)
        }
        out += String.fromCharCode(Number.parseInt(digits, 16))
        index += 6
        continue
      }
      const replacement = ESCAPES[escape]
      if (replacement === undefined) {
        throw new JsonSyntaxError(`Unknown string escape "\\${escape}".`, index)
      }
      out += replacement
      index += 2
      continue
    }
    if (char < ' ') {
      throw new JsonSyntaxError('A raw control character is not allowed inside a string.', index)
    }
    out += char
    index += 1
  }
}

function parseNumber(cursor: Cursor): number {
  NUMBER.lastIndex = cursor.index
  const match = NUMBER.exec(cursor.text)
  if (match === null) {
    throw new JsonSyntaxError(`Unexpected ${describeAt(cursor)} where a number was expected.`, cursor.index)
  }
  cursor.index += match[0].length
  return Number(match[0])
}

function record(paths: Paths, key: string, span: Span): void {
  if (paths.spans.has(key) && !paths.repeated.has(key)) {
    paths.repeated.add(key)
    paths.duplicates.push(key)
  }
  paths.spans.set(key, span)
}

function skipSpace(cursor: Cursor): void {
  const { text } = cursor
  while (cursor.index < text.length) {
    const char = text[cursor.index]
    if (char !== ' ' && char !== '\t' && char !== '\n' && char !== '\r') return
    cursor.index += 1
  }
}

function describeAt(cursor: Cursor): string {
  const char = cursor.text[cursor.index]
  return char === undefined ? 'end of file' : JSON.stringify(char)
}

function lineStartsOf(text: string): readonly number[] {
  const starts = [0]
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n') starts.push(index + 1)
  }
  return starts
}

function spanAt(cursor: Cursor, offset: number, length: number): Span {
  const { lineStarts } = cursor
  let low = 0
  let high = lineStarts.length - 1
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if ((lineStarts[middle] ?? 0) <= offset) low = middle
    else high = middle - 1
  }
  return { line: low + 1, column: offset - (lineStarts[low] ?? 0) + 1, offset, length }
}
