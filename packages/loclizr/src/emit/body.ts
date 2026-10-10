import type { ExactBranch, IntlOptions, Node, NumberFormatSpec, PluralBranch, SelectBranch } from '../types'
import { compareCodepoint } from '../util'
import { PLURAL_KEYWORDS, formatName, isArgName, pad, quoted, templateText } from './shared'

type PluralNode = Extract<Node, { kind: 'plural' }>

type SelectNode = Extract<Node, { kind: 'select' }>

type ArgNode = Extract<Node, { kind: 'arg' }>

const NO_OPTIONS: IntlOptions = {}

export interface MessageContext {
  readonly kind: 'text' | 'markup'
  readonly selectors: readonly string[]
  // Every argument the declaration types as a markup handler. A name here is a
  // function the call site supplies, so it is called, never interpolated.
  readonly handlers: ReadonlySet<string>
  readonly usedLocals: Set<number>
  readonly formats: Map<string, IntlOptions>
  readonly runtime: Set<string>
}

interface ArmContext extends MessageContext {
  // The locale whose body this arm prints. A plural selects its category with
  // that locale's rules, never the requesting locale's: an inherited or
  // fallback arm carries another language's grammar, and the requesting
  // locale's categories can pick a branch that body never wrote. Number and
  // date formatting stay on the requesting locale, which is what a regional
  // overlay such as de-AT over de is declared for.
  readonly locale: string
  // A plan probes each branch by rendering it, and that render plans every
  // branch nested inside, so without these each level of nesting would double
  // the work. Kept per arm because a plural plan depends on the arm's locale.
  readonly pluralPlans: Map<PluralNode, PluralPlan>
  readonly selectPlans: Map<SelectNode, Map<Frame | null, SelectPlan>>
}

export function messageContext(
  kind: 'text' | 'markup',
  selectors: readonly string[],
  handlers: ReadonlySet<string>,
): MessageContext {
  return {
    kind,
    selectors,
    handlers,
    usedLocals: new Set<number>(),
    formats: new Map<string, IntlOptions>(),
    runtime: new Set<string>(),
  }
}

// One local per plural selector name, so two bodies of one message that order
// their plurals differently still share one `const nN = args.x` preamble.
export function pluralSelectors(bodies: readonly (readonly Node[])[]): readonly string[] {
  const names: string[] = []
  for (const nodes of bodies) {
    walk(nodes, (node) => {
      if (node.kind === 'plural' && !names.includes(node.name)) names.push(node.name)
    })
  }
  return names
}

export function renderArm(
  nodes: readonly Node[],
  ctx: MessageContext,
  indent: number,
  locale: string,
): string {
  return statements(nodes, { ...ctx, locale, pluralPlans: new Map(), selectPlans: new Map() }, indent, null)
}

export function localDeclarations(ctx: MessageContext, indent: number): readonly string[] {
  return [...ctx.usedLocals]
    .sort((a, b) => a - b)
    .map((index) => `${pad(indent)}const n${index} = ${access(ctx.selectors[index] ?? '')}`)
}

interface Frame {
  readonly index: number | null
  readonly name: string
  readonly offset: number
}

function statements(nodes: readonly Node[], ctx: ArmContext, indent: number, frame: Frame | null): string {
  const only = nodes.length === 1 ? nodes[0] : undefined
  if (only?.kind === 'plural') return pluralStatements(only, ctx, indent, frame)
  if (only?.kind === 'select') return selectStatements(only, ctx, indent, frame)
  return `${pad(indent)}return ${armExpression(nodes, ctx, indent, frame)}`
}

function pluralStatements(node: PluralNode, ctx: ArmContext, indent: number, frame: Frame | null): string {
  const plan = pluralPlan(node, ctx)
  const lines: string[] = []
  for (const branch of plan.exact) {
    lines.push(conditional(`${localRef(plan.inner, ctx)} === ${branch.value}`, branch.body, ctx, indent, plan.inner))
  }
  if (plan.keywords.length === 0) {
    lines.push(statements(plan.other, ctx, indent, plan.inner))
    return lines.join('\n')
  }
  lines.push(`${pad(indent)}switch (${pluralCall(node, plan.inner, ctx)}) {`)
  for (const branch of plan.keywords) {
    lines.push(`${pad(indent + 2)}case ${quoted(branch.keyword)}:`)
    lines.push(statements(branch.body, ctx, indent + 4, plan.inner))
  }
  lines.push(`${pad(indent + 2)}default:`)
  lines.push(statements(plan.other, ctx, indent + 4, plan.inner))
  lines.push(`${pad(indent)}}`)
  return lines.join('\n')
}

