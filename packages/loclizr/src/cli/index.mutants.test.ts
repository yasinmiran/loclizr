import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { diag } from '../diagnostics'
import { reset } from './__fixtures__/compiler'
import { buildResult, summary } from './__fixtures__/results'
import { run } from './index'
import { io } from './io'

vi.mock('../compiler', () => import('./__fixtures__/compiler'))

const ANSI = '\u001b['

let out: string[] = []
const wasTty = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')

function stdoutIsTty(value: boolean): void {
  Object.defineProperty(process.stdout, 'isTTY', { value, configurable: true, writable: true })
}

beforeEach(() => {
  out = []
  vi.spyOn(io, 'out').mockImplementation((text) => {
    out.push(text)
  })
  vi.spyOn(io, 'err').mockImplementation(() => undefined)
  vi.stubEnv('NO_COLOR', '')
  reset(
    buildResult({
      exitCode: 2,
      ok: false,
      diagnostics: [
        diag('missing-translation', {
          message: 'de has no value for cart.items.',
          file: 'locales/de.json',
          locale: 'de',
          key: 'cart.items',
        }),
      ],
      summary: summary({ errors: 1, messages: 1, locales: 2 }),
    }),
  )
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  if (wasTty === undefined) Reflect.deleteProperty(process.stdout, 'isTTY')
  else Object.defineProperty(process.stdout, 'isTTY', wasTty)
})

// The docs promise colour only on a TTY: a report piped into a file or a CI
// log has to stay plain text.
describe('run, colour follows stdout', () => {
  it('prints no escape codes when stdout is not a TTY', async () => {
    stdoutIsTty(false)

    await run(['build'])

    expect(out.join('')).toContain('LZ3001')
    expect(out.join('')).not.toContain(ANSI)
  })

  it('colours the report when stdout is a TTY', async () => {
    stdoutIsTty(true)

    await run(['build'])

    expect(out.join('')).toContain(ANSI)
  })
})
