import type { ReactElement } from 'react'
import { useLocale } from 'loclizr/react'
import * as m from './loclizr/messages'

const offered = [m.sourceLocale, ...m.locales.filter((tag) => tag !== m.sourceLocale)]

export function Switcher(): ReactElement {
  const locale = useLocale()
  const names = new Intl.DisplayNames([locale], { type: 'language' })
  return (
    <div className="switcher">
      <span className="label" id="switcher-label">
        {m.app_language()}
      </span>
      <div className="switcher__set" role="group" aria-labelledby="switcher-label">
        {offered.map((tag) => (
          <button
            key={tag}
            type="button"
            className={tag === locale ? 'switcher__tag switcher__tag--on' : 'switcher__tag'}
            aria-pressed={tag === locale}
            onClick={() => m.setLocale(tag)}
          >
            {names.of(tag) ?? tag}
          </button>
        ))}
      </div>
    </div>
  )
}