function selectStatements(node: SelectNode, ctx: ArmContext, indent: number, frame: Frame | null): string {
  const plan = selectPlan(node, ctx, frame)
  if (plan.options.length === 0) return statements(plan.other, ctx, indent, frame)
  const lines: string[] = [`${pad(indent)}switch (${access(node.name)}) {`]
  for (const branch of plan.options) {
    lines.push(`${pad(indent + 2)}case ${quoted(branch.option)}:`)
    lines.push(statements(branch.body, ctx, indent + 4, frame))
  }
  lines.push(`${pad(indent + 2)}default:`)
  lines.push(statements(plan.other, ctx, indent + 4, frame))
  lines.push(`${pad(indent)}}`)
  return lines.join('\n')
}

function conditional(
  test: string,
  body: readonly Node[],
  ctx: ArmContext,
  indent: number,
  frame: Frame,
): string {
  if (!branching(body)) return `${pad(indent)}if (${test}) return ${armExpression(body, ctx, indent, frame)}`
  return [
    `${pad(indent)}if (${test}) {`,
    statements(body, ctx, indent + 2, frame),
    `${pad(indent)}}`,
  ].join('\n')
}

function armExpression(nodes: readonly Node[], ctx: ArmContext, indent: number, frame: Frame | null): string {
  if (ctx.kind === 'text') return textExpression(nodes, ctx, indent, frame)
  if (carriesMarkup(nodes, ctx)) return partsExpression(nodes, ctx, indent, frame)
  return `[${textExpression(nodes, ctx, indent, frame)}]`
}

function textExpression(nodes: readonly Node[], ctx: ArmContext, indent: number, frame: Frame | null): string {
  return `\`${templateParts(nodes, ctx, indent, frame)}\``
}

function partsExpression(nodes: readonly Node[], ctx: ArmContext, indent: number, frame: Frame | null): string {
  const elements = partsElements(nodes, ctx, indent + 2, frame)
  if (!elements.some((element) => element.includes('\n'))) return `[${elements.join(', ')}]`
  const listed = elements.map((element) => `${pad(indent + 2)}${element},`).join('\n')
  return `[\n${listed}\n${pad(indent)}]`
}

function partsElements(
  nodes: readonly Node[],
  ctx: ArmContext,
  indent: number,
  frame: Frame | null,
): readonly string[] {
  const elements: string[] = []
  let chunk: Node[] = []
  const flush = (): void => {
    if (chunk.length === 0) return
    const single = chunk.length === 1 ? chunk[0] : undefined
    elements.push(single?.kind === 'text' ? quoted(single.value) : textExpression(chunk, ctx, indent, frame))
    chunk = []
  }
  for (const node of nodes) {
    if (node.kind === 'markup') {
      flush()
      elements.push(`${access(node.name)}(${partsExpression(node.children, ctx, indent, frame)})`)
      continue
    }
    // A handler reached through a bare argument has no children of its own, so
    // it renders exactly as an empty tag would.
    if (refersToHandler(node, ctx)) {
      flush()
      elements.push(`${access(node.name)}([])`)
      continue
    }
    // A branch that reaches a tag contributes its own elements here.
    // Interpolating it would string-coerce the handler's return value.
    if ((node.kind === 'plural' || node.kind === 'select') && carriesMarkup([node], ctx)) {
      flush()
      elements.push(...branchElements(node, ctx, indent, frame))
      continue
    }
    chunk.push(node)
  }
  flush()
  return elements
}

function branchElements(
  node: PluralNode | SelectNode,
  ctx: ArmContext,
  indent: number,
  frame: Frame | null,
): readonly string[] {
  const plan = branchPlan(node, ctx, frame)
  if (plan.alternatives.length === 0) return partsElements(plan.fallback, ctx, indent, plan.frame)
  return [`...(${ternary(plan.alternatives, plan.fallback, ctx, indent, plan.frame, armExpression)})`]
}

