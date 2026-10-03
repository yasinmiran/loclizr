import { describe, expect, it } from 'vitest'
import type { Body, LocaleOrigin, Message, MessageUsage, Node, Program } from '../types'
import { message, program, site, span, threeLocales } from './__fixtures__/program'
import { buildRecord, checkDescriptions, serializeRecord } from './index'

const CART_ITEMS_SOURCE =
  '{count, plural, =0 {Your cart is empty} one {# item in your cart} other {# items in your cart}}'

const cartItemsNodes: readonly Node[] = [
  {
    kind: 'plural',
    name: 'count',
    ordinal: false,
    offset: 0,
    exact: [{ value: 0, body: [{ kind: 'text', value: 'Your cart is empty' }] }],
    branches: [
      { keyword: 'one', body: [{ kind: 'pound' }, { kind: 'text', value: ' item in your cart' }] },
      {
        keyword: 'other',
        body: [{ kind: 'pound' }, { kind: 'text', value: ' items in your cart' }],
      },
    ],
  },
]

function cartItems(): Message {
  return message({
    key: 'cart.items',
    id: 'cart_items',
    namespace: 'cart',
    source: CART_ITEMS_SOURCE,
    args: [{ name: 'count', type: { kind: 'number' } }],
    description: 'Badge under the cart icon on every page',
    placeholders: [{ name: 'count', note: 'Number of line items, not total quantity' }],
    nodes: cartItemsNodes,
    origins: threeLocales(),
  })
}

function navHome(): Message {
  return message({
    key: 'nav.home',
    id: 'nav_home',
    namespace: 'nav',
    source: 'Home',
    origins: threeLocales(),
  })
}

