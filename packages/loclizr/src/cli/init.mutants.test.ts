import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runInit } from './init'

let root = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'loclizr-cli-init-mutants-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function write(relative: string, content: string): Promise<void> {
  const file = join(root, relative)
  await mkdir(join(file, '..'), { recursive: true })
  await writeFile(file, content, 'utf8')
}

describe('runInit, the ambiguous-source gate', () => {
  // The commented-out retrofit line carries the same text, so only a whole
  // line tells a hard gate from a suggestion.
  it('writes the gate live when no source catalog exists yet', async () => {
    await runInit({ cwd: root })
    const lines = (await readFile(join(root, 'loclizr.config.ts'), 'utf8')).split('\n')

    expect(lines).toContain("  severity: { 'ambiguous-source': 'error' },")
    expect(lines).not.toContain("  // severity: { 'ambiguous-source': 'error' },")
  })
})

describe('runInit, layouts it reports', () => {
  it('never offers an unnameable layout as a `catalogs` alternative', async () => {
    await write('locales/en.json', '{"a":"b"}')
    await write('app/(marketing)/locales/de.json', '{"a":"b"}')

    const result = await runInit({ cwd: root })
    const mentions = result.output
      .split('\n')
      .filter((line) => line.includes('app/(marketing)/locales/{locale}.json'))

    expect(mentions.length).toBeGreaterThan(0)
    for (const line of mentions) {
      expect(line).toContain('`catalogs` cannot name')
      expect(line).not.toContain('set `catalogs` yourself')
    }
  })
})
