import type { ScanGroup } from './index'
import type { Scrubbed } from './scrub'

export interface Bindings {
  readonly namespaces: ReadonlySet<string>
  readonly messages: ReadonlyMap<string, string>
  readonly groups: ReadonlyMap<string, ScanGroup>
  readonly groupsById: ReadonlyMap<string, ScanGroup>
  // True as soon as one specifier resolved into the generated tree, whether or
  // not it bound anything callable. LZ5004 asks whether the glob reached the
  // sources, so a switcher importing only `locales`, a barrel re-export and a
  // side-effect import all answer it.
  readonly importedGenerated: boolean
}

// The clause cannot open on whitespace, so it can never re-consume what the
// leading `\s+` took. Without that bound the two overlap and a keyword followed
// by a long whitespace run, which is what a blanked banner comment leaves
// behind, costs one pass per split of the run. Nor can the clause run past the
// next keyword, where the next attempt starts, or a file of unterminated
// `import x` costs one pass to the end per keyword. That keyword is bounded by
// identifier characters rather than `\b`, which would find it inside `$import`.
// `import{a}from'x'` needs no whitespace at all, so `{` and `*` may follow the
// keyword directly.
const IMPORT =
  /\bimport(?:\s+(?![('"`])|(?=[{*]))([^\s'"`;](?:(?!(?<![\p{ID_Continue}$])import(?![\p{ID_Continue}$]))[^'"`;])*?)?\bfrom\b\s*(['"])([^'"\n]*)\2/gu
// A re-export reaches the generated tree without binding anything callable here,
// which keeps "renamed re-exports are not followed" true while LZ5004 stops
// blaming the glob for a barrel.
const REEXPORT =
  /\bexport(?:\s+(?![('"`])|(?=[{*]))(?:[^\s'"`;](?:(?!(?<![\p{ID_Continue}$])export(?![\p{ID_Continue}$]))[^'"`;])*?)?\bfrom\b\s*(['"])([^'"\n]*)\1/gu
const SIDE_EFFECT = /\bimport\s*(['"])([^'"\n]*)\1/gu
const NAMESPACE = /\*\s*as\s+([\p{ID_Start}$_][\p{ID_Continue}$]*)/u
// A named block never nests, so it cannot hold a `{` either, which keeps a run of
// unclosed braces to one pass rather than one pass per brace.
const NAMED_BLOCK = /\{([^{}]*)\}/u
const NAMED_ENTRY =
  /^\s*(?:type\s+)?([\p{ID_Start}$_][\p{ID_Continue}$]*)(?:\s+as\s+([\p{ID_Start}$_][\p{ID_Continue}$]*))?\s*$/u
const TYPE_ONLY = /^type\b/u
const TRAILING_SLASHES = /\/+$/u

export function bindImports(input: {
  readonly scrubbed: Scrubbed
  readonly outDir: string
  readonly ids: ReadonlySet<string>
  readonly groups: readonly ScanGroup[]
}): Bindings {
  const text = input.scrubbed.withoutComments
  const namespaces = new Set<string>()
  const messages = new Map<string, string>()
  const groups = new Map<string, ScanGroup>()
  const groupsById = new Map<string, ScanGroup>()
  for (const group of input.groups) groupsById.set(group.id, group)
  let importedGenerated = false
  for (const match of text.matchAll(IMPORT)) {
    if (!isCode(input.scrubbed, match.index, 'import')) continue
    if (!bindsGeneratedTree(match[3] ?? '', input.outDir)) continue
    importedGenerated = true
    const clause = (match[1] ?? '').trim()
    if (TYPE_ONLY.test(clause)) continue
    const namespace = NAMESPACE.exec(clause)?.[1]
    if (namespace !== undefined) namespaces.add(namespace)
    for (const entry of namedEntries(clause)) {
      if (input.ids.has(entry.imported)) {
        messages.set(entry.local, entry.imported)
        continue
      }
      const group = groupsById.get(entry.imported)
      if (group !== undefined) groups.set(entry.local, group)
    }
  }
  for (const [pattern, keyword] of [
    [REEXPORT, 'export'],
    [SIDE_EFFECT, 'import'],
  ] as const) {
    for (const match of text.matchAll(pattern)) {
      if (!isCode(input.scrubbed, match.index, keyword)) continue
      if (bindsGeneratedTree(match[2] ?? '', input.outDir)) importedGenerated = true
    }
  }
  return { namespaces, messages, groups, groupsById, importedGenerated }
}

// The clause is read off the text that still holds string contents, because the
// specifier lives in one. `codeOnly` blanks those contents in place, so a
// keyword still standing there is a statement rather than a quoted example.
function isCode(scrubbed: Scrubbed, at: number, keyword: string): boolean {
  return scrubbed.codeOnly.startsWith(keyword, at)
}

// Matching by suffix rather than by resolution is what makes `@/loclizr/messages`
// and `#app/loclizr/groups` bind with no tsconfig, vite config or imports map
// read. It errs toward false positives, and the `ids` set filters those out.
export function bindsGeneratedTree(specifier: string, outDir: string): boolean {
  const base = basenameOf(outDir)
  if (base === '') return false
  const bare = stripExtension(specifier)
  if (bare.endsWith(`${base}/messages`) || bare.endsWith(`${base}/groups`)) return true
  const cut = bare.lastIndexOf('/')
  return cut > 0 && bare.slice(0, cut).endsWith(`${base}/messages`)
}

export function basenameOf(dir: string): string {
  const trimmed = dir.replace(TRAILING_SLASHES, '')
  const cut = trimmed.lastIndexOf('/')
  return cut === -1 ? trimmed : trimmed.slice(cut + 1)
}

function stripExtension(specifier: string): string {
  const slash = specifier.lastIndexOf('/')
  const dot = specifier.lastIndexOf('.')
  return dot > slash + 1 ? specifier.slice(0, dot) : specifier
}

function namedEntries(
  clause: string,
): readonly { readonly imported: string; readonly local: string }[] {
  const block = NAMED_BLOCK.exec(clause)?.[1]
  if (block === undefined) return []
  const entries: { imported: string; local: string }[] = []
  for (const raw of block.split(',')) {
    const parsed = NAMED_ENTRY.exec(raw)
    const imported = parsed?.[1]
    if (imported === undefined) continue
    entries.push({ imported, local: parsed?.[2] ?? imported })
  }
  return entries
}
