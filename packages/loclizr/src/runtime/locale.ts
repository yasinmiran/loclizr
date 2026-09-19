let current = 'en'

export function getLocale(): string {
  return current
}

export function setLocale(locale: string): void {
  current = locale
}
