export function readCookie(header: string, name: string): string | null {
  for (const pair of header.split(';')) {
    const split = pair.indexOf('=')
    if (split === -1) continue
    if (pair.slice(0, split).trim() !== name) continue
    const value = decode(unquote(pair.slice(split + 1).trim()))
    return value === '' ? null : value
  }
  return null
}

// RFC 6265 lets a cookie value sit inside one pair of double quotes, and the
// common server-side parsers strip them, so a backend may write the locale that way.
function unquote(value: string): string {
  return value.length >= 2 && value.startsWith('"') && value.endsWith('"')
    ? value.slice(1, -1)
    : value
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}
