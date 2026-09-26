import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { GENERATED_HEADER, syncOutput } from '../../src/compiler/output'
import type { EmittedFile } from '../../src/types'

const FILES: readonly EmittedFile[] = [
  { path: '.gitignore', contents: '*\n!.gitignore\n' },
  { path: 'messages/_locale.js', contents: `${GENERATED_HEADER}\nexport const locales = []\n` },
]

const OUTSIDE_FILE = `${GENERATED_HEADER}\n// a file the user owns, outside the project\n`

let base = ''
let project = ''
let outside = ''

beforeEach(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'loclizr-security-')))
  project = join(base, 'project')
  outside = join(base, 'outside')
  await mkdir(join(project, 'src'), { recursive: true })
  await mkdir(outside, { recursive: true })
  await writeFile(join(outside, 'victim.js'), OUTSIDE_FILE, 'utf8')
})

afterEach(async () => {
  await rm(base, { recursive: true, force: true })
})

// `outdir-unsafe` is checked on a lexically resolved path, and the prune step
// leans on that check for its second bound. A symlink is committable, so the
// containment has to survive one.
describe('outDir reached through a symlink', () => {
  beforeEach(async () => {
    await symlink(outside, join(project, 'src', 'loclizr'), 'dir')
  })

  test('deletes nothing outside the project root', async () => {
    await syncOutput({
      mode: 'build',
      root: project,
      outDir: 'src/loclizr',
      files: FILES,
      record: null,
    })
    expect(existsSync(join(outside, 'victim.js'))).toBe(true)
    expect(await readFile(join(outside, 'victim.js'), 'utf8')).toBe(OUTSIDE_FILE)
  })

  test('writes nothing outside the project root', async () => {
    await syncOutput({
      mode: 'build',
      root: project,
      outDir: 'src/loclizr',
      files: FILES,
      record: null,
    })
    expect(existsSync(join(outside, 'messages'))).toBe(false)
    expect(existsSync(join(outside, '.gitignore'))).toBe(false)
  })

  test('reports the refusal as an error rather than failing silently', async () => {
    const result = await syncOutput({
      mode: 'build',
      root: project,
      outDir: 'src/loclizr',
      files: FILES,
      record: null,
    })
    expect(result.written).toEqual([])
    expect(result.diagnostics.some((one) => one.severity === 'error')).toBe(true)
  })
})

// The refusal above must not be bought by weakening the prune, so the ordinary
// tree still writes and still sweeps its own orphans.
describe('outDir that is a real directory', () => {
  test('writes the tree and prunes a headered file this emit did not produce', async () => {
    const outDir = join(project, 'src', 'loclizr')
    await mkdir(outDir, { recursive: true })
    await writeFile(join(outDir, 'stale.js'), OUTSIDE_FILE, 'utf8')
    const result = await syncOutput({
      mode: 'build',
      root: project,
      outDir: 'src/loclizr',
      files: FILES,
      record: null,
    })
    expect(result.written).toContain('src/loclizr/messages/_locale.js')
    expect(existsSync(join(outDir, 'stale.js'))).toBe(false)
  })
})
