import type { UsageSite } from '../types'
import type { Bindings } from './imports'
import type { ScanGroup } from './index'
import {
  isDigit,
  isIdentStartAt,
  isLineTerminator,
  previousSignificant,
  readIdentEnd,
  readNumberEnd,
} from './scrub'

export type FoundSite = UsageSite & { readonly id: string }

const SNIPPET_CAP = 160
const LINE_BREAK = /\r\n|[\n\r\u2028\u2029]/gu
// A return type annotation is walked rather than skipped, and the walk is bounded
// so a file of unbalanced punctuation cannot make pass two quadratic.
const ANNOTATION_CAP = 512

// A `(` after one of these opens a clause, or belongs to a function the word
// does not name, so the word in front of it never names a scope.
const NOT_A_SCOPE_NAME: ReadonlySet<string> = new Set([
  'async',
  'await',
  'case',
  'catch',
  'default',
  'delete',
  'do',
  'else',
  'export',
  'for',
  'function',
  'if',
  'import',
  'in',
  'instanceof',
  'new',
  'of',
  'return',
  'super',
  'switch',
  'this',
  'throw',
  'typeof',
  'void',
  'while',
  'with',
  'yield',
])

// A body after the `)` of one of these is theirs, not a method's: `if (x) {`,
// `function (x) {`, `async (x): T => {`. Every other reserved word is a legal
// method name, `delete() {}` and `return() {}` included.
const NOT_A_METHOD_NAME: ReadonlySet<string> = new Set([
  'async',
  'catch',
  'for',
  'function',
  'if',
  'switch',
  'while',
  'with',
])

// Inside a type, a word from this set is an operator: what follows it is another
// type rather than the body brace.
const TYPE_OPERATORS: ReadonlySet<string> = new Set(['extends', 'infer', 'keyof', 'readonly'])

const DECLARATION_KEYWORDS: ReadonlySet<string> = new Set([
  'class',
  'const',
  'function',
  'let',
  'var',
])

// These start a statement, so a declaration name still in hand belongs to the
// statement before them and cannot name the block they are about to open.
const STATEMENT_KEYWORDS: ReadonlySet<string> = new Set([
  'catch',
  'do',
  'else',
  'for',
  'if',
  'return',
  'switch',
  'throw',
  'try',
  'while',
  'with',
])

// A newline after one of these continues the statement, so the declaration name
// in hand is still the one the body about to open belongs to.
const CONTINUES_STATEMENT: ReadonlySet<string> = new Set([
  '=',
  '(',
  '[',
  '{',
  ',',
  ':',
  '?',
  '.',
  '|',
  '&',
  '+',
  '-',
  '*',
  '/',
  '%',
  '<',
  '!',
  '~',
  '^',
])

const CLOSERS: Readonly<Record<string, string>> = { ')': '(', ']': '[', '}': '{' }

interface Frame {
  readonly open: '(' | '[' | '{'
  readonly callee: string | null
  readonly typePosition: boolean
  readonly scope: string | null
}

// A name in hand, with the bracket depth it was written at, so every slot below
// can tell a nested occurrence from the statement it belongs to.
interface Named {
  readonly name: string
  readonly depth: number
}

interface Body {
  readonly at: number
  readonly name: string
  readonly depth: number
}

interface Access {
  readonly ids: readonly string[]
  readonly end: number
}

interface Accessor {
  readonly kind: '.' | '[' | 'none'
  readonly next: number
}

