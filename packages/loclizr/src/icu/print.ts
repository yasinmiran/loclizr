import type { ExactBranch, Node, PluralBranch, SelectBranch } from '../types'
import { escapeIcuLiteral } from '../util'
import { categoryRank } from './categories'

export function printIcu(nodes: readonly Node[]): string {
  return printNodes(nodes, false)
}

function printNodes(nodes: readonly Node[], poundIsSpecial: boolean): string {
  let out = ''
  for (const node of nodes) out += printNode(node, poundIsSpecial)
  return out
}

function printNode(node: Node, poundIsSpecial: boolean): string {
  switch (node.kind) {
    case 'text':
      return escapeText(node.value, poundIsSpecial)
    case 'arg':
      return `{${node.name}}`
    case 'number':
      return node.style === null
        ? `{${node.name}, number}`
        : `{${node.name}, number, ${node.style}}`
    case 'dateTime':
      return node.style === null
        ? `{${node.name}, ${node.form}}`
        : `{${node.name}, ${node.form}, ${node.style}}`
    case 'pound':
      return '#'
    case 'plural': {
      const keyword = node.ordinal ? 'selectordinal' : 'plural'
      const offset = node.offset === 0 ? '' : `offset:${node.offset} `
      const branches = printPluralBranches(node.exact, node.branches)
      return `{${node.name}, ${keyword}, ${offset}${branches}}`
    }
    case 'select':
      return `{${node.name}, select, ${printSelectBranches(node.branches)}}`
    case 'markup':
      return `<${node.name}>${printNodes(node.children, poundIsSpecial)}</${node.name}>`
  }
}

function printPluralBranches(
  exact: readonly ExactBranch[],
  branches: readonly PluralBranch[],
): string {
  const parts: string[] = []
  for (const branch of sortExact(exact)) {
    parts.push(`=${branch.value} {${printNodes(branch.body, true)}}`)
  }
  for (const branch of sortKeywords(branches)) {
    parts.push(`${branch.keyword} {${printNodes(branch.body, true)}}`)
  }
  return parts.join(' ')
}

function printSelectBranches(branches: readonly SelectBranch[]): string {
  return sortSelect(branches)
    .map((branch) => `${branch.option} {${printNodes(branch.body, false)}}`)
    .join(' ')
}

export function sortExact(exact: readonly ExactBranch[]): readonly ExactBranch[] {
  return [...exact].sort((a, b) => a.value - b.value)
}

export function sortKeywords(branches: readonly PluralBranch[]): readonly PluralBranch[] {
  return [...branches].sort((a, b) => categoryRank(a.keyword) - categoryRank(b.keyword))
}

export function sortSelect(branches: readonly SelectBranch[]): readonly SelectBranch[] {
  return [...branches].sort(
    (a, b) => Number(a.option === 'other') - Number(b.option === 'other'),
  )
}

// The parser treats `#` as the plural selector only while the nearest enclosing
// message is a plural body, so quoting it anywhere else either ships a literal
// apostrophe pair to the translator or, inside a select, fails to re-parse.
function escapeText(value: string, poundIsSpecial: boolean): string {
  if (poundIsSpecial) return escapeIcuLiteral(value)
  return value
    .split('#')
    .map((run) => escapeIcuLiteral(run))
    .join('#')
}
