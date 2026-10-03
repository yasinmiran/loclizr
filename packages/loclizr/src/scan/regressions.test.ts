import { describe, expect, it } from 'vitest'
import type { ScanGroup } from './index'
import { bindImports } from './imports'
import { scanFile } from './index'
import { scrub } from './scrub'

const IDS: ReadonlySet<string> = new Set(['nav_home', 'errors_a', 'errors_b'])

const GROUPS: readonly ScanGroup[] = [
  { id: 'errors', memberIds: ['errors_a', 'errors_b'], memberProps: { a: 'errors_a', b: 'errors_b' } },
]

const NAMESPACE = "import * as m from './loclizr/messages'"

function sitesOf(text: string, file = 'src/a.ts') {
  return scanFile({ text, file, outDir: 'src/loclizr', ids: IDS, groups: GROUPS })
}

function found(text: string, file = 'src/a.ts'): readonly (readonly [string, number, number, string | null])[] {
  return sitesOf(text, file).map((site) => [site.id, site.line, site.column, site.scope] as const)
}

describe('scan-spread', () => {
  it('records a namespace member written right after a spread', () => {
    expect(found(`${NAMESPACE}\nconst parts = [...m.nav_home()]\n`)).toEqual([['nav_home', 2, 19, null]])
  })

  it('records a group access written right after a spread', () => {
    expect(found("import { errors } from './loclizr/groups'\nf(...errors[k]())\n")).toEqual([
      ['errors_a', 2, 6, null],
      ['errors_b', 2, 6, null],
    ])
  })

  it('records a bound bare call and a JSX spread attribute after a spread', () => {
    expect(found("import { nav_home } from './loclizr/messages'\nf(...nav_home())\n")).toEqual([
      ['nav_home', 2, 6, null],
    ])
    expect(found(`${NAMESPACE}\nconst a = <A {...m.nav_home()} />\n`, 'src/a.tsx')).toEqual([
      ['nav_home', 2, 18, null],
    ])
  })
})

describe('scan-regex-after-incr', () => {
  it.each(['a++', 'a--', 'done!'])('reads a slash after %s as a division', (operand) => {
    expect(found(`${NAMESPACE}\nconst r = ${operand} / 2; m.nav_home(); const h = n / 2\n`)).toHaveLength(1)
    expect(found(`${NAMESPACE}\nconst r = ${operand} / 2; m.nav_home(); const h = n / 2\n`, 'src/a.js')).toHaveLength(1)
  })

  it('still reads a slash after != and after a prefix increment as before', () => {
    expect(found(`${NAMESPACE}\nconst r = a != /x m.nav_home() /.source\n`)).toEqual([])
    expect(found(`${NAMESPACE}\nconst r = ++a / 2; m.nav_home(); const h = n / 2\n`)).toHaveLength(1)
  })
})

describe('scan-snippet-quadratic', () => {
  it('records twenty thousand usages on one line well under a second', () => {
    const sites = sitesOf(`${NAMESPACE}\n${'m.nav_home();'.repeat(20_000)}\n`)
    expect(sites).toHaveLength(20_000)
    expect(sites[19_999]?.snippet).toBe('m.nav_home();'.repeat(13).slice(0, 160))
  }, 1000)
})

describe('scan-import-regex', () => {
  it('binds in linear time over a long run of unterminated import keywords', () => {
    expect(sitesOf(`${'import x '.repeat(20_000)}\n`)).toEqual([])
  }, 1000)

  it('binds in linear time over a long run of unterminated export keywords', () => {
    expect(sitesOf(`${'export x '.repeat(20_000)}\n`)).toEqual([])
  }, 1000)

  it('binds in linear time over a long run of unclosed braces in a clause', () => {
    const text = `import {${'{'.repeat(150_000)} from './loclizr/messages'\nm.nav_home()\n`
    expect(sitesOf(text)).toEqual([])
  }, 1000)
})