describe('buildRecord', () => {
  it('builds the worked example', () => {
    const record = buildRecord(
      program({
        messages: [navHome(), cartItems()],
        usages: [{ id: 'cart_items', sites: [site('src/Cart.tsx', 'Cart', 12, 8)] }],
      }),
    )

    expect(record).toEqual({
      schema: 1,
      sourceLocale: 'en',
      locales: ['de', 'de-AT', 'en'],
      messages: [
        {
          key: 'cart.items',
          id: 'cart_items',
          module: 'messages/cart.js',
          kind: 'text',
          source: CART_ITEMS_SOURCE,
          sourceHash: 'a826cf6a40d3293e',
          description: 'Badge under the cart icon on every page',
          args: [
            {
              name: 'count',
              type: 'number',
              options: null,
              note: 'Number of line items, not total quantity',
            },
          ],
          variants: [{ arg: 'count', kind: 'plural', matches: ['=0', 'one', 'other'] }],
          markup: [],
          translations: [
            { locale: 'de', status: 'translated', from: null, reason: null },
            { locale: 'de-AT', status: 'inherited', from: 'de', reason: null },
            { locale: 'en', status: 'translated', from: null, reason: null },
          ],
          usage: [{ file: 'src/Cart.tsx', scope: 'Cart' }],
        },
        {
          key: 'nav.home',
          id: 'nav_home',
          module: 'messages/nav.js',
          kind: 'text',
          source: 'Home',
          sourceHash: '3a78695388b38b5c',
          description: null,
          args: [],
          variants: [],
          markup: [],
          translations: [
            { locale: 'de', status: 'translated', from: null, reason: null },
            { locale: 'de-AT', status: 'inherited', from: 'de', reason: null },
            { locale: 'en', status: 'translated', from: null, reason: null },
          ],
          usage: [],
        },
      ],
    })
  })

  it('sorts messages by key by code point', () => {
    const keys = ['nav.home', 'Nav.home', 'cart.items', 'cart.Items']
    const messages = keys.map((key, index) =>
      message({ key, id: `m${index}`, namespace: 'n', source: key }),
    )

    const record = buildRecord(program({ messages }))

    expect(record.messages.map((entry) => entry.key)).toEqual([
      'Nav.home',
      'cart.Items',
      'cart.items',
      'nav.home',
    ])
  })

  it('sorts locales and keeps Message.args order verbatim', () => {
    const record = buildRecord(
      program({
        locales: ['fr', 'de-AT', 'en', 'de'],
        messages: [
          message({
            key: 'a',
            id: 'a',
            namespace: 'n',
            source: '{zed} {alpha}',
            args: [
              { name: 'zed', type: { kind: 'stringish' } },
              { name: 'alpha', type: { kind: 'date' } },
            ],
          }),
        ],
      }),
    )

    expect(record.locales).toEqual(['de', 'de-AT', 'en', 'fr'])
    expect(record.messages[0]?.args).toEqual([
      { name: 'zed', type: 'text', options: null, note: null },
      { name: 'alpha', type: 'date', options: null, note: null },
    ])
  })

  it('carries a select argument as its source options and its branch matches', () => {
    const nodes: readonly Node[] = [
      {
        kind: 'select',
        name: 'state',
        branches: [
          { option: 'shipped', body: [{ kind: 'text', value: 'On its way' }] },
          { option: 'other', body: [{ kind: 'text', value: 'Processing' }] },
          { option: 'delivered', body: [{ kind: 'text', value: 'Delivered' }] },
        ],
      },
    ]

    const record = buildRecord(
      program({
        messages: [
          message({
            key: 'order.status',
            id: 'order_status',
            namespace: 'order',
            source: 'x',
            args: [{ name: 'state', type: { kind: 'select', options: ['shipped', 'delivered'] } }],
            nodes,
          }),
        ],
      }),
    )

    expect(record.messages[0]?.args).toEqual([
      { name: 'state', type: 'select', options: ['shipped', 'delivered'], note: null },
    ])
    expect(record.messages[0]?.variants).toEqual([
      { arg: 'state', kind: 'select', matches: ['shipped', 'delivered', 'other'] },
    ])
  })

  it('merges exact branches ascending and keyword branches in CLDR order', () => {
    const nodes: readonly Node[] = [
      {
        kind: 'plural',
        name: 'count',
        ordinal: false,
        offset: 0,
        exact: [
          { value: 7, body: [] },
          { value: 0, body: [] },
          { value: 2, body: [] },
        ],
        branches: [
          { keyword: 'other', body: [] },
          { keyword: 'one', body: [] },
          { keyword: 'few', body: [] },
          { keyword: 'zero', body: [] },
        ],
      },
    ]

    const record = buildRecord(
      program({ messages: [message({ key: 'a', id: 'a', namespace: 'n', source: 'x', nodes })] }),
    )

    expect(record.messages[0]?.variants).toEqual([
      { arg: 'count', kind: 'plural', matches: ['=0', '=2', '=7', 'zero', 'one', 'few', 'other'] },
    ])
  })

  it('marks an ordinal plural as selectordinal', () => {
    const nodes: readonly Node[] = [
      {
        kind: 'plural',
        name: 'place',
        ordinal: true,
        offset: 0,
        exact: [],
        branches: [
          { keyword: 'other', body: [] },
          { keyword: 'two', body: [] },
        ],
      },
    ]

    const record = buildRecord(
      program({ messages: [message({ key: 'a', id: 'a', namespace: 'n', source: 'x', nodes })] }),
    )

    expect(record.messages[0]?.variants).toEqual([
      { arg: 'place', kind: 'selectordinal', matches: ['two', 'other'] },
    ])
  })

  it('collects nested variants in pre-order through plural, select and markup bodies', () => {
    const nodes: readonly Node[] = [
      {
        kind: 'markup',
        name: 'link',
        children: [
          {
            kind: 'plural',
            name: 'count',
            ordinal: false,
            offset: 1,
            exact: [
              {
                value: 0,
                body: [
                  {
                    kind: 'select',
                    name: 'exact',
                    branches: [{ option: 'other', body: [] }],
                  },
                ],
              },
            ],
            branches: [
              {
                keyword: 'other',
                body: [
                  {
                    kind: 'select',
                    name: 'gender',
                    branches: [
                      { option: 'other', body: [] },
                      { option: 'female', body: [] },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ]

    const record = buildRecord(
      program({ messages: [message({ key: 'a', id: 'a', namespace: 'n', source: 'x', nodes })] }),
    )

    expect(record.messages[0]?.variants).toEqual([
      { arg: 'count', kind: 'plural', matches: ['=0', 'other'] },
      { arg: 'exact', kind: 'select', matches: ['other'] },
      { arg: 'gender', kind: 'select', matches: ['female', 'other'] },
    ])
  })

  it('reads the source locale body rather than the first body', () => {
    const germanOnly: Body = {
      locale: 'de',
      format: 'icu',
      nodes: [
        {
          kind: 'plural',
          name: 'count',
          ordinal: false,
          offset: 0,
          exact: [],
          branches: [{ keyword: 'other', body: [] }],
        },
      ],
      args: [],
      markupTags: [],
    }
    const english: Body = { locale: 'en', format: 'icu', nodes: [{ kind: 'text', value: 'Home' }], args: [], markupTags: [] }

    const record = buildRecord(
      program({
        messages: [
          message({
            key: 'a',
            id: 'a',
            namespace: 'n',
            source: 'Home',
            bodies: [germanOnly, english],
          }),
        ],
      }),
    )

    expect(record.messages[0]?.variants).toEqual([])
  })

  it('attaches a placeholder note across an NFC and NFD spelling', () => {
    const record = buildRecord(
      program({
        messages: [
          message({
            key: 'a',
            id: 'a',
            namespace: 'n',
            source: '{café}',
            args: [{ name: 'café', type: { kind: 'stringish' } }],
            placeholders: [{ name: 'café', note: 'The shop name' }],
          }),
        ],
      }),
    )

    expect(record.messages[0]?.args[0]?.note).toBe('The shop name')
  })

  it('dedups and sorts markup tags', () => {
    const record = buildRecord(
      program({
        messages: [
          message({
            key: 'a',
            id: 'a',
            namespace: 'n',
            source: 'x',
            kind: 'markup',
            markupTags: ['link', 'b', 'link'],
            args: [
              { name: 'link', type: { kind: 'markup' } },
              { name: 'b', type: { kind: 'markup' } },
            ],
            description: 'Consent line under the checkout button',
          }),
        ],
      }),
    )

    expect(record.messages[0]?.kind).toBe('markup')
    expect(record.messages[0]?.markup).toEqual(['b', 'link'])
  })

  it('prints Message.module rather than deriving one from the namespace', () => {
    const record = buildRecord(
      program({
        messages: [
          message({
            key: 'cart.items',
            id: 'cart_items',
            namespace: 'cart',
            module: 'messages/checkout.js',
            source: 'Hi',
          }),
        ],
      }),
    )

    expect(record.messages[0]?.module).toBe('messages/checkout.js')
  })

  it('carries a fallback origin with its source and its reason', () => {
    const origins: readonly LocaleOrigin[] = [
      { locale: 'en', origin: { status: 'translated' } },
      { locale: 'de', origin: { status: 'fallback', from: 'en', reason: 'blank' } },
      { locale: 'de-AT', origin: { status: 'fallback', from: 'en', reason: 'invalid' } },
    ]

    const record = buildRecord(
      program({
        messages: [message({ key: 'a', id: 'a', namespace: 'n', source: 'x', origins })],
      }),
    )

    expect(record.messages[0]?.translations).toEqual([
      { locale: 'de', status: 'fallback', from: 'en', reason: 'blank' },
      { locale: 'de-AT', status: 'fallback', from: 'en', reason: 'invalid' },
      { locale: 'en', status: 'translated', from: null, reason: null },
    ])
  })

  it('dedups usage by file and scope, sorts it, and drops position', () => {
    const usages: readonly MessageUsage[] = [
      {
        id: 'a',
        sites: [
          site('src/Header.tsx', 'Header', 31, 9),
          site('src/Cart.tsx', 'Cart', 12, 8),
          site('src/Cart.tsx', 'Cart', 48, 3),
          site('src/Cart.tsx', null, 2, 1),
          site('src/Cart.tsx', 'Badge', 60, 5),
        ],
      },
    ]

    const record = buildRecord(
      program({
        messages: [message({ key: 'a', id: 'a', namespace: 'n', source: 'x' })],
        usages,
      }),
    )

    expect(record.messages[0]?.usage).toEqual([
      { file: 'src/Cart.tsx', scope: null },
      { file: 'src/Cart.tsx', scope: 'Badge' },
      { file: 'src/Cart.tsx', scope: 'Cart' },
      { file: 'src/Header.tsx', scope: 'Header' },
    ])
    const text = serializeRecord(record)
    expect(text).not.toContain('"line"')
    expect(text).not.toContain('"column"')
    expect(text).not.toContain('"snippet"')
  })

  it('never reads a previous record, so an unknown id yields no usage', () => {
    const record = buildRecord(
      program({
        messages: [message({ key: 'a', id: 'a', namespace: 'n', source: 'x' })],
        usages: [{ id: 'gone', sites: [site('src/Old.tsx', 'Old', 1, 1)] }],
      }),
    )

    expect(record.messages[0]?.usage).toEqual([])
  })

  it('produces identical bytes when every unordered array is reversed', () => {
    const usages: readonly MessageUsage[] = [
      {
        id: 'cart_items',
        sites: [site('src/Cart.tsx', 'Cart', 12, 8), site('src/Badge.tsx', 'Badge', 4, 2)],
      },
    ]
    const forward = program({
      messages: [cartItems(), navHome()],
      locales: ['en', 'de', 'de-AT'],
      usages,
    })

    expect(serializeRecord(buildRecord(reversed(forward)))).toBe(
      serializeRecord(buildRecord(forward)),
    )
  })
})

describe('serializeRecord', () => {
  it('writes two-space JSON with LF endings and a trailing newline', () => {
    const record = buildRecord(program({ messages: [navHome()] }))

    expect(serializeRecord(record)).toBe(`{
  "schema": 1,
  "sourceLocale": "en",
  "locales": [
    "de",
    "de-AT",
    "en"
  ],
  "messages": [
    {
      "key": "nav.home",
      "id": "nav_home",
      "module": "messages/nav.js",
      "kind": "text",
      "source": "Home",
      "sourceHash": "3a78695388b38b5c",
      "description": null,
      "args": [],
      "variants": [],
      "markup": [],
      "translations": [
        {
          "locale": "de",
          "status": "translated",
          "from": null,
          "reason": null
        },
        {
          "locale": "de-AT",
          "status": "inherited",
          "from": "de",
          "reason": null
        },
        {
          "locale": "en",
          "status": "translated",
          "from": null,
          "reason": null
        }
      ],
      "usage": []
    }
  ]
}
`)
  })

  it('escapes a carriage return in source text rather than writing one', () => {
    const record = buildRecord(
      program({
        messages: [message({ key: 'a', id: 'a', namespace: 'n', source: 'one\r\ntwo' })],
      }),
    )

    const text = serializeRecord(record)
    expect(text).not.toContain('\r')
    expect(text).toContain('"source": "one\\r\\ntwo"')
  })

  it('round-trips through JSON.parse', () => {
    const record = buildRecord(
      program({
        messages: [cartItems(), navHome()],
        usages: [{ id: 'cart_items', sites: [site('src/Cart.tsx', 'Cart', 12, 8)] }],
      }),
    )

    expect(JSON.parse(serializeRecord(record))).toEqual(record)
  })

  it('escapes bidi controls and line separators so a diff viewer cannot reorder them', () => {
    const hostile = '\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069\u2028\u2029'
    const record = buildRecord(
      program({
        messages: [message({ key: 'a', id: 'a', namespace: 'n', source: `x${hostile}y` })],
        usages: [{ id: 'a', sites: [site('src/Cart\u202ets.ts', 'Cart', 1, 1)] }],
      }),
    )

    const text = serializeRecord(record)
    expect(text).not.toMatch(/[\u202a-\u202e\u2066-\u2069\u2028\u2029]/)
    expect(text).toContain(
      '"source": "x\\u202a\\u202b\\u202c\\u202d\\u202e\\u2066\\u2067\\u2068\\u2069\\u2028\\u2029y"',
    )
    expect(text).toContain('"file": "src/Cart\\u202ets.ts"')
    expect(JSON.parse(text)).toEqual(record)
  })
})

describe('checkDescriptions', () => {
  it('reports a message that takes arguments and has no description', () => {
    const diagnostics = checkDescriptions(
      program({
        messages: [
          message({
            key: 'cart.items',
            id: 'cart_items',
            namespace: 'cart',
            source: CART_ITEMS_SOURCE,
            args: [{ name: 'count', type: { kind: 'number' } }],
            spans: [{ locale: 'en', file: 'locales/en.json', span: span(12, 5, 214) }],
          }),
        ],
      }),
    )

    expect(diagnostics).toHaveLength(1)
    const [diagnostic] = diagnostics
    expect(diagnostic?.code).toBe('LZ5006')
    expect(diagnostic?.rule).toBe('missing-description')
    expect(diagnostic?.severity).toBe('warn')
    expect(diagnostic?.fatal).toBe(false)
    expect(diagnostic?.key).toBe('cart.items')
    expect(diagnostic?.file).toBe('locales/en.json')
    expect(diagnostic?.span).toEqual(span(12, 5, 214))
    expect(diagnostic?.message).toContain('count')
    expect(diagnostic?.hint).toContain('locales/en.meta.json')
    expect(diagnostic?.hint).toContain('"cart.items"')
  })

  it('names the tags of a message whose only arguments are markup handlers', () => {
    const diagnostics = checkDescriptions(
      program({
        messages: [
          message({
            key: 'terms.accept',
            id: 'terms_accept',
            namespace: 'terms',
            source: 'Read our <b><link>terms</link></b>.',
            kind: 'markup',
            markupTags: ['link', 'b'],
            args: [
              { name: 'b', type: { kind: 'markup' } },
              { name: 'link', type: { kind: 'markup' } },
            ],
          }),
        ],
      }),
    )

    expect(diagnostics.map((diagnostic) => diagnostic.key)).toEqual(['terms.accept'])
    expect(diagnostics[0]?.message).toContain('carries markup b, link')
  })

  it('names every argument of a message mixing markup with a value', () => {
    const diagnostics = checkDescriptions(
      program({
        messages: [
          message({
            key: 'cart.left',
            id: 'cart_left',
            namespace: 'cart',
            source: '<link>{count, number}</link> left',
            kind: 'markup',
            markupTags: ['link'],
            args: [
              { name: 'link', type: { kind: 'markup' } },
              { name: 'count', type: { kind: 'number' } },
            ],
          }),
        ],
      }),
    )

    expect(diagnostics[0]?.message).toContain('takes link, count')
  })

  it('stays quiet for a described message and for one with neither arguments nor markup', () => {
    const diagnostics = checkDescriptions(
      program({
        messages: [
          message({ key: 'nav.home', id: 'nav_home', namespace: 'nav', source: 'Home' }),
          message({
            key: 'cart.greeting',
            id: 'cart_greeting',
            namespace: 'cart',
            source: 'Hi {name}',
            args: [{ name: 'name', type: { kind: 'stringish' } }],
            description: 'Greeting above the cart list',
          }),
        ],
      }),
    )

    expect(diagnostics).toEqual([])
  })

  it('names the config when the sidecar is switched off', () => {
    const diagnostics = checkDescriptions(
      program({
        meta: false,
        messages: [
          message({
            key: 'a',
            id: 'a',
            namespace: 'n',
            source: '{x}',
            args: [{ name: 'x', type: { kind: 'stringish' } }],
          }),
        ],
      }),
    )

    expect(diagnostics[0]?.hint).toBe(
      'set meta in loclizr.config.ts to switch the description sidecar on.',
    )
  })

  it('reports in key order', () => {
    const keys = ['nav.home', 'cart.items', 'errors.forbidden']
    const diagnostics = checkDescriptions(
      program({
        messages: keys.map((key, index) =>
          message({
            key,
            id: `m${index}`,
            namespace: 'n',
            source: '{x}',
            args: [{ name: 'x', type: { kind: 'stringish' } }],
          }),
        ),
      }),
    )

    expect(diagnostics.map((diagnostic) => diagnostic.key)).toEqual([
      'cart.items',
      'errors.forbidden',
      'nav.home',
    ])
  })
})

function reversed(input: Program): Program {
  return {
    ...input,
    locales: [...input.locales].reverse(),
    messages: [...input.messages].reverse().map((entry) => ({
      ...entry,
      bodies: [...entry.bodies].reverse(),
      origins: [...entry.origins].reverse(),
      spans: [...entry.spans].reverse(),
      placeholders: [...entry.placeholders].reverse(),
    })),
    usages: [...input.usages]
      .reverse()
      .map((usage) => ({ ...usage, sites: [...usage.sites].reverse() })),
  }
}
