export interface Io {
  out: (text: string) => void
  err: (text: string) => void
}

// A mutable object rather than two exported functions, so a test can replace
// one member without an ESM namespace binding in the way.
export const io: Io = {
  out: (text: string): void => {
    process.stdout.write(text)
  },
  err: (text: string): void => {
    process.stderr.write(text)
  },
}