describe('scan-import-nospace', () => {
  it('binds a named import with no whitespace after the keyword', () => {
    expect(found("import{nav_home}from'./loclizr/messages'\nnav_home()\n")).toEqual([['nav_home', 2, 1, null]])
  })

  it('binds a namespace import with no whitespace after the keyword', () => {
    expect(found("import*as m from'./loclizr/messages'\nm.nav_home()\n")).toEqual([['nav_home', 2, 1, null]])
  })

  it.each(["export{x}from'./loclizr/messages'", "export*from'./loclizr/messages'"])(
    'counts the re-export %s as reaching the tree',
    (text) => {
      const bindings = bindImports({ scrubbed: scrub(text, false), outDir: 'src/loclizr', ids: IDS, groups: GROUPS })
      expect(bindings.importedGenerated).toBe(true)
    },
  )

  it('does not read an identifier that starts with import as the keyword', () => {
    const text = "const important = 1; important from './loclizr/messages'"
    const bindings = bindImports({ scrubbed: scrub(text, false), outDir: 'src/loclizr', ids: IDS, groups: GROUPS })
    expect(bindings.importedGenerated).toBe(false)
  })
})

describe('scan-lone-cr', () => {
  it.each([
    ['a lone CR', '\r'],
    ['U+2028', ' '],
    ['U+2029', ' '],
  ])('ends a line comment at %s', (_name, terminator) => {
    expect(found(`${NAMESPACE}\n// note${terminator}m.nav_home()\n`)).toEqual([['nav_home', 3, 1, null]])
  })

  it('reports lines, columns and the snippet of a CR-only file', () => {
    const sites = sitesOf(`${NAMESPACE}\rconst a = 1\r  m.nav_home()\r`)
    expect(sites.map((site) => [site.line, site.column, site.snippet])).toEqual([[3, 3, 'm.nav_home()']])
  })

  it('keeps positions after a CR inside a template literal', () => {
    expect(found(`${NAMESPACE}\nconst t = \`a\rb\`\nm.nav_home()\n`)).toEqual([['nav_home', 4, 1, null]])
  })

  it('still counts CRLF as one line break', () => {
    expect(found(`${NAMESPACE}\r\n// note\r\nm.nav_home()\r\n`)).toEqual([['nav_home', 3, 1, null]])
  })
})

describe('scan-second-declarator', () => {
  it('names a braceless arrow in the second declarator', () => {
    expect(found(`${NAMESPACE}\nconst a = 1, Cart = () => m.nav_home()\n`)).toEqual([['nav_home', 2, 27, 'Cart']])
  })

  it('names an arrow with a block body in the second declarator', () => {
    expect(found(`${NAMESPACE}\nlet a = 1, Cart = () => {\n  m.nav_home()\n}\n`)).toEqual([['nav_home', 3, 3, 'Cart']])
  })

  it('names a function expression in a declarator after a line break', () => {
    expect(found(`${NAMESPACE}\nconst a = 1,\n  Cart = function () {\n    m.nav_home()\n  }\n`)).toEqual([
      ['nav_home', 4, 5, 'Cart'],
    ])
  })

  it('does not take a type argument after a comma for a declarator', () => {
    expect(found(`${NAMESPACE}\nconst a: Map<string, number> = new Map(), b = () => m.nav_home()\n`)).toEqual([
      ['nav_home', 2, 53, 'b'],
    ])
  })

  it('does not name an assignment after a comma outside a declaration', () => {
    expect(found(`${NAMESPACE}\na = 1, Cart = () => m.nav_home()\n`)).toEqual([['nav_home', 2, 21, null]])
  })
})

describe('scan-method-names', () => {
  it.each(['delete', 'default', 'new', 'return'])('names a class method called %s', (name) => {
    expect(found(`${NAMESPACE}\nclass Store {\n  ${name}() {\n    return m.nav_home()\n  }\n}\n`)).toEqual([
      ['nav_home', 4, 12, name],
    ])
  })

  it('names an object literal method called delete', () => {
    expect(found(`${NAMESPACE}\nconst api = {\n  delete() {\n    return m.nav_home()\n  }\n}\n`)).toEqual([
      ['nav_home', 4, 12, 'delete'],
    ])
  })

  it('does not name a block after a statement head', () => {
    expect(found(`${NAMESPACE}\nfunction run() {\n  if (x) {\n    m.nav_home()\n  }\n}\n`)).toEqual([
      ['nav_home', 4, 5, 'run'],
    ])
  })
})