export function collectSites(input: {
  readonly source: string
  readonly code: string
  readonly file: string
  readonly bindings: Bindings
  readonly ids: ReadonlySet<string>
}): readonly FoundSite[] {
  const code = input.code
  const lineStarts = lineStartsOf(code)
  const sites: FoundSite[] = []
  const frames: Frame[] = []
  let index = 0
  let pending: Named | null = null
  // A declaration whose body is an expression rather than a block, which is every
  // arrow component written `const Cart = () => <p/>`. It has no bracket to live
  // in, so it lives at the depth it was written at.
  let loose: Named | null = null
  let classBody: Named | null = null
  let body: Body | null = null
  let expectName = false
  let declarator: string | null = null
  // An open `const`, `let` or `var` statement, whose commas at its own depth
  // separate declarators that each name what they declare.
  let declaration: Named | null = null
  // `<T, U = X>` opens no frame, so its commas sit at the declaration's depth too.
  let typeParameters = 0
  let lastIdent: string | null = null
  let afterDot = false
  const snippets = new Map<number, string>()

  function endClause(): void {
    if (pending !== null && frames.length <= pending.depth) pending = null
    if (loose !== null && frames.length <= loose.depth) loose = null
  }

  function endStatement(): void {
    endClause()
    if (declaration !== null && frames.length <= declaration.depth) declaration = null
    if (body !== null && frames.length <= body.depth) body = null
    if (classBody !== null && frames.length <= classBody.depth) classBody = null
  }

  function takeName(): string | null {
    const name = pending?.name ?? null
    pending = null
    return name
  }

  while (index < code.length) {
    const char = code.charAt(index)
    const dotted = afterDot
    afterDot = false

    if (isIdentStartAt(code, index)) {
      const end = readIdentEnd(code, index)
      const word = code.slice(index, end)
      if (DECLARATION_KEYWORDS.has(word)) {
        expectName = true
        declarator = word
        if (word !== 'class' && word !== 'function' && opensBinding(code, end)) {
          declaration = { name: word, depth: frames.length }
          typeParameters = 0
        }
        lastIdent = word
        index = end
        continue
      }
      if (expectName) {
        expectName = false
        lastIdent = word
        index = end
        // `class extends X {}` and `export default class {}` are anonymous.
        if (word === 'extends' || word === 'implements') continue
        pending = { name: word, depth: frames.length }
        // A heritage clause can hold anything, so the class body is found by
        // depth: it is the next brace opening where the class name was written.
        if (declarator === 'class') classBody = { name: word, depth: frames.length }
        continue
      }
      if (STATEMENT_KEYWORDS.has(word)) {
        endStatement()
        lastIdent = word
        index = end
        continue
      }
      const access = dotted ? null : resolveAccess(word, end, code, input.bindings, input.ids)
      if (access !== null) {
        for (const id of access.ids) {
          sites.push(siteAt(id, index, lineStarts, frames, loose, input, snippets))
        }
        lastIdent = null
        index = access.end
        continue
      }
      lastIdent = word
      index = end
      continue
    }

    if (isDigit(char)) {
      index = readNumberEnd(code, index)
      lastIdent = null
      expectName = false
      continue
    }

    if (char === '=' && code.charAt(index + 1) === '>') {
      openArrowBody(index)
      lastIdent = null
      expectName = false
      index += 2
      continue
    }

    if (char === '.') {
      // The last dot of a spread is not a member access: `...m.nav_home()`.
      const spread = code.startsWith('...', index)
      afterDot = !spread
      lastIdent = null
      expectName = false
      index += spread ? 3 : 1
      continue
    }

    if (char === '(' || char === '[' || char === '{') {
      // `const { a } = obj` declares no single name, so the name slot is spent.
      if (expectName && char !== '(') pending = null
      openFrame(char, index)
      lastIdent = null
      expectName = false
      index += 1
      continue
    }

    if (char === ')' || char === ']' || char === '}') {
      closeFrame(char, index)
      lastIdent = null
      expectName = false
      index += 1
      continue
    }

    if (char === ';') {
      endStatement()
      lastIdent = null
      expectName = false
      index += 1
      continue
    }

    // A comma ends a clause but not a prediction: the one in
    // `f(): Record<string, number> {` sits inside a return type. One written
    // between JSX children is prose and ends nothing at all.
    if (char === ',') {
      if (!followsMarkup(code, index)) endClause()
      lastIdent = null
      expectName =
        declaration !== null &&
        frames.length === declaration.depth &&
        typeParameters === 0 &&
        startsDeclarator(code, index + 1)
      if (expectName && declaration !== null) declarator = declaration.name
      index += 1
      continue
    }

    if (isLineTerminator(char)) {
      const atPending = pending !== null && frames.length === pending.depth
      const atDeclaration = declaration !== null && frames.length === declaration.depth
      if ((atPending || atDeclaration) && !continuesStatement(code, index)) {
        if (atPending) pending = null
        if (atDeclaration) declaration = null
      }
      index += 1
      continue
    }

    // Only a `<` where a value starts can open type parameters, which keeps a
    // comparison such as `a < b, c = 1` from hiding the next declarator.
    if (declaration !== null && frames.length === declaration.depth) {
      if (char === '<' && (typeParameters > 0 || startsValue(code, index))) typeParameters += 1
      if (char === '>' && typeParameters > 0) typeParameters -= 1
    }

    if (char !== ' ' && char !== '\t' && char !== '\r') {
      lastIdent = null
      expectName = false
    }
    index += 1
  }

  return sites

  function openFrame(char: '(' | '[' | '{', at: number): void {
    const scope = scopeForBrace(char, at)
    if (scope !== null) {
      body = null
      classBody = null
      pending = null
    }
    frames.push({
      open: char,
      callee: char === '(' ? lastIdent : null,
      typePosition: char === '{' && code.charAt(previousSignificant(code, at)) === ':',
      scope,
    })
  }

  function closeFrame(char: ')' | ']' | '}', at: number): void {
    const open = CLOSERS[char]
    let matching = frames.length - 1
    // A closer with nothing to match is ignored rather than unwinding the stack,
    // because a file of stray punctuation must not cost the scopes above it.
    while (matching >= 0 && frames[matching]?.open !== open) matching -= 1
    if (matching < 0) return
    const frame = frames[matching]
    frames.length = matching
    if (pending !== null && frames.length < pending.depth) pending = null
    if (loose !== null && frames.length < loose.depth) loose = null
    if (declaration !== null && frames.length < declaration.depth) declaration = null
    // An object literal or a block that named nothing ends the statement's name
    // with it. A type annotation does not: `const render: { (): string } =
    // function () {}` is still naming `render` on the other side of the brace.
    if (char === '}' && frame?.typePosition !== true && pending !== null && frames.length <= pending.depth) {
      pending = null
    }
    if (char === ')') closeParameterList(frame?.callee ?? null, at)
  }

  // The class name wins over a prediction from its own heritage clause, so
  // `class Cart extends mixin(base) {` is Cart rather than mixin.
  function scopeForBrace(char: '(' | '[' | '{', at: number): string | null {
    if (char === '{' && classBody !== null && frames.length === classBody.depth) {
      return classBody.name
    }
    return body !== null && body.at === at ? body.name : null
  }

  function closeParameterList(callee: string | null, at: number): void {
    if (callee !== null && STATEMENT_KEYWORDS.has(callee)) pending = null
    const method =
      callee !== null &&
      !NOT_A_METHOD_NAME.has(callee) &&
      !(NOT_A_SCOPE_NAME.has(callee) && breaksLine(code, at + 1))
        ? callee
        : null
    const name = method ?? pending?.name ?? null
    body = name === null ? null : bodyAfterParams(code, at + 1, name, frames.length)
  }

  function openArrowBody(at: number): void {
    const enclosing = innermostCall()
    // A `(` with no callee in front of it is a parameter list, so an arrow inside
    // it belongs to a parameter's type or to a nested arrow, not to the
    // declaration this statement is naming.
    if (enclosing !== null && scopeNameOf(enclosing.callee) === null) return
    const name = takeName()
    if (name === null) return
    const start = skipSpace(code, at + 2)
    const char = code.charAt(start)
    if (char === '{' || char === '(') body = { at: start, name, depth: frames.length }
    else loose = { name, depth: frames.length }
  }

  function innermostCall(): Frame | null {
    for (let at = frames.length - 1; at >= 0; at -= 1) {
      const frame = frames[at]
      if (frame?.open === '(') return frame
    }
    return null
  }
}

