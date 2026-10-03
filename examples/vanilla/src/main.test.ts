// @vitest-environment jsdom
import { expect, test } from 'vitest'

test('a switch re-renders the page in German', async () => {
  document.body.innerHTML = '<div id="app"></div>'
  await import('./main')
  expect(document.querySelector('h1')?.textContent).toBe('Hi Ada, your cart is ready')

  const select = document.querySelector('select')!
  select.value = 'de'
  select.dispatchEvent(new Event('change'))

  expect(document.querySelector('h1')?.textContent).toBe('Hallo Ada, dein Warenkorb ist bereit')
  expect(document.querySelector('p')?.textContent).toBe('3 Artikel in deinem Warenkorb')
  expect(document.title).toBe('Warenkorb')
  expect(document.documentElement.lang).toBe('de')
})
