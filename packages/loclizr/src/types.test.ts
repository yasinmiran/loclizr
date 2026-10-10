import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, test } from 'vitest'

const TYPES = join(dirname(fileURLToPath(import.meta.url)), 'types')
const TYPESCRIPT = dirname(createRequire(import.meta.url).resolve('typescript/package.json'))
const TSC = join(TYPESCRIPT, 'bin/tsc')
const CURSOR = '/*|*/'

interface Position {
  readonly line: number
  readonly character: number
}

interface CompletionItem {
  readonly label: string
}

type Completions = readonly CompletionItem[] | { readonly items: readonly CompletionItem[] } | null

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

// Speaks just enough of the language server protocol to ask for completions
// at each cursor, which is what an editor shows someone typing a call.
async function completionsAt(source: string): Promise<readonly (readonly string[])[]> {
  const root = await mkdtemp(join(tmpdir(), 'loclizr-types-'))
  roots.push(root)
  const compilerOptions = {
    strict: true,
    exactOptionalPropertyTypes: true,
    module: 'esnext',
    moduleResolution: 'bundler',
    types: [],
  }
  await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions }), 'utf8')
  const positions: Position[] = []
  const lines = source.split('\n')
  lines.forEach((line, index) => {
    const character = line.indexOf(CURSOR)
    if (character >= 0) positions.push({ line: index, character })
  })
  const text = source.replaceAll(CURSOR, '')
  const file = join(root, 'app.ts')
  await writeFile(file, text, 'utf8')
  const uri = pathToFileURL(file).href

  const server = spawn(process.execPath, [TSC, '--lsp', '--stdio'], { cwd: root })
  try {
    const rpc = connect(server)
    const rootUri = pathToFileURL(root).href
    await rpc.request('initialize', { processId: process.pid, rootUri, capabilities: {} })
    rpc.notify('initialized', {})
    const textDocument = { uri, languageId: 'typescript', version: 1, text }
    rpc.notify('textDocument/didOpen', { textDocument })
    const labels: (readonly string[])[] = []
    for (const position of positions) {
      const params = { textDocument: { uri }, position }
      const result = (await rpc.request('textDocument/completion', params)) as Completions
      const items = result === null ? [] : 'items' in result ? result.items : result
      labels.push(items.map((item) => item.label))
    }
    await rpc.request('shutdown', null)
    rpc.notify('exit', null)
    return labels
  } finally {
    server.kill()
  }
}

function connect(server: ChildProcessWithoutNullStreams) {
  const pending = new Map<number, (result: unknown) => void>()
  let buffer = Buffer.alloc(0)
  let nextId = 1
  const send = (message: object): void => {
    const body = JSON.stringify({ jsonrpc: '2.0', ...message })
    server.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
  }
  server.stdout.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk])
    for (;;) {
      const head = buffer.indexOf('\r\n\r\n')
      if (head < 0) return
      const length = Number(/Content-Length: (\d+)/i.exec(buffer.subarray(0, head).toString())?.[1])
      if (buffer.length < head + 4 + length) return
      const message = JSON.parse(buffer.subarray(head + 4, head + 4 + length).toString()) as {
        id?: number
        method?: string
        result?: unknown
      }
      buffer = buffer.subarray(head + 4 + length)
      if (message.id === undefined) continue
      if (message.method !== undefined) send({ id: message.id, result: null })
      else pending.get(message.id)?.(message.result)
    }
  })
  return {
    request(method: string, params: unknown): Promise<unknown> {
      const id = nextId++
      return new Promise((resolve) => {
        pending.set(id, resolve)
        send({ id, method, params })
      })
    },
    notify(method: string, params: unknown): void {
      send({ method, params })
    },
  }
}

describe('EmptyArgs in an editor', () => {
  test('offers nothing inside the braces of a no-argument call', { timeout: 30_000 }, async () => {
    const [empty, counted] = await completionsAt(
      [
        `import type { EmptyArgs } from ${JSON.stringify(TYPES)}`,
        'declare function home(args?: EmptyArgs): string',
        'declare function items(args: { count: number }): string',
        `home({ ${CURSOR} })`,
        `items({ ${CURSOR} })`,
      ].join('\n'),
    )

    expect(counted).toEqual(['count'])
    expect(empty).toEqual([])
  })
})
