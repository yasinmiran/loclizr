import { describe, expect, test } from 'vitest'
import { diag, hasError, hasFatal } from './index'

describe('hasError and hasFatal over a mixed list', () => {
  // BuildResult.ok is `!hasError`: one surviving error among warnings means the
  // run is not ok, wherever that error sits.
  test('answers true for one error among warnings, wherever it sits', () => {
    const warning = diag('ambiguous-source', { message: 'Open' })
    const error = diag('arg-missing', { message: 'count' })
    expect(hasError([warning, error])).toBe(true)
    expect(hasError([error, warning])).toBe(true)
    expect(hasError([warning, error, warning])).toBe(true)
  })

  test('answers true for one fatal error among warnings, wherever it sits', () => {
    const warning = diag('ambiguous-source', { message: 'Open' })
    const fatal = diag('identifier-collision', { message: 'home.title' })
    expect(hasFatal([warning, fatal])).toBe(true)
    expect(hasFatal([fatal, warning])).toBe(true)
  })
})
