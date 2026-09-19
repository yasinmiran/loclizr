import { expect, test } from 'vitest'
import { getLocale, setLocale } from './locale'

test('setLocale changes the active locale', () => {
  setLocale('de')
  expect(getLocale()).toBe('de')
})
