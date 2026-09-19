import type { ScanGroup } from './index'

export interface Bindings {
  readonly namespaces: ReadonlySet<string>
  readonly messages: ReadonlyMap<string, string>
  readonly groups: ReadonlyMap<string, ScanGroup>
  readonly groupsById: ReadonlyMap<string, ScanGroup>
  // True as soon as one specifier resolved into the generated tree, whether or
  // not it bound anything callable. LZ5004 asks whether the glob reached the
  // sources, so a switcher importing only `locales` answers it.
  readonly importedGenerated: boolean
}

const IMPORT = /\bimport\s+(?![('"`])([^'"`;]*?)\bfrom\s*(['"])([^'"\n]*)\2/gu
const NAMESPACE = /\*\s*as\s+([\p{ID_Start}$_][\p{ID_Continue}$]*)/u
const NAMED_BLOCK = /\{([^}]*)\}/u
const NAMED_ENTRY =
  /^\s*(?:type\s+)?([\p{ID_Start}$_][\p{ID_Continue}$]*)(?:\s+as\s+([\p{ID_Start}$_][\p{ID_Continue}$]*))?\s*$/u
const TYPE_ONLY = /^type\b/u

export function bindImports(input: {
  readonly withoutComments: string
  readonly file: string
  readonly outDir: string
  readonly ids: ReadonlySet<string>
  readonly groups: readonly ScanGroup[]
}): Bindings {
  const namespaces = new Set<string>()
  const messages = new Map<string, string>()
  const groups = new Map<string, ScanGroup>()
  const groupsById = new Map<string, ScanGroup>()
  for (const group of input.groups) groupsById.set(group.id, group)
  let importedGenerated = false
  for (const match of input.withoutComments.matchAll(IMPORT)) {
    const specifier = match[3] ?? ''
    if (!resolvesToGenerated(specifier, input.file, input.outDir)) continue
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
  return { namespaces, messages, groups, groupsById, importedGenerated }
}

export function resolvesToGenerated(specifier: string, file: string, outDir: string): boolean {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return false
  const resolved = resolvePosix(dirnamePosix(file), specifier)
  const bare = resolved.endsWith('.js') ? resolved.slice(0, -'.js'.length) : resolved
  const base = outDir.replace(/\/+$/u, '')
  const prefix = base === '' || base === '.' ? '' : `${base}/`
  return (
    bare === `${prefix}messages` ||
    bare === `${prefix}groups` ||
    bare.startsWith(`${prefix}messages/`)
  )
}

function namedEntries(clause: string): readonly { readonly imported: string; readonly local: string }[] {
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

function dirnamePosix(file: string): string {
  const cut = file.lastIndexOf('/')
  return cut === -1 ? '' : file.slice(0, cut)
}

function resolvePosix(dir: string, specifier: string): string {
  const segments: string[] = []
  for (const segment of `${dir === '' ? '' : `${dir}/`}${specifier}`.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      segments.pop()
      continue
    }
    segments.push(segment)
  }
  return segments.join('/')
}
