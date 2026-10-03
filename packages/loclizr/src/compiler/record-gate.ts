import { stableStringify } from '../util'

const PROJECTED_OUT: ReadonlySet<string> = new Set(['usage', 'translations'])

// `usage` moves when a component is renamed and `translations` move when a
// translator lands a batch, so neither can be allowed to fail a build. What is
// left is the contract between code and translations.
export function recordsAgree(committed: string, fresh: string): boolean {
  const left = projection(committed)
  return left !== null && left === projection(fresh)
}

// A record the gate cannot make sense of counts as differing. JSON.parse walks
// iteratively and stableStringify recurses, so a committed file nested deeply
// enough overflows the stack on a document the parser accepted.
function projection(text: string): string | null {
  try {
    return stableStringify(withoutVolatileFields(JSON.parse(text)))
  } catch {
    return null
  }
}

function withoutVolatileFields(record: unknown): unknown {
  if (!isPlainObject(record)) return record
  const messages = record['messages']
  if (!Array.isArray(messages)) return record
  return { ...record, messages: messages.map(projectMessage) }
}

function projectMessage(message: unknown): unknown {
  if (!isPlainObject(message)) return message
  // Assignment would hand a `__proto__` field to the prototype setter and drop
  // it from the comparison; fromEntries defines it as an own property.
  return Object.fromEntries(
    Object.entries(message).filter(([field]) => !PROJECTED_OUT.has(field)),
  )
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
