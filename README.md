# loclizr

loclizr is a CLI that turns JSON translation catalogs into typed message
functions, checks the catalogs on every build, and writes a context record for
translators.

**Status: pre-release.** v0.1 is in development and nothing is published to npm
yet. The API can change between any two commits until a release says otherwise.

## A 60-second example

Put a catalog at `locales/en.json`. Values are ICU MessageFormat:

```json
{
  "nav.home": "Home",
  "cart.greeting": "Hello, {name}",
  "cart.items": "{count, plural, one {# item in your cart} other {# items in your cart}}"
}
```

Add `locales/de.json` beside it with the same keys, then build. No config file
is needed for this layout: `en` is taken as the source locale and output goes to
`src/loclizr/`.

```sh
npx loclizr build
```

Import the generated code from anywhere under `src/`:

```ts
import * as m from './loclizr/messages'

m.nav_home()                       // "Home"
m.cart_greeting({ name: 'Ada' })   // "Hello, Ada"
m.cart_items({ count: 3 })         // "3 items in your cart"

m.cart_items({ count: '3' })       // type error: count is a number
m.cart_greeting()                  // type error: name is required
```

Argument types come from the message itself, so a plural argument is a `number`
and a renamed placeholder breaks the call site at typecheck rather than in
production. The output is plain ESM with declarations next to it. No bundler
plugin is involved and your source files are never transformed.

The locale is read at call time, so switching language needs no reload:

```ts
m.setLocale('de')
m.cart_greeting({ name: 'Ada' })   // "Hallo, Ada"
```

In React there is one thing to know. A message call is a plain function call and
does not subscribe the component to the locale, so the root keys the tree on it:

```tsx
import { useLocale } from 'loclizr/react'

function Root() {
  return <App key={useLocale()} />
}
```

The key change remounts `App`, which discards local component state below it
(open accordions, uncommitted form input). Where that is not acceptable, a
component can call `useLocale()` itself and pass the result per call,
`m.cart_items({ count }, { locale })`, and it re-renders in place.

## What a failing build looks like

Add `cart.items` to `en.json`, forget `de.json`, and the next build prints
something like this and exits 1:

```
error  LZ3001  missing-translation  locales/de.json

  "cart.items" has no German translation. The "de" build of this message
  falls back to the source text from locales/en.json.

  fix  add the key to locales/de.json:
         "cart.items": "{count, plural, one {...} other {...}}"
  or   turn the rule down in loclizr.config.ts:
         severity: { 'missing-translation': 'warn' }
```

The generated tree is still written, with the missing message filled from the
fallback chain, so the app keeps typechecking and the one real error is not
buried under "cannot find module". The exit code is what gates.

The same pass reports blank translations, arguments that differ between locales,
markup tag mismatches, incomplete plural categories, and source strings shared
by several keys where a translator could not tell them apart. Every rule has a
code and can be re-levelled to `off`, `warn` or `error` under `severity`. Other
tools check catalogs as well, usually as a step you add; here the check is part
of `build` and on from the first run.

Because one untranslated key should not stop a dev server from starting,
`loclizr build --no-fail` prints the identical diagnostics and exits 0 as long
as output was written. That flag belongs in `predev` and `prepare`. `prebuild`
runs plain `loclizr build`, and CI runs `loclizr check`, which does everything
`build` does without writing and takes no such flag.

```json
"prepare": "loclizr build --no-fail",
"predev": "loclizr build --no-fail",
"prebuild": "loclizr build",
"pretypecheck": "loclizr build"
```

## The context record

Each build also writes `locales/loclizr.context.json`, meant to be committed.
Per message it holds the source text and a hash of it, the argument names and
types, the plural or select shape, the file and enclosing component or function
where the message is used, per-locale translation status, and a description if
you wrote one in `locales/en.meta.json`.

It carries no timestamps and no line numbers, so it only changes when a message
or its usage changes, and that change shows up in the same pull request as the
string edit. It does not say whether a string is a button label or a page title,
and it does not include surrounding copy or glossary matches.

## Existing i18next catalogs

`catalogFormat` defaults to `'auto'` and decides per file: a file containing
`{{` or i18next plural-suffix keys (`_one`, `_other`) is read as i18next,
anything else as ICU. Both formats can sit side by side.

## What it deliberately does not do

- **No per-locale delivery.** Every declared locale of every used message is
  inlined into that message function. Bundle size grows with locale count.
- **No runtime `format()` for content unknown at build time.** ICU is parsed at
  build time only, and the browser never ships a parser.
- **No extraction.** It does not find hardcoded strings in your source or
  rewrite them into message calls. Catalogs are authored or imported.
- **Server rendering covers Web Fetch handlers only** (Vite SSR, Hono, TanStack
  Start, Bun, Deno, Workers with `nodejs_als`); Express and Fastify go through
  `localeFromHeaders`. Next.js is not a first-class target in v0.1.
- **No URL-prefix locale routing.** The locale comes from a cookie or from
  `Accept-Language`.
- **`Intl.PluralRules`, `Intl.NumberFormat` and `Intl.DateTimeFormat` are
  required.** Hermes on Android needs the `intl` build of the runtime.
- **No `--watch`.** Use `loclizr build --no-fail` in `predev`, or
  `nodemon -w locales -x 'loclizr build --no-fail'` for a live loop. The Vite
  example wires a small inline plugin that does the same.

## CLI

| Command | What it does |
| --- | --- |
| `loclizr init` | writes `loclizr.config.ts` and a seed source catalog if absent, then prints the `package.json` scripts and a CI snippet |
| `loclizr build` | reads catalogs, checks them, writes the generated tree and the context record. Takes `--no-fail` |
| `loclizr check` | everything `build` does with no writes, and fails if the generated tree on disk or the committed record is stale |

Global flags: `--cwd <dir>`, `--config <path>`, `--reporter human|json`,
`--max-warnings <n>`, `--quiet`. Exit codes are 0 for clean, 1 for errors, and 2
when the tool could not run at all (invalid usage or config, unsafe `outDir`,
unwritable output).

## Repo layout

| Path | Contents |
| --- | --- |
| `packages/loclizr` | the SDK: compiler, CLI, runtime, React and server bindings |
| `examples/vite-react` | a Vite and React app built against the package |
| `apps/web` | the documentation site |
| `docs/design/spec.md` | the v0.1 specification; every API name and rule code lives there |
| `research/` | the landscape study the design came out of |

## Development

Node 20.19 or newer, pnpm 9.

```sh
pnpm install
pnpm build          # build the package
pnpm test           # vitest, package only
pnpm typecheck      # package and the example
pnpm example:dev    # run the Vite example
pnpm web:dev        # run the docs site
pnpm check          # build, typecheck, test, example build, docs build
```

## License

[MIT](LICENSE)
