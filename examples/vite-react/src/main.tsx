import { StrictMode, useState, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { useLocale } from 'loclizr/react'
import { App, defaultShopper, type Cart } from './App'
import { CourierNote } from './CourierNote'
import './styles.css'

const openingCart: Cart = {
  name: defaultShopper,
  count: 3,
  amount: 42.5,
  at: '2026-09-26',
  delivery: 'shipped',
  problem: 'rate_limited',
  seconds: 30,
}

function Shop(): ReactElement {
  const locale = useLocale()
  const [cart, setCart] = useState(openingCart)
  return (
    <>
      <App
        key={locale}
        cart={cart}
        onChange={(patch) => setCart((current) => ({ ...current, ...patch }))}
      />
      <CourierNote />
    </>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Shop />
  </StrictMode>,
)
