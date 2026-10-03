import * as m from './loclizr/messages'

const app = document.querySelector<HTMLDivElement>('#app')!
app.innerHTML = `
  <select id="locale" aria-label="Language"></select>
  <h1 id="greeting"></h1>
  <p id="items"></p>
`

const select = app.querySelector<HTMLSelectElement>('#locale')!
for (const tag of m.locales) select.add(new Option(tag, tag))
select.addEventListener('change', () => m.setLocale(select.value as m.AppLocale))

function render(): void {
  const locale = m.getLocale()
  select.value = locale
  document.documentElement.lang = locale
  document.title = m.nav_cart()
  app.querySelector('#greeting')!.textContent = m.cart_greeting({ name: 'Ada' })
  app.querySelector('#items')!.textContent = m.cart_items({ count: 3 })
}

m.subscribe(render)
render()
