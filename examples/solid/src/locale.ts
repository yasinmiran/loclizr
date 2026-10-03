import { createSignal, onCleanup, type Accessor } from 'solid-js'
import * as m from './loclizr/messages'

export function createLocale(): Accessor<m.AppLocale> {
  const [locale, setLocale] = createSignal(m.getLocale())
  onCleanup(m.subscribe(() => setLocale(m.getLocale())))
  return locale
}
