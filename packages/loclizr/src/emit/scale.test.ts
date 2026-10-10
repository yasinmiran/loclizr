import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { IntlOptions, Message, Node } from '../types'
import { emit } from './index'
import { body, config, CURRENCY, message, PLAIN, program, translated } from './__fixtures__/program'

const RUNTIME = new URL('../index.ts', import.meta.url).href

function scaled(name: string, options: IntlOptions, multiplier: number): Node {
  return { kind: 'number', name, style: null, format: { kind: 'number', options, multiplier } }
}

function single(key: string, node: Node): Message {
  return message({
    key,
    source: '{n, number}',
    args: [{ name: 'n', type: { kind: 'number' } }],
    bodies: [body('en', [node])],
    origins: [translated('en')],
  })
}

describe('a number with a multiplier, executed', () => {
  let root = ''
  let generated: Record<string, (args: Record<string, unknown>, opts?: { locale?: string }) => unknown>

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'loclizr-scale-'))
    const emitted = emit(
      program({
        messages: [
          single('thousands', scaled('n', PLAIN, 1000)),
          single('dollars', scaled('n', CURRENCY, 1000)),
          single('hundredths', scaled('n', PLAIN, 0.01)),
        ],
        config: config({ locales: ['en'] }),
      }),
    )
    expect(emitted.diagnostics).toEqual([])
    await writeFile(join(root, 'package.json'), '{ "type": "module" }\n', 'utf8')
    for (const file of emitted.files) {
      const absolute = join(root, file.path)
      await mkdir(dirname(absolute), { recursive: true })
      await writeFile(absolute, file.contents.replaceAll("from 'loclizr'", `from '${RUNTIME}'`), 'utf8')
    }
    generated = (await import(pathToFileURL(join(root, 'messages/_root.js')).href)) as typeof generated
  })

  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  const render = (id: string, n: number): unknown => generated[id]?.({ n }, { locale: 'en' })

  test('multiplies the value before formatting it', () => {
    expect(render('thousands', 2)).toBe('2,000')
    expect(render('thousands', 0.25)).toBe('250')
  })

  test('scales a currency amount', () => {
    expect(render('dollars', 2)).toBe('$2,000.00')
  })

  test('scales by a fraction', () => {
    expect(render('hundredths', 500)).toBe('5')
  })
})
