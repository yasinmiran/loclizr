import { describe, expect, it } from 'vitest'
import type { ScanGroup } from './index'
import { scanFile } from './index'
import { scrub } from './scrub'

const IDS: ReadonlySet<string> = new Set(['nav_home'])
const GROUPS: readonly ScanGroup[] = []
const IMPORT = "import * as m from './loclizr/messages'\n"
// Each shape below costs seconds when walked quadratically and milliseconds when linear.
const BOUND_MS = 1000
const SLOW = { timeout: 120_000 }

function timed(run: () => unknown): number {
  const start = performance.now()
  run()
  return performance.now() - start
}

function scan(text: string, file = 'src/a.ts') {
  return scanFile({ text, file, outDir: 'src/loclizr', ids: IDS, groups: GROUPS })
}

function blankedAt(code: string, source: string, needle: string): boolean {
  return code.charAt(source.lastIndexOf(needle)) === ' '
}

describe('scrub stays linear on a line of failed regular expressions', () => {
  it('reads a line of unclosed regex classes in linear time', SLOW, () => {
    const text = '(/['.repeat(60_000)
    expect(timed(() => scrub(text, false))).toBeLessThan(BOUND_MS)
  })

  it('does not let an escaped line break carry a failed regex onto the next line', SLOW, () => {
    const text = '(/[\\\n'.repeat(60_000)
    expect(timed(() => scrub(text, false))).toBeLessThan(BOUND_MS)
  })

  it('still reads a regex on the line after the budget ran out', () => {
    const source = `${'(/['.repeat(1000)}\nconst r = /x/\n`
    expect(blankedAt(scrub(source, false).codeOnly, source, 'x/')).toBe(true)
  })

  it('still reads a regex after a few failed ones on the same line', () => {
    const source = '(/[ (/[ (/x/\n'
    expect(blankedAt(scrub(source, false).codeOnly, source, 'x/')).toBe(true)
  })

  it.each([
    ['a block comment', ' /*\n*/'],
    ['a template', ' `\n`;'],
    ['a string continuation', " '\\\n';"],
  ])('starts a fresh budget on a line reached through %s', (_, span) => {
    const source = `${IMPORT}${'(/['.repeat(64)}${span} const r = /m.nav_home()/\n`
    expect(scan(source)).toEqual([])
  })

  it('keeps usages after a regex on a line reached through a block comment', () => {
    const source = `${IMPORT}${'(/['.repeat(64)} /*\n*/ const r = /\`/\nm.nav_home()\n`
    expect(scan(source).map((site) => site.line)).toEqual([4])
  })
})

describe('the JSX scrub stays linear on a line of unclosed template holes', () => {
  it('reads a line of unclosed holes in linear time', SLOW, () => {
    const text = '=`${'.repeat(60_000)
    expect(timed(() => scrub(text, true))).toBeLessThan(BOUND_MS)
  })

  it('still reads ordinary lines after the budget ran out', () => {
    const source = `${'=`${'.repeat(1000)}\nconst a = 'x'\n<p>Don't {m.nav_home()}</p>\n`
    const code = scrub(source, true).codeOnly
    expect(blankedAt(code, source, "x'")).toBe(true)
    expect(code.slice(source.indexOf('<p>'))).toBe("<p>Don't {m.nav_home()}</p>\n")
  })

  it('still reads a literal after a few failed ones on the same line', () => {
    const source = "=`${ =`${ = 'x'\n"
    expect(blankedAt(scrub(source, true).codeOnly, source, "x'")).toBe(true)
  })

  it('starts a fresh budget on a line reached through a block comment', () => {
    const source = `${IMPORT}${'=`${'.repeat(64)} /*\n*/ const a = 'm.nav_home()'\n`
    expect(scan(source, 'src/a.tsx')).toEqual([])
  })
})

describe('the site walk stays linear', () => {
  it('keeps a declaration open across many blank lines in linear time', SLOW, () => {
    const text = `${IMPORT}const x =${'\n'.repeat(150_000)}m.nav_home()\n`
    let sites: ReturnType<typeof scan> = []
    expect(timed(() => (sites = scan(text)))).toBeLessThan(BOUND_MS)
    expect(sites.map((site) => site.line)).toEqual([150_002])
  })

  it('ignores a run of unmatched closers in linear time', SLOW, () => {
    const text = `${IMPORT}${'('.repeat(80_000)}${']'.repeat(80_000)}`
    expect(timed(() => scan(text))).toBeLessThan(BOUND_MS)
  })

  it('finds the scope of sites under deep brackets in linear time', SLOW, () => {
    const text = `${IMPORT}${'[m.nav_home()'.repeat(80_000)}`
    let sites: ReturnType<typeof scan> = []
    expect(timed(() => (sites = scan(text)))).toBeLessThan(BOUND_MS)
    expect(sites).toHaveLength(80_000)
  })

  it('finds the enclosing call of arrows under deep brackets in linear time', SLOW, () => {
    const text = `${IMPORT}${'[() => 0'.repeat(80_000)}`
    expect(timed(() => scan(text))).toBeLessThan(BOUND_MS)
  })

  it('names the scope through brackets above it and drops it once they close', () => {
    const source = [
      IMPORT,
      'function Cart() {',
      '  f([{ a: () => [m.nav_home()] }])',
      '}',
      ')]}',
      'm.nav_home()',
      'const Row = () => [m.nav_home(), g(() => m.nav_home())]',
      '',
    ].join('\n')
    expect(scan(source).map((site) => site.scope)).toEqual(['Cart', null, 'Row', 'Row'])
  })
})
