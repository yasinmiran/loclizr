import type { ReactElement, ReactNode } from 'react'
import type { Locale, SetLocaleOptions } from '../types'

export function useLocale(): Locale {
  throw new Error('not implemented')
}

export function useSetLocale(): (locale: Locale, options?: SetLocaleOptions) => void {
  throw new Error('not implemented')
}

export function Parts(props: { readonly of: readonly (string | ReactNode)[] }): ReactElement {
  throw new Error('not implemented')
}
