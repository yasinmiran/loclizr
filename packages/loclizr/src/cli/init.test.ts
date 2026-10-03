import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runInit } from './init'

let root = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'loclizr-cli-init-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function write(relative: string, content: string): Promise<void> {
  const file = join(root, relative)
  await mkdir(join(file, '..'), { recursive: true })
  await writeFile(file, content, 'utf8')
}

function read(relative: string): Promise<string> {
  return readFile(join(root, relative), 'utf8')
}

describe('runInit, greenfield', () => {
  it('writes the config and an ICU seed catalog', async () => {
    const result = await runInit({ cwd: root })

    expect(result.ok).toBe(true)
    expect(result.output).toContain('wrote loclizr.config.ts')
    expect(result.output).toContain('wrote locales/en.json')
    expect(await read('loclizr.config.ts')).toContain("import { defineConfig } from 'loclizr'")
  })

  it('seeds a catalog that classifies as ICU under auto', async () => {
    await runInit({ cwd: root })
    const seed: unknown = JSON.parse(await read('locales/en.json'))
    const values = leafValues(seed)
    const keys = leafKeys(seed)

    expect(values.length).toBeGreaterThan(0)
    expect(values.some((value) => value.includes('{{'))).toBe(false)
    expect(keys.some((key) => /_(?:zero|one|two|few|many|other)$/.test(key))).toBe(false)
    expect(values.some((value) => value.includes(', plural,'))).toBe(true)
  })

  it('turns ambiguous-source on, because the gate is free from the first commit', async () => {
    await runInit({ cwd: root })

    expect(await read('loclizr.config.ts')).toContain("severity: { 'ambiguous-source': 'error' },")
  })

  it('never writes a catalogFormat line', async () => {
    await runInit({ cwd: root })

    expect(await read('loclizr.config.ts')).not.toContain('catalogFormat')
  })

  it('counts an empty source catalog as greenfield and leaves it alone', async () => {
    await write('locales/en.json', '{}\n')

    const result = await runInit({ cwd: root })

    expect(await read('loclizr.config.ts')).toContain("severity: { 'ambiguous-source': 'error' },")
    expect(await read('locales/en.json')).toBe('{}\n')
    expect(result.output).toContain('locales/en.json already exists, left unchanged')
  })
})

describe('runInit, the source locale it declares', () => {
  it('takes it from the catalogs already on disk, not from en', async () => {
    await write('locales/de.json', JSON.stringify({ nav: { home: 'Startseite' } }))

    const result = await runInit({ cwd: root })

    expect(await read('loclizr.config.ts')).toContain("sourceLocale: 'de',")
    expect(result.output).not.toContain('locales/en.json')
    await expect(read('locales/en.json')).rejects.toThrow()
  })

  it('leaves the catalog it found byte identical', async () => {
    await write('locales/de.json', '{"nav":{"home":"Startseite"}}')

    await runInit({ cwd: root })

    expect(await read('locales/de.json')).toBe('{"nav":{"home":"Startseite"}}')
  })

  it('keeps en when an en catalog sits beside the others', async () => {
    await write('locales/de.json', '{}')
    await write('locales/en.json', '{}')

    await runInit({ cwd: root })

    expect(await read('loclizr.config.ts')).toContain("sourceLocale: 'en',")
  })

  it('takes the first by code point when several exist and none is en', async () => {
    await write('locales/fr.json', '{}')
    await write('locales/de.json', '{}')

    await runInit({ cwd: root })

    expect(await read('loclizr.config.ts')).toContain("sourceLocale: 'de',")
  })

  it('reads neither the meta sidecar nor the context record as a locale', async () => {
    await write('locales/de.json', '{}')
    await write('locales/de.meta.json', '{}')
    await write('locales/loclizr.context.json', '{}')

    await runInit({ cwd: root })

    expect(await read('loclizr.config.ts')).toContain("sourceLocale: 'de',")
  })

  it('falls back to en when the project has no catalogs at all', async () => {
    const result = await runInit({ cwd: root })

    expect(await read('loclizr.config.ts')).toContain("sourceLocale: 'en',")
    expect(result.output).toContain('wrote locales/en.json')
  })
})

