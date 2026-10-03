import { describe, expect, it } from 'vitest'
import type {
  Body,
  LocaleOrigin,
  Message,
  MessageUsage,
  Node,
  PlaceholderNote,
  Program,
} from '../types'
import { message, program, site, threeLocales } from './__fixtures__/program'
import { buildRecord, serializeRecord } from './index'

const CART_ITEMS_SOURCE =
  '{count, plural, =0 {Your cart is empty} one {# item in your cart} other {# items in your cart}}'

const CART_ITEMS_NODES: readonly Node[] = [
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
    nodes: CART_ITEMS_NODES,
    bodies: [
      {
        locale: 'en',
        format: 'icu',
        nodes: CART_ITEMS_NODES,
        args: [{ name: 'count', type: { kind: 'number' } }],
        markupTags: [],
      },
    ],
    origins: threeLocales(),
  })
}

function reverseUsages(input: Program): Program {
  return { ...input, usages: [...input.usages].reverse() }
}

function reversePlaceholders(input: Program): Program {
  return {
    ...input,
    messages: input.messages.map((entry) => ({
      ...entry,
      placeholders: [...entry.placeholders].reverse(),
    })),
  }
}

describe('buildRecord under hostile input', () => {
  it('keeps every usage site when two usage entries carry one message id', () => {
    const usages: readonly MessageUsage[] = [
      { id: 'a', sites: [site('src/Badge.tsx', 'Badge', 4, 2)] },
      { id: 'a', sites: [site('src/Cart.tsx', 'Cart', 12, 8)] },
    ]

    const record = buildRecord(
      program({
        messages: [message({ key: 'a', id: 'a', namespace: 'n', source: 'x' })],
        usages,
      }),
    )

    expect(record.messages[0]?.usage).toEqual([
      { file: 'src/Badge.tsx', scope: 'Badge' },
      { file: 'src/Cart.tsx', scope: 'Cart' },
    ])
  })

  it('writes the same bytes when Program.usages is reversed', () => {
    const forward = program({
      messages: [message({ key: 'a', id: 'a', namespace: 'n', source: 'x' })],
      usages: [
        { id: 'a', sites: [site('src/Badge.tsx', 'Badge', 4, 2)] },
        { id: 'a', sites: [site('src/Cart.tsx', 'Cart', 12, 8)] },
      ],
    })

    expect(serializeRecord(buildRecord(reverseUsages(forward)))).toBe(
      serializeRecord(buildRecord(forward)),
    )
  })

  it('ranks an invented keyword between many and other, where the source prints it', () => {
    const nodes: readonly Node[] = [
      {
        kind: 'plural',
        name: 'count',
        ordinal: false,
        offset: 0,
        exact: [],
        branches: [
          { keyword: 'one', body: [] },
          { keyword: 'bogus', body: [] },
          { keyword: 'zombie', body: [] },
          { keyword: 'other', body: [] },
        ],
      },
    ]

    const record = buildRecord(
      program({
        messages: [
          message({
            key: 'a',
            id: 'a',
            namespace: 'n',
            source: '{count, plural, one {A} bogus {B} zombie {C} other {D}}',
            nodes,
          }),
        ],
      }),
    )

    expect(record.messages[0]?.variants).toEqual([
      { arg: 'count', kind: 'plural', matches: ['one', 'bogus', 'zombie', 'other'] },
    ])
  })

  it('keeps the note spelled like the argument, whichever end of the sidecar it sits at', () => {
    const composed = 'café'
    const decomposed = 'café'
    const withNotes = (notes: readonly PlaceholderNote[]): Program =>
      program({
        messages: [
          message({
            key: 'a',
            id: 'a',
            namespace: 'n',
            source: `{${composed}}`,
            args: [{ name: composed, type: { kind: 'stringish' } }],
            placeholders: notes,
          }),
        ],
      })

    const first = buildRecord(
      withNotes([
        { name: composed, note: 'Composed spelling' },
        { name: decomposed, note: 'Decomposed spelling' },
      ]),
    )
    const second = buildRecord(
      withNotes([
        { name: decomposed, note: 'Decomposed spelling' },
        { name: composed, note: 'Composed spelling' },
      ]),
    )

    expect(first.messages[0]?.args[0]?.note).toBe('Composed spelling')
    expect(second.messages[0]?.args[0]?.note).toBe('Composed spelling')
  })

  it('picks between two spellings that both differ from the argument by code point', () => {
    const name = 'cafȩ́'.normalize('NFC')
    const notes: readonly PlaceholderNote[] = [
      { name: 'cafȩ́', note: 'Acute first' },
      { name: 'cafȩ́', note: 'Cedilla first' },
    ]
    const noteOf = (placeholders: readonly PlaceholderNote[]): string | null =>
      buildRecord(
        program({
          messages: [
            message({
              key: 'a',
              id: 'a',
              namespace: 'n',
              source: `{${name}}`,
              args: [{ name, type: { kind: 'stringish' } }],
              placeholders,
            }),
          ],
        }),
      ).messages[0]?.args[0]?.note ?? null

    expect(noteOf(notes)).toBe('Acute first')
    expect(noteOf([...notes].reverse())).toBe('Acute first')
  })

  it('writes the same bytes when two notes normalize to one argument name', () => {
    const forward = program({
      messages: [
        message({
          key: 'a',
          id: 'a',
          namespace: 'n',
          source: '{café}',
          args: [{ name: 'café', type: { kind: 'stringish' } }],
          placeholders: [
            { name: 'café', note: 'Composed spelling' },
            { name: 'café', note: 'Decomposed spelling' },
          ],
        }),
      ],
    })

    expect(serializeRecord(buildRecord(reversePlaceholders(forward)))).toBe(
      serializeRecord(buildRecord(forward)),
    )
  })

  it('orders exact branches by numeric value rather than by printed text', () => {
    const nodes: readonly Node[] = [
      {
        kind: 'plural',
        name: 'count',
        ordinal: false,
        offset: 0,
        exact: [
          { value: 10, body: [] },
          { value: 2, body: [] },
          { value: 1, body: [] },
          { value: 0, body: [] },
        ],
        branches: [{ keyword: 'other', body: [] }],
      },
    ]

    const record = buildRecord(
      program({ messages: [message({ key: 'a', id: 'a', namespace: 'n', source: 'x', nodes })] }),
    )

    expect(record.messages[0]?.variants).toEqual([
      { arg: 'count', kind: 'plural', matches: ['=0', '=1', '=2', '=10', 'other'] },
    ])
  })

  it('sorts keys by code point across the astral plane', () => {
    const keys = ['�', '\u{1F600}', '']
    const messages = keys.map((key, index) =>
      message({ key, id: `m${index}`, namespace: 'n', source: key }),
    )

    const record = buildRecord(program({ messages }))

    expect(record.messages.map((entry) => entry.key)).toEqual(['', '�', '\u{1F600}'])
  })

  it('keeps a plural offset out of the variant matches', () => {
    const nodes: readonly Node[] = [
      {
        kind: 'plural',
        name: 'count',
        ordinal: false,
        offset: 3,
        exact: [{ value: 1, body: [] }],
        branches: [
          { keyword: 'one', body: [] },
          { keyword: 'other', body: [] },
        ],
      },
    ]

    const record = buildRecord(
      program({ messages: [message({ key: 'a', id: 'a', namespace: 'n', source: 'x', nodes })] }),
    )

    expect(record.messages[0]?.variants).toEqual([
      { arg: 'count', kind: 'plural', matches: ['=1', 'one', 'other'] },
    ])
  })

  it('copies a prototype member name verbatim and reads its note off no prototype', () => {
    const record = buildRecord(
      program({
        messages: [
          message({
            key: 'a',
            id: 'a',
            namespace: 'n',
            source: '{__proto__} {constructor} {toString}',
            args: [
              { name: '__proto__', type: { kind: 'stringish' } },
              { name: 'constructor', type: { kind: 'stringish' } },
              { name: 'toString', type: { kind: 'stringish' } },
            ],
            placeholders: [{ name: '__proto__', note: 'The literal key a translator sees' }],
          }),
        ],
      }),
    )

    expect(record.messages[0]?.args).toEqual([
      {
        name: '__proto__',
        type: 'text',
        options: null,
        note: 'The literal key a translator sees',
      },
      { name: 'constructor', type: 'text', options: null, note: null },
      { name: 'toString', type: 'text', options: null, note: null },
    ])
  })

  it('transcribes an origin that contradicts the locale own body', () => {
    const germanBody: Body = {
      locale: 'de',
      format: 'icu',
      nodes: [
        {
          kind: 'plural',
          name: 'nmae',
          ordinal: false,
          offset: 0,
          exact: [],
          branches: [{ keyword: 'other', body: [] }],
        },
      ],
      args: [{ name: 'nmae', type: { kind: 'number' } }],
      markupTags: [],
    }
    const englishBody: Body = {
      locale: 'en',
      format: 'icu',
      nodes: [{ kind: 'text', value: 'Hi' }],
      args: [],
      markupTags: [],
    }
    const origins: readonly LocaleOrigin[] = [
      { locale: 'en', origin: { status: 'translated' } },
      { locale: 'de', origin: { status: 'fallback', from: 'en', reason: 'invalid' } },
      { locale: 'de-AT', origin: { status: 'fallback', from: 'en', reason: 'missing' } },
    ]

    const record = buildRecord(
      program({
        messages: [
          message({
            key: 'a',
            id: 'a',
            namespace: 'n',
            source: 'Hi',
            bodies: [germanBody, englishBody],
            origins,
          }),
        ],
      }),
    )

    expect(record.messages[0]?.translations).toEqual([
      { locale: 'de', status: 'fallback', from: 'en', reason: 'invalid' },
      { locale: 'de-AT', status: 'fallback', from: 'en', reason: 'missing' },
      { locale: 'en', status: 'translated', from: null, reason: null },
    ])
    expect(record.messages[0]?.variants).toEqual([])
  })

  it('leaves the input program untouched and repeats byte for byte', () => {
    const input = program({
      messages: [
        cartItems(),
        message({ key: 'nav.home', id: 'nav_home', namespace: 'nav', source: 'Home' }),
      ],
      locales: ['en', 'de', 'de-AT'],
      usages: [{ id: 'cart_items', sites: [site('src/Cart.tsx', 'Cart', 12, 8)] }],
    })
    const snapshot = JSON.stringify(input)

    const first = serializeRecord(buildRecord(input))
    const second = serializeRecord(buildRecord(input))

    expect(JSON.stringify(input)).toBe(snapshot)
    expect(second).toBe(first)
  })
})

