import { createRoot } from 'react-dom/client'
import HeroReel from './HeroReel'

export function mountHeroReel(root: HTMLElement): void {
  createRoot(root).render(<HeroReel />)
}
