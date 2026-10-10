import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import type { RuleName } from '../types'
import { RULES } from './index'

interface SpecRow {
  readonly code: string
  readonly name: string
  readonly severity: string
  readonly fatal: string
  readonly exitTwo: boolean
  readonly owner: string
}

const SPEC: string = readFileSync(new URL('../../../../docs/design/spec.md', import.meta.url), 'utf8')

const ROW = /^\|\s*(LZ\d{4})\s*\|\s*`([a-z0-9-]+)`\s*\|\s*(off|warn|error)\s*\|\s*([^|]+?)\s*\|\s*(M\d{1,2})\s*\|/

function slice(from: string, to: string): readonly string[] {
  const lines = SPEC.split('\n')
  const start = lines.findIndex((line) => line.startsWith(from))
  const end = lines.findIndex((line, index) => index > start && line.startsWith(to))
  if (start < 0 || end < 0) throw new Error(`no ${JSON.stringify(from)} block in the spec`)
  return lines.slice(start, end)
}

function ruleRows(): readonly SpecRow[] {
  const rows: SpecRow[] = []
  for (const line of slice('## 13. Rule catalog', '## 14.')) {
    const match = ROW.exec(line)
    if (match === null) continue
    const [, code, name, severity, fatal, owner] = match
    if (
      code === undefined ||
      name === undefined ||
      severity === undefined ||
      fatal === undefined ||
      owner === undefined
    ) {
      throw new Error(`unreadable rule row: ${line}`)
    }
    rows.push({
      code,
      name,
      severity,
      fatal: fatal.split(',')[0]?.trim() ?? '',
      exitTwo: fatal.includes('exit 2'),
      owner,
    })
  }
  return rows
}

function unionNames(): readonly string[] {
  const names: string[] = []
  let inside = false
  for (const line of slice('## 15. Shared types', '## 16.')) {
    if (line.startsWith('export type RuleName =')) {
      inside = true
      continue
    }
    if (!inside) continue
    const match = /^\s*\|\s*'([a-z0-9-]+)'\s*$/.exec(line)
    if (match?.[1] === undefined) break
    names.push(match[1])
  }
  return names
}

const ROWS = ruleRows()

describe('RULES against the rule catalog it transcribes', () => {
  test('carries one entry per catalog row and no more', () => {
    expect(ROWS.length).toBe(57)
    expect(Object.keys(RULES)).toHaveLength(ROWS.length)
  })

  test('transcribes every field of every row', () => {
    for (const row of ROWS) {
      expect(Object.hasOwn(RULES, row.name)).toBe(true)
      const rule = RULES[row.name as RuleName]
      expect({
        code: rule.code,
        name: rule.name,
        severity: rule.severity,
        fatal: rule.fatal,
        exitTwo: rule.exitTwo,
        owner: rule.owner,
      }).toEqual(row)
    }
  })

  test('keys the table in the catalog order, so a code is never quietly renumbered', () => {
    expect(Object.keys(RULES)).toEqual(ROWS.map((row) => row.name))
  })

  test('agrees with the rule name union the shared types print', () => {
    expect(unionNames()).toEqual(ROWS.map((row) => row.name))
  })

  test('reserves exit two for the three rules that mean the tool could not run', () => {
    const exitTwo = ROWS.filter((row) => row.exitTwo).map((row) => row.code)
    expect(exitTwo).toEqual(['LZ1001', 'LZ1007', 'LZ5001'])
  })

  test('makes every exit-two rule block emission outright', () => {
    for (const row of ROWS.filter((candidate) => candidate.exitTwo)) {
      expect(row.fatal).toBe('always')
      expect(RULES[row.name as RuleName].fatal).toBe('always')
    }
  })

  test('assigns each code exactly one producing module', () => {
    const owners = new Map<string, string>()
    for (const row of ROWS) {
      expect(owners.has(row.code)).toBe(false)
      owners.set(row.code, row.owner)
    }
    expect(new Set(ROWS.map((row) => row.name)).size).toBe(ROWS.length)
  })
})
