// No 'use client' directive in v0.1, so Parts can render from a server
// component instead of forcing a client boundary.
import { createElement, Fragment, useEffect, useSyncExternalStore } from 'react'
import type { ReactElement, ReactNode } from 'react'
import type { Locale, SetLocaleOptions } from '../types'
import { warnOnce } from '../runtime/state'
import { getLocale, setLocale, subscribe } from '../runtime/store'

export function useLocale(): Locale {
  const locale = useSyncExternalStore(subscribe, getLocale, getLocale)
  useEffect(() => {
    // The whole body sits in the try because a minifier drops the code after a
    // folded return only within the same block.
    try {
      if (typeof document === 'undefined' || process.env.NODE_ENV === 'production') return
      const declared = document.documentElement.lang
      if (declared === locale) return
      document.documentElement.lang = locale
      // A missing attribute is not a server versus client disagreement, so it
      // keeps its own key and leaves the disagreement warning unspent.
      if (declared === '') {
        warnOnce(
          'html-lang-missing',
          '<html> carries no lang attribute, so a client with no cookie has nothing to read. Render lang from the Content-Language header withLocale sets.',
        )
        return
      }
      // Tags compare case-insensitively, as matchLocale does when it reads lang.
      if (declared.toLowerCase() === locale.toLowerCase()) return
      warnOnce(
        'html-lang',
        `<html lang="${declared}"> disagrees with the resolved locale "${locale}". Render lang from the Content-Language header withLocale sets.`,
      )
    } catch {}
  }, [locale])
  return locale
}

export function useSetLocale(): (locale: Locale, options?: SetLocaleOptions) => void {
  return setLocale
}

export function Parts(props: { readonly of: readonly (string | ReactNode)[] }): ReactElement {
  return createElement(Fragment, null, ...props.of)
}

export type { Locale, SetLocaleOptions } from '../types'