function templateParts(nodes: readonly Node[], ctx: ArmContext, indent: number, frame: Frame | null): string {
  let out = ''
  for (const node of nodes) {
    switch (node.kind) {
      case 'text':
        out += templateText(node.value)
        break
      case 'arg':
        // A string arm has nowhere to put a handler's return value, and
        // interpolating the function itself would ship its source text to
        // users. Reachable only where analysis typed a name the source body
        // used bare as a markup handler.
        if (!ctx.handlers.has(node.name)) out += `\${${access(node.name)}}`
        break
      case 'number':
        out += `\${${intlCall('$number1', scaled(access(node.name), node.format), node.format.options, ctx)}}`
        break
      case 'dateTime':
        out += `\${${intlCall('$dateTime1', access(node.name), node.format.options, ctx)}}`
        break
      case 'pound':
        out += frame === null ? '#' : `\${${intlCall('$number1', selectorValue(frame, ctx), NO_OPTIONS, ctx)}}`
        break
      case 'markup':
        out += templateParts(node.children, ctx, indent, frame)
        break
      case 'plural':
      case 'select':
        out += branchingPart(node, ctx, indent, frame)
        break
    }
  }
  return out
}

function branchingPart(
  node: PluralNode | SelectNode,
  ctx: ArmContext,
  indent: number,
  frame: Frame | null,
): string {
  const plan = branchPlan(node, ctx, frame)
  if (plan.alternatives.length === 0) return templateParts(plan.fallback, ctx, indent, plan.frame)
  const chain = ternary(plan.alternatives, plan.fallback, ctx, indent + 2, plan.frame, textExpression)
  return `\${\n${pad(indent + 2)}${chain}\n${pad(indent)}}`
}

interface Alternative {
  readonly test: string
  readonly body: readonly Node[]
}

interface BranchPlan {
  readonly alternatives: readonly Alternative[]
  readonly fallback: readonly Node[]
  readonly frame: Frame | null
}

function branchPlan(node: PluralNode | SelectNode, ctx: ArmContext, frame: Frame | null): BranchPlan {
  if (node.kind === 'select') {
    const plan = selectPlan(node, ctx, frame)
    const alternatives = plan.options.map((branch) => ({
      test: `${access(node.name)} === ${quoted(branch.option)}`,
      body: branch.body,
    }))
    return { alternatives, fallback: plan.other, frame }
  }
  const plan = pluralPlan(node, ctx)
  const alternatives: Alternative[] = plan.exact.map((branch) => ({
    test: `${localRef(plan.inner, ctx)} === ${branch.value}`,
    body: branch.body,
  }))
  for (const branch of plan.keywords) {
    alternatives.push({
      test: `${pluralCall(node, plan.inner, ctx)} === ${quoted(branch.keyword)}`,
      body: branch.body,
    })
  }
  return { alternatives, fallback: plan.other, frame: plan.inner }
}

function pluralCall(node: PluralNode, frame: Frame, ctx: ArmContext): string {
  ctx.runtime.add('$plural1')
  return `$plural1(${quoted(ctx.locale)}, ${selectorValue(frame, ctx)}, ${node.ordinal})`
}

type Render = (nodes: readonly Node[], ctx: ArmContext, indent: number, frame: Frame | null) => string

function ternary(
  alternatives: readonly Alternative[],
  fallback: readonly Node[],
  ctx: ArmContext,
  indent: number,
  frame: Frame | null,
  render: Render,
): string {
  const head = alternatives[0]
  if (head === undefined) return render(fallback, ctx, indent, frame)
  const rest = alternatives.slice(1)
  return [
    head.test,
    `${pad(indent + 2)}? ${render(head.body, ctx, indent + 2, frame)}`,
    `${pad(indent + 2)}: ${ternary(rest, fallback, ctx, indent + 2, frame, render)}`,
  ].join('\n')
}

interface PluralPlan {
  readonly inner: Frame
  readonly exact: readonly ExactBranch[]
  readonly keywords: readonly PluralBranch[]
  readonly other: readonly Node[]
}

