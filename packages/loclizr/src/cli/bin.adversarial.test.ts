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

describe('bin', () => {
  it('hands run the argv past the node binary and the script', async () => {
    runMock.mockResolvedValue(0)
    process.argv = ['/usr/local/bin/node', '/app/dist/cli/bin.js', 'build', '--no-fail']

    await import('./bin')
    await flush()

    expect(runMock).toHaveBeenCalledWith(['build', '--no-fail'])
  })

  it('sets process.exitCode to what run resolved', async () => {
    runMock.mockResolvedValue(1)
    process.argv = ['node', 'bin.js', 'build']

    await import('./bin')
    await flush()

    expect(process.exitCode).toBe(1)
  })

  it('sets a 2 through rather than collapsing it', async () => {
    runMock.mockResolvedValue(2)
    process.argv = ['node', 'bin.js', 'check']

    await import('./bin')
    await flush()

    expect(process.exitCode).toBe(2)
  })

  it('never calls process.exit, which would cut a piped report short', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((): never => {
      throw new Error('bin called process.exit')
    })
    runMock.mockResolvedValue(1)
    process.argv = ['node', 'bin.js', 'build']

    await import('./bin')
    await flush()

    expect(exit).not.toHaveBeenCalled()
  })

  it('reports a rejection on stderr and exits 2', async () => {
    const write = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    runMock.mockRejectedValue(new Error('boom'))
    process.argv = ['node', 'bin.js', 'build']

    await import('./bin')
    await flush()

    expect(process.exitCode).toBe(2)
    expect(write.mock.calls.map((call) => String(call[0])).join('')).toContain('boom')
  })
})
