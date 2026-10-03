import { createLocale } from './locale'
import * as m from './loclizr/messages'
import { Cart } from './Cart'
import { Switcher } from './Switcher'

export default function App() {
  const locale = createLocale()
  return (
    <>
      <Switcher />
      <h1>{m.cart_greeting({ name: 'Ada' }, { locale: locale() })}</h1>
      <Cart count={3} />
    </>
  )
}