describe('runInit, a layout other than the default', () => {
  async function splitTree(): Promise<void> {
    await write('public/locales/en/common.json', '{"nav":{"home":"Home"}}')
    await write('public/locales/en/checkout.json', '{"pay":"Pay"}')
    await write('public/locales/de/common.json', '{"nav":{"home":"Startseite"}}')
  }

  it('points catalogs at the split layout the project already uses', async () => {
    await splitTree()

    await runInit({ cwd: root })

    expect(await read('loclizr.config.ts')).toContain(
      "catalogs: 'public/locales/{locale}/{ns}.json',",
    )
  })

  it('writes no seed catalog beside a tree it did not lay out', async () => {
    await splitTree()

    const result = await runInit({ cwd: root })

    expect(result.output).toContain('no seed catalog written')
    await expect(read('locales/en.json')).rejects.toThrow()
  })

  it('names the pattern and the locales it inferred', async () => {
    await splitTree()

    const { output } = await runInit({ cwd: root })

    expect(output).toContain('found 2 locales at public/locales/{locale}/{ns}.json: de, en')
  })

  it('treats it as a retrofit, whatever those catalogs hold', async () => {
    await splitTree()

    await runInit({ cwd: root })

    expect(await read('loclizr.config.ts')).toContain(
      "// severity: { 'ambiguous-source': 'error' },",
    )
  })

  it('takes the source locale from the layout it found', async () => {
    await write('public/locales/de/common.json', '{"nav":{"home":"Startseite"}}')
    await write('public/locales/fr/common.json', '{"nav":{"home":"Accueil"}}')

    await runInit({ cwd: root })

    expect(await read('loclizr.config.ts')).toContain("sourceLocale: 'de',")
  })

  it('reads a namespace first tree as {ns}/{locale}, not as a locale named common', async () => {
    await write('locales/common/en.json', '{"nav":{"home":"Home"}}')
    await write('locales/common/de.json', '{"nav":{"home":"Startseite"}}')
    await write('locales/checkout/en.json', '{"pay":"Pay"}')

    await runInit({ cwd: root })
    const config = await read('loclizr.config.ts')

    expect(config).toContain("catalogs: 'locales/{ns}/{locale}.json',")
    expect(config).toContain("sourceLocale: 'en',")
  })

  it('keeps the default layout when one exists beside another, and names the other', async () => {
    await write('locales/en.json', '{"nav":{"home":"Home"}}')
    await write('public/locales/en/common.json', '{"nav":{"home":"Home"}}')

    const { output } = await runInit({ cwd: root })

    expect(await read('loclizr.config.ts')).toContain("catalogs: 'locales/{locale}.json',")
    expect(output).toContain('also found public/locales/{locale}/{ns}.json')
  })
})

describe('runInit, retrofit', () => {
  it('comments the ambiguous-source line out with a note', async () => {
    await write('locales/en.json', JSON.stringify({ nav: { home: 'Home' } }))

    await runInit({ cwd: root })
    const config = await read('loclizr.config.ts')

    expect(config).toContain("// severity: { 'ambiguous-source': 'error' },")
    expect(config).toContain('locales/en.meta.json')
    expect(config).not.toContain("\n  severity: { 'ambiguous-source': 'error' },")
  })

  it('treats a catalog it cannot parse as a retrofit, not as empty', async () => {
    await write('locales/en.json', '{ "nav": ')

    await runInit({ cwd: root })

    expect(await read('loclizr.config.ts')).toContain("// severity: { 'ambiguous-source': 'error' },")
  })

  it('leaves an existing catalog byte identical', async () => {
    await write('locales/en.json', '{"nav":{"home":"Home"}}')

    await runInit({ cwd: root })

    expect(await read('locales/en.json')).toBe('{"nav":{"home":"Home"}}')
  })
})

