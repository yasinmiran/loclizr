export function readCookie(header: string, name: string): string | null {
  for (const pair of header.split(';')) {
    const split = pair.indexOf('=')
    if (split === -1) continue
    if (pair.slice(0, split).trim() !== name) continue
    const value = decode(pair.slice(split + 1).trim())
    return value === '' ? null : value
  }
  return null
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}
