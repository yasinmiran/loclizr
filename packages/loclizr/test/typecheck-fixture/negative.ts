import { errors, terms } from './src/loclizr/groups.js'
import * as m from './src/loclizr/messages.js'

declare const code: keyof typeof errors

// @ts-expect-error 'sp' is not a declared locale
m.setLocale('sp')

// @ts-expect-error 'sp' is not a declared locale
m.nav_home(undefined, { locale: 'sp' })

// @ts-expect-error a message with no arguments accepts none
m.nav_home({ x: 1 })

// @ts-expect-error a dynamic member needs every member's arguments
errors[code]({})

// @ts-expect-error args is required in the mapped type
errors[code]()

// @ts-expect-error 'nope' is not an argument of errors.rate_limited
errors.rate_limited({ nope: 1 })

// @ts-expect-error 'pending' is not a select option of order.status
m.order_status({ state: 'pending' })

// @ts-expect-error amount is required
m.cart_total({})

// @ts-expect-error a markup handler is required
m.terms_accept<string>({})

// @ts-expect-error a handler argument stays required where the message returns a string
m.terms_bare({})

// @ts-expect-error count is a number, not a string
m.cart_items({ count: '3' })

// @ts-expect-error a group member that returns parts is not a string
export const parts: string = terms.accept({ link: (chunks) => chunks.join('') })

// @ts-expect-error the markup handler a member needs is missing
terms.notice({ count: 1 })