function followsMarkup(code: string, at: number): boolean {
  const char = code.charAt(previousSignificant(code, at))
  return char === '}' || char === '>'
}

// A comma inside type arguments sits at the declaration's depth too, since `<`
// opens no frame, so only `Name =` or `Name:` after it starts a declarator.
function startsDeclarator(code: string, from: number): boolean {
  const start = skipSpace(code, from)
  if (!isIdentStartAt(code, start)) return false
  const after = skipSpace(code, readIdentEnd(code, start))
  const char = code.charAt(after)
  if (char === ':') return true
  const next = code.charAt(after + 1)
  return char === '=' && next !== '=' && next !== '>'
}

// `var` and `const` are legal keys, `{ var: 1 }` and `as const,`, and neither
// is followed by the name or pattern a declaration binds.
function opensBinding(code: string, from: number): boolean {
  const start = skipSpace(code, from)
  const char = code.charAt(start)
  return char === '{' || char === '[' || isIdentStartAt(code, start)
}

function startsValue(code: string, at: number): boolean {
  const before = code.charAt(previousSignificant(code, at))
  return before === '=' || before === ':'
}

// `super()` and `return (x)` end their statement at a line break, so a brace on
// the next line opens a plain block. Only on the same line is the word a method
// name, as in `delete() {`.
function breaksLine(code: string, from: number): boolean {
  return /[\n\r]/u.test(code.slice(from, skipSpace(code, from)))
}

