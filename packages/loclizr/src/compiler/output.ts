import type { Dirent } from 'node:fs'
import {
  access,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { diag } from '../diagnostics'
import { HEADER } from '../emit/shared'
import type { Diagnostic, EmittedFile } from '../types'
import { compareCodepoint } from '../util'
import { recordsAgree } from './record-gate'

// The token emit prints and the token the prune keys on are one constant with
// one author: two literals that drift turn every generated file foreign.
export const GENERATED_HEADER: string = HEADER

const GITIGNORE = '.gitignore'

// A concurrent build's in-flight temporary carries the generated header, so
// without this the two documented dev-loop invocations prune each other.
const TEMPORARY = /\.loclizr[0-9a-z]+\.tmp$/u

export interface RecordOutput {
  readonly path: string
  readonly bytes: string
}

export interface OutputInput {
  readonly mode: 'build' | 'check'
  readonly root: string
  readonly outDir: string
  readonly files: readonly EmittedFile[]
  readonly record: RecordOutput | null
}

export interface OutputResult {
  readonly written: readonly string[]
  readonly diagnostics: readonly Diagnostic[]
}

interface Run {
  // The root every path is measured against, resolved through the filesystem.
  readonly realRoot: string
  // Taken before any write: `.gitignore` is not guaranteed to be emitted first,
  // and writing any other file creates outDir.
  readonly freshOutDir: boolean
  // outDir holds its own .gitignore, so nobody is committing the generated tree.
  readonly selfIgnored: boolean
  readonly written: string[]
  readonly diagnostics: Diagnostic[]
  // Every path this run reached at its emitted location, as `dev:ino`. On a
  // case-insensitive filesystem a renamed namespace folds onto the dirent it
  // replaced, so the sweep would find a name it never emitted and delete the
  // file it just wrote. A lowercased name comparison would instead keep a real
  // orphan wherever the two names are two real files.
  readonly identities: Set<string>
}

let sequence = 0

export async function syncOutput(input: OutputInput): Promise<OutputResult> {
  const realRoot = await realOrLexical(input.root)
  if (await escapesRoot(realRoot, join(input.root, input.outDir))) {
    return {
      written: [],
      diagnostics: [outsideRoot(input.outDir, 'nothing under it was written or pruned')],
    }
  }
  const run: Run = {
    realRoot,
    freshOutDir: !(await exists(join(input.root, input.outDir))),
    selfIgnored: await exists(join(input.root, input.outDir, GITIGNORE)),
    written: [],
    diagnostics: [],
    identities: new Set(),
  }
  if (await syncFiles(input, run)) {
    await sweepOutDir(input, run)
    await syncRecord(input, run)
  }
  return { written: run.written, diagnostics: run.diagnostics }
}

// `outdir-unsafe` is decided lexically, on a path nothing resolves through the
// filesystem, so a committed `src/loclizr -> ..` link passes it while the
// prune's unlink lands wherever the link points. Both sides go through
// realpath: a macOS tmpdir under /var is itself a link to /private/var, so a
// real path compared against a lexical root would escape on every run there.
async function escapesRoot(realRoot: string, target: string): Promise<boolean> {
  const real = await realTarget(target)
  if (real === null) return true
  const inside = relative(realRoot, real)
  return inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)
}

// The longest existing prefix decides, because the tail this build is about to
// create cannot be a link yet. A dangling link is not that prefix: it resolves
// nowhere today and somewhere nobody chose tomorrow.
async function realTarget(target: string): Promise<string | null> {
  const missing: string[] = []
  let current = resolve(target)
  for (;;) {
    const real = await realOrNull(current)
    if (real !== null) return join(real, ...missing.toReversed())
    if (await isLink(current)) return null
    const parent = dirname(current)
    if (parent === current) return join(current, ...missing.toReversed())
    missing.push(basename(current))
    current = parent
  }
}

async function realOrNull(target: string): Promise<string | null> {
  try {
    return await realpath(target)
  } catch {
    return null
  }
}

async function realOrLexical(target: string): Promise<string> {
  return (await realOrNull(target)) ?? resolve(target)
}

async function isLink(target: string): Promise<boolean> {
  try {
    return (await lstat(target)).isSymbolicLink()
  } catch {
    return false
  }
}

async function syncFiles(input: OutputInput, run: Run): Promise<boolean> {
  for (const file of input.files) {
    if (file.path === GITIGNORE) {
      if (!(await syncGitignore(input, file, run))) return false
      continue
    }
    const path = posixJoin(input.outDir, file.path)
    const absolute = join(input.root, path)
    const existing = await readIfPresent(absolute)
    if (existing !== null) await remember(absolute, run)
    if (existing !== null && !isGenerated(existing)) {
      run.diagnostics.push(foreignFile(path, occupiedBy(input.mode)))
      continue
    }
    if (input.mode === 'check') {
      if (existing !== null && !unchanged(existing, file.contents)) {
        run.diagnostics.push(stale(path, run.selfIgnored))
      }
      continue
    }
    if (existing !== null && unchanged(existing, file.contents)) continue
    // The containment at the top bounds outDir itself. A link committed one
    // level down, `outDir/messages -> elsewhere`, leaves the same way: the
    // sweep refuses to follow it, and this is what stops the write.
    if (await escapesRoot(run.realRoot, dirname(absolute))) {
      run.diagnostics.push(outsideRoot(path, 'it was not written'))
      return false
    }
    if (!(await write(absolute, path, file.contents, run))) return false
    await remember(absolute, run)
    run.written.push(path)
  }
  return true
}

