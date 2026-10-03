export interface Scrubbed {
  readonly withoutComments: string
  readonly codeOnly: string
}

type Range = readonly [number, number]

interface Lexed {
  readonly comments: readonly Range[]
  readonly literals: readonly Range[]
}

interface Literal {
  readonly chunks: readonly Range[]
  readonly end: number
}

const IDENT_START = /[\p{ID_Start}$_]/u
const IDENT_PART = /[\p{ID_Continue}$]/u
const NUMBER_PART = /[0-9A-Za-z_$.]/u
const WORD_BEFORE = /[\p{ID_Start}$_][\p{ID_Continue}$]*$/u
const WORD_WINDOW = 32

// Expression position: a `/` here opens a regular expression rather than a
// division, and a quote here opens a string rather than prose.
const BEFORE_EXPRESSION: ReadonlySet<string> = new Set([
  'await',
  'case',
  'delete',
  'do',
  'else',
  'in',
  'instanceof',
  'new',
  'of',
  'return',
  'throw',
  'typeof',
  'void',
  'yield',
])

const PUNCTUATOR_BEFORE_EXPRESSION: ReadonlySet<string> = new Set([
  '=',
  '(',
  '[',
  '{',
  ',',
  ':',
  ';',
  '?',
])

export function scrub(text: string, jsx: boolean): Scrubbed {
  const lexed = jsx ? lexJsx(text) : lex(text)
  const withoutComments = blank(text, lexed.comments)
  return { withoutComments, codeOnly: blank(withoutComments, lexed.literals) }
}

// Identifiers are read by code point, not by code unit. The mangler keeps every
// ID_Continue character, so a plane 2 CJK key reaches source as a surrogate pair
// that `\p{ID_Start}` rejects one half at a time.
export function isIdentStartAt(text: string, index: number): boolean {
  const char = codePointAt(text, index)
  return char !== '' && IDENT_START.test(char)
}

export function isDigit(char: string): boolean {
  return char >= '0' && char <= '9'
}

export function readIdentEnd(text: string, start: number): number {
  let index = start
  while (index < text.length) {
    const char = codePointAt(text, index)
    if (char === '' || !IDENT_PART.test(char)) return index
    index += char.length
  }
  return index
}

export function readNumberEnd(text: string, start: number): number {
  let index = start
  while (index < text.length && NUMBER_PART.test(text.charAt(index))) index += 1
  return index
}

export function previousSignificant(text: string, at: number): number {
  let index = at - 1
  while (index >= 0) {
    const char = text.charAt(index)
    if (char !== ' ' && char !== '\t' && char !== '\n' && char !== '\r') return index
    index -= 1
  }
  return -1
}

// ECMAScript ends a line at all four, so a lone CR or a U+2028 must end a line
// comment and a line number exactly as `\n` does.
export function isLineTerminator(char: string): boolean {
  return char === '\n' || char === '\r' || char === '\u2028' || char === '\u2029'
}

function codePointAt(text: string, index: number): string {
  const code = text.codePointAt(index)
  return code === undefined ? '' : String.fromCodePoint(code)
}

// JSX text is not a string to any JS tokenizer, so `<p>Don't forget</p>` presents
// a bare apostrophe that a full lexer reads as an opening quote, swallowing every
// usage until the next one. The JSX lexer therefore opens a literal only where
// prose cannot reach: in expression position, closing on the same line. It reads
// no regular expressions at all, because `<p>a</p><p>b</p>` offers `/p><p>b</` as
// one, and it ends an unterminated block comment with its line, because a stray
// `/*` in markup would otherwise blank the file from there down.
function lexJsx(text: string): Lexed {
  const comments: Range[] = []
  const literals: Range[] = []
  let index = 0
  while (index < text.length) {
    const char = text.charAt(index)
    if (char === '/' && text.charAt(index + 1) === '/') {
      // A scheme-qualified URL in JSX text sits in no string, so it needs its own
      // carve-out before the line is read as a comment.
      if (text.charAt(index - 1) === ':') {
        index += 2
        continue
      }
      const start = index
      index = endOfLineComment(text, index)
      comments.push([start, index])
      continue
    }
    if (char === '/' && text.charAt(index + 1) === '*') {
      const start = index
      index = endOfBlockComment(text, index, true)
      comments.push([start, index])
      continue
    }
    if ((char === '"' || char === "'" || char === '`') && opensJsxLiteral(text, index)) {
      const literal = readSameLineLiteral(text, index)
      if (literal !== null) {
        literals.push(...literal.chunks)
        index = literal.end
        continue
      }
    }
    index += 1
  }
  return { comments, literals }
}