function continuesStatement(code: string, at: number): boolean {
  const before = previousSignificant(code, at)
  if (before === -1) return false
  const char = code.charAt(before)
  if (char === '>' && code.charAt(before - 1) === '=') return true
  return CONTINUES_STATEMENT.has(char)
}

// Only whitespace or a return type annotation stands between a parameter list and
// its body, so everything else stops here and a call chain costs nothing. An
// arrow is left to the arrow handler, which owns `=>` wherever it appears.
function bodyAfterParams(code: string, from: number, name: string, depth: number): Body | null {
  const at = skipSpace(code, from)
  if (code.charAt(at) === '{') return { at, name, depth }
  if (code.charAt(at) !== ':' || code.slice(from, at).includes('\n')) return null
  return braceAfterType(code, at + 1, name, depth)
}

// The annotation is walked rather than skipped, because in
// `useLabels(): { title: string } {` the first brace belongs to the type: a brace
// where the walk expects an operand opens an object type, and one where it
// already has an operand opens the body.
function braceAfterType(code: string, from: number, name: string, depth: number): Body | null {
  let index = from
  let expectOperand = true
  const limit = Math.min(code.length, from + ANNOTATION_CAP)
  while (index < limit) {
    const char = code.charAt(index)
    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
      index += 1
      continue
    }
    if (char === '{' && !expectOperand) return { at: index, name, depth }
    if (char === '{' || char === '(' || char === '[') {
      const close = matchingBracket(code, index, limit)
      if (close === null) return null
      index = close
      expectOperand = false
      continue
    }
    if (char === '=' && code.charAt(index + 1) === '>') {
      expectOperand = true
      index += 2
      continue
    }
    if (char === '|' || char === '&' || char === '<' || char === ',' || char === ':') {
      expectOperand = true
      index += 1
      continue
    }
    if (char === '>') {
      expectOperand = false
      index += 1
      continue
    }
    if (char === '.' || char === '?') {
      index += 1
      continue
    }
    if (isIdentStartAt(code, index)) {
      const end = readIdentEnd(code, index)
      const word = code.slice(index, end)
      if (STATEMENT_KEYWORDS.has(word) || DECLARATION_KEYWORDS.has(word)) return null
      expectOperand = TYPE_OPERATORS.has(word)
      index = end
      continue
    }
    if (isDigit(char)) {
      index = readNumberEnd(code, index)
      expectOperand = false
      continue
    }
    return null
  }
  return null
}

function matchingBracket(code: string, from: number, limit: number): number | null {
  const open = code.charAt(from)
  const close = open === '{' ? '}' : open === '(' ? ')' : ']'
  let depth = 0
  let index = from
  while (index < limit) {
    const char = code.charAt(index)
    if (char === open) depth += 1
    else if (char === close) {
      depth -= 1
      if (depth === 0) return index + 1
    }
    index += 1
  }
  return null
}

function siteAt(
  id: string,
  offset: number,
  lineStarts: readonly number[],
  frames: readonly Frame[],
  loose: Named | null,
  input: { readonly source: string; readonly file: string },
  snippets: Map<number, string>,
): FoundSite {
  const at = positionOf(lineStarts, offset)
  // Every site on a line shares one snippet, and building it walks the whole
  // line, so a minified line of n usages would otherwise cost n squared.
  let snippet = snippets.get(at.lineStart)
  if (snippet === undefined) {
    snippet = snippetOf(input.source, at.lineStart, at.lineEnd)
    snippets.set(at.lineStart, snippet)
  }
  return {
    id,
    file: input.file,
    line: at.line,
    column: at.column,
    scope: scopeOf(frames, loose),
    snippet,
  }
}

