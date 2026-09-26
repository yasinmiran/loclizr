import { useState, type ReactElement } from 'react'
import { useLocale } from 'loclizr/react'
import * as m from './loclizr/messages'

export function CourierNote(): ReactElement {
  const locale = useLocale()
  const [note, setNote] = useState('')
  return (
    <section className="note">
      <div className="shell note__inner">
        <label className="label" htmlFor="note">
          {m.app_note({}, { locale })}
        </label>
        <textarea
          id="note"
          className="note__input"
          rows={2}
          value={note}
          placeholder={m.app_notePlaceholder({}, { locale })}
          onChange={(event) => setNote(event.target.value)}
        />
        <p className="note__hint">{m.app_noteKeeps({}, { locale })}</p>
      </div>
    </section>
  )
}
