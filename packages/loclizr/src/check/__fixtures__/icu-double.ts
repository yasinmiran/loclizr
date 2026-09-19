import type { ArgType } from '../../types'

export function unify(a: ArgType, b: ArgType): ArgType | null {
  if (a.kind === 'stringish') return b
  if (b.kind === 'stringish') return a
  if (a.kind !== b.kind) return null
  return a
}