function scopeOf(frames: readonly Frame[], loose: Named | null): string | null {
  for (let at = frames.length - 1; at >= 0; at -= 1) {
    const scope = frames[at]?.scope
    if (scope !== null && scope !== undefined) {
      return loose !== null && loose.depth > at ? loose.name : scope
    }
  }
  return loose?.name ?? null
}

function resolveAccess(
  word: string,
  end: number,
  code: string,
  bindings: Bindings,
  ids: ReadonlySet<string>,
): Access | null {
  if (bindings.namespaces.has(word)) {
    const accessor = accessorAt(code, end)
    // Computed access on a plain namespace is a documented limit of the scan.
    if (accessor.kind !== '.') return null
    const memberStart = skipSpace(code, accessor.next)
    if (!isIdentStartAt(code, memberStart)) return null
    const memberEnd = readIdentEnd(code, memberStart)
    const member = code.slice(memberStart, memberEnd)
    if (ids.has(member)) return { ids: [member], end: memberEnd }
    const group = bindings.groupsById.get(member)
    if (group !== undefined) return resolveGroupAccess(group, memberEnd, code)
    return { ids: [], end: memberEnd }
  }

  const message = bindings.messages.get(word)
  if (message !== undefined) {
    return code.charAt(skipSpace(code, end)) === '(' ? { ids: [message], end } : null
  }

  const group = bindings.groups.get(word)
  return group === undefined ? null : resolveGroupAccess(group, end, code)
}

function resolveGroupAccess(group: ScanGroup, at: number, code: string): Access {
  const accessor = accessorAt(code, at)
  if (accessor.kind === '[') return { ids: group.memberIds, end: accessor.next }
  if (accessor.kind === 'none') return { ids: [], end: at }
  const propStart = skipSpace(code, accessor.next)
  if (!isIdentStartAt(code, propStart)) return { ids: [], end: at }
  const propEnd = readIdentEnd(code, propStart)
  const prop = code.slice(propStart, propEnd)
  // Own properties only: `errors.hasOwnProperty(code)` would otherwise resolve to
  // a function off Object.prototype and travel on as a MessageUsage.id.
  const id = Object.hasOwn(group.memberProps, prop) ? group.memberProps[prop] : undefined
  return { ids: id === undefined ? [] : [id], end: propEnd }
}

function accessorAt(code: string, from: number): Accessor {
  let at = skipSpace(code, from)
  let optional = false
  if (code.charAt(at) === '?' && code.charAt(at + 1) === '.') {
    at = skipSpace(code, at + 2)
    optional = true
  }
  const char = code.charAt(at)
  if (char === '[') return { kind: '[', next: at + 1 }
  if (char === '.') return { kind: '.', next: at + 1 }
  return optional ? { kind: '.', next: at } : { kind: 'none', next: at }
}

function scopeNameOf(word: string | null): string | null {
  return word === null || NOT_A_SCOPE_NAME.has(word) ? null : word
}

function skipSpace(code: string, from: number): number {
  let at = from
  while (at < code.length) {
    const char = code.charAt(at)
    if (char !== ' ' && char !== '\t' && char !== '\n' && char !== '\r') return at
    at += 1
  }
  return at
}

function lineStartsOf(text: string): readonly number[] {
  const starts: number[] = [0]
  for (const match of text.matchAll(LINE_BREAK)) starts.push(match.index + match[0].length)
  return starts
}

function positionOf(
  lineStarts: readonly number[],
  offset: number,
): {
  readonly line: number
  readonly column: number
  readonly lineStart: number
  readonly lineEnd: number | undefined
} {
  let low = 0
  let high = lineStarts.length - 1
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if ((lineStarts[mid] ?? 0) <= offset) low = mid
    else high = mid - 1
  }
  const lineStart = lineStarts[low] ?? 0
  return { line: low + 1, column: offset - lineStart + 1, lineStart, lineEnd: lineStarts[low + 1] }
}

// The slice runs to the next line's start, and trim drops the break that ends it.
function snippetOf(source: string, lineStart: number, lineEnd: number | undefined): string {
  const line = source.slice(lineStart, lineEnd).trim()
  return line.length <= SNIPPET_CAP ? line : Array.from(line).slice(0, SNIPPET_CAP).join('')
}
