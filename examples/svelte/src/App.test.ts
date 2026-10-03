import { afterEach, expect, test } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'
import * as m from './loclizr/messages'
import App from './App.svelte'

let app: ReturnType<typeof mount> | undefined

afterEach(() => {
  if (app) unmount(app)
  m.setLocale('en')
  flushSync()
})

test('a switch re-renders the heading and keeps the cart count', () => {
  app = mount(App, { target: document.body })
  document.querySelector<HTMLButtonElement>('p + button')?.click()
  flushSync()
  expect(document.querySelector('h1')?.textContent).toBe('Hi Ada, your cart is ready')
  expect(document.querySelector('p')?.textContent).toBe('4 items in your cart')

  m.setLocale('de')
  flushSync()

  expect(document.querySelector('h1')?.textContent).toBe('Hallo Ada, dein Warenkorb ist bereit')
  expect(document.querySelector('p')?.textContent).toBe('4 Artikel in deinem Warenkorb')
})
