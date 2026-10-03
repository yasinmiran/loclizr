import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { discoverLayouts } from './discover'

let root = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'loclizr-cli-discover-edge-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function touch(...relatives: readonly string[]): Promise<void> {
  for (const relative of relatives) {
    const file = join(root, relative)
    await mkdir(join(file, '..'), { recursive: true })
    await writeFile(file, '{}', 'utf8')
  }
}

describe('nothing to find', () => {
  it('finds no layout in an empty directory', async () => {
    expect(await discoverLayouts(root)).toEqual([])
  })

  it('finds no layout under a root that does not exist', async () => {
    expect(await discoverLayouts(join(root, 'absent'))).toEqual([])
  })

  it('finds no layout in a catalog directory holding no json', async () => {
    await mkdir(join(root, 'locales'))
    await writeFile(join(root, 'locales', 'en.yaml'), 'a: b\n', 'utf8')

    expect(await discoverLayouts(root)).toEqual([])
  })
})

describe('where it looks', () => {
  it('finds a catalog directory nested deep below the root', async () => {
    await touch('apps/web/src/assets/i18n/de.json')

    expect(await discoverLayouts(root)).toEqual([
      { pattern: 'apps/web/src/assets/i18n/{locale}.json', locales: ['de'] },
    ])
  })

  it('accepts every catalog directory name it knows', async () => {
    for (const dir of ['locale', 'i18n', 'lang', 'messages', 'translations']) {
      await touch(`${dir}/fr.json`)
    }

    const patterns = (await discoverLayouts(root)).map((layout) => layout.pattern)

    expect(patterns).toEqual([
      'i18n/{locale}.json',
      'lang/{locale}.json',
      'locale/{locale}.json',
      'messages/{locale}.json',
      'translations/{locale}.json',
    ])
  })

  it('anchors on the innermost catalog directory', async () => {
    await touch('locales/i18n/de.json')

    expect(await discoverLayouts(root)).toEqual([
      { pattern: 'locales/i18n/{locale}.json', locales: ['de'] },
    ])
  })

  it('skips a hidden directory', async () => {
    await touch('.cache/locales/de.json')

    expect(await discoverLayouts(root)).toEqual([])
  })

  it('skips dist and build output', async () => {
    await touch('dist/locales/de.json', 'build/locales/fr.json', 'packages/a/dist/i18n/it.json')

    expect(await discoverLayouts(root)).toEqual([])
  })

  it('keeps a non ASCII base directory verbatim', async () => {
    await touch('приложение 🌍/locales/de.json')

    expect(await discoverLayouts(root)).toEqual([
      { pattern: 'приложение 🌍/locales/{locale}.json', locales: ['de'] },
    ])
  })
})

describe('which stems are locales', () => {
  it('accepts region, script and extension subtags', async () => {
    await touch(
      'locales/zh-Hant-TW.json',
      'locales/de-CH-1996.json',
      'locales/en-u-nu-latn.json',
      'locales/es-419.json',
    )

    expect(await discoverLayouts(root)).toEqual([
      {
        pattern: 'locales/{locale}.json',
        locales: ['de-CH-1996', 'en-u-nu-latn', 'es-419', 'zh-Hant-TW'],
      },
    ])
  })

  it('rejects stems that are not language tags', async () => {
    await touch(
      'locales/123.json',
      'locales/x-private.json',
      'locales/.json',
      'locales/en_US.json',
      'locales/en US.json',
      'locales/en-.json',
    )

    expect(await discoverLayouts(root)).toEqual([])
  })

  it('rejects a stem carrying a dot, so sidecars never read as locales', async () => {
    await touch('locales/en.meta.json', 'locales/loclizr.context.json', 'locales/de.backup.json')

    expect(await discoverLayouts(root)).toEqual([])
  })

  it('keeps a stem the way it is spelled on disk', async () => {
    await touch('locales/pt-br.json')

    expect(await discoverLayouts(root)).toEqual([
      { pattern: 'locales/{locale}.json', locales: ['pt-br'] },
    ])
  })
})

describe('split layouts', () => {
  it('reads a tree that fits both orders as locale first', async () => {
    await touch('locales/en/de.json')

    expect(await discoverLayouts(root)).toEqual([
      { pattern: 'locales/{locale}/{ns}.json', locales: ['en'] },
    ])
  })

  it('accepts an underscore namespace and rejects a dotted one', async () => {
    await touch('locales/en/my_ns.json', 'locales/de/common.meta.json')

    expect(await discoverLayouts(root)).toEqual([
      { pattern: 'locales/{locale}/{ns}.json', locales: ['en'] },
    ])
  })

  it('lists each locale once however many namespaces it has', async () => {
    await touch(
      'locales/en/common.json',
      'locales/en/checkout.json',
      'locales/en/auth.json',
      'locales/de/common.json',
    )

    expect(await discoverLayouts(root)).toEqual([
      { pattern: 'locales/{locale}/{ns}.json', locales: ['de', 'en'] },
    ])
  })

  it('reads a namespace first tree with a script subtag locale', async () => {
    await touch('i18n/common/zh-Hant.json', 'i18n/common/en.json')

    expect(await discoverLayouts(root)).toEqual([
      { pattern: 'i18n/{ns}/{locale}.json', locales: ['en', 'zh-Hant'] },
    ])
  })

  it('reads neither order when no segment is a language tag', async () => {
    await touch('locales/shared/common.json', 'locales/checkout/payment.json')

    expect(await discoverLayouts(root)).toEqual([])
  })
})

describe('ranking', () => {
  it('ranks the default layout first even when another holds more locales', async () => {
    await touch('locales/en.json', 'public/locales/en/a.json', 'public/locales/de/a.json')
    await touch('public/locales/fr/a.json')

    expect((await discoverLayouts(root)).map((layout) => layout.pattern)).toEqual([
      'locales/{locale}.json',
      'public/locales/{locale}/{ns}.json',
    ])
  })

  it('ranks the layout with more locales first among the rest', async () => {
    await touch('packages/a/locales/en.json', 'packages/b/locales/en.json', 'packages/b/locales/de.json')

    expect((await discoverLayouts(root)).map((layout) => layout.pattern)).toEqual([
      'packages/b/locales/{locale}.json',
      'packages/a/locales/{locale}.json',
    ])
  })

  it('breaks a tie by code point, so uppercase sorts first', async () => {
    await touch('b/locales/en.json', 'a/locales/en.json', 'Z/locales/en.json')

    expect((await discoverLayouts(root)).map((layout) => layout.pattern)).toEqual([
      'Z/locales/{locale}.json',
      'a/locales/{locale}.json',
      'b/locales/{locale}.json',
    ])
  })

  it('sorts locales by code point rather than by locale collation', async () => {
    await touch('locales/fr.json', 'locales/de-AT.json', 'locales/de.json', 'locales/DE-ch.json')

    expect((await discoverLayouts(root))[0]?.locales).toEqual(['DE-ch', 'de', 'de-AT', 'fr'])
  })

  it('answers the same on two calls over one tree', async () => {
    await touch(
      'locales/en.json',
      'apps/a/i18n/de/common.json',
      'apps/b/lang/common/fr.json',
      'apps/c/messages/it.json',
    )

    expect(await discoverLayouts(root)).toEqual(await discoverLayouts(root))
  })
})
