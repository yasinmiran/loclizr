export interface Scrubbed {
  readonly withoutComments: string
  readonly codeOnly: string
}

type Range = readonly [number, number]

interface Lexed {
  readonly comments: readonly Range[]
  readonly literals: readonly Range[]
}

const IDENT_START = /[\p{ID_Start}$_]/u
const IDENT_PART = /[\p{ID_Continue}$]/u
const NUMBER_PART = /[0-9A-Za-z_$.]/u

// A `/` directly after one of these opens a regular expression, not a division.
const REGEX_AFTER_WORD: ReadonlySet<string> = new Set([
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

// JSX text is not a string to any JS tokenizer, so a bare apostrophe in
// `<p>Don't forget</p>` would open a string literal that swallows every usage
// until the next one. Section 12 trades that false negative for false
// positives: comments only, then pass two over the remainder.
export function scrub(text: string, jsx: boolean): Scrubbed {
  if (jsx) {
    const stripped = blank(text, commentRanges(text))
    return { withoutComments: stripped, codeOnly: stripped }
  }
  const lexed = lex(text)
  const withoutComments = blank(text, lexed.comments)
  return { withoutComments, codeOnly: blank(withoutComments, lexed.literals) }
}

export function isIdentStart(char: string): boolean {
  return char !== '' && IDENT_START.test(char)
}

export function isIdentPart(char: string): boolean {
  return char !== '' && IDENT_PART.test(char)
}

export function isDigit(char: string): boolean {
  return char >= '0' && char <= '9'
}

export function readIdentEnd(text: string, start: number): number {
  let index = start
  while (isIdentPart(text.charAt(index))) index += 1
  return index
}

export function readNumberEnd(text: string, start: number): number {
  let index = start
  while (index < text.length && NUMBER_PART.test(text.charAt(index))) index += 1
  return index
}

function commentRanges(text: string): readonly Range[] {
  const ranges: Range[] = []
  let index = 0
  while (index < text.length) {
    const char = text.charAt(index)
    if (char === '/' && text.charAt(index + 1) === '/') {
      const start = index
      index = endOfLineComment(text, index)
      ranges.push([start, index])
      continue
    }
    if (char === '/' && text.charAt(index + 1) === '*') {
      const start = index
      index = endOfBlockComment(text, index)
      ranges.push([start, index])
      continue
    }
    index += 1
  }
  return ranges
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
      index = endOfBlockComment(text, index)
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
    if (isIdentStart(char)) {
      const end = readIdentEnd(text, index)
      afterValue = !REGEX_AFTER_WORD.has(text.slice(index, end))
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
    if (char !== ' ' && char !== '\t' && char !== '\n' && char !== '\r') afterValue = false
    index += 1
  }
  if (inTemplate) literals.push([chunkStart, text.length])
  return { comments, literals }
}

function endOfLineComment(text: string, start: number): number {
  let index = start + 2
  while (index < text.length && text.charAt(index) !== '\n') index += 1
  return index
}

function endOfBlockComment(text: string, start: number): number {
  let index = start + 2
  while (index < text.length) {
    if (text.charAt(index) === '*' && text.charAt(index + 1) === '/') return index + 2
    index += 1
  }
  return text.length
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
    if (char === '\n') break
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
    if (char === '\n') return null
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
      if (units[index] !== '\n') units[index] = ' '
    }
  }
  return units.join('')
}
