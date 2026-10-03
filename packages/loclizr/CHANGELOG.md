# Changelog

All notable changes to `loclizr` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the version
numbers follow [Semantic Versioning](https://semver.org/) with the 0.x caveat:
a minor release may break an invariant, and this file says so when it does.

## 0.1.0

First release.

- `loclizr build` reads JSON catalogs at `locales/{locale}.json`, ICU
  MessageFormat by default, i18next files detected per file and converted in
  memory, and writes typed ESM message functions, one module per top-level
  key, with hand-printed declarations beside them.
- Fifty-six catalog checks run inside the same build: missing and blank
  translations, ICU syntax, arguments that differ between locales, plural
  categories a locale can never select or lacks, markup tag mismatches,
  keys that share a source text without a description. Errors exit 1;
  `build --no-fail` keeps a dev server running; `loclizr check` is the CI
  gate and also fails on a stale generated tree or a stale record.
- A context record per message, `locales/loclizr.context.json`, written as a
  pure function of the catalogs, the meta sidecar, the scanned sources and
  the config: source text and hash, argument types, plural or select shape,
  per-locale status, usage sites as file plus enclosing scope, and the
  description if one was written. Meant to be committed with the string
  change.
- Runtime: the locale is read when a message function is called, so
  switching language needs no reload; `setLocale`, `getLocale`, `subscribe`
  on the client; `withLocale`, `runWithLocale`, `localeFromHeaders` and
  `negotiate` in `loclizr/server`, request scoped through
  `AsyncLocalStorage`; `useLocale`, `useSetLocale` and `Parts` in
  `loclizr/react`.
- Typed lookup groups for keys chosen at run time, declared under `groups`
  in `loclizr.config.ts`.
- `loclizr init` writes a config and a seed catalog and prints the
  `predev`, `prebuild` and `pretypecheck` scripts plus the CI step.
- Human and JSON reporters, `--max-warnings`, `--quiet`, exit codes 0, 1
  and 2.

Not in this release, on purpose: per-locale delivery (every declared locale
is inlined into each message function), a runtime `format()`, string
extraction from source, first-class Next.js server rendering, URL-prefix
locale routing, `--watch`.