function opensJsxLiteral(text: string, at: number): boolean {
  const before = previousSignificant(text, at)
  if (before === -1) return true
  const char = text.charAt(before)
  if (PUNCTUATOR_BEFORE_EXPRESSION.has(char)) return true
  if (char === '>' && text.charAt(before - 1) === '=') return true
  return BEFORE_EXPRESSION.has(wordEndingAt(text, before))
}

function wordEndingAt(text: string, at: number): string {
  const window = text.slice(Math.max(0, at - WORD_WINDOW), at + 1)
  return WORD_BEFORE.exec(window)?.[0] ?? ''
}

function readSameLineLiteral(text: string, start: number): Literal | null {
  const quote = text.charAt(start)
  const chunks: Range[] = []
  let chunkStart = start + 1
  let index = chunkStart
  while (index < text.length) {
    const char = text.charAt(index)
    if (isLineTerminator(char)) return null
    if (char === '\\') {
      index += 2
      continue
    }
    if (char === quote) {
      chunks.push([chunkStart, index])
      return { chunks, end: index + 1 }
    }
    if (quote === '`' && char === '$' && text.charAt(index + 1) === '{') {
      const hole = endOfHole(text, index + 2)
      if (hole === null) return null
      chunks.push([chunkStart, index])
      index = hole
      chunkStart = hole
      continue
    }
    index += 1
  }
  return null
}

function endOfHole(text: string, from: number): number | null {
  let depth = 1
  let index = from
  while (index < text.length) {
    const char = text.charAt(index)
    if (isLineTerminator(char)) return null
    if (char === '{') depth += 1
    if (char === '}') {
      depth -= 1
      if (depth === 0) return index + 1
    }
    index += 1
  }
  return null
}

