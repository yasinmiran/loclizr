import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { glob } from 'tinyglobby'
import { diag } from '../diagnostics'
import type { Config, Diagnostic, MessageUsage, UsageSite } from '../types'
import { compareCodepoint, toPosix } from '../util'
import { basenameOf, bindImports } from './imports'
import { scrub } from './scrub'
import { collectSites } from './sites'
import type { FoundSite } from './sites'

export interface ScanResult {
  readonly usages: readonly MessageUsage[]
  readonly diagnostics: readonly Diagnostic[]
}

export interface ScanGroup {
  readonly id: string
  readonly memberIds: readonly string[]
  readonly memberProps: Readonly<Record<string, string>>
}

interface FileScan {
  readonly sites: readonly FoundSite[]
  readonly importedGenerated: boolean
}

const JSX_EXTENSIONS: ReadonlySet<string> = new Set(['.jsx', '.tsx'])
const TRAILING_SLASHES = /\/+$/u

export async function scan(input: {
  readonly config: Config
  readonly ids: readonly string[]
  readonly groups: readonly ScanGroup[]
}): Promise<ScanResult> {
  const config = input.config
  const ids = new Set(input.ids)
  const files = await matchFiles(config)
  const sites: FoundSite[] = []
  let importedGenerated = false

  for (const file of files) {
    const text = await readText(join(config.root, file))
    if (text === null) continue
    const scanned = scanText({
      text,
      file,
      outDir: config.outDir,
      ids,
      groups: input.groups,
    })
    if (scanned.importedGenerated) importedGenerated = true
    sites.push(...scanned.sites)
  }

  return {
    usages: groupById(sites),
    diagnostics: report({
      ids,
      sites,
      fileCount: files.length,
      importedGenerated,
      outDir: config.outDir,
    }),
  }
}

// LZ5004 asks whether the files the scan matched reached the generated tree, so
// a scan that matched none has nothing to answer and stays silent. LZ5005 means
// nothing without at least one generated import, so it is suppressed either way.
function report(input: {
  readonly ids: ReadonlySet<string>
  readonly sites: readonly FoundSite[]
  readonly fileCount: number
  readonly importedGenerated: boolean
  readonly outDir: string
}): readonly Diagnostic[] {
  if (input.importedGenerated) {
    return unusedMessages(input.ids, new Set(input.sites.map((site) => site.id)))
  }
  return input.fileCount === 0 ? [] : [foundNothing(input.fileCount, input.outDir)]
}

export function scanFile(input: {
  readonly text: string
  readonly file: string
  readonly outDir: string
  readonly ids: ReadonlySet<string>
  readonly groups: readonly ScanGroup[]
}): readonly (UsageSite & { readonly id: string })[] {
  return scanText(input).sites
}

function scanText(input: {
  readonly text: string
  readonly file: string
  readonly outDir: string
  readonly ids: ReadonlySet<string>
  readonly groups: readonly ScanGroup[]
}): FileScan {
  const scrubbed = scrub(input.text, isJsx(input.file))
  const bindings = bindImports({
    scrubbed,
    outDir: input.outDir,
    ids: input.ids,
    groups: input.groups,
  })
  if (!bindings.importedGenerated) return { sites: [], importedGenerated: false }
  return {
    sites: collectSites({
      source: input.text,
      code: scrubbed.codeOnly,
      file: input.file,
      bindings,
      ids: input.ids,
    }),
    importedGenerated: true,
  }
}

async function matchFiles(config: Config): Promise<readonly string[]> {
  const outDir = config.outDir.replace(TRAILING_SLASHES, '')
  try {
    const found = await glob([...config.scan.include], {
      cwd: config.root,
      // Generated files reference their own identifiers, so outDir is excluded
      // whatever scan.exclude says.
      ignore: [...config.scan.exclude, `${outDir}/**`],
      absolute: false,
      onlyFiles: true,
      dot: false,
      expandDirectories: false,
    })
    return found.map(toPosix).sort(compareCodepoint)
  } catch {
    return []
  }
}

async function readText(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8')
  } catch {
    return null
  }
}

function isJsx(file: string): boolean {
  const dot = file.lastIndexOf('.')
  return dot !== -1 && JSX_EXTENSIONS.has(file.slice(dot).toLowerCase())
}

function groupById(sites: readonly FoundSite[]): readonly MessageUsage[] {
  const byId = new Map<string, UsageSite[]>()
  for (const found of sites) {
    const site: UsageSite = {
      file: found.file,
      line: found.line,
      column: found.column,
      scope: found.scope,
      snippet: found.snippet,
    }
    const existing = byId.get(found.id)
    if (existing === undefined) byId.set(found.id, [site])
    else existing.push(site)
  }
  return [...byId]
    .map(([id, sites_]) => ({ id, sites: sites_ }))
    .sort((a, b) => compareCodepoint(a.id, b.id))
}

function unusedMessages(
  ids: ReadonlySet<string>,
  seen: ReadonlySet<string>,
): readonly Diagnostic[] {
  return [...ids]
    .filter((id) => !seen.has(id))
    .sort(compareCodepoint)
    .map((id) =>
      diag('unused-message', {
        message: `No source file references the message \`${id}\`.`,
        hint: 'delete the key, or widen scan.include when the call site is outside it',
      }),
    )
}

function foundNothing(fileCount: number, outDir: string): Diagnostic {
  return diag('scan-found-nothing', {
    message: `The scan read ${fileCount} file${fileCount === 1 ? '' : 's'} and found no import of the generated messages.`,
    hint: `check scan.include in loclizr.config.ts. A usage site is found through an import such as import * as m from './${basenameOf(outDir)}/messages'`,
  })
}
