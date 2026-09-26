import { describe, expect, test } from 'vitest'
import type { ScanGroup } from './index'
import { scanFile } from './index'

const IDS: ReadonlySet<string> = new Set([
  'errors_forbidden',
  'errors_not_found',
  'nav_home',
])

const GROUPS: readonly ScanGroup[] = [
  {
    id: 'errors',
    memberIds: ['errors_forbidden', 'errors_not_found'],
    memberProps: { forbidden: 'errors_forbidden', not_found: 'errors_not_found' },
  },
]

function sitesOf(source: readonly string[], file = 'src/App.ts') {
  const text = `${source.join('\n')}\n`
  return scanFile({ text, file, outDir: 'src/loclizr', ids: IDS, groups: GROUPS })
}

function idsOf(source: readonly string[], file = 'src/App.ts'): readonly string[] {
  return sitesOf(source, file).map((site) => site.id)
}

const INHERITED_PROPS: readonly string[] = [
  'toString',
  'valueOf',
  'constructor',
  'hasOwnProperty',
  'propertyIsEnumerable',
  '__proto__',
]

describe('a property no member maps to', () => {
  test.each(INHERITED_PROPS)('records nothing for a bound group read as .%s', (property) => {
    expect(idsOf(["import { errors } from './loclizr/groups'", `errors.${property}`])).toEqual([])
  })

  test.each(INHERITED_PROPS)('records nothing through a namespace read as .%s', (property) => {
    expect(idsOf(["import * as g from './loclizr/groups'", `g.errors.${property}()`])).toEqual([])
  })

  test('never reports an id that is not a string', () => {
    const sites = sitesOf([
      "import { errors } from './loclizr/groups'",
      'errors.toString()',
      'errors.constructor()',
      'errors.hasOwnProperty("forbidden")',
    ])
    expect(sites.map((site) => typeof site.id)).toEqual([])
  })
})

describe('the two access forms', () => {
  test('a static access across a line break still resolves one member', () => {
    expect(
      idsOf(["import { errors } from './loclizr/groups'", 'errors', '  .forbidden()']),
    ).toEqual(['errors_forbidden'])
  })

  test('a namespace member access across a line break still resolves', () => {
    expect(idsOf(["import * as m from './loclizr/messages'", 'm', '  .nav_home()'])).toEqual([
      'nav_home',
    ])
  })

  test('a computed access on a group reached through the barrel counts every member', () => {
    expect(
      idsOf(["import * as m from './loclizr/messages'", 'm.errors[code]({ seconds: 1 })']),
    ).toEqual(['errors_forbidden', 'errors_not_found'])
  })
})