function occupiedBy(mode: 'build' | 'check'): string {
  return mode === 'check'
    ? 'so the generated file it occupies is not the one this build would write'
    : 'so the generated file it occupies was not written'
}

// The build writes this one only into an outDir it is creating, and never
// touches it again, so a team that deletes it to commit the generated tree
// keeps it deleted and owns whatever it puts there.
async function syncGitignore(input: OutputInput, file: EmittedFile, run: Run): Promise<boolean> {
  if (input.mode === 'check' || !run.freshOutDir) return true
  const path = posixJoin(input.outDir, file.path)
  const absolute = join(input.root, path)
  if (!(await write(absolute, path, file.contents, run))) return false
  run.written.push(path)
  return true
}

// An orphan that will not delete is an annoyance, not a reason to abandon the
// record step: the tree this build wrote is already complete and correct.
async function sweepOutDir(input: OutputInput, run: Run): Promise<void> {
  const outRoot = join(input.root, input.outDir)
  const emitted = new Set(input.files.map((file) => file.path))
  for (const found of await listFiles(outRoot)) {
    if (found === GITIGNORE || emitted.has(found) || TEMPORARY.test(found)) continue
    const path = posixJoin(input.outDir, found)
    const absolute = join(outRoot, found)
    if (await isSamePath(absolute, run)) continue
    const contents = await readIfPresent(absolute)
    if (contents === null || !isGenerated(contents)) {
      run.diagnostics.push(foreignFile(path, 'so it was neither overwritten nor pruned'))
      continue
    }
    if (input.mode === 'check') {
      run.diagnostics.push(orphaned(path, run.selfIgnored))
      continue
    }
    try {
      await unlink(absolute)
    } catch (error) {
      run.diagnostics.push(undeletable(path, error))
    }
  }
}

async function syncRecord(input: OutputInput, run: Run): Promise<void> {
  const record = input.record
  if (record === null) return
  const absolute = join(input.root, record.path)
  const committed = await readIfPresent(absolute)
  if (input.mode === 'check') {
    if (committed === null) run.diagnostics.push(recordMissing(record.path))
    else if (!recordsAgree(committed, record.bytes)) run.diagnostics.push(recordStale(record.path))
    return
  }
  if (committed !== null && !isRecordText(committed)) {
    run.diagnostics.push(notARecord(record.path))
    return
  }
  if (committed !== null && !recordsAgree(committed, record.bytes)) {
    run.diagnostics.push(recordRewritten(record.path))
  }
  if (committed !== null && unchanged(committed, record.bytes)) return
  if (!(await write(absolute, record.path, record.bytes, run))) return
  run.written.push(record.path)
}

async function write(absolute: string, path: string, contents: string, run: Run): Promise<boolean> {
  sequence += 1
  const temporary = `${absolute}.loclizr${process.pid.toString(36)}${sequence.toString(36)}.tmp`
  try {
    await mkdir(dirname(absolute), { recursive: true })
    await writeFile(temporary, contents, 'utf8')
    await rename(temporary, absolute)
    return true
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined)
    run.diagnostics.push(unwritable(path, error))
    return false
  }
}

async function listFiles(root: string): Promise<readonly string[]> {
  const found: string[] = []
  await walk(root, '', found)
  return found.sort(compareCodepoint)
}

