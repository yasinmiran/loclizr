import type { ArgType } from '../types'

export function unify(a: ArgType, b: ArgType): ArgType | null {
  if (a.kind === 'stringish') return b
  if (b.kind === 'stringish') return a
  if (a.kind !== b.kind) return null
  // `a` wins for select: the option union is the source locale's, and the source
  // locale is always the accumulator a caller folds targets into.
  return a
}
