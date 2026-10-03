# loclizr

Typed message functions and default-on catalog checks, generated from your
translation files. `loclizr build` reads JSON catalogs, fails the build when a
translation is missing or its arguments disagree with the source, and writes a
context record for translators next to the catalogs.

**0.x.** A minor version may break an invariant, and the changelog says when it does.

## Install

```sh
npm install loclizr
```

A regular dependency, not a dev one: the generated code imports its small
runtime from `loclizr`.

## Example

`locales/en.json`, in ICU MessageFormat, with a `locales/de.json` beside it:

```json
{
  "cart.greeting": "Hello, {name}",
  "cart.items": "{count, plural, one {# item} other {# items}}"
}
```

```sh
npx loclizr build
```

```ts
import * as m from './loclizr/messages'

m.cart_greeting({ name: 'Ada' })   // "Hello, Ada"
m.cart_items({ count: '3' })       // type error: count is a number

m.setLocale('de')                  // read at call time, no reload
```

With no config file, `en` is the source locale and output goes to
`src/loclizr/`. In React, render `<App key={useLocale()} />` at the root, with
`useLocale` from `loclizr/react`, so a language switch re-renders the tree.
Existing i18next catalogs are detected per file and read as they are.

## Entry points

| Import | For |
| --- | --- |
| `loclizr` | `defineConfig` and the runtime the generated code imports |
| `loclizr/react` | `useLocale`, `Parts` |
| `loclizr/server` | request-scoped locale for server rendering (`runWithLocale`, `localeFromHeaders`) |
| `loclizr/compiler` | the build as a function, for wiring into your own tooling |
| bin `loclizr` | `init`, `build` (takes `--no-fail` for `predev`), `check` for CI |

## More

The repository README covers the failing-build output, the context record, and
what v0.1 deliberately leaves out, including per-locale delivery: every locale
is inlined, so bundle size grows with locale count. The full specification is
`docs/design/spec.md` in the repository, and the documentation site source is
under `apps/web`.

MIT licensed.