describe('runInit, augmentLocale', () => {
  it('stays on when no generated tree exists', async () => {
    await runInit({ cwd: root })

    expect(await read('loclizr.config.ts')).not.toContain('augmentLocale')
  })

  it('goes off when a generated tree exists in the workspace', async () => {
    await write(
      'packages/ui/src/loclizr/messages.js',
      '// @generated by loclizr abi=1. Do not edit; run `loclizr build`.\nexport {}\n',
    )

    await runInit({ cwd: root })

    expect(await read('loclizr.config.ts')).toContain('augmentLocale: false,')
  })

  it('ignores a messages.js that carries no generated header', async () => {
    await write('src/messages.js', 'export const messages = {}\n')

    await runInit({ cwd: root })

    expect(await read('loclizr.config.ts')).not.toContain('augmentLocale')
  })

  it('ignores the tree at the outDir this config declares, which is its own', async () => {
    await write(
      'src/loclizr/messages.js',
      '// @generated by loclizr abi=1. Do not edit; run `loclizr build`.\nexport {}\n',
    )

    await runInit({ cwd: root })

    expect(await read('loclizr.config.ts')).not.toContain('augmentLocale')
  })

  it('goes off for a sibling package tree, which --cwd alone never sees', async () => {
    await write('pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n")
    await write(
      'packages/ui/src/loclizr/messages.js',
      '// @generated by loclizr abi=1. Do not edit; run `loclizr build`.\nexport {}\n',
    )

    await runInit({ cwd: join(root, 'packages/app') })

    expect(await read('packages/app/loclizr.config.ts')).toContain('augmentLocale: false,')
  })

  it('stays on for its own outDir one level below the workspace root', async () => {
    await write('pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n")
    await write(
      'packages/app/src/loclizr/messages.js',
      '// @generated by loclizr abi=1. Do not edit; run `loclizr build`.\nexport {}\n',
    )

    await runInit({ cwd: join(root, 'packages/app') })

    expect(await read('packages/app/loclizr.config.ts')).not.toContain('augmentLocale')
  })

  it('ignores a generated tree inside node_modules', async () => {
    await write(
      'node_modules/other/loclizr/messages.js',
      '// @generated by loclizr abi=1. Do not edit; run `loclizr build`.\n',
    )

    await runInit({ cwd: root })

    expect(await read('loclizr.config.ts')).not.toContain('augmentLocale')
  })
})

describe('runInit, never overwrites', () => {
  it('leaves an existing loclizr.config.ts alone', async () => {
    await write('loclizr.config.ts', 'export default {}\n')

    const result = await runInit({ cwd: root })

    expect(await read('loclizr.config.ts')).toBe('export default {}\n')
    expect(result.output).toContain('loclizr.config.ts already exists, left unchanged')
    expect(result.ok).toBe(true)
  })

  it('refuses to shadow an existing loclizr.config.js and names it', async () => {
    await write('loclizr.config.js', 'export default {}\n')

    const result = await runInit({ cwd: root })

    expect(result.output).toContain('loclizr.config.js already exists, left unchanged')
    expect(result.output).not.toContain('loclizr.config.ts already exists')
    await expect(read('loclizr.config.ts')).rejects.toThrow()
  })

  it('seeds no catalog beside a config that already declares where they live', async () => {
    await write('loclizr.config.js', 'export default {}\n')

    const result = await runInit({ cwd: root })

    expect(result.ok).toBe(true)
    expect(result.output).toContain(
      'no seed catalog written, because loclizr.config.js already declares sourceLocale and catalogs',
    )
    await expect(read('locales/en.json')).rejects.toThrow()
  })
})

describe('runInit, printed wiring', () => {
  it('prints the three package.json scripts with --no-fail on the dev tree maker', async () => {
    const { output } = await runInit({ cwd: root })

    expect(output).toContain('"predev": "loclizr build --no-fail"')
    expect(output).toContain('"prebuild": "loclizr build"')
    expect(output).toContain('"pretypecheck": "loclizr build"')
  })

  it('prints no prepare hook, which would rewrite the record during a CI install', async () => {
    const { output } = await runInit({ cwd: root })

    expect(output).not.toContain('"prepare"')
    expect(output).toContain('before any step that runs loclizr build')
  })

  it('tells the reader to install loclizr as a regular dependency', async () => {
    const { output } = await runInit({ cwd: root })

    expect(output).toContain('npm i loclizr')
    expect(output).not.toContain('npm i -D loclizr')
  })

  it('keeps --no-fail off the two gate hooks', async () => {
    const { output } = await runInit({ cwd: root })

    expect(output).not.toContain('"prebuild": "loclizr build --no-fail"')
    expect(output).not.toContain('"pretypecheck": "loclizr build --no-fail"')
  })

  it('prints a CI snippet that runs check, not build', async () => {
    const { output } = await runInit({ cwd: root })

    expect(output).toContain('npx loclizr check')
    expect(output).not.toContain('run: npx loclizr build')
    expect(output).toContain('# loclizr check compares the committed context record')
  })

  it('edits no package.json', async () => {
    await write('package.json', '{"name":"app"}')

    await runInit({ cwd: root })

    expect(await read('package.json')).toBe('{"name":"app"}')
  })
})

describe('runInit, --config', () => {
  it('writes the config where it was pointed', async () => {
    const result = await runInit({ cwd: root, configPath: 'tools/loclizr.config.ts' })

    expect(result.ok).toBe(true)
    expect(await read('tools/loclizr.config.ts')).toContain('defineConfig')
  })

  it('leaves the file it was pointed at alone and seeds nothing beside it', async () => {
    await write('tools/loclizr.config.ts', 'export default {}\n')

    const result = await runInit({ cwd: root, configPath: 'tools/loclizr.config.ts' })

    expect(await read('tools/loclizr.config.ts')).toBe('export default {}\n')
    expect(result.output).toContain('tools/loclizr.config.ts already exists, left unchanged')
    expect(result.output).toContain('no seed catalog written')
    await expect(read('locales/en.json')).rejects.toThrow()
  })
})

describe('runInit, failure', () => {
  it('reports an unwritable target and skips the wiring', async () => {
    await write('locales', '')

    const result = await runInit({ cwd: root })

    expect(result.ok).toBe(false)
    expect(result.output).toContain('could not write locales/en.json')
    expect(result.output).not.toContain('"predev"')
  })
})

function leafValues(tree: unknown): readonly string[] {
  if (typeof tree === 'string') return [tree]
  if (tree === null || typeof tree !== 'object') return []
  return Object.values(tree).flatMap(leafValues)
}

function leafKeys(tree: unknown): readonly string[] {
  if (tree === null || typeof tree !== 'object') return []
  return Object.entries(tree).flatMap(([key, value]) => [key, ...leafKeys(value)])
}