function lex(text: string): Lexed {
  const comments: Range[] = []
  const literals: Range[] = []
  const templateDepths: number[] = []
  let braceDepth = 0
  let index = 0
  let inTemplate = false
  let chunkStart = 0
  let afterValue = false
  while (index < text.length) {
    if (inTemplate) {
      const char = text.charAt(index)
      if (char === '\\') {
        index += 2
        continue
      }
      if (char === '`') {
        literals.push([chunkStart, index])
        index += 1
        inTemplate = false
        afterValue = true
        continue
      }
      if (char === '$' && text.charAt(index + 1) === '{') {
        literals.push([chunkStart, index])
        templateDepths.push(braceDepth)
        braceDepth += 1
        index += 2
        inTemplate = false
        afterValue = false
        continue
      }
      index += 1
      continue
    }
    const char = text.charAt(index)
    if (char === '/' && text.charAt(index + 1) === '/') {
      const start = index
      index = endOfLineComment(text, index)
      comments.push([start, index])
      continue
    }
    if (char === '/' && text.charAt(index + 1) === '*') {
      const start = index
      index = endOfBlockComment(text, index, false)
      comments.push([start, index])
      continue
    }
    if (char === '/' && !afterValue) {
      const end = readRegex(text, index)
      if (end !== null) {
        literals.push([index + 1, end])
        index = end
        afterValue = true
        continue
      }
      index += 1
      afterValue = false
      continue
    }
    if (char === '"' || char === "'") {
      const quoted = readQuoted(text, index)
      literals.push([index + 1, quoted.contentEnd])
      index = quoted.end
      afterValue = true
      continue
    }
    if (char === '`') {
      index += 1
      chunkStart = index
      inTemplate = true
      continue
    }
    if (char === '{') {
      braceDepth += 1
      index += 1
      afterValue = false
      continue
    }
    if (char === '}') {
      braceDepth -= 1
      index += 1
      if (templateDepths[templateDepths.length - 1] === braceDepth) {
        templateDepths.pop()
        chunkStart = index
        inTemplate = true
        afterValue = true
        continue
      }
      afterValue = false
      continue
    }
    if (isIdentStartAt(text, index)) {
      const end = readIdentEnd(text, index)
      afterValue = !BEFORE_EXPRESSION.has(text.slice(index, end))
      index = end
      continue
    }
    if (isDigit(char)) {
      index = readNumberEnd(text, index)
      afterValue = true
      continue
    }
    if (char === ')' || char === ']') {
      index += 1
      afterValue = true
      continue
    }
    // `a++` and `done!` are still values, so the `/` after them divides. A prefix
    // `++` leaves expression position as it found it, and so does `!` that is
    // not stuck to an operand, which is `!/re/.test(s)` on a fresh line. A `)!`
    // is left a logical not, since `if (a)!/re/` cannot be told from `f()!` here.
    if ((char === '+' || char === '-') && text.charAt(index + 1) === char) {
      index += 2
      continue
    }
    if (
      char === '!' &&
      afterValue &&
      text.charAt(index + 1) !== '=' &&
      text.charAt(index - 1) !== ')' &&
      previousSignificant(text, index) === index - 1
    ) {
      index += 1
      continue
    }
    if (char !== ' ' && char !== '\t' && char !== '\n' && char !== '\r') afterValue = false
    index += 1
  }
  if (inTemplate) literals.push([chunkStart, text.length])
  return { comments, literals }
}

function endOfLineComment(text: string, start: number): number {
  let index = start + 2
  while (index < text.length && !isLineTerminator(text.charAt(index))) index += 1
  return index
}

function endOfBlockComment(text: string, start: number, capUnterminated: boolean): number {
  const close = text.indexOf('*/', start + 2)
  if (close !== -1) return close + 2
  if (!capUnterminated) return text.length
  return endOfLineComment(text, start)
}

function readQuoted(text: string, start: number): { readonly contentEnd: number; readonly end: number } {
  const quote = text.charAt(start)
  let index = start + 1
  while (index < text.length) {
    const char = text.charAt(index)
    if (char === '\\') {
      index += 2
      continue
    }
    if (char === quote) return { contentEnd: index, end: index + 1 }
    // U+2028 and U+2029 are legal inside a string literal, so only CR joins LF.
    if (char === '\n' || char === '\r') break
    index += 1
  }
  const end = Math.min(index, text.length)
  return { contentEnd: end, end }
}

// Returns the index after the flags, or null when the `/` was not a regular
// expression after all, in which case nothing is blanked.
function readRegex(text: string, start: number): number | null {
  let index = start + 1
  let inClass = false
  let closed = false
  while (index < text.length) {
    const char = text.charAt(index)
    if (char === '\\') {
      index += 2
      continue
    }
    if (isLineTerminator(char)) return null
    if (char === '[') {
      inClass = true
      index += 1
      continue
    }
    if (char === ']') {
      inClass = false
      index += 1
      continue
    }
    if (char === '/' && !inClass) {
      index += 1
      closed = true
      break
    }
    index += 1
  }
  if (!closed) return null
  return readIdentEnd(text, index)
}

function blank(text: string, ranges: readonly Range[]): string {
  if (ranges.length === 0) return text
  const units = text.split('')
  for (const [start, end] of ranges) {
    const from = Math.max(0, start)
    const to = Math.min(end, units.length)
    for (let index = from; index < to; index += 1) {
      if (!isLineTerminator(units[index] ?? '')) units[index] = ' '
    }
  }
  return units.join('')
}
