import { readable } from 'svelte/store'
import { getLocale, subscribe } from './loclizr/messages'

export const localeStore = readable(getLocale(), (set) => {
  set(getLocale())
  return subscribe(() => set(getLocale()))
})
