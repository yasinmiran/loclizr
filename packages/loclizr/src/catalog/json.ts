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
  readonly reported: Set<string>
  readonly leaves: Set<string>
}

const SYNTAX_HINT = 'a catalog is plain JSON: double-quoted keys, no trailing comma, no comments.'

// The scan is recursive descent, so a document nested past the call stack would
// escape as a RangeError and take the build down instead of reporting. A catalog
// is a shallow tree of message keys, so the cap sits far above anything a
// translator or a TMS export writes and well below where the stack gives out.
const MAX_DEPTH = 256

class JsonSyntaxError extends Error {
  readonly offset: number
  readonly hint: string

  constructor(message: string, offset: number, hint: string = SYNTAX_HINT) {
    super(message)
    this.offset = offset
    this.hint = hint
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

const BYTE_ORDER_MARK = '\ufeff'

// Object.keys lists integer-like keys first, so a parsed object's file order is
// kept beside it for the walk that decides which route of a collision wins.
const fileOrder = new WeakMap<object, readonly string[]>()

export function keysInFileOrder(node: Record<string, unknown>): readonly string[] {
  return fileOrder.get(node) ?? Object.keys(node)
}

export function parseJsonWithSpans(text: string, file: string): ParsedJson {
  const cursor: Cursor = { text, lineStarts: lineStartsOf(text), index: 0 }
  const paths: Paths = { spans: new Map(), duplicates: [], reported: new Set(), leaves: new Set() }
  try {
    // JSON.parse rejects a byte order mark too, and printed raw the character is
    // invisible, so the message names it.
    if (text.startsWith(BYTE_ORDER_MARK)) {
      throw new JsonSyntaxError(
        'The file starts with a byte order mark (U+FEFF), which JSON.parse rejects.',
        0,
        'save the file as UTF-8 without a byte order mark.',
      )
    }
    skipSpace(cursor)
    const value = parseValue(cursor, '', paths, 0)
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
          hint: failure.hint,
          file,
          span: spanAt(cursor, failure.offset, failure.offset < text.length ? 1 : 0),
        }),
      ],
    }
  }
}

function parseValue(cursor: Cursor, path: string | null, paths: Paths, depth: number): unknown {
  const char = cursor.text[cursor.index]
  if (char === undefined) {
    throw new JsonSyntaxError('Unexpected end of file where a value was expected.', cursor.index)
  }
  if (char === '{' || char === '[') {
    if (depth >= MAX_DEPTH) {
      throw new JsonSyntaxError(
        `This file nests more than ${MAX_DEPTH} levels deep.`,
        cursor.index,
        'a catalog is a tree of message keys; nothing that a translator writes nests this far.',
      )
    }
    return char === '{'
      ? parseObject(cursor, path, paths, depth + 1)
      : parseArray(cursor, paths, depth + 1)
  }
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

function parseObject(
  cursor: Cursor,
  path: string | null,
  paths: Paths,
  depth: number,
): Record<string, unknown> {
  const result = Object.create(null) as Record<string, unknown>
  const written = new Set<string>()
  const order: string[] = []
  fileOrder.set(result, order)
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
    const key = parseString(cursor)
    // Depth 1 is the root object; an empty key below it is still a segment.
    const child = path === null ? null : depth === 1 ? key : `${path}.${key}`
    if (child !== null) {
      // One object writing a key twice loses the first value whole, whatever
      // shape either of them has.
      if (written.has(key)) recordDuplicate(paths, child)
      written.add(key)
    }
    skipSpace(cursor)
    if (cursor.text[cursor.index] !== ':') {
      throw new JsonSyntaxError(`Unexpected ${describeAt(cursor)} where ":" was expected.`, cursor.index)
    }
    cursor.index += 1
    skipSpace(cursor)
    const valueStart = cursor.index
    const value = parseValue(cursor, child, paths, depth)
    // A rewritten key walks from its last spelling, where its value and span are.
    if (Object.hasOwn(result, key)) order.splice(order.indexOf(key), 1)
    order.push(key)
    result[key] = value
    if (child !== null) paths.spans.set(child, valueSpan(cursor, valueStart, value))
    // Two routes to one path, a dotted key beside a nested one, collide only
    // where both end in a message. A leaf beside a deeper branch gives two
    // different flat keys and shadows nothing.
    if (child !== null && typeof value === 'string') {
      if (paths.leaves.has(child)) recordDuplicate(paths, child)
      paths.leaves.add(child)
    }
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

function parseArray(cursor: Cursor, paths: Paths, depth: number): unknown[] {
  const result: unknown[] = []
  cursor.index += 1
  skipSpace(cursor)
  if (cursor.text[cursor.index] === ']') {
    cursor.index += 1
    return result
  }
  for (;;) {
    skipSpace(cursor)
    result.push(parseValue(cursor, null, paths, depth))
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

function recordDuplicate(paths: Paths, key: string): void {
  if (paths.reported.has(key)) return
  paths.reported.add(key)
  paths.duplicates.push(key)
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
    const char = text[index]
    if (char === '\n' || (char === '\r' && text[index + 1] !== '\n')) starts.push(index + 1)
  }
  return starts
}

// A path's span covers its value, and a string's quotes are left out of it, so
// adding an offset into the message text to the span lands on the character that
// offset names.
function valueSpan(cursor: Cursor, start: number, value: unknown): Span {
  if (typeof value !== 'string') return spanAt(cursor, start, cursor.index - start)
  const content = start + 1
  return spanAt(cursor, content, cursor.index - 1 - content)
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
