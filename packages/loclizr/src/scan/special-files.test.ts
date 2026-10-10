import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { testConfig } from './__fixtures__/config'
import { scan } from './index'

const USES_HOME = "import * as m from './loclizr/messages'\nexport const home = m.nav_home()\n"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe.skipIf(process.platform === 'win32')('a matched path that is not a regular file', () => {
  it('skips a symlink to a FIFO instead of blocking on it', { timeout: 2000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'loclizr-scan-fifo-'))
    roots.push(root)
    await mkdir(join(root, 'src'))
    await writeFile(join(root, 'src/app.ts'), USES_HOME, 'utf8')
    execFileSync('mkfifo', [join(root, 'pipe')])
    await symlink(join(root, 'pipe'), join(root, 'src/pipe.ts'))

    const result = await scan({ config: testConfig({ root }), ids: ['nav_home'], groups: [] })

    expect(result.usages.flatMap((usage) => usage.sites.map((site) => site.file))).toEqual([
      'src/app.ts',
    ])
  })
})
