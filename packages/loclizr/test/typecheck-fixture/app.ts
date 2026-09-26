import { errors, terms } from './src/loclizr/groups.js'
import * as m from './src/loclizr/messages.js'

export const home: string = m.nav_home()
export const homeInGerman: string = m.nav_home({}, { locale: 'de' })
export const homeWithoutArgs: string = m.nav_home(undefined, { locale: 'de' })
export const greeting: string = m.cart_greeting({ name: 'Ada' })
export const items: string = m.cart_items({ count: 3 })
export const total: string = m.cart_total({ amount: 42.5 })
export const updated: string = m.cart_updated({ at: new Date() })
export const counts: string = m.cart_counts({ files: 1, folders: 2 })
export const nested: string = m.cart_nested({ users: 3, files: 4 })
export const status: string = m.order_status({ state: 'shipped' })
export const snippet: string = m.dev_snippet()
export const rateLimited: string = errors.rate_limited({ seconds: 5 })

export const accept: readonly (string | string)[] = m.terms_accept<string>({
  link: (chunks) => chunks.join(''),
})

export const dropped: readonly (string | string)[] = m.terms_dropped<string>({
  notice: (chunks) => chunks.join(''),
})

export const notice: readonly (string | string)[] = m.terms_notice<string>({
  count: 2,
  b: (chunks) => chunks.join(''),
})

export const bare: string = m.terms_bare({ link: (chunks) => chunks.join('') })

export function byCode(code: keyof typeof errors): string {
  return errors[code]({ seconds: 30 })
}

export const groupedTitle: string = terms.title({})

export const groupedAccept: readonly (string | string)[] = terms.accept({
  link: (chunks) => chunks.join(''),
})

export function byTerm(key: keyof typeof terms): string | readonly string[] {
  return terms[key]({
    count: 1,
    b: (chunks) => chunks.join(''),
    link: (chunks) => chunks.join(''),
    notice: (chunks) => chunks.join(''),
  })
}

export const current: 'de' | 'de-AT' | 'en' = m.getLocale()

export const known: readonly ['de', 'de-AT', 'en'] = m.locales

export const source: 'en' = m.sourceLocale

export const stop: () => void = m.subscribe(() => {})

export function toGerman(): void {
  m.setLocale('de')
}
