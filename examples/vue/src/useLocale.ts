import { onMounted, onUnmounted, shallowRef, type ShallowRef } from 'vue'
import * as m from './loclizr/messages'

export function useLocale(): ShallowRef<m.AppLocale> {
  const locale = shallowRef(m.getLocale())
  let off = (): void => {}
  onMounted(() => {
    off = m.subscribe(() => {
      locale.value = m.getLocale()
    })
  })
  onUnmounted(() => off())
  return locale
}