describe('scan-sfc', () => {
  it.each([
    ['src/App.svelte', `<script>\n${NAMESPACE}\n</script>\n<p>Don't forget {m.nav_home()}</p>\n`],
    ['src/App.vue', `<script setup>\n${NAMESPACE}\n</script>\n<template>\n<p>Don't forget {{ m.nav_home() }}</p>\n</template>\n`],
    ['src/App.astro', `---\n${NAMESPACE}\n---\n<p>Don't forget {m.nav_home()}</p>\n`],
  ])('keeps a usage after an apostrophe in template text in %s', (file, text) => {
    expect(sitesOf(text, file).map((site) => site.id)).toEqual(['nav_home'])
  })
})

describe('scan-regex-after-incr, a logical not after a closing paren', () => {
  it('reads a slash after `)!` as a regex opener', () => {
    expect(found(`${NAMESPACE}\nif (a)!/'/.test(s) && m.nav_home()\nm.nav_home()\n`)).toEqual([
      ['nav_home', 2, 23, null],
      ['nav_home', 3, 1, null],
    ])
    expect(found(`${NAMESPACE}\nif(a)!/'/.test(s);m.nav_home()\n`)).toHaveLength(1)
  })

  it('still reads a slash after an indexed non-null as a division', () => {
    expect(found(`${NAMESPACE}\nconst r = a[0]! / 2; m.nav_home(); const h = n / 2\n`)).toHaveLength(1)
  })
})

describe('scan-second-declarator, type parameters and keys', () => {
  it('does not take a type parameter default for a declarator', () => {
    for (const file of ['src/a.ts', 'src/a.tsx']) {
      expect(found(`${NAMESPACE}\nconst f = <T, U = string>(x: T) => m.nav_home()\n`, file)).toEqual([
        ['nav_home', 2, 36, null],
      ])
    }
    expect(found(`${NAMESPACE}\nconst f = <K extends string, V = unknown>(k: K) => {\n  m.nav_home()\n}\n`)).toEqual([
      ['nav_home', 3, 3, null],
    ])
    expect(found(`${NAMESPACE}\nconst f = <T extends Map<K, V>, U = X>() => 1, g = () => m.nav_home()\n`)).toEqual([
      ['nav_home', 2, 58, 'g'],
    ])
  })

  it('does not open a declaration at a key named var', () => {
    expect(found(`${NAMESPACE}\nconst api = { var: 1, render: () => m.nav_home() }\n`)).toEqual([
      ['nav_home', 2, 37, 'api'],
    ])
  })
})

describe('scan-import-regex, keywords inside identifiers', () => {
  it('binds a clause that holds $import', () => {
    expect(found("import { $import, nav_home } from './loclizr/messages'\nnav_home()\n")).toEqual([
      ['nav_home', 2, 1, null],
    ])
  })

  it('counts a re-export that holds $export as reaching the tree', () => {
    const text = "export { $export, nav_home } from './loclizr/messages'"
    const bindings = bindImports({ scrubbed: scrub(text, false), outDir: 'src/loclizr', ids: IDS, groups: GROUPS })
    expect(bindings.importedGenerated).toBe(true)
  })
})

describe('scan-method-names, statement words before a block', () => {
  it('does not name a block on the line after super()', () => {
    const text = `${NAMESPACE}\nclass S extends B {\n  constructor() {\n    super()\n    {\n      m.nav_home()\n    }\n  }\n}\n`
    expect(found(text)).toEqual([['nav_home', 6, 7, 'constructor']])
  })

  it('does not name a block on the line after return (x)', () => {
    const text = `${NAMESPACE}\nfunction run() {\n  return (x)\n  {\n    m.nav_home()\n  }\n}\n`
    expect(found(text)).toEqual([['nav_home', 5, 5, 'run']])
  })
})
