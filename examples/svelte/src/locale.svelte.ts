import { createSubscriber } from 'svelte/reactivity'
import { getLocale, subscribe, type AppLocale } from './loclizr/messages'

const track = createSubscriber(subscribe)

export const locale = {
  get current(): AppLocale {
    track()
    return getLocale()
  },
}
