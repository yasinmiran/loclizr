import { diag } from '../diagnostics'
import type { Diagnostic, RawEntry, Span } from '../types'

export interface FlattenInput {
  readonly value: unknown
  readonly file: string
  readonly locale: string
  readonly ns: string | null
  readonly spans: ReadonlyMap<string, Span>
}

export interface FlattenResult {
  readonly entries: readonly RawEntry[]
  readonly diagnostics: readonly Diagnostic[]
}

const ROOT_SPAN: Span = { line: 1, column: 1, offset: 0, length: 0 }

interface Walk {
  readonly input: FlattenInput
  readonly entries: RawEntry[]
  readonly diagnostics: Diagnostic[]
  readonly positionOf: Map<string, number>
}

export function flatten(input: FlattenInput): FlattenResult {
  const walk: Walk = { input, entries: [], diagnostics: [], positionOf: new Map() }
  if (!isObject(input.value)) {
    walk.diagnostics.push(
      diag('catalog-shape-invalid', {
        message: `The catalog root is ${describe(input.value)}, not an object of keys.`,
        hint: 'a catalog is a JSON object whose leaves are message strings.',
        file: input.file,
        locale: input.locale,
        span: ROOT_SPAN,
      }),
    )
    return { entries: walk.entries, diagnostics: walk.diagnostics }
  }
  descend(walk, input.value, '')
  return { entries: walk.entries, diagnostics: walk.diagnostics }
}

function descend(walk: Walk, node: Record<string, unknown>, prefix: string): void {
  for (const name of Object.keys(node)) {
    const path = prefix === '' ? name : `${prefix}.${name}`
    const value = node[name]
    if (typeof value === 'string') {
      add(walk, path, value)
      continue
    }
    // A null leaf is an untranslated unit, which several TMS exports write. It
    // contributes no entry and reaches LZ3001 through the fallback chain.
    if (value === null) continue
    if (isObject(value)) {
      descend(walk, value, path)
      continue
    }
    walk.diagnostics.push(
      diag('catalog-shape-invalid', {
        message: `"${keyOf(walk, path)}" is ${describe(value)}, not a message string.`,
        hint: Array.isArray(value)
          ? 'give each item its own key. An array value needs format(), which is deferred past v0.1.'
          : 'quote the value, or write null for an untranslated unit.',
        file: walk.input.file,
        locale: walk.input.locale,
        key: keyOf(walk, path),
        span: spanOf(walk, path),
      }),
    )
  }
}

function add(walk: Walk, path: string, value: string): void {
  const key = keyOf(walk, path)
  const entry: RawEntry = { key, value, span: spanOf(walk, path) }
  const position = walk.positionOf.get(key)
  if (position === undefined) {
    walk.positionOf.set(key, walk.entries.length)
    walk.entries.push(entry)
    return
  }
  // JSON itself keeps the last of two colliding keys; readCatalogs reports the
  // collision from the scanner's duplicate list.
  walk.entries[position] = entry
}

function keyOf(walk: Walk, path: string): string {
  return walk.input.ns === null ? path : `${walk.input.ns}.${path}`
}

function spanOf(walk: Walk, path: string): Span {
  return walk.input.spans.get(path) ?? ROOT_SPAN
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function describe(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'an array'
  if (value === undefined) return 'missing'
  return `a ${typeof value}`
}
