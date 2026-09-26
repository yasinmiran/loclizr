import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { BuildResult } from '../types'
import { build } from './index'

let root = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'loclizr-fatality-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function seed(path: string, value: unknown): Promise<void> {
  const absolute = join(root, path)
  await mkdir(dirname(absolute), { recursive: true })
  await writeFile(absolute, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function read(path: string): Promise<string | null> {
  try {
    return await readFile(join(root, path), 'utf8')
  } catch {
    return null
  }
}

function codes(result: BuildResult): readonly string[] {
  return result.diagnostics.map((diagnostic) => diagnostic.code)
}

function keys(result: BuildResult): readonly string[] {
  return (result.record?.messages ?? []).map((entry) => entry.key)
}

function paths(result: BuildResult): readonly string[] {
  return result.files.map((file) => file.path)
}

describe('a source message that failed to lower', () => {
  it('drops that one message and writes everything else', async () => {
    await seed('locales/en.json', {
      broken: { count: '{n, plural, one {one}}' },
      good: { home: 'Home' },
    })

    const result = await build({ cwd: root })

    expect(codes(result)).toContain('LZ2004')
    expect(keys(result)).toEqual(['good.home'])
    expect(paths(result)).not.toContain('messages/broken.js')
    expect(await read('src/loclizr/messages/good.js')).toContain('Home')
    expect(result.exitCode).toBe(1)
  })

  it('keeps an empty source string as a message that renders nothing', async () => {
    await seed('locales/en.json', { empty: { text: '' }, good: { home: 'Home' } })

    const result = await build({ cwd: root })
    const module = result.files.find((file) => file.path === 'messages/empty.js')

    expect(keys(result)).toEqual(['empty.text', 'good.home'])
    expect(result.record?.messages[0]?.source).toBe('')
    expect(module?.contents).toContain('empty_text')
    expect(codes(result)).not.toContain('LZ2001')
  })
})

describe('a target message that failed to lower', () => {
  it('renders the source body and reports only the syntax error', async () => {
    await seed('locales/en.json', { good: { home: 'Home' } })
    await seed('locales/de.json', { good: { home: '{n, plural, one {eins}}' } })

    const result = await build({ cwd: root })
    const home = result.record?.messages.find((entry) => entry.key === 'good.home')
    const arm = result.files.find((file) => file.path === 'messages/good.js')

    const crossLocale = result.diagnostics.filter((entry) => entry.code.startsWith('LZ3'))
    expect(codes(result).filter((code) => code === 'LZ2004')).toHaveLength(1)
    expect(crossLocale).toEqual([])
    expect(result.diagnostics.find((entry) => entry.code === 'LZ2004')?.locale).toBe('de')
    expect(home?.translations).toContainEqual({
      locale: 'de',
      status: 'fallback',
      from: 'en',
      reason: 'invalid',
    })
    expect(arm?.contents).not.toContain('eins')
    expect(arm?.contents).toContain('Home')
  })
})
