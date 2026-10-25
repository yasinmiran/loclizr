// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { computed, createSSRApp, defineComponent, h, nextTick, type ShallowRef } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { setLocale } from 'loclizr'
import { beforeEach, expect, test } from 'vitest'
import App from './App.vue'
import Root from './Root.vue'
import * as m from './loclizr/messages'
import { useLocale } from './useLocale'

beforeEach(() => {
  setLocale('en', { persist: false })
})

test('a computed that reads the ref updates; a child that does not stays stale', async () => {
  const wrapper = mount(App)
  setLocale('de', { persist: false })
  await nextTick()
  expect(wrapper.get('h1').text()).toBe('Hallo Ada, dein Warenkorb ist bereit')
  expect(wrapper.get('p').text()).toBe('3 items in your cart')
})

test('a key on the root re-renders every message', async () => {
  const wrapper = mount(Root)
  setLocale('de', { persist: false })
  await nextTick()
  expect(wrapper.get('h1').text()).toBe('Hallo Ada, dein Warenkorb ist bereit')
  expect(wrapper.get('p').text()).toBe('3 Artikel in deinem Warenkorb')
})

test('a computed that never reads the ref is cached', async () => {
  const Home = defineComponent(() => {
    const label = computed(() => m.nav_home())
    return () => h('span', label.value)
  })
  const wrapper = mount(Home)
  setLocale('de', { persist: false })
  await nextTick()
  expect(wrapper.text()).toBe('Home')
})

test('the subscription ends on unmount', () => {
  let locale!: ShallowRef<m.AppLocale>
  const Probe = defineComponent(() => {
    locale = useLocale()
    return () => h('span', locale.value)
  })
  mount(Probe).unmount()
  setLocale('de', { persist: false })
  expect(locale.value).toBe('en')
})

test('a server render leaves no subscription', async () => {
  let locale!: ShallowRef<m.AppLocale>
  const Probe = defineComponent(() => {
    locale = useLocale()
    return () => h('span', locale.value)
  })
  await renderToString(createSSRApp(Probe))
  setLocale('de', { persist: false })
  expect(locale.value).toBe('en')
})
