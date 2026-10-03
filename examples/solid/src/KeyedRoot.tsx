import { Show } from 'solid-js'
import { createLocale } from './locale'
import * as m from './loclizr/messages'

function Greeting() {
  return <h1>{m.cart_greeting({ name: 'Ada' })}</h1>
}

export function KeyedRoot() {
  const locale = createLocale()
  return (
    <Show when={locale()} keyed>
      <Greeting />
    </Show>
  )
}
