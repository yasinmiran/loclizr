import { createLocale } from './locale'
import * as m from './loclizr/messages'

export function Cart(props: { count: number }) {
  const locale = createLocale()
  return <p>{m.cart_items({ count: props.count }, { locale: locale() })}</p>
}
