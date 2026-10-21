import type { Arg, ArgType, Message } from '../types'
import { compareCodepoint } from '../util'
import { MAX_LINE, bindsHandlerType, docComment, isArgName, quoted } from './shared'

// A handler returns `R` and receives chunks of `T`, so `R` is inferred from the
// handler a call passes even with no contextual type, while `R extends T` still
// rejects a handler whose result cannot sit among the chunks it is nested into.
export const HANDLER_PARAMETERS = '<R extends T, T = R>'

export function argsParameter(args: readonly Arg[]): string {
  return args.length === 0 ? 'args?: EmptyArgs' : `args: ${argsShape(args)}`
}

export function argsShape(args: readonly Arg[], emptyArgs = 'EmptyArgs'): string {
  if (args.length === 0) return emptyArgs
  const fields = args.map((arg) => `${isArgName(arg.name) ? arg.name : quoted(arg.name)}: ${typeOf(arg.type)}`)
  return `{ ${fields.join('; ')} }`
}

export function returnType(kind: 'text' | 'markup'): string {
  return kind === 'markup' ? 'readonly (string | R)[]' : 'string'
}

export function declaration(message: Message, sourceLocale: string): readonly string[] {
  const generic = bindsHandlerType(message) ? HANDLER_PARAMETERS : ''
  const parameter = argsParameter(message.args)
  const result = returnType(message.kind)
  const doc = docComment(sourceLocale, message.source)
  const oneLine = `export declare function ${message.id}${generic}(${parameter}, opts?: MessageOptions): ${result}`
  if (oneLine.length <= MAX_LINE) return [doc, oneLine]
  return [
    doc,
    `export declare function ${message.id}${generic}(`,
    `  ${parameter},`,
    '  opts?: MessageOptions,',
    `): ${result}`,
  ]
}

export function typeOf(type: ArgType): string {
  switch (type.kind) {
    case 'number':
      return 'number'
    case 'date':
      return 'Date | number'
    case 'markup':
      return '(chunks: readonly (string | T)[]) => R'
    case 'select': {
      const options = type.options.filter((option) => option !== 'other')
      if (options.length === 0) return 'string | number'
      return [...options].sort(compareCodepoint).map(quoted).join(' | ')
    }
    default:
      return 'string | number'
  }
}