// Probing renders into the same context on purpose: a branch is only dropped
// when it renders byte-identically to one that survives, so what it collected
// is collected anyway.
function pluralPlan(node: PluralNode, ctx: ArmContext): PluralPlan {
  const cached = ctx.pluralPlans.get(node)
  if (cached !== undefined) return cached
  const inner: Frame = { index: indexOf(node.name, ctx), name: node.name, offset: node.offset }
  const other = node.branches.find((branch) => branch.keyword === 'other')?.body ?? []
  const keywords = orderKeywords(node.branches.filter((branch) => branch.keyword !== 'other'))
  const probe = (body: readonly Node[]): string => armExpression(body, ctx, 0, inner)
  const baseline = probe(other)
  const collapsed = keywords.every((branch) => probe(branch.body) === baseline)
  const exact = [...node.exact]
    .sort((a, b) => a.value - b.value)
    .filter((branch) => !collapsed || probe(branch.body) !== baseline)
  const plan: PluralPlan = { inner, exact, keywords: collapsed ? [] : keywords, other }
  ctx.pluralPlans.set(node, plan)
  return plan
}

interface SelectPlan {
  readonly options: readonly SelectBranch[]
  readonly other: readonly Node[]
}

function selectPlan(node: SelectNode, ctx: ArmContext, frame: Frame | null): SelectPlan {
  const byFrame = ctx.selectPlans.get(node) ?? new Map<Frame | null, SelectPlan>()
  const cached = byFrame.get(frame)
  if (cached !== undefined) return cached
  const other = node.branches.find((branch) => branch.option === 'other')?.body ?? []
  const options = [...node.branches]
    .filter((branch) => branch.option !== 'other')
    .sort((a, b) => compareCodepoint(a.option, b.option))
  const probe = (body: readonly Node[]): string => armExpression(body, ctx, 0, frame)
  const baseline = probe(other)
  const collapsed = options.every((branch) => probe(branch.body) === baseline)
  const plan: SelectPlan = { options: collapsed ? [] : options, other }
  ctx.selectPlans.set(node, byFrame.set(frame, plan))
  return plan
}

function orderKeywords(branches: readonly PluralBranch[]): readonly PluralBranch[] {
  return [...branches].sort((a, b) => {
    const left = PLURAL_KEYWORDS.indexOf(a.keyword)
    const right = PLURAL_KEYWORDS.indexOf(b.keyword)
    if (left === right) return compareCodepoint(a.keyword, b.keyword)
    if (left === -1) return 1
    if (right === -1) return -1
    return left - right
  })
}

function intlCall(helper: string, value: string, options: IntlOptions, ctx: ArmContext): string {
  ctx.runtime.add(helper)
  const name = formatName(options)
  ctx.formats.set(name, options)
  return `${helper}(l, ${value}, ${name})`
}

function scaled(value: string, format: NumberFormatSpec): string {
  const multiplier = format.multiplier
  return multiplier === undefined || multiplier === 1 ? value : `${value} * ${multiplier}`
}

function selectorValue(frame: Frame, ctx: ArmContext): string {
  const local = localRef(frame, ctx)
  return frame.offset === 0 ? local : `${local} - ${frame.offset}`
}

function localRef(frame: Frame, ctx: ArmContext): string {
  if (frame.index === null) return access(frame.name)
  ctx.usedLocals.add(frame.index)
  return `n${frame.index}`
}

function indexOf(name: string, ctx: ArmContext): number | null {
  const index = ctx.selectors.indexOf(name)
  return index === -1 ? null : index
}

function branching(nodes: readonly Node[]): boolean {
  const only = nodes.length === 1 ? nodes[0] : undefined
  return only?.kind === 'plural' || only?.kind === 'select'
}

function carriesMarkup(nodes: readonly Node[], ctx: ArmContext): boolean {
  let found = false
  walk(nodes, (node) => {
    if (node.kind === 'markup' || refersToHandler(node, ctx)) found = true
  })
  return found
}

function refersToHandler(node: Node, ctx: ArmContext): node is ArgNode {
  return node.kind === 'arg' && ctx.handlers.has(node.name)
}

function access(name: string): string {
  return isArgName(name) ? `args.${name}` : `args[${quoted(name)}]`
}

function walk(nodes: readonly Node[], visit: (node: Node) => void): void {
  for (const node of nodes) {
    visit(node)
    switch (node.kind) {
      case 'plural':
        for (const branch of node.exact) walk(branch.body, visit)
        for (const branch of node.branches) walk(branch.body, visit)
        break
      case 'select':
        for (const branch of node.branches) walk(branch.body, visit)
        break
      case 'markup':
        walk(node.children, visit)
        break
      default:
        break
    }
  }
}
