export const CLDR_CATEGORIES: readonly string[] = Object.freeze([
  'zero',
  'one',
  'two',
  'few',
  'many',
  'other',
])

const UNKNOWN_RANK = CLDR_CATEGORIES.length
const OTHER_RANK = CLDR_CATEGORIES.length + 1

export function isCldrCategory(keyword: string): boolean {
  return CLDR_CATEGORIES.includes(keyword)
}

// Keyword branches print and emit in CLDR order, with `other` last and any
// keyword the catalog invented (LZ2006) held between the two in source order.
export function categoryRank(keyword: string): number {
  if (keyword === 'other') return OTHER_RANK
  const index = CLDR_CATEGORIES.indexOf(keyword)
  return index === -1 ? UNKNOWN_RANK : index
}
