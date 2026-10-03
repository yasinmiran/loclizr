# Changelog

All notable changes to `loclizr` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the version
numbers follow [Semantic Versioning](https://semver.org/) with the 0.x caveat:
a minor release may break an invariant, and this file says so when it does.

## 0.1.1 - 2026-10-03

Fixes, plus a few changes in what a build accepts. A project that built clean
under 0.1.0 can stop at one of the behaviour changes below.

### Behaviour changes

- Config load rejects more configs with `LZ1001 config-invalid`, exit 2:
  - an `outDir` that can hold a catalog, such as `outDir: 'locales'` under
    the default `catalogs` pattern, or any directory above the catalogs. The
    self-ignoring `.gitignore` the build writes there kept every catalog out
    of git. Give `outDir` a directory of its own (#45).
  - an `outDir` that holds the `meta` or `record` path when that path is
    written with `{sourceLocale}` (#29).
  - a `meta` or `record` path the `catalogs` pattern also matches, such as
    `record: 'locales/de.json'`, which skipped that catalog and then wrote the
    record over it. Name a path the pattern cannot match, such as the default
    `locales/loclizr.context.json` (#39).
  - any of the above spelled in another letter case: paths compare without
    case, so `outDir: 'Locales'` is caught on every machine (#31).
  - a `sourceLocale` that a declared `locales` list leaves out, whatever is
    on disk. It was `LZ1004` with exit 1 when the source catalog was also
    missing (#45).
  - `export default undefined` and `export default null`. The first loaded
    as the defaults and read named exports as config fields; the second
    failed with a loader error. Both get the default-export message (#28,
    #30).
  - `NaN`, `Infinity` or `-Infinity` as a `formats` option value (#23).
- `severity` set to `off` on a rule that blocks output prints that diagnostic
  as a warning. The run still writes no tree and exits 1, but it says why
  instead of exiting in silence (#41).
- Every generated `.js` file has `// @ts-nocheck` as its second line, so a
  project that typechecks JavaScript (`checkJs`, `svelte-check`,
  `astro check`) skips generated code. The `.d.ts` files carry the types and
  stay checked. A committed generated tree is stale under `loclizr check`
  until it is rebuilt: run `loclizr build` once and commit the tree (#51).
- The default `scan.include` is
  `src/**/*.{ts,tsx,js,jsx,mts,mjs,svelte,vue,astro}`, so usage sites in
  Svelte, Vue and Astro components reach the context record with no config.
  The record's `usage` lists grow; `usage` is outside the record gate, so
  `check` does not fail on it (#50).
- `build` writes `outDir/.gitignore` only when it creates `outDir`. Delete the
  file to commit the generated tree and it stays deleted (#49).
- `build` writes the record only over a file it can tell is a record: a JSON
  object with `schema: 1`, or a file holding merge conflict markers. Anything
  else at the record path is left alone and reported as
  `LZ5001 output-unwritable`, exit 2 (#39).
- A `null` leaf in the source catalog is `LZ1010 catalog-shape-invalid`
  naming the key, unless another route to the same key holds a string. The
  message used to drop out with no diagnostic. In a target catalog `null` is
  still a missing translation (#2).
- Existing codes cover inputs that built a broken or misleading tree:
  - `LZ4001 identifier-collision` when a group id equals the id of a grouped
    message, which made `groups.js` fail to parse.
  - `LZ4002 identifier-reserved` for `Object` as a group id or as the id of a
    grouped message, which shadowed the `Object.freeze` the groups module
    calls (#21).
  - `LZ4003 confusable-key` for keys that differ only by an invisible
    joiner (U+200C, U+200D, U+2060, U+FEFF) (#21).
  - `LZ2001 icu-syntax` for two options of one select that are equal under
    NFC but not byte for byte (#20).

### Fixes

#### Config

- The `LZ1004` hint prints a whole config file, `defineConfig` import
  included, so the paste loads (#43).
- The `LZ1006` hint for a file name that is not a locale tag says to rename
  the file or move it out of the catalog pattern; declaring `locales` never
  cleared it (#45).
- `LZ1007` for `outDir: '.'` says it resolves to the project root itself,
  not to a path outside it (#45).

#### `loclizr init`

- Quotes, backslashes and control characters in a discovered catalog
  directory are escaped, so the written config parses (#32).
- A catalog directory no `catalogs` pattern can spell (a glob character such
  as `app/(marketing)/locales/`, or a backslash on POSIX) is listed with a
  note to move it. When it is the only layout, `init` writes the default
  pattern and no seed catalog (#33, #34).
- `--config` naming a directory, or an empty path, fails with exit 2 instead
  of reporting the config as already present (#34).

#### Catalogs and i18next import

- The last value in the file wins every key collision, as `JSON.parse` would,
  including keys with numeric segments (#17).
- An empty key segment stays in the path, a lone CR counts as a line end for
  diagnostic positions, and a leading byte order mark gets a message that
  names it (#18).
- `LZ1017` no longer offers a context rewrite for a nested key under an
  underscored segment, such as `user_settings.title` beside `user` (#18).
- i18next plural folding for a locale `Intl` has no plural data for no longer
  follows the build machine's own locale, so the output is the same on every
  machine (#40).
- The `LZ1020` hint names the `severity` override that silences it; no
  `catalogFormat` value does (#47).
- The `LZ1016` hint offers `i18nextMarkup: 'tags'` only when every tag in the
  value would lower; otherwise the message names the tag that cannot lower and
  the hint says what a tag needs to lower. The `LZ1013` hint for a `datetime`
  formatter points at `formats.dateTime` and writes `{x, date, style}` (#5).

#### Checks and hints

- A date skeleton the resolver rejects, next to another syntax error, gives
  `LZ2003` for the skeleton and an `LZ2001` at the real error, not the
  skeleton's text over the whole entry (#56).
- In an i18next file, the `LZ3004`, `LZ3005`, `LZ3007` and `LZ3013` messages
  and hints use i18next spellings: `{{name}}`, and plural keys such as
  `"items_few"` instead of ICU branches. This holds under the default
  `catalogFormat: 'auto'` (#5, #42).
- The `LZ2008` hint names the construct that fired it, and in an i18next file
  says to write `{{count}}` (#5).
- Two plurals on one argument with the same gap report `LZ3007` or `LZ3013`
  once, not twice (#22).
- `LZ4002` hints give the real reason a name is reserved: `__proto__`,
  `constructor` and `prototype` are built-in object properties, the rest are
  taken by the barrel (#46).

#### Identifiers and generated code

- An `identifiers` override is sanitized like every other export name, so an
  override holding a character that is illegal in an identifier no longer
  writes a module that does not parse (#19).
- A group named `empty` no longer breaks `groups.d.ts`: its `EmptyArgs` type
  and the imported one stay apart.
- Group type names capitalize a first letter outside the Basic Multilingual
  Plane (#21).
- Nested selects and plurals emit in time linear in their size; each level of
  nesting used to double the build time (#23).
- Format options that differ only in a non-finite number get distinct hoisted
  names (#23).
- A `fallback` map entry keyed by the source locale is ignored: the source
  locale's chain is the source alone.
- An argument named `__proto__` is read by subscript in the `.js` and quoted
  in the `.d.ts` (#23).

#### Scan

- Many usage sites on one long line no longer cost quadratic time, and the
  import and export matchers stay linear on unterminated input (#44, #48).
- A usage right after a spread, on a line where a `/` follows `++`, `--` or a
  non-null `!`, after a line comment ended by a lone CR, U+2028 or U+2029, or
  bound by `import{...}from` with no spaces is recorded (#24, #25, #26).
- A usage inside a later declarator, `const a = 1, Cart = () => ...`, or a
  method named with a reserved word, `delete() { ... }`, records that
  declarator or method as its scope (#26).
- `.svelte`, `.vue` and `.astro` files are lexed like JSX, so a bare
  apostrophe in template text does not hide the usages after it (#50).

#### Context record

- A blank or whitespace-only description counts as missing for `LZ5006`, as
  it already did for `LZ3012` (#27).
- `sourceHash` of a source text holding an unpaired surrogate no longer
  collides with the same text holding U+FFFD. Every other hash is unchanged
  (#38).
- The record gate compares a message field named `__proto__` like any other
  field (#35).

#### Programmatic API

- A negative `maxWarnings` passed to `build()` or `check()` means no cap, as
  `--max-warnings=-1` does on the command line (#35).

#### Runtime, React and server

- The runtime and `loclizr/react` load without a `process` global, so a plain
  `<script type="module">` page or a Worker without Node compatibility runs
  them. Warnings are skipped there instead of throwing (#4).
- When the locale comes from the cookie, the store sets `<html lang>` to the
  locale it resolves to, as `setLocale` does (#52).
- `setLocale` with a tag holding an unpaired surrogate completes instead of
  throwing after the locale was already stored (#36).
- `useLocale` does not warn when `<html lang>` and the resolved locale differ
  only in letter case (#36).
- `withLocale` returns a `Response.error()` unchanged instead of throwing, and
  never writes an empty `Vary` member (#37).

### Added

- `loclizr --version` and `-v` print the installed version (#1).

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