// Only regular files are collected. A symlink is neither read nor deleted,
// because following one leads out of outDir and the header cannot prove we
// wrote whatever it points at.
async function walk(root: string, prefix: string, found: string[]): Promise<void> {
  let entries: readonly Dirent[]
  try {
    entries = await readdir(join(root, prefix), { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const path = posixJoin(prefix, entry.name)
    if (entry.isDirectory()) await walk(root, path, found)
    else if (entry.isFile()) found.push(path)
  }
}

async function readIfPresent(absolute: string): Promise<string | null> {
  try {
    return await readFile(absolute, 'utf8')
  } catch {
    return null
  }
}

async function remember(absolute: string, run: Run): Promise<void> {
  const key = await identityOf(absolute)
  if (key !== null) run.identities.add(key)
}

async function isSamePath(absolute: string, run: Run): Promise<boolean> {
  const key = await identityOf(absolute)
  return key !== null && run.identities.has(key)
}

// A filesystem that reports no inode number gives every file the same one, so
// an identity built from it would match everything and prune nothing.
async function identityOf(absolute: string): Promise<string | null> {
  try {
    const found = await stat(absolute)
    return found.ino === 0 ? null : `${found.dev}:${found.ino}`
  } catch {
    return null
  }
}

async function exists(absolute: string): Promise<boolean> {
  try {
    await access(absolute)
    return true
  } catch {
    return false
  }
}

function isGenerated(contents: string): boolean {
  return contents.startsWith(GENERATED_HEADER)
}

const CONFLICT_MARKER = /^<{7}(?: |$)/m

// The record path may point at a catalog, a tsconfig or a source file, and
// writing over one of those destroys work. So only text recognisable as a
// record is replaced: a schema 1 object, or one a merge left conflict markers
// in, which is how a conflicted record heals under LZ5007.
function isRecordText(contents: string): boolean {
  if (CONFLICT_MARKER.test(contents)) return true
  let parsed: unknown
  try {
    parsed = JSON.parse(contents.replace(/^\uFEFF/, ''))
  } catch {
    return false
  }
  return (
    typeof parsed === 'object' &&
    parsed !== null &&
    !Array.isArray(parsed) &&
    (parsed as Record<string, unknown>)['schema'] === 1
  )
}

// A lone surrogate in a catalog value cannot be encoded, so writeFile lands
// U+FFFD where emit produced half an emoji. Comparing the string emit produced
// against the text that comes back off disk would then rewrite the file on
// every build and report it stale forever.
function unchanged(existing: string, contents: string): boolean {
  return existing === contents || existing === Buffer.from(contents, 'utf8').toString('utf8')
}

function posixJoin(...parts: readonly string[]): string {
  return parts.filter((part) => part !== '').join('/')
}

function foreignFile(path: string, consequence: string): Diagnostic {
  return diag('outdir-foreign-file', {
    message: `\`${path}\` does not carry the generated header, ${consequence}.`,
    hint: 'the build deletes and overwrites only what it can prove it wrote. Move the file outside outDir, or delete it if it is a generated file whose header was stripped.',
    file: path,
  })
}

function undeletable(path: string, error: unknown): Diagnostic {
  return diag('outdir-foreign-file', {
    message: `\`${path}\` carries the generated header and this emit did not produce it, but it could not be deleted: ${reasonOf(error)}.`,
    hint: 'the generated tree is complete; this is a leftover the prune could not remove. Check the permissions on the directory holding it, or delete it by hand.',
    file: path,
  })
}

// outDir holding its own .gitignore means nobody is committing the tree, so
// advice about how to commit it is noise on every machine that has run a build.
function stale(path: string, selfIgnored: boolean): Diagnostic {
  return diag('output-stale', {
    message: `\`${path}\` differs from what this build would write.`,
    hint: selfIgnored
      ? 'the generated tree on disk is stale; run `loclizr build`.'
      : 'run `loclizr build` and commit the result.',
    file: path,
  })
}

function orphaned(path: string, selfIgnored: boolean): Diagnostic {
  return diag('output-stale', {
    message: `\`${path}\` is orphaned: it carries the generated header and this emit did not produce it.`,
    hint: selfIgnored
      ? 'run `loclizr build`, which prunes it.'
      : 'run `loclizr build`, which prunes it, and commit the result.',
    file: path,
  })
}

function outsideRoot(path: string, consequence: string): Diagnostic {
  return diag('output-unwritable', {
    message: `\`${path}\` resolves outside the project root, so ${consequence}.`,
    hint: 'every path the build writes stays inside the project root through symlinks as well as lexically, because the prune deletes generated files under outDir and the header alone cannot prove we wrote a file somewhere else. Replace the link with a real directory inside the project.',
    file: path,
  })
}

function recordStale(path: string): Diagnostic {
  return diag('record-stale', {
    message: `\`${path}\` no longer matches the catalogs: the contract this build derived differs from the committed record.`,
    hint: 'run `loclizr build` and commit the record with the string change.',
    file: path,
  })
}

function recordMissing(path: string): Diagnostic {
  return diag('record-stale', {
    message: `\`${path}\` does not exist, so the context record for these catalogs was never committed.`,
    hint: 'run `loclizr build` and commit the record beside the catalogs.',
    file: path,
  })
}

function recordRewritten(path: string): Diagnostic {
  return diag('record-rewritten', {
    message: `\`${path}\` was rewritten: the committed record's contract differs from the one these catalogs produce.`,
    hint: 'commit the rewritten record with the string change, so the context lands in the same pull request.',
    file: path,
  })
}

function notARecord(path: string): Diagnostic {
  return diag('output-unwritable', {
    message: `\`${path}\` is not a loclizr context record, so the record was not written over it.`,
    hint: 'the build overwrites only a file it can tell is a record. Point `record` at a path of its own, or delete the file if it is an old record you meant to replace.',
    file: path,
  })
}

function unwritable(path: string, error: unknown): Diagnostic {
  return diag('output-unwritable', {
    message: `\`${path}\` could not be written: ${reasonOf(error)}.`,
    hint: 'check that the path is writable and that nothing else holds it open.',
    file: path,
  })
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
