import type { AppLocale } from '../loclizr/messages'
import { home, nav, section, ui, type NavKey, type SectionKey } from '../loclizr/groups'
import { demoLocales } from './language-demo'

// The site's own language choice. It lives in localStorage, not in the locale
// cookie setLocale writes: the documentation stays English, and a cookie
// would make every page that imports messages set <html lang> to the choice.
// So every call names its locale, and translated elements carry their own
// lang and dir.
const storageKey = 'loclizr-site-locale'
const rightToLeft: ReadonlySet<AppLocale> = new Set(['ar'])

export const siteLocales: readonly AppLocale[] = demoLocales

export const sectionKeyByLabel: Readonly<Record<string, SectionKey>> = {
  'Start here': 'start',
  Guides: 'guides',
  Frameworks: 'frameworks',
  Reference: 'reference',
  Project: 'project',
}

function isLocale(value: string | null): value is AppLocale {
  return value !== null && (siteLocales as readonly string[]).includes(value)
}

export function storedLocale(): AppLocale {
  try {
    const value = localStorage.getItem(storageKey)
    return isLocale(value) ? value : 'en'
  } catch {
    return 'en'
  }
}

function storeLocale(locale: AppLocale): void {
  try {
    localStorage.setItem(storageKey, locale)
  } catch {
    // Private windows can refuse storage; the choice then lasts this page.
  }
}

function isKey<K extends string>(record: Readonly<Record<K, unknown>>, key: string): key is K {
  return Object.hasOwn(record, key)
}

// A sidebar slug such as guides/i18next-import is the nav key guides_i18next_import.
function navKeyFor(href: string): NavKey | null {
  const slug = href.slice(import.meta.env.BASE_URL.replace(/\/?$/, '/').length).replace(/\/$/, '')
  const key = slug.replace(/[/-]/g, '_')
  return isKey(nav, key) ? key : null
}

// The text goes in its own span carrying lang and dir, so an Arabic label
// reads right to left without flipping the link, its icon or the column.
function setText(element: Element, text: string, locale: AppLocale): void {
  let span = element.querySelector<HTMLSpanElement>(':scope > [data-translated]')
  if (!span) {
    const node = [...element.childNodes].reverse().find((child) => child.nodeType === Node.TEXT_NODE && child.textContent?.trim())
    span = document.createElement('span')
    span.dataset.translated = ''
    if (node) node.replaceWith(span)
    else element.append(span)
  }
  span.textContent = text
  span.lang = locale
  span.dir = rightToLeft.has(locale) ? 'rtl' : 'ltr'
}

export function applySiteLocale(locale: AppLocale): void {
  const options = { locale }
  for (const link of document.querySelectorAll<HTMLAnchorElement>('.sidebar-content a.entry-link, .mobile-nav-links a')) {
    const key = navKeyFor(link.getAttribute('href') ?? '')
    if (key) setText(link, nav[key]({}, options), locale)
  }
  for (const title of document.querySelectorAll<HTMLElement>('.sidebar-content .entry-title, .mobile-nav-label, [data-section]')) {
    // Sidebar headings carry no key in their markup, so the first pass reads
    // it from the English label and keeps it for the next switch.
    const key = title.dataset.section ?? sectionKeyByLabel[title.textContent?.trim() ?? '']
    if (key === undefined || !isKey(section, key)) continue
    title.dataset.section = key
    setText(title, section[key]({}, options), locale)
  }
  for (const element of document.querySelectorAll<HTMLElement>('[data-ui]')) {
    const key = element.dataset.ui ?? ''
    if (isKey(ui, key)) setText(element, ui[key]({}, options), locale)
  }
  const toc = document.querySelector('#starlight__on-this-page')
  if (toc) setText(toc, ui.onThisPage({}, options), locale)
  for (const select of document.querySelectorAll<HTMLSelectElement>('[data-site-language]')) select.title = ui.docsInEnglish({}, options)
  for (const label of document.querySelectorAll('site-search button[data-open-modal] > span')) setText(label, ui.search({}, options), locale)
  for (const element of document.querySelectorAll<HTMLElement>('[data-home]')) {
    const key = element.dataset.home ?? ''
    if (isKey(home, key)) setText(element, home[key]({}, options), locale)
  }
}

export function chooseSiteLocale(locale: AppLocale): void {
  storeLocale(locale)
  applySiteLocale(locale)
  for (const select of document.querySelectorAll<HTMLSelectElement>('[data-site-language]')) select.value = locale
}

export function mountSiteLanguage(select: HTMLSelectElement): void {
  select.value = storedLocale()
  select.addEventListener('change', () => {
    if (isLocale(select.value)) chooseSiteLocale(select.value)
  })
}
