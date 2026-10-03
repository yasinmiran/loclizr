import { onScopeDispose, shallowRef, type ShallowRef } from 'vue'
import * as m from './loclizr/messages'

export function useLocale(): ShallowRef<m.AppLocale> {
  const locale = shallowRef(m.getLocale())
  const off = m.subscribe(() => {
    locale.value = m.getLocale()
  })
  onScopeDispose(off)
  return locale
}
