import type {
  Arg,
  Body,
  Config,
  ExactBranch,
  Group,
  IntlOptions,
  LocaleOrigin,
  LocaleSpan,
  Message,
  Node,
  PluralBranch,
  Program,
  SelectBranch,
  Span,
} from '../../types'
import { hash16 } from '../../util'

export const SPAN: Span = { line: 1, column: 1, offset: 0, length: 1 }

export function text(value: string): Node {
  return { kind: 'text', value }
}

export function arg(name: string): Node {
  return { kind: 'arg', name }
}

export function num(name: string, style: string | null, options: IntlOptions): Node {
  return { kind: 'number', name, style, format: { kind: 'number', options } }
}

export function when(
  name: string,
  form: 'date' | 'time',
  style: string | null,
  options: IntlOptions,
): Node {
  return { kind: 'dateTime', name, form, style, format: { kind: 'dateTime', options } }
}

export function pound(): Node {
  return { kind: 'pound' }
}

export function plural(
  name: string,
  parts: {
    readonly ordinal?: boolean
    readonly offset?: number
    readonly exact?: readonly ExactBranch[]
    readonly branches: readonly PluralBranch[]
  },
): Node {
  return {
    kind: 'plural',
    name,
    ordinal: parts.ordinal ?? false,
    offset: parts.offset ?? 0,
    exact: parts.exact ?? [],
    branches: parts.branches,
  }
}

export function choice(name: string, branches: readonly SelectBranch[]): Node {
  return { kind: 'select', name, branches }
}

export function markup(name: string, children: readonly Node[]): Node {
  return { kind: 'markup', name, children }
}

export function body(locale: string, nodes: readonly Node[], args: readonly Arg[] = []): Body {
  return { locale, nodes, args, markupTags: markupTagsOf(nodes), format: 'icu' }
}

export function translated(locale: string): LocaleOrigin {
  return { locale, origin: { status: 'translated' } }
}

export function inherited(locale: string, from: string): LocaleOrigin {
  return { locale, origin: { status: 'inherited', from } }
}

export function fellBack(
  locale: string,
  from: string,
  reason: 'missing' | 'blank' | 'invalid',
): LocaleOrigin {
  return { locale, origin: { status: 'fallback', from, reason } }
}

export function message(parts: {
  readonly key: string
  readonly source: string
  readonly kind?: 'text' | 'markup'
  readonly args?: readonly Arg[]
  readonly description?: string | null
  readonly bodies: readonly Body[]
  readonly origins: readonly LocaleOrigin[]
  readonly identifier?: string
}): Message {
  const namespace = parts.key.includes('.') ? (parts.key.split('.')[0] ?? '_root') : '_root'
  const id = parts.identifier ?? parts.key.replaceAll('.', '_')
  const source = parts.bodies.find((entry) => entry.locale === 'en')
  return {
    key: parts.key,
    id,
    namespace,
    module: `messages/${namespace}.js`,
    kind: parts.kind ?? 'text',
    source: parts.source,
    sourceHash: hash16(parts.source),
    args: parts.args ?? [],
    markupTags: source === undefined ? [] : source.markupTags,
    description: parts.description ?? null,
    placeholders: [],
    bodies: parts.bodies,
    origins: parts.origins,
    spans: parts.bodies.map(
      (entry): LocaleSpan => ({ locale: entry.locale, file: `locales/${entry.locale}.json`, span: SPAN }),
    ),
  }
}

export function config(overrides: Partial<Config> = {}): Config {
  return {
    root: '/app',
    locales: ['en', 'de', 'de-AT'],
    sourceLocale: 'en',
    catalogs: 'locales/{locale}.json',
    catalogFormat: 'auto',
    i18nextMarkup: 'literal',
    meta: 'locales/{sourceLocale}.meta.json',
    outDir: 'src/loclizr',
    record: 'locales/loclizr.context.json',
    cookie: 'locale',
    augmentLocale: true,
    groups: {},
    identifiers: {},
    fallback: 'bcp47',
    formats: { timeZone: null, number: {}, dateTime: {} },
    scan: { include: ['src/**/*.{ts,tsx,js,jsx,mts,mjs}'], exclude: ['**/node_modules/**'] },
    severity: {},
    ...overrides,
  }
}

