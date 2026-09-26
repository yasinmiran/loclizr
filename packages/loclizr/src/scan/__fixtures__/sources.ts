export const APP_TSX: string = `import * as m from '@/loclizr/messages'
import { errors } from '@/loclizr/groups'

export function Cart({ code }: { code: keyof typeof errors }) {
  // m.nav_home() lives in a comment and must not count.
  return (
    <>
      <h1>Don't stop: {m.nav_cart()}</h1>
      <p>{m.cart_items({ count: 2 })}</p>
      <p>{errors[code]({ seconds: 30 })}</p>
    </>
  )
}
`

export const HELPER_TS: string = `export function shout(text: string): string {
  return \`\${text}! m.nav_home()\`
}
`

export const SWITCHER_TS: string = `import { locales } from '../loclizr/messages'

export const options: readonly string[] = [...locales]
`

// A barrel re-export and a side-effect import both reach the generated tree
// without binding anything callable, so LZ5004 must stay quiet for either.
export const BARREL_TS: string = `export * from '../loclizr/messages'
`

export const SIDE_EFFECT_TS: string = `import '../loclizr/messages'
`

// Lives inside outDir. It binds and would record a usage of nav_home, so the
// scan reporting nav_home unused is what proves outDir was excluded.
export const INSIDE_OUTDIR_TS: string = `import * as m from './loclizr/messages'

export const home = m.nav_home()
`

// Lives under node_modules, so scan.exclude keeps cart_total out of the usage set.
export const VENDORED_TS: string = `import * as m from '@/loclizr/messages'

export const vendored = m.cart_total()
`
