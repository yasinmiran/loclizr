import * as m from '../loclizr/messages'
import type { AppLocale } from '../loclizr/messages'

export type OrderState = 'packing' | 'shipped' | 'delivered'

export interface DemoInput {
  readonly locale: AppLocale
  readonly name: string
  readonly count: number
  readonly state: OrderState
}

export const demoLocales: readonly AppLocale[] = ['en', 'de', 'fr', 'es', 'pt', 'it', 'pl', 'uk', 'ar', 'hi', 'ja', 'zh', 'ko']
export const orderStates: readonly OrderState[] = ['packing', 'shipped', 'delivered']
export const initialInput: DemoInput = { locale: 'en', name: 'Ada', count: 3, state: 'shipped' }

// Fixed at noon UTC so the rendered date is the same day in every time zone.
const updatedAt = Date.UTC(2026, 9, 3, 12)

export function languageName(locale: AppLocale): string {
  const name = new Intl.DisplayNames([locale], { type: 'language' }).of(locale) ?? locale
  return `${name.charAt(0).toLocaleUpperCase(locale)}${name.slice(1)} (${locale})`
}

// The docs page around the demo stays English, so every call names its locale
// rather than calling setLocale(), which would rewrite <html lang> for the page.
export function demoLines(input: DemoInput): string[] {
  const options = { locale: input.locale }
  return [
    m.demo_greeting({ name: input.name }, options),
    m.demo_items({ count: input.count }, options),
    m.demo_total({ amount: input.count * 24.5 }, options),
    m.demo_status({ state: input.state }, options),
    m.demo_updated({ at: updatedAt }, options),
  ]
}

export function mountLanguageDemo(root: HTMLElement): void {
  const locale = root.querySelector<HTMLSelectElement>('[name="locale"]')
  const name = root.querySelector<HTMLInputElement>('[name="name"]')
  const count = root.querySelector<HTMLInputElement>('[name="count"]')
  const state = root.querySelector<HTMLSelectElement>('[name="state"]')
  const output = root.querySelector<HTMLElement>('[data-output]')
  const call = root.querySelector<HTMLElement>('[data-call]')
  if (!locale || !name || !count || !state || !output || !call) return

  const render = (): void => {
    const input: DemoInput = {
      locale: locale.value as AppLocale,
      name: name.value,
      count: Math.max(0, Math.trunc(count.valueAsNumber || 0)),
      state: state.value as OrderState,
    }
    output.lang = input.locale
    output.dir = input.locale === 'ar' ? 'rtl' : 'ltr'
    output.replaceChildren(
      ...demoLines(input).map((line) => {
        const p = document.createElement('p')
        p.textContent = line
        return p
      }),
    )
    call.textContent = `m.demo_items({ count: ${input.count} }, { locale: '${input.locale}' })`
  }

  root.addEventListener('input', render)
  render()
}

export interface GridRow {
  readonly locale: AppLocale
  readonly items: string
  readonly total: string
}

export function gridRows(count: number): GridRow[] {
  return demoLocales.map((locale) => ({
    locale,
    items: m.demo_items({ count }, { locale }),
    total: m.demo_total({ amount: count * 24.5 }, { locale }),
  }))
}

export function mountLocaleGrid(root: HTMLElement): void {
  const count = root.querySelector<HTMLInputElement>('[name="count"]')
  const rows = root.querySelectorAll<HTMLElement>('[data-locale]')
  if (!count) return

  const render = (): void => {
    const byLocale = new Map(gridRows(Math.max(0, Math.trunc(count.valueAsNumber || 0))).map((row) => [row.locale, row]))
    for (const row of rows) {
      const cells = byLocale.get(row.dataset.locale as AppLocale)
      const [items, total] = row.querySelectorAll('td')
      if (!cells || !items || !total) continue
      items.textContent = cells.items
      total.textContent = cells.total
    }
  }

  root.addEventListener('input', render)
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-count]')) {
    button.addEventListener('click', () => {
      count.value = button.dataset.count ?? '0'
      render()
    })
  }
}
