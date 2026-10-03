import { afterEach, expect, test } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library'
import * as m from './loclizr/messages'
import App from './App'
import { KeyedRoot } from './KeyedRoot'

afterEach(() => {
  cleanup()
  m.setLocale('en')
})

test('per-call locale updates in place', () => {
  render(() => <App />)
  expect(screen.getByRole('heading').textContent).toBe('Hi Ada, your cart is ready')
  fireEvent.click(screen.getByRole('button', { name: 'de' }))
  expect(screen.getByRole('heading').textContent).toBe('Hallo Ada, dein Warenkorb ist bereit')
  expect(screen.getByText('3 Artikel in deinem Warenkorb')).toBeTruthy()
})

test('keyed root rebuilds on setLocale', () => {
  render(() => <KeyedRoot />)
  m.setLocale('de')
  expect(screen.getByRole('heading').textContent).toBe('Hallo Ada, dein Warenkorb ist bereit')
})

test('a bare call reads no signal and stays stale', () => {
  render(() => <h1>{m.cart_greeting({ name: 'Ada' })}</h1>)
  m.setLocale('de')
  expect(screen.getByRole('heading').textContent).toBe('Hi Ada, your cart is ready')
})
