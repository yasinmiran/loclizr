import { diag } from '../diagnostics'
import { unify } from '../icu'
import type {
  ArgType,
  Body,
  Diagnostic,
  Message,
  Node,
  Origin,
  Program,
  Related,
  Span,
} from '../types'
import { compareCodepoint, requiredCategories } from '../util'

const CLDR_ORDER: readonly string[] = ['zero', 'one', 'two', 'few', 'many', 'other']

const CLDR_CATEGORIES: ReadonlySet<string> = new Set(CLDR_ORDER)

const ARG_KIND_LABEL: Readonly<Record<ArgType['kind'], string>> = {
  stringish: 'plain text',
  number: 'a number',
  date: 'a date',
  select: 'a select',
  markup: 'a markup tag',
}

interface Comparison {
  readonly program: Program
  readonly message: Message
  readonly source: Body
  readonly body: Body
  readonly file: string
  readonly span: Span | undefined
}

interface FoldState {
  readonly type: ArgType
  readonly locale: string
}

export function runChecks(program: Program): readonly Diagnostic[] {
  const out: Diagnostic[] = []
  for (const message of program.messages) {
    checkOrigins(program, message, out)
    checkTranslations(program, message, out)
    checkPluralCategories(program, message, out)
    checkTimeZone(program, message, out)
  }
  checkExtras(program, out)
  checkAmbiguousSource(program, out)
  return out
}

function checkOrigins(program: Program, message: Message, out: Diagnostic[]): void {
  for (const entry of message.origins) {
    if (entry.locale === program.sourceLocale) continue
    if (entry.origin.status !== 'fallback') continue
    if (entry.origin.reason === 'invalid') continue
    const blank = entry.origin.reason === 'blank'
    const file = catalogFile(program, message, entry.locale)
    out.push(
      diag(blank ? 'blank-translation' : 'missing-translation', {
        message: blank
          ? `The ${entry.locale} value is empty, so this message renders ${program.sourceLocale} text.`
          : `The ${entry.locale} catalog has no value for this key, so this message renders ${program.sourceLocale} text.`,
        hint: blank
          ? `write a ${entry.locale} value for "${message.key}" in ${file}`
          : `add "${message.key}" to ${file}`,
        file,
        locale: entry.locale,
        key: message.key,
        span: spanOf(message, entry.locale),
      }),
    )
  }
}

function checkTranslations(program: Program, message: Message, out: Diagnostic[]): void {
  const source = bodyOf(message, program.sourceLocale)
  if (source === undefined) return
  const folded = new Map<string, FoldState>(
    source.args.map((arg) => [arg.name, { type: arg.type, locale: program.sourceLocale }]),
  )
  const sourceSelects = selectOptions(source.nodes)
  for (const body of ownBodies(message)) {
    if (body.locale === program.sourceLocale) continue
    const comparison: Comparison = {
      program,
      message,
      source,
      body,
      file: catalogFile(program, message, body.locale),
      span: spanOf(message, body.locale),
    }
    checkArgs(comparison, folded, out)
    checkSelects(comparison, sourceSelects, out)
    checkMarkup(comparison, out)
  }
}

function checkArgs(comparison: Comparison, folded: Map<string, FoldState>, out: Diagnostic[]): void {
  const { program, message, source, body, file, span } = comparison
  const here = new Map(body.args.map((arg) => [arg.name, arg.type] as const))
  const there = new Set(source.args.map((arg) => arg.name))
  for (const arg of source.args) {
    const mine = here.get(arg.name)
    if (mine === undefined) {
      if (arg.type.kind === 'markup') continue
      out.push(
        diag('arg-missing', {
          message: `The ${program.sourceLocale} text uses {${arg.name}} and the ${body.locale} translation does not.`,
          hint: `add {${arg.name}} to "${message.key}" in ${file}`,
          file,
          locale: body.locale,
          key: message.key,
          span,
        }),
      )
      continue
    }
    foldArgType(comparison, folded, arg.name, mine, out)
  }
  for (const arg of body.args) {
    if (there.has(arg.name)) continue
    const tag = arg.type.kind === 'markup'
    out.push(
      diag('arg-extra', {
        message: tag
          ? `The ${body.locale} translation uses the tag <${arg.name}>, which the ${program.sourceLocale} text does not have, so this locale renders ${program.sourceLocale} text instead.`
          : `The ${body.locale} translation uses {${arg.name}}, which the ${program.sourceLocale} text does not have, so this locale renders ${program.sourceLocale} text instead.`,
        hint: tag
          ? `remove <${arg.name}> from "${message.key}" in ${file}, or add it to the ${program.sourceLocale} text`
          : `check the spelling of {${arg.name}} in ${file}, or add it to the ${program.sourceLocale} text`,
        file,
        locale: body.locale,
        key: message.key,
        span,
      }),
    )
  }
}