export function program(parts: {
  readonly messages: readonly Message[]
  readonly groups?: readonly Group[]
  readonly config?: Config
}): Program {
  const resolved = parts.config ?? config({ groups: parts.groups === undefined ? {} : { errors: 'errors' } })
  return {
    config: resolved,
    sourceLocale: resolved.sourceLocale,
    locales: resolved.locales,
    messages: parts.messages,
    extras: [],
    groups: parts.groups ?? [],
    usages: [],
    diagnostics: [],
  }
}

export const CURRENCY: IntlOptions = { currency: 'USD', style: 'currency' }

export const MEDIUM_DATE: IntlOptions = { dateStyle: 'medium' }

export const PLAIN: IntlOptions = {}

export const ERRORS_GROUP: Group = {
  name: 'errors',
  id: 'errors',
  typeBase: 'Errors',
  prefix: 'errors',
  members: [
    { key: 'errors.forbidden', id: 'errors_forbidden', member: 'forbidden' },
    { key: 'errors.not_found', id: 'errors_not_found', member: 'not_found' },
    { key: 'errors.rate_limited', id: 'errors_rate_limited', member: 'rate_limited' },
  ],
}

// The spec's worked example: three locales, de-AT a sparse overlay over de.
export function workedExample(): Program {
  return program({ messages: workedMessages(), groups: [ERRORS_GROUP] })
}

