import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const runMock = vi.hoisted(() => vi.fn<(argv: readonly string[]) => Promise<number>>())

vi.mock('./index', () => ({ run: runMock }))

const originalArgv = process.argv

function flush(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve)
  })
}

beforeEach(() => {
  vi.resetModules()
  runMock.mockReset()
})

afterEach(() => {
  process.argv = originalArgv
  process.exitCode = undefined
  vi.restoreAllMocks()
})

async function stderrOfRejection(reason: unknown): Promise<string> {
  const write = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
  runMock.mockRejectedValue(reason)
  process.argv = ['node', 'bin.js', 'build']

  await import('./bin')
  await flush()

  return write.mock.calls.map((call) => String(call[0])).join('')
}

describe('bin, a rejection that is not an Error', () => {
  it('prints a rejected string after the prefix and exits 2', async () => {
    expect(await stderrOfRejection('disk on fire')).toBe('loclizr: disk on fire\n')
    expect(process.exitCode).toBe(2)
  })

  it('prints a rejected undefined rather than crashing', async () => {
    expect(await stderrOfRejection(undefined)).toBe('loclizr: undefined\n')
    expect(process.exitCode).toBe(2)
  })

  it('prints an Error message carrying unicode verbatim', async () => {
    expect(await stderrOfRejection(new Error('ファイル 🚫'))).toBe('loclizr: ファイル 🚫\n')
  })
})

describe('bin, argv', () => {
  it('passes an empty argv through as empty', async () => {
    runMock.mockResolvedValue(2)
    process.argv = ['node', 'bin.js']

    await import('./bin')
    await flush()

    expect(runMock).toHaveBeenCalledWith([])
  })

  it('passes arguments carrying spaces and unicode through untouched', async () => {
    runMock.mockResolvedValue(0)
    process.argv = ['node', 'bin.js', 'build', '--cwd', 'my app/приложение 🌍']

    await import('./bin')
    await flush()

    expect(runMock).toHaveBeenCalledWith(['build', '--cwd', 'my app/приложение 🌍'])
  })

  it('sets exitCode 0 on a clean run rather than leaving it unset', async () => {
    runMock.mockResolvedValue(0)
    process.argv = ['node', 'bin.js', 'check']

    await import('./bin')
    await flush()

    expect(process.exitCode).toBe(0)
  })
})