function foldArgType(
  comparison: Comparison,
  folded: Map<string, FoldState>,
  name: string,
  mine: ArgType,
  out: Diagnostic[],
): void {
  const { program, message, body, file, span } = comparison
  const state = folded.get(name)
  if (state === undefined) return
  const merged = unify(state.type, mine)
  if (merged !== null) {
    if (merged.kind !== state.type.kind) folded.set(name, { type: merged, locale: body.locale })
    return
  }
  const related: Related = {
    file: catalogFile(program, message, state.locale),
    locale: state.locale,
    key: message.key,
    span: spanOf(message, state.locale) ?? null,
    message: `${ARG_KIND_LABEL[state.type.kind]} here`,
  }
  out.push(
    diag('arg-type-conflict', {
      message: `{${name}} is ${ARG_KIND_LABEL[mine.kind]} in ${body.locale} and ${ARG_KIND_LABEL[state.type.kind]} in ${state.locale}, and one call site cannot carry both.`,
      hint: `use one type for {${name}} in every locale`,
      file,
      locale: body.locale,
      key: message.key,
      span,
      related: [related],
    }),
  )
}

function checkSelects(
  comparison: Comparison,
  sourceSelects: ReadonlyMap<string, ReadonlySet<string>>,
  out: Diagnostic[],
): void {
  const { program, message, body, file, span } = comparison
  const targetSelects = selectOptions(body.nodes)
  for (const [name, options] of sourceSelects) {
    const theirs = targetSelects.get(name)
    if (theirs === undefined) continue
    for (const option of options) {
      if (option === 'other' || theirs.has(option)) continue
      out.push(
        diag('select-option-missing', {
          message: `The ${body.locale} translation has no "${option}" branch for {${name}}, so that value renders the other branch.`,
          hint: `add ${option} {...} to {${name}, select, ...} in ${file}`,
          file,
          locale: body.locale,
          key: message.key,
          span,
        }),
      )
    }
    for (const option of theirs) {
      if (option === 'other' || options.has(option)) continue
      out.push(
        diag('select-option-extra', {
          message: `The ${body.locale} translation has a "${option}" branch for {${name}} that the ${program.sourceLocale} text does not, and the generated type never lets a call site pass it.`,
          hint: `add ${option} {...} to the ${program.sourceLocale} select, or delete the branch from ${file}`,
          file,
          locale: body.locale,
          key: message.key,
          span,
        }),
      )
    }
  }
}

function checkMarkup(comparison: Comparison, out: Diagnostic[]): void {
  const { program, message, source, body, file, span } = comparison
  const theirs = new Set(body.markupTags)
  const missing = [...new Set(source.markupTags)]
    .filter((tag) => !theirs.has(tag))
    .sort(compareCodepoint)
  if (missing.length === 0) return
  const list = missing.map((tag) => `<${tag}>`).join(', ')
  out.push(
    diag('markup-mismatch', {
      message: `The ${program.sourceLocale} text uses ${list} and the ${body.locale} translation does not.`,
      hint: `wrap the matching words of "${message.key}" in ${list} in ${file}`,
      file,
      locale: body.locale,
      key: message.key,
      span,
    }),
  )
}

function checkPluralCategories(program: Program, message: Message, out: Diagnostic[]): void {
  for (const body of ownBodies(message)) {
    const file = catalogFile(program, message, body.locale)
    const span = spanOf(message, body.locale)
    walk(body.nodes, (node) => {
      if (node.kind !== 'plural') return
      const keyword = node.ordinal ? 'selectordinal' : 'plural'
      const required = requiredCategories(body.locale, node.ordinal)
      const provided = new Set(node.branches.map((branch) => branch.keyword))
      const missing = CLDR_ORDER.filter((category) => required.includes(category) && !provided.has(category))
      if (missing.length > 0) {
        out.push(
          diag('plural-category-incomplete', {
            message: `${body.locale} selects ${missing.join(', ')} for some values of {${node.name}}, and this ${keyword} has no branch for ${missing.length === 1 ? 'it' : 'them'}.`,
            hint: `add ${missing.map((category) => `${category} {...}`).join(' ')} to {${node.name}, ${keyword}, ...} in ${file}`,
            file,
            locale: body.locale,
            key: message.key,
            span,
          }),
        )
      }
      for (const branch of node.branches) {
        if (!CLDR_CATEGORIES.has(branch.keyword)) continue
        if (required.includes(branch.keyword)) continue
        out.push(
          diag('plural-category-unreachable', {
            message: `${body.locale} never selects "${branch.keyword}", so this branch of {${node.name}} never renders.`,
            hint:
              branch.keyword === 'zero'
                ? `${body.locale} never selects zero; use the exact branch =0`
                : `${body.locale} never selects ${branch.keyword}; delete the branch, or use an exact branch such as =2`,
            file,
            locale: body.locale,
            key: message.key,
            span,
          }),
        )
      }
    })
  }
}

