import type { ReactElement, ReactNode } from 'react'
import { Parts } from 'loclizr/react'
import { errors, type ErrorsKey } from './loclizr/groups'
import * as m from './loclizr/messages'
import { Switcher } from './Switcher'

export type Delivery = Parameters<typeof m.order_status>[0]['state']

export interface Cart {
  readonly name: string
  readonly count: number
  readonly amount: number
  readonly at: string
  readonly delivery: Delivery
  readonly problem: ErrorsKey
  readonly seconds: number
}

interface AppProps {
  readonly cart: Cart
  readonly onChange: (patch: Partial<Cart>) => void
}

const deliveries: readonly Delivery[] = ['packing', 'shipped', 'delivered']
const problems: readonly ErrorsKey[] = ['forbidden', 'not_found', 'rate_limited']

export const defaultShopper = 'Ada'

export function App({ cart, onChange }: AppProps): ReactElement {
  const shopper = cart.name.trim() === '' ? defaultShopper : cart.name.trim()
  return (
    <>
      <header className="topbar" id="top">
        <div className="shell topbar__inner">
          <span className="wordmark">loclizr</span>
          <nav className="nav">
            <a className="nav__link" href="#top">
              {m.nav_home()}
            </a>
            <a className="nav__link nav__link--current" href="#cart" aria-current="page">
              {m.nav_cart()}
            </a>
          </nav>
          <Switcher />
        </div>
      </header>

      <section className="hero shell">
        <h1 className="hero__line">{m.cart_greeting({ name: shopper })}</h1>
        <div className="hero__foot">
          <p className="hero__note">{m.app_tagline()}</p>
          <div className="hero__field">
            <label className="label" htmlFor="shopper">
              {m.app_name()}
            </label>
            <input
              id="shopper"
              className="input input--name"
              type="text"
              value={cart.name}
              onChange={(event) => onChange({ name: event.target.value })}
            />
          </div>
        </div>
      </section>

      <section className="bench shell" id="cart">
        <h2 className="bench__title">{m.app_cart()}</h2>

        <div className="bench__card">
          <Row index={0} value={m.cart_items({ count: cart.count })}>
            <Field id="count" label={m.app_count()}>
              <div className="stepper">
                <button
                  type="button"
                  className="stepper__button"
                  aria-label={m.app_fewer()}
                  onClick={() => onChange({ count: Math.max(0, cart.count - 1) })}
                >
                  &#8722;
                </button>
                <input
                  id="count"
                  className="input input--number"
                  type="number"
                  min={0}
                  value={cart.count}
                  onChange={(event) => onChange({ count: wholeNumber(event.target.value) })}
                />
                <button
                  type="button"
                  className="stepper__button"
                  aria-label={m.app_more()}
                  onClick={() => onChange({ count: cart.count + 1 })}
                >
                  +
                </button>
              </div>
            </Field>
          </Row>

          <Row index={1} value={m.cart_total({ amount: cart.amount })}>
            <Field id="amount" label={m.app_amount()}>
              <input
                id="amount"
                className="input input--number"
                type="number"
                min={0}
                step={0.01}
                value={cart.amount}
                onChange={(event) => onChange({ amount: decimal(event.target.value) })}
              />
            </Field>
          </Row>

          <Row index={2} value={m.cart_updated({ at: new Date(`${cart.at}T12:00`) })}>
            <Field id="at" label={m.app_updated()}>
              <input
                id="at"
                className="input"
                type="date"
                value={cart.at}
                onChange={(event) => {
                  if (event.target.value !== '') onChange({ at: event.target.value })
                }}
              />
            </Field>
          </Row>

          <Row index={3} value={m.order_status({ state: cart.delivery })}>
            <Field id="delivery" label={m.app_delivery()}>
              <select
                id="delivery"
                className="input"
                value={cart.delivery}
                onChange={(event) => onChange({ delivery: event.target.value as Delivery })}
              >
                {deliveries.map((state) => (
                  <option key={state} value={state}>
                    {m.order_status({ state })}
                  </option>
                ))}
              </select>
            </Field>
          </Row>

          <Row index={4} value={errors[cart.problem]({ seconds: cart.seconds })}>
            <Field id="problem" label={m.app_problem()}>
              <select
                id="problem"
                className="input input--wide"
                value={cart.problem}
                onChange={(event) => onChange({ problem: event.target.value as ErrorsKey })}
              >
                {problems.map((problem) => (
                  <option key={problem} value={problem}>
                    {errors[problem]({ seconds: cart.seconds })}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="seconds" label={m.app_retry()}>
              <input
                id="seconds"
                className="input input--number"
                type="number"
                min={0}
                value={cart.seconds}
                onChange={(event) => onChange({ seconds: wholeNumber(event.target.value) })}
              />
            </Field>
          </Row>

          <p className="terms" id="terms">
            <Parts
              of={m.terms_accept({
                link: (chunks) => (
                  <a className="terms__link" href="#terms">
                    {chunks}
                  </a>
                ),
              })}
            />
          </p>
        </div>
      </section>
    </>
  )
}

interface RowProps {
  readonly index: number
  readonly value: ReactNode
  readonly children: ReactNode
}

function Row({ index, value, children }: RowProps): ReactElement {
  return (
    <div className="row">
      <div className="row__control">{children}</div>
      <p className="row__value" style={{ animationDelay: `${index * 30}ms` }}>
        {value}
      </p>
    </div>
  )
}

interface FieldProps {
  readonly id: string
  readonly label: string
  readonly children: ReactNode
}

function Field({ id, label, children }: FieldProps): ReactElement {
  return (
    <div className="field">
      <label className="label" htmlFor={id}>
        {label}
      </label>
      {children}
    </div>
  )
}

function wholeNumber(value: string): number {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function decimal(value: string): number {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}
