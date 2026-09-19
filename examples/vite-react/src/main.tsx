import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { getLocale } from 'loclizr'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <p>{getLocale()}</p>
  </StrictMode>,
)