describe('serializeRecord under hostile input', () => {
  it('prints every object in schema field order', () => {
    const record = buildRecord(
      program({
        messages: [cartItems()],
        usages: [{ id: 'cart_items', sites: [site('src/Cart.tsx', 'Cart', 12, 8)] }],
      }),
    )

    const parsed = JSON.parse(serializeRecord(record)) as Record<string, unknown>
    const entry = (parsed['messages'] as readonly Record<string, unknown>[])[0] ?? {}

    expect(Object.keys(parsed)).toEqual(['schema', 'sourceLocale', 'locales', 'messages'])
    expect(Object.keys(entry)).toEqual([
      'key',
      'id',
      'module',
      'kind',
      'source',
      'sourceHash',
      'description',
      'args',
      'variants',
      'markup',
      'translations',
      'usage',
    ])
    expect(Object.keys((entry['args'] as readonly object[])[0] ?? {})).toEqual([
      'name',
      'type',
      'options',
      'note',
    ])
    expect(Object.keys((entry['variants'] as readonly object[])[0] ?? {})).toEqual([
      'arg',
      'kind',
      'matches',
    ])
    expect(Object.keys((entry['translations'] as readonly object[])[0] ?? {})).toEqual([
      'locale',
      'status',
      'from',
      'reason',
    ])
    expect(Object.keys((entry['usage'] as readonly object[])[0] ?? {})).toEqual(['file', 'scope'])
  })

  it('writes the worked example cart.items byte for byte', () => {
    const record = buildRecord(
      program({
        messages: [cartItems()],
        usages: [{ id: 'cart_items', sites: [site('src/Cart.tsx', 'Cart', 12, 8)] }],
      }),
    )

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
      "key": "cart.items",
      "id": "cart_items",
      "module": "messages/cart.js",
      "kind": "text",
      "source": "${CART_ITEMS_SOURCE}",
      "sourceHash": "a826cf6a40d3293e",
      "description": "Badge under the cart icon on every page",
      "args": [
        {
          "name": "count",
          "type": "number",
          "options": null,
          "note": "Number of line items, not total quantity"
        }
      ],
      "variants": [
        {
          "arg": "count",
          "kind": "plural",
          "matches": [
            "=0",
            "one",
            "other"
          ]
        }
      ],
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
      "usage": [
        {
          "file": "src/Cart.tsx",
          "scope": "Cart"
        }
      ]
    }
  ]
}
`)
  })

  it('round-trips source text carrying a lone surrogate, a line separator and a null', () => {
    const source = 'a\uD800b c d\u0000e*/f</script>g\\h"i'

    const record = buildRecord(
      program({ messages: [message({ key: 'a', id: 'a', namespace: 'n', source })] }),
    )
    const text = serializeRecord(record)
    const parsed = JSON.parse(text) as { readonly messages: readonly { readonly source: string }[] }

    expect(parsed.messages[0]?.source).toBe(source)
    expect(text.slice(0, -1)).not.toMatch(/[\u0000-\u0009\u000B-\u001F]/u)
  })
})
