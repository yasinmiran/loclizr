import { diag } from '../../diagnostics'
import type { LowerContext, LowerResult } from '../../icu'
import type { Arg, ArgType, Diagnostic, Node } from '../../types'

// A stand-in for M3 covering the grammar these tests need: literal text,
// `{name}`, `{name, number}`, `{name, date}` and `<tag>...</tag>`. Anything
// else fails the way a real parse error does, which is how a test asks for a
// value that cannot be lowered.

export const calls: LowerContext[] = []

export function resetCalls(): void {
  calls.length = 0
}

export function lower(icu: string, context: LowerContext): LowerResult {
  calls.push(context)
  let nodes: readonly Node[] = []
  try {
    nodes = parseNodes(new Scanner(icu), null)
  } catch {
    return {
      nodes: [],
      args: [],
      markupTags: [],
      kind: 'text',
      normalized: '',
      diagnostics: [
        diag('icu-syntax', {
          message: `The value of "${context.key}" is not valid ICU MessageFormat.`,
          key: context.key,
          locale: context.locale,
          file: context.file,
          span: context.span,
        }),
      ],
    }
  }
  const collected = collectArgs(nodes, context)
  return {
    nodes: collected.failed ? [] : nodes,
    args: collected.failed ? [] : collected.args,
    markupTags: collected.failed ? [] : collectTags(nodes),
    kind: collected.failed || !hasMarkup(nodes) ? 'text' : 'markup',
    normalized: collected.failed ? '' : printNodes(nodes),
    diagnostics: collected.diagnostics,
  }
}

export function unify(a: ArgType, b: ArgType): ArgType | null {
  if (a.kind === 'stringish') return b
  if (b.kind === 'stringish') return a
  if (a.kind !== b.kind) return null
  return a
}

export function printIcu(nodes: readonly Node[]): string {
  return printNodes(nodes)
}

class Scanner {
  position = 0

  constructor(readonly text: string) {}

  get done(): boolean {
    return this.position >= this.text.length
  }

  peek(): string {
    return this.text[this.position] ?? ''
  }

  take(): string {
    const char = this.peek()
    this.position += 1
    return char
  }

  until(stop: string): string {
    const at = this.text.indexOf(stop, this.position)
    if (at === -1) throw new Error('unterminated')
    const slice = this.text.slice(this.position, at)
    this.position = at + stop.length
    return slice
  }
}

function parseNodes(scanner: Scanner, openTag: string | null): readonly Node[] {
  const nodes: Node[] = []
  let text = ''
  const flush = (): void => {
    if (text === '') return
    nodes.push({ kind: 'text', value: text })
    text = ''
  }
  while (!scanner.done) {
    const char = scanner.peek()
    if (char === '{') {
      scanner.take()
      flush()
      nodes.push(parseArgument(scanner.until('}')))
      continue
    }
    if (char === '}') throw new Error('unbalanced')
    if (char === '<') {
      if (scanner.text.startsWith('</', scanner.position)) {
        scanner.position += 2
        const close = scanner.until('>')
        if (close !== openTag) throw new Error('mismatched tag')
        flush()
        return nodes
      }
      scanner.take()
      const name = scanner.until('>')
      flush()
      nodes.push({ kind: 'markup', name, children: parseNodes(scanner, name) })
      continue
    }
    text += scanner.take()
  }
  if (openTag !== null) throw new Error('unclosed tag')
  flush()
  return nodes
}

function parseArgument(body: string): Node {
  const parts = body.split(',').map((part) => part.trim())
  const [name, type] = parts
  if (name === undefined || name === '') throw new Error('empty argument')
  if (parts.length === 1) return { kind: 'arg', name }
  if (parts.length === 2 && type === 'number') {
    return { kind: 'number', name, style: null, format: { kind: 'number', options: {} } }
  }
  if (parts.length === 2 && type === 'date') {
    return {
      kind: 'dateTime',
      name,
      form: 'date',
      style: null,
      format: { kind: 'dateTime', options: { dateStyle: 'medium' } },
    }
  }
  throw new Error('unsupported argument')
}

function collectArgs(
  nodes: readonly Node[],
  context: LowerContext,
): {
  readonly args: readonly Arg[]
  readonly diagnostics: readonly Diagnostic[]
  readonly failed: boolean
} {
  const args: Arg[] = []
  const diagnostics: Diagnostic[] = []
  let failed = false
  for (const found of walkArgs(nodes)) {
    const existing = args.findIndex((arg) => arg.name === found.name)
    if (existing === -1) {
      args.push(found)
      continue
    }
    const merged = unify(args[existing]?.type ?? found.type, found.type)
    if (merged === null) {
      failed = true
      diagnostics.push(
        diag('arg-type-conflict-local', {
          message: `The argument "${found.name}" is used at two irreconcilable types in "${context.key}".`,
          key: context.key,
          locale: context.locale,
          file: context.file,
          span: context.span,
        }),
      )
      continue
    }
    args[existing] = { name: found.name, type: merged }
  }
  return { args, diagnostics, failed }
}

function* walkArgs(nodes: readonly Node[]): Generator<Arg> {
  for (const node of nodes) {
    if (node.kind === 'arg') yield { name: node.name, type: { kind: 'stringish' } }
    if (node.kind === 'number') yield { name: node.name, type: { kind: 'number' } }
    if (node.kind === 'dateTime') yield { name: node.name, type: { kind: 'date' } }
    if (node.kind === 'markup') {
      yield { name: node.name, type: { kind: 'markup' } }
      yield* walkArgs(node.children)
    }
  }
}

function collectTags(nodes: readonly Node[]): readonly string[] {
  const tags: string[] = []
  for (const node of nodes) {
    if (node.kind !== 'markup') continue
    if (!tags.includes(node.name)) tags.push(node.name)
    for (const tag of collectTags(node.children)) {
      if (!tags.includes(tag)) tags.push(tag)
    }
  }
  return tags
}

function hasMarkup(nodes: readonly Node[]): boolean {
  return nodes.some((node) => node.kind === 'markup')
}

function printNodes(nodes: readonly Node[]): string {
  let out = ''
  for (const node of nodes) {
    if (node.kind === 'text') out += node.value
    if (node.kind === 'arg') out += `{${node.name}}`
    if (node.kind === 'number') out += `{${node.name}, number}`
    if (node.kind === 'dateTime') out += `{${node.name}, ${node.form}}`
    if (node.kind === 'markup') out += `<${node.name}>${printNodes(node.children)}</${node.name}>`
  }
  return out
}
