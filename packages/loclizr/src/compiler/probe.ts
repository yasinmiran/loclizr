import { requiredCategories } from '../util'

// Russian has four cardinal categories; small-icu silently answers with English
// data instead of throwing, which is how a truncated build machine disagrees
// with CI about every plural rule.
const RUSSIAN_CARDINAL_CATEGORIES = 4

export function icuDataComplete(): boolean {
  try {
    return requiredCategories('ru', false).length >= RUSSIAN_CARDINAL_CATEGORIES
  } catch {
    return false
  }
}

// `Intl.getCanonicalLocales` accepts any well formed tag, so `shared`, `und`,
// `xx` and `tlh` all reach the plural lookup, where Intl answers for the build
// machine's own locale rather than throwing. Every category claim about such a
// tag is then a claim about whoever ran the build.
export function localesWithoutPluralData(locales: readonly string[]): readonly string[] {
  return locales.filter((locale) => !hasPluralData(locale))
}

function hasPluralData(locale: string): boolean {
  try {
    const canonical = Intl.getCanonicalLocales(locale)[0] ?? locale
    const resolved = new Intl.PluralRules(canonical).resolvedOptions().locale
    return languageOf(resolved) === languageOf(canonical)
  } catch {
    // A tag Intl cannot canonicalize is M9's LZ1002, which is fatal before the
    // pipeline reaches this.
    return true
  }
}

// Plural data is keyed by language, so `de-AT` resolving to `de` is a hit while
// `shared` resolving to the host locale is not. Canonicalizing first is what
// keeps the deprecated tags honest: `tl` canonicalizes to `fil` and
// `art-lojban` to `jbo`, both of which Intl does have data for.
function languageOf(tag: string): string {
  return (tag.split('-')[0] ?? tag).toLowerCase()
}