export function workedMessages(): readonly Message[] {
  return [
    message({
      key: 'cart.greeting',
      source: 'Hi {name}, your cart is ready',
      args: [{ name: 'name', type: { kind: 'stringish' } }],
      bodies: [
        body('en', [text('Hi '), arg('name'), text(', your cart is ready')]),
        body('de', [text('Hallo '), arg('name'), text(', dein Warenkorb ist fertig')]),
        body('de-AT', [text('Servus '), arg('name'), text(', dein Warenkorb ist fertig')]),
      ],
      origins: [translated('en'), translated('de'), translated('de-AT')],
    }),
    message({
      key: 'cart.items',
      source:
        '{count, plural, =0 {Your cart is empty} one {# item in your cart} other {# items in your cart}}',
      args: [{ name: 'count', type: { kind: 'number' } }],
      description: 'Badge under the cart icon on every page',
      bodies: [
        body('en', [
          plural('count', {
            exact: [{ value: 0, body: [text('Your cart is empty')] }],
            branches: [
              { keyword: 'one', body: [pound(), text(' item in your cart')] },
              { keyword: 'other', body: [pound(), text(' items in your cart')] },
            ],
          }),
        ]),
        body('de', [
          plural('count', {
            exact: [{ value: 0, body: [text('Dein Warenkorb ist leer')] }],
            branches: [
              { keyword: 'one', body: [arg('count'), text(' Artikel in deinem Warenkorb')] },
              { keyword: 'other', body: [arg('count'), text(' Artikel in deinem Warenkorb')] },
            ],
          }),
        ]),
      ],
      origins: [translated('en'), translated('de'), inherited('de-AT', 'de')],
    }),
    message({
      key: 'cart.total',
      source: 'Total: {amount, number, ::currency/USD}',
      args: [{ name: 'amount', type: { kind: 'number' } }],
      bodies: [
        body('en', [text('Total: '), num('amount', '::currency/USD', CURRENCY)]),
        body('de', [text('Summe: '), num('amount', '::currency/USD', CURRENCY)]),
      ],
      origins: [translated('en'), translated('de'), inherited('de-AT', 'de')],
    }),
    message({
      key: 'cart.updated',
      source: 'Updated {at, date, medium}',
      args: [{ name: 'at', type: { kind: 'date' } }],
      bodies: [
        body('en', [text('Updated '), when('at', 'date', 'medium', MEDIUM_DATE)]),
        body('de', [text('Aktualisiert '), when('at', 'date', 'medium', MEDIUM_DATE)]),
      ],
      origins: [translated('en'), translated('de'), inherited('de-AT', 'de')],
    }),
    message({
      key: 'errors.forbidden',
      source: 'You do not have access',
      bodies: [
        body('en', [text('You do not have access')]),
        body('de', [text('Du hast keinen Zugriff')]),
      ],
      origins: [translated('en'), translated('de'), inherited('de-AT', 'de')],
    }),
    message({
      key: 'errors.not_found',
      source: 'We could not find that page',
      bodies: [
        body('en', [text('We could not find that page')]),
        body('de', [text('Wir konnten die Seite nicht finden')]),
      ],
      origins: [translated('en'), translated('de'), inherited('de-AT', 'de')],
    }),
    message({
      key: 'errors.rate_limited',
      source: 'Too many requests. Try again in {seconds, number} seconds.',
      args: [{ name: 'seconds', type: { kind: 'number' } }],
      bodies: [
        body('en', [
          text('Too many requests. Try again in '),
          num('seconds', null, PLAIN),
          text(' seconds.'),
        ]),
        body('de', [
          text('Zu viele Anfragen. Versuche es in '),
          num('seconds', null, PLAIN),
          text(' Sekunden erneut.'),
        ]),
      ],
      origins: [translated('en'), translated('de'), inherited('de-AT', 'de')],
    }),
    message({
      key: 'nav.cart',
      source: 'Cart',
      bodies: [body('en', [text('Cart')]), body('de', [text('Warenkorb')])],
      origins: [translated('en'), translated('de'), inherited('de-AT', 'de')],
    }),
    message({
      key: 'nav.home',
      source: 'Home',
      bodies: [body('en', [text('Home')]), body('de', [text('Startseite')])],
      origins: [translated('en'), translated('de'), inherited('de-AT', 'de')],
    }),
    message({
      key: 'order.status',
      source: '{state, select, shipped {On its way} delivered {Delivered} other {Processing}}',
      args: [{ name: 'state', type: { kind: 'select', options: ['shipped', 'delivered'] } }],
      description: 'Chip in the order list. Past tense.',
      bodies: [
        body('en', [
          choice('state', [
            { option: 'shipped', body: [text('On its way')] },
            { option: 'delivered', body: [text('Delivered')] },
            { option: 'other', body: [text('Processing')] },
          ]),
        ]),
        body('de', [
          choice('state', [
            { option: 'shipped', body: [text('Unterwegs')] },
            { option: 'delivered', body: [text('Zugestellt')] },
            { option: 'other', body: [text('In Bearbeitung')] },
          ]),
        ]),
      ],
      origins: [translated('en'), translated('de'), inherited('de-AT', 'de')],
    }),
    message({
      key: 'terms.accept',
      source: 'Read our <link>terms</link> before you continue.',
      kind: 'markup',
      args: [{ name: 'link', type: { kind: 'markup' } }],
      bodies: [
        body('en', [text('Read our '), markup('link', [text('terms')]), text(' before you continue.')]),
        body('de', [
          text('Lies unsere '),
          markup('link', [text('AGB')]),
          text(', bevor du fortfährst.'),
        ]),
      ],
      origins: [translated('en'), translated('de'), inherited('de-AT', 'de')],
    }),
  ]
}

function markupTagsOf(nodes: readonly Node[]): readonly string[] {
  const tags: string[] = []
  const visit = (children: readonly Node[]): void => {
    for (const node of children) {
      switch (node.kind) {
        case 'markup':
          if (!tags.includes(node.name)) tags.push(node.name)
          visit(node.children)
          break
        case 'plural':
          for (const branch of node.exact) visit(branch.body)
          for (const branch of node.branches) visit(branch.body)
          break
        case 'select':
          for (const branch of node.branches) visit(branch.body)
          break
        default:
          break
      }
    }
  }
  visit(nodes)
  return tags
}
