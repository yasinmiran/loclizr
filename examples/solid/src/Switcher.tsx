import { For } from 'solid-js'
import { createLocale } from './locale'
import * as m from './loclizr/messages'

export function Switcher() {
  const locale = createLocale()
  return (
    <div>
      <For each={m.locales}>
        {(tag) => (
          <button type="button" aria-pressed={tag === locale()} onClick={() => m.setLocale(tag)}>
            {tag}
          </button>
        )}
      </For>
    </div>
  )
}