function checkTimeZone(program: Program, message: Message, out: Diagnostic[]): void {
  if ((program.config.formats.timeZone ?? '') !== '') return
  const source = bodyOf(message, program.sourceLocale)
  if (source === undefined) return
  const names: string[] = []
  walk(source.nodes, (node) => {
    if (node.kind !== 'dateTime') return
    if (node.format.options['timeZone'] !== undefined) return
    if (!names.includes(node.name)) names.push(node.name)
  })
  if (names.length === 0) return
  const list = names.map((name) => `{${name}}`).join(', ')
  out.push(
    diag('date-without-timezone', {
      message: `${list} formats a date with no time zone, so a server and a browser can render two different values for one instant.`,
      hint: `set formats.timeZone in loclizr.config.ts, or leave this rule off where the viewer's own zone is what you want`,
      file: catalogFile(program, message, program.sourceLocale),
      locale: program.sourceLocale,
      key: message.key,
      span: spanOf(message, program.sourceLocale),
    }),
  )
}

function checkExtras(program: Program, out: Diagnostic[]): void {
  for (const extra of program.extras) {
    out.push(
      diag('extra-translation', {
        message: `"${extra.key}" is in the ${extra.locale} catalog and not in ${program.sourceLocale}, so no message is generated for it.`,
        hint: `add "${extra.key}" to the ${program.sourceLocale} catalog, or delete it from ${extra.file}`,
        file: extra.file,
        locale: extra.locale,
        key: extra.key,
        span: extra.span,
      }),
    )
  }
}

function checkAmbiguousSource(program: Program, out: Diagnostic[]): void {
  const buckets = new Map<string, Message[]>()
  for (const message of program.messages) {
    const bucket = buckets.get(message.source)
    if (bucket === undefined) buckets.set(message.source, [message])
    else bucket.push(message)
  }
  const colliding = [...buckets.values()]
    .filter((bucket) => bucket.length > 1 && bucket.some((message) => !hasDescription(message)))
    .map((bucket) => [...bucket].sort((a, b) => compareCodepoint(a.key, b.key)))
    .sort((a, b) => compareCodepoint(a[0]?.key ?? '', b[0]?.key ?? ''))
  for (const group of colliding) {
    const first = group[0]
    if (first === undefined) continue
    const undescribed = group.filter((message) => !hasDescription(message))
    const related: readonly Related[] = group.map((message) => ({
      file: catalogFile(program, message, program.sourceLocale),
      locale: null,
      key: message.key,
      span: spanOf(message, program.sourceLocale) ?? null,
      message: hasDescription(message) ? `"${message.description}"` : 'no description',
    }))
    out.push(
      diag('ambiguous-source', {
        message: `${group.length} keys share the source text "${oneLine(first.source)}" and ${
          undescribed.length === 1 ? 'one has' : `${undescribed.length} have`
        } no description.\nA translator sees one string with no way to tell the meanings apart.`,
        hint: describeHint(program, undescribed),
        file: catalogFile(program, first, program.sourceLocale),
        span: spanOf(first, program.sourceLocale),
        related,
      }),
    )
  }
}

function describeHint(program: Program, undescribed: readonly Message[]): string {
  const meta =
    program.config.meta === false
      ? null
      : program.config.meta.replaceAll('{sourceLocale}', program.sourceLocale)
  const width = Math.max(...undescribed.map((message) => message.key.length))
  return [
    meta === null ? 'set meta in loclizr.config.ts, then describe:' : `add descriptions in ${meta}:`,
    ...undescribed.map(
      (message) => `       ${`"${message.key}":`.padEnd(width + 4)}{ "description": "" }`,
    ),
    'or   make this a hard gate in loclizr.config.ts:',
    `       severity: { 'ambiguous-source': 'error' }`,
  ].join('\n')
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

function selectOptions(nodes: readonly Node[]): ReadonlyMap<string, ReadonlySet<string>> {
  const found = new Map<string, Set<string>>()
  walk(nodes, (node) => {
    if (node.kind !== 'select') return
    const options = found.get(node.name) ?? new Set<string>()
    for (const branch of node.branches) options.add(branch.option)
    found.set(node.name, options)
  })
  return found
}

function ownBodies(message: Message): readonly Body[] {
  return message.bodies
    .filter((body) => isOwnBody(message, body.locale))
    .sort((a, b) => compareCodepoint(a.locale, b.locale))
}

function isOwnBody(message: Message, locale: string): boolean {
  const origin = originOf(message, locale)
  return origin === undefined || origin.status === 'translated'
}

function originOf(message: Message, locale: string): Origin | undefined {
  return message.origins.find((entry) => entry.locale === locale)?.origin
}

function bodyOf(message: Message, locale: string): Body | undefined {
  return message.bodies.find((body) => body.locale === locale)
}

function spanOf(message: Message, locale: string): Span | undefined {
  return message.spans.find((entry) => entry.locale === locale)?.span
}

function catalogFile(program: Program, message: Message, locale: string): string {
  const known = message.spans.find((entry) => entry.locale === locale)
  if (known !== undefined) return known.file
  const [namespace = ''] = message.key.split('.')
  return program.config.catalogs.replaceAll('{locale}', locale).replaceAll('{ns}', namespace)
}

function hasDescription(message: Message): boolean {
  return message.description !== null && message.description.trim() !== ''
}

function oneLine(text: string): string {
  return text.replace(/[\r\n]+/gu, ' ')
}
