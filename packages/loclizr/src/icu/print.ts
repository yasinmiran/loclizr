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
      return escapeIcuLiteral(node.value, { inPlural: poundIsSpecial })
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
      return `{${node.name}, ${keyword}, ${offset}${printPluralBranches(node.exact, node.branches)}}`
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
  for (const branch of [...exact].sort((a, b) => a.value - b.value)) {
    parts.push(`=${branch.value} {${printNodes(branch.body, true)}}`)
  }
  const keywords = [...branches].sort((a, b) => categoryRank(a.keyword) - categoryRank(b.keyword))
  for (const branch of keywords) {
    parts.push(`${branch.keyword} {${printNodes(branch.body, true)}}`)
  }
  return parts.join(' ')
}

// A select resets the pound context even inside a plural, because the parser
// reads `#` there as literal text. Quoting it anyway would print apostrophes a
// translator then has to read, and `'#'` inside a select inside a plural is
// EXPECT_ARGUMENT_CLOSING_BRACE.
function printSelectBranches(branches: readonly SelectBranch[]): string {
  return [...branches]
    .sort((a, b) => Number(a.option === 'other') - Number(b.option === 'other'))
    .map((branch) => `${branch.option} {${printNodes(branch.body, false)}}`)
    .join(' ')
}
