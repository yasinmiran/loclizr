# loclizr v0.1 specification

Status: frozen for implementation. Every signature, code and file path below is
the contract. One engineer per module in section 16 can build against this with
no further conversation.

## 1. What this is

loclizr is a compiler for the contract between code and translations. The
runtime is a solved problem, so we ship parity there and differentiate on two
things: catalog verification that is on by default inside the build, and a
deterministic per-message context record that lands in the same pull request as
the string change.

Pipeline, fixed:

1. `loclizr build` reads JSON catalogs at `locales/{locale}.json`. The catalogs
   are the static source of truth and the compiler never writes them.
2. It lowers every message to one intermediate representation (section 5).
3. Three consumers read that one representation: emit (section 7), check
   (section 13), record (section 14). Nothing downstream re-parses.
4. It writes plain typed ESM message functions to `outDir`, and a context record
   JSON sidecar.

The app imports generated code:

```ts
import * as m from './loclizr/messages'

m.cart_greeting({ name: 'Ada' })
```

No bundler plugin is required, and app code is never transformed. A project may
wire the compiler into its own dev server for the edit loop (section 16's M13
does), but that plugin only reruns `build`; nothing anywhere rewrites a source
file.

### Invariants

These hold for every decision below. While the version is `0.x` there is no
major to bump and a minor may break, so the policy is the one the project can
actually keep: breaking an invariant before 1.0 is a minor bump and is listed in
the changelog. At 1.0 the invariants become semver load bearing and a break
needs a major.

1. **The browser never ships an ICU parser.** ICU MessageFormat is parsed with
   `@formatjs/icu-messageformat-parser` at build time only.
2. **Generated code is framework free.** It imports from `loclizr` and from its
   own sibling files, nothing else. It runs in RSC, a Vite SPA, React Native and
   plain Node.
3. **The locale is resolved at call time**, so switching language at runtime
   works with no reload.
4. **No mutable global locale on the server.** Request scoping is structural,
   through `AsyncLocalStorage`.
5. **Output is a deterministic function of its inputs.** Same catalogs, same
   config, same bytes. No timestamps, no absolute paths, no version stamps, no
   iteration-order dependence.

### Toolchain conventions

These are the repo's settings and this spec assumes them everywhere.

- TypeScript strict, plus `isolatedDeclarations`, `verbatimModuleSyntax`,
  `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`. Every export
  needs an explicit type annotation.
- ESM only. Node 20.19 or newer.
- Relative imports **inside `packages/loclizr/src` are extensionless**
  (`from '../types'`). Relative imports **in generated output carry `.js`**
  (`from './_locale.js'`), because generated code runs under Node's ESM resolver
  during server rendering.
- Tests are vitest, colocated as `*.test.ts` beside the code.
- `typescript` is a devDependency of the package. Nothing at build time or run
  time needs it, because declarations are printed as text.

### Honest exclusions for v0.1

- **No per-locale delivery.** Every declared locale of every used message is
  inlined into that message function. Bundle size grows with locale count. This
  is stated in the README, not hidden.
- **`format()` for content unknown at build time is deferred past v0.1.** A
  runtime formatter needs a runtime parser, which breaks invariant 1. When it
  lands it will be a separate entry (`loclizr/format`) so the invariant still
  holds for everyone who does not import it.
- **No extraction, no instrumentation.** v0.1 does not find hardcoded strings in
  source and does not rewrite them into message calls. Catalogs are authored or
  imported. Any retrofit path is a separate opt-in command considered after
  v0.1, run once, and never part of the build. This follows from "no AST
  transform of app code, ever" and is stated here so the retrofit reader is not
  left to infer it.
- **The context record delivers two of the five fields the pitch names.** The
  render site, as the file plus the enclosing scope, and the argument types ship
  in v0.1. **Element role does not**: the record never says whether a string is
  a button label, a page title or a tooltip, because the scan is a tokenizer and
  cannot read a JSX tree. Surrounding copy and glossary hits do not ship either.
  Glossary is the cheap deterministic one and is the first candidate for v0.2;
  the number that motivates it is single-vendor and unreproduced, so it does not
  gate v0.1.
- **SSR covers Web Fetch handlers only** (Vite SSR, Hono, TanStack Start, Bun,
  Deno, Workers with `nodejs_als`). A framework with no Fetch `Request` in hand
  feeds `localeFromHeaders` instead (section 11.2), which is how Express and
  Fastify reach `runWithLocale`. **Next.js is not a first-class SSR target in
  v0.1**, neither the App Router nor Pages Router middleware: there is no test,
  no example and no promise. Middleware runs in a different runtime and cannot
  wrap a render, and the App Router entry, `enterWith` from a root layout, is a
  v0.2 question. Nothing in v0.1 emits a `'use client'` directive; an app that
  needs one puts it on its own component file.
- **URL-prefix locale routing is out of scope.** Section 11's hydration
  agreement assumes the locale comes from a cookie or from `Accept-Language`,
  never from the path.
- **Generated code requires `Intl.PluralRules`, `Intl.NumberFormat` and
  `Intl.DateTimeFormat`.** It calls all three unconditionally. React Native is
  supported (section 11.1 makes the store work with no `document`), but Hermes
  on Android needs the `intl` build of the runtime. That is a one-line project
  setting, and it is named here rather than discovered in a crash report.
- **No `--watch`.** The tight loop is `loclizr build --no-fail` in `predev`,
  plus, for people who want the catalog edit to land in the running app, either
  `nodemon -w locales -x 'loclizr build --no-fail'` or the twenty-line Vite
  plugin section 16's M13 ships inside its own `vite.config.ts`. Both are
  supported patterns and neither is a published package. A watcher is
  a second code path through the compiler with platform-dependent recursive
  `fs.watch` behaviour and a bespoke severity semantic to defend, and nothing
  else in v0.1 depends on it. It comes back in v0.2 once the build's real cost
  on a large catalog has been measured.

## 2. Catalogs

`locales/{locale}.json` is a JSON tree of nested keys. The native format is ICU
MessageFormat; an i18next catalog, with `{{var}}` interpolation and
`_one` / `_other` plural suffixes, is converted to ICU at read time. The
compiler reads the file, never writes it, and never requires an edit to it.

**The format is decided per file, not per project.** `catalogFormat` defaults to
`'auto'`, and under `'auto'` M2 classifies each catalog file on its own,
**after flattening and before any conversion**, by looking at that one file's
entries:

- the file is **i18next** when any string value contains a `{{` anywhere except
  inside a typed ICU argument run, `{name, plural ...}`, `{name, select ...}`,
  `{name, selectordinal ...}`, `{name, number ...}`, `{name, date ...}` or
  `{name, time ...}`, which is the one place valid ICU writes a `{{`: a branch
  body opening straight onto an argument, `one {{count} Artikel}`. Or when any
  key belongs to a plural group of section 2.1 step 4 that has two members or
  more, an `X_other` with at least one CLDR sibling;
- otherwise the file is **ICU**.

A file is exactly one format. There is no hybrid parse: ICU argument syntax
inside a file read as i18next is literal text, and `{{name}}` inside a file read
as ICU is a literal brace around an argument, exactly as the ICU grammar says.
That is the whole point of deciding per file rather than per value, because a
per-value guess turns a translator's stray `{{` into a silent change of meaning.
`catalogFormat: 'icu'` and `catalogFormat: 'i18next'` force every file and skip
classification entirely.

The typed-run carve-out is what lets an ICU file spell `one {{count} Artikel}`
without being read as i18next, and it is the narrowest rule that does: a `{{`
in prose around a stray brace, `a { color: {{c}} }`, still counts as a
placeholder, because no ICU value is shaped like that. Two misses are known and
accepted. A `{{` written inside ICU quoted literal text, `'{{x}}'`, still
classifies the file as i18next. And a lone `X_other` never decides it, because
`reason_other` is as likely an ordinary ICU key as an i18next plural: a file
that holds only lone `_other` keys and no `{{` reads as ICU and is never
folded, so its key `items_other` disagrees with an i18next source that folds
the same key to `items` (section 2.1 step 4). `catalogFormat` is
project-wide, so the way out for such a file is a value that classifies on its
own, any `{{` placeholder, or pinning `catalogFormat: 'i18next'` for the whole
catalog set.

Section 2.1 steps 1 through 4, and `LZ1012` through `LZ1014`, `LZ1016` and
`LZ1017`, apply **only to a file read as i18next**. An `X_one` with no `X_other`
in an ICU file is an ordinary key and raises nothing; `$t(` in an ICU file is
ordinary text.

The format a file was read as is recorded on its `RawCatalog.format`, so
everything downstream, `LZ2001`'s span composition most of all, reads the
decision rather than re-deriving it.

A file read as i18next that contains a single-brace run shaped like a typed ICU
argument, `{x, plural ...}`, `{x, select ...}`, `{x, selectordinal ...}`,
`{x, number ...}`, `{x, date ...}` or `{x, time ...}`, raises
`LZ1020 icu-in-i18next-file` at warn. The hint names what classified the file,
verbatim: the first value holding a `{{`, or the first CLDR-suffixed key. It
states that the run will render as literal text, and gives the fix: convert
that file to ICU, or set `severity: { 'icu-in-i18next-file': 'off' }` if the
literal text is what you meant. No `catalogFormat` value silences it, because
it fires on every file read as i18next. Under `catalogFormat: 'i18next'` nothing
classified the file, so the hint names the setting instead. This is the one
mistake `'auto'` can make invisible, so it is the one it reports.

A key path is the dotted join of its nesting. `{"nav": {"home": "Home"}}` is the
key `nav.home`. A dotted key at any level flattens the same way, so
`{"nav.home": "Home"}` and the nested form produce the same key and collide as
`LZ1011 duplicate-key` when both routes end in a message string. A leaf beside
a deeper branch, `"a.b": "leaf"` beside `"a": {"b": {"c": "deeper"}}`, gives
the two distinct keys `a.b` and `a.b.c`, shadows nothing and raises nothing. A
JSON key written twice inside one object is `LZ1011` whatever shape either value
has, because the first value is lost whole. In every collision the last value
wins, which is what `JSON.parse` would have done silently. A file nested more
than 256 levels deep is `LZ1009 catalog-json-syntax` with a span, like any
other malformed catalog.

**Split catalogs are first class.** `catalogs` carries an optional `{ns}` token,
so `'public/locales/{locale}/{ns}.json'` matches the layout that
`i18next-fs-backend`, `i18next-http-backend` and `next-i18next` all default to.
One file becomes one catalog, and every key flattened out of it is prefixed with
its namespace segment: `common.json` holding `nav.home` produces the key
`common.nav.home`. Everything downstream then falls out unchanged, because
`namespaceOf` already splits on the first segment and the per-namespace module
split already follows it. The prefix is the file's own namespace segment, so two
files of one locale are disjoint by construction; `readCatalogs` still guards
the cross-file case as `LZ1011 duplicate-key`, but nothing the token grammar can
express reaches it. Without `{ns}` in the pattern there is one catalog per
locale and no prefix is added.

**Leaf shapes.** A string leaf is a message. An object leaf is nesting. A `null`
leaf is a **missing translation**, not a shape error: several TMS exports write
`null` for an untranslated unit, so it produces no entry. In a target catalog
it raises no diagnostic of its own and feeds the normal fallback chain and
`LZ3001`. In the source catalog there is no chain to feed, so it is
`LZ1010 catalog-shape-invalid` naming the key, unless another route to the same
key ends in a message string. An array leaf is
`LZ1010 catalog-shape-invalid`, with a hint naming the deferred `format()`
escape hatch. Flattening an array to `tips.0`, `tips.1` is tempting and wrong,
because the app wants the array, not three messages. A non-empty array whose
every item is an object with a numeric `type` is the AST `formatjs compile --ast`
writes, so the same code carries a hint to compile again without `--ast`
instead. A number or boolean leaf is the same code with its own hint: quote the
value, or write `null` for an untranslated unit.

**Read failures.** A catalog file that exists and cannot be read is
`LZ1008 catalog-unreadable`; one that does not exist raises nothing here,
because a declared locale with no catalog is `LZ1005`, raised by `resolveConfig`
where the locale list is. Both `LZ1008` and `LZ1009` are fatal only for the
source catalog.

### 2.1 i18next to ICU conversion, exact algorithm

Run in this order on each raw value. The order matters: escaping literal text
before rewriting placeholders is what keeps an imported catalog from silently
changing meaning.

1. **Escape literal ICU syntax.** Scan the value for the i18next placeholder
   pattern `{{ name }}` and split into placeholder runs and literal runs. In
   each literal run, **quote every maximal run of ICU-special and apostrophe
   characters that contains at least one special, doubling each apostrophe
   inside that run**. A run of apostrophes alone is doubled and left unquoted,
   and a literal run holding no special at all is emitted unchanged. The
   function is `escapeIcuLiteral`, owned by M1, because M3's `printIcu` needs
   the same escaping and may not import M2. **It takes the context it needs as
   a parameter**, because neither half of the special set is context free.

   This is load bearing. Verified against the installed parser: without it,
   `Don''t {{x}}` parses to `Don't ` and loses an apostrophe, and
   `Set {color} in CSS` invents a required argument named `color`.

   **One pass, not two.** Doubling every `'` first and wrapping specials second
   closes a quote and immediately reopens it around the doubled pair: `{'}`
   prints `'{''''}'`, which re-parses as `{''}`, one apostrophe too many,
   because the parser reads `'''` as an escaped apostrophe still inside the
   quote. Quoting apostrophes together with the specials they sit among prints
   `'{''}'`, which round-trips. The doubling inside a quoted run stays
   exhaustive rather than minimal: a lone trailing apostrophe left undoubled
   opens a quote that swallows the enclosing plural branch's closing brace.

   **The special set is `{`, `}` and `<`, plus `#` only for text that lands
   directly inside a plural or selectordinal branch body.** `#` is not
   universally special. Verified on 3.5.19 in the parser's `tryParseQuote`: it
   opens a quoted section before `#` only when the enclosing argument is a
   plural or a selectordinal, so `'#'` anywhere else is three literal
   characters. Quoting it unconditionally would print `C'#' rocks` into
   `Message.source`, and worse, the closing apostrophe binds forward:
   `Order '#'` followed by `{id}` parses as one literal run and the `id`
   argument disappears from the message entirely. Section 5.5 requires
   `printIcu`'s output to be re-parseable ICU and this section requires the
   same of `toIcu`, and a context-free escape cannot satisfy both, so the
   caller passes `inPlural`.

   **`<` is in that set, and that is the difference between "your i18next
   catalog works unchanged" being true and being false.** The parser runs with
   `ignoreTag: false`, and HTML inside values is pervasive in i18next catalogs
   because `Trans` and `dangerouslySetInnerHTML` put it there. Verified on
   3.5.19: `Click <b>here</b> {{x}}` unescaped lowers to a markup node, so `b`
   becomes a required handler argument and the message's return type changes
   from `string` to `readonly (string | T)[]`, silently, at every call site.
   `Line<br>break` is `UNCLOSED_TAG` and `Read <a href="/t">terms</a>` is
   `INVALID_TAG`, both hard errors. Also verified: `'<b>'` and `'<'b'>'` both
   lower to literal text. So imported tag-shaped text stays literal text, which
   is exactly what i18next itself rendered.

   Every value that contained tag-shaped text raises
   `LZ1016 i18next-markup-literal` as a warning, so the conversion is visible
   rather than silent. A team that wants those tags lowered to real markup
   arguments sets `i18nextMarkup: 'tags'`, which takes `<` out of the special
   set for the whole catalog set. That is the escape's second parameter,
   `markup`: `toIcu` passes the configured mode through so the mode is
   expressible in the one implementation of this step rather than forcing M2 to
   fork it. Under `'tags'` a value holding a tag the parser would reject, a
   numbered `<1>` tag, a tag with attributes, an unclosed or mismatched tag, or
   a name cut by an argument, is escaped to literal text as a whole and raises
   `LZ1016`, so its return type stays `string` and the message survives. A
   self-closing tag is treated the same way: the parser accepts `<br/>` but
   reads it as literal text and respells `<br />` as `<br/>`, so it never
   lowers, and escaping the value whole keeps the translator's spelling. The
   output of `toIcu` is parseable ICU in both modes; the importer never hands
   M3 a value whose rejection would drop a source message. A file read as ICU
   is unaffected by any of this.

2. **Rewrite placeholders.** `{{ name }}` becomes `{name}`. Surrounding
   whitespace inside the braces is trimmed. A placeholder carrying an i18next
   inline formatter, `{{val, fmt}}`, is `LZ1013 i18next-format-unsupported`,
   and is still rewritten to the bare `{val}`, so the message renders the raw
   value, which is what i18next printed with no formatter registered. A value
   containing `$t(` is `LZ1012 i18next-nesting-unsupported`.

   Only a named run is a placeholder. A `{{` whose inner text trims to empty or
   holds a brace, `{{}}`, `{{ }}`, `{{{name}}`, is text i18next rendered as
   written: it stays inside the literal run around it, that run is not cut at
   it, and step 1 escapes the whole stretch in one pass rather than closing a
   quote and reopening it between two braces. The unescape prefix, `{{- name}}`,
   converts to `{name}` with no diagnostic: loclizr never HTML-escapes an
   argument, so the two spellings are the same message after import. A run
   whose name ICU rejects, `{{user.name}}`, stays literal text, escaped in the
   same pass, and is `LZ1013 i18next-format-unsupported` from M2 with a hint
   naming the flat name to write; the function exists and renders the text as
   i18next did for a missing interpolation value. The compiler never invents an
   argument name.

3. **`{{count}}` stays a plain argument.** It becomes `{count}`, typed
   `string | number` in a message that step 4 does not fold. Where the key does
   fold, `count` is that plural's selector and is typed `number` like every
   selector, and the `{count}` inside a branch renders the raw value while the
   selector decides the branch. It is never rewritten to `#` and never
   formatted through `Intl.NumberFormat`. i18next stringifies placeholders
   unformatted, so
   auto-formatting would turn `1000 items` into `1,000 items` on import day and
   make "your i18next catalog works unchanged" false. The upgrade is not a
   character inside this file, because `{count, number}` written into a file
   read as i18next renders as literal text and raises `LZ1020`. It is a file
   conversion: rewrite that catalog as ICU, at which point `{count, number}`
   means what it says.

4. **Fold plural suffixes.** Match the ordinal infix `X_ordinal_<cat>` **before**
   the plain suffix `X_<cat>`, or `place_ordinal_one` folds as a cardinal on the
   base key `place_ordinal` and renders the `other` branch for `2nd` and `3rd`
   with no diagnostic, because English cardinal is `['one','other']` while
   English ordinal is `['few','one','two','other']`.

   A cardinal group exists when `X_other` is present and at least one other
   sibling `X_<cat>` exists, where `<cat>` is a CLDR category keyword (`zero`,
   `one`, `two`, `few`, `many`, `other`). It becomes one key `X` with the ICU
   value `{count, plural, <branch> {<value>} ...}`. An ordinal group exists on
   the same rule over the `_ordinal_<cat>` infix and becomes
   `{count, selectordinal, ...}`, validated against
   `requiredCategories(locale, true)`. The ordinal group folds to the base key
   `X` with `_ordinal` stripped, **unless** a cardinal group for `X` also
   exists, in which case it keeps the key `X_ordinal`: i18next picks between the
   two with a call-site option the compiler does not have, so the compiler keeps
   both rather than guessing.

   **A lone `X_other` folds in every locale.** `_other` is i18next's plural
   form everywhere, so `X_other` with no CLDR sibling becomes the key `X` with
   the value `{count, plural, other {...}}`, and a lone `X_ordinal_other`
   becomes `{count, selectordinal, other {...}}` on the same rule. A ja catalog
   can hold nothing but `_other`, because cardinal ja, zh, ko, th, vi and id
   have one category, and an en source holding the same lone `items_other`
   must fold to the same key `items`, or every plural message is reported
   `LZ3001` missing and `LZ3003` extra at once and the app ships the source
   text to a translated locale. The fold reads no locale data, so it is the
   same on every machine and for a locale `Intl` has no plural data for; the
   categories the source lacks are `LZ3007`'s to report (section 5.3).

   **A lone `X_other` folds only where the key looks like a plural.** It stays
   an ordinary key, and raises nothing, when the same file also holds the bare
   key `X`, or a key `X_<word>` whose `<word>` holds no `_` or `.` and is
   neither a CLDR category nor `ordinal`. `gender_other` beside `gender_male`
   and `gender_female`, or `option_other` beside a bare `option`, is a value
   that i18next reaches as a context, `t('option', { context: 'other' })`, not
   a plural, and folding it would rename a working key and demand a `count`.
   `items_other` beside `items_list.title` or `items_ordinal_other` still
   folds, because a nested key and plural spelling say nothing about the base.
   The test reads that one file's keys, so the fold stays pure.

   Branches are ordered `=0, zero, one, two, few, many, other`. The plural
   selector is always named `count`, because that is i18next's fixed selector
   name. Only those suffixes fold; a context suffix such as `_male` stays an
   ordinary key. A `#` inside a folded value is quoted as `'#'` when that value
   becomes a branch body, merged into any quoted run already around it: step 1
   leaves `#` bare because it is literal outside a plural, and a branch body is
   the one place a converted value lands inside one. A bare `X` beside a group
   that folds to `X` is `LZ1011 duplicate-key`; the folded plural wins and
   keeps the position of the group's first member.

   An `X_one` with no `X_other` sibling stays an ordinary key `X_one` and raises
   `LZ1014 plural-suffix-orphan` as a warning, because i18next would never
   select it either. **`X_plural` beside a bare `X`** raises the same warning,
   with a hint naming i18next's JSON v3 to v4 converter: that is the pre-v21
   format, both keys survive as ordinary messages typed with no `count`, and
   each renders one grammatical number. Folding it automatically is one guess
   too many for a compiler, but losing it silently is worse than either.

   **`_zero` is decided per locale, because the compiler knows the locale.**
   Emit the keyword branch `zero {...}` when
   `requiredCategories(locale, ordinal)` for the group's own kind contains
   `zero`, and the exact branch `=0` otherwise. Verified:
   `Intl.PluralRules('de').select(0)` is `other`, so a German `zero` branch
   would never be selected and the translation would silently stop rendering,
   while `Intl.PluralRules('lv').select(10)` and `.select(20)` both return
   `zero` and Arabic's category set contains `zero`, so converting those to `=0`
   would drop counts 10, 20 and 11 through 19 into `other`. German keeps `=0`,
   Latvian and Arabic keep i18next's behaviour. The group's kind matters:
   Latvian cardinal carries `zero` and Latvian ordinal does not, so an ordinal
   group decided by the cardinal set would emit a keyword branch nothing can
   select, which M5 would then report as `LZ3013`. Section 5.3 tests exact
   branches before the category lookup, so both forms work.

   **i18next context suffixes are detected, not converted.** A key
   `X_male` or `X_female` where a bare `X` also exists raises
   `LZ1017 i18next-context-detected` as a warning. Only those two suffixes
   count: `X_<word>` beside `X` is the ordinary snake_case naming of many
   catalogs (`accept` beside `accept_invitation`, `basic` beside `basic_desc`),
   and reading it as a context group reports separate messages as lost and
   prints a rewrite that deletes them. That also rules out `plural`, `ordinal`,
   the six CLDR categories and any suffix holding a dot, such as
   `user_settings.title` beside `user`. It is evaluated over the post-fold key
   set, so a context under a folded base, `friend` beside `friend_male` folded
   from `friend_male_one` and `friend_male_other`, is caught. i18next picked
   contexts at run time with `t('friend', { context: gender })`, and after
   import `m.friend_male` and `m.friend_female` are each their own message,
   with no selector picking between them. The typed lookup tier is prefix
   based and cannot reach a suffix, so the hint prints the exact one-line
   rewrite instead:
   `{context, select, male {...} female {...} other {...}}`, **together with the
   instruction to convert this file to ICU first**, because that line pasted
   into a file read as i18next is literal text and `LZ1020`. That turns a silent
   behaviour loss into a punch list, and the rewrite lands in the catalog the
   user already owns.

A file read as ICU skips steps 1 through 4 entirely and is parsed as written.

### 2.2 Descriptions and placeholder notes

Descriptions live in an optional sidecar at `locales/{sourceLocale}.meta.json`,
flat-key addressed, source locale only:

```json
{
  "cart.items": {
    "description": "Badge under the cart icon on every page",
    "placeholders": { "count": "Number of line items, not quantity" }
  },
  "order.status": { "description": "Chip in the order list. Past tense." }
}
```

The sidecar exists rather than a sibling key inside the catalog because the
catalog is the file a TMS ingests. Most TMS importers treat every leaf string as
translatable, so a description written inside `en.json` becomes a translation
unit, inflates the string count and gets sent to a translator as copy. A
separate file cannot leak.

The value is an object. `description` is a sentence for the translator.
`placeholders` maps an argument name to a note about what that argument holds.
An entry whose key is not in the source catalog is `LZ1015 meta-orphan` and is
dropped. A `placeholders` key that names no argument of its message, compared by
NFC name, is `LZ1022 meta-placeholder-orphan` and its note is dropped: a renamed
argument or a typo would otherwise leave `note: null` in the record with no
signal. M8 raises it, since the arguments are only known once the message is
parsed. Keys are the post-fold, post-prefix form, so a split catalog's note is
addressed `common.nav.home`, the same string the record and every diagnostic
print.

A sidecar that does not exist is not an error: `meta` is `null` and nothing is
raised. One that exists but cannot be read or parsed is `LZ1008` or `LZ1009`,
never fatal, because it is not a catalog. A root, an entry, a `description`, a
`placeholders` map or a note of the wrong shape is `LZ1010`. Two `placeholders`
keys that normalize to one argument name, an NFC and an NFD spelling, keep one
note: the spelling that matches the argument's own NFC name, then the lower
code point of the name, then of the note. No diagnostic names the loser.

## 3. Configuration

Configuration is optional. With no config file, `npx loclizr build` expands the
default `catalogs` pattern, takes `en` as the source locale, and writes
`src/loclizr/`. That is the whole quickstart. If no `en.json` exists and the
source locale cannot be inferred, `LZ1004 source-catalog-missing` prints a
whole config file to paste, `defineConfig` import included.

**Path semantics, one rule for the whole config.** `Config.root` is an absolute
POSIX path. **Every other path-valued field of `Config` is POSIX and relative to
`root`**, with `{locale}`, `{sourceLocale}` and `{ns}` left unsubstituted. A
module that opens a file joins it with `root` itself; every path that leaves a
module inside a type (`Diagnostic.file`, `LocaleSpan.file`, `UsageSite.file`,
`DiscoveredCatalog.file`) is relative POSIX. `resolveConfig` normalizes and
enforces this, and `LZ1007 outdir-unsafe` is checked on the resolved absolute
form. `EmittedFile.path` is the one path relative to `outDir` rather than to
`root`, because the prune step compares it against what is on disk under
`outDir` and M10 checks every `Message.module` against it.

**Token expansion.** `{locale}` expands to `[A-Za-z0-9-]+` and `{ns}` to
`[A-Za-z0-9_-]+`. Each matches exactly one whole path segment, or the whole
basename stem before `.json`, and never crosses `/` or `.`. Neither is ever
`*`. This is not a nicety: `Intl.getCanonicalLocales('en.meta')` and
`Intl.getCanonicalLocales('loclizr.context')` both throw `RangeError`, so a
glob that swallowed `en.meta.json` would make the documented quickstart die the
moment somebody writes a description, and would make the *second*
`loclizr build` die with no user action at all, because build one wrote
`loclizr.context.json` beside the catalogs. Belt and braces on top of the
pattern: a resolved `meta` or `record` path the pattern matches is
`LZ1001 config-invalid`, discovery still excludes both paths, and a
**discovered** basename that `Intl.getCanonicalLocales` rejects is skipped with
`LZ1006 catalog-undeclared` at warn. `LZ1002 locale-tag-invalid` stays fatal for
a locale the user **declared** in `locales`. A discovered file that parses to an
object with `schema: 1` is a context record, never a catalog, because no catalog
value is a number: it is a record a build wrote under an
earlier `record` path, `locales/context.json` after the `LZ1001` below moved it.
It is skipped before the locale set is decided, so it declares no locale, and
reported as `LZ1006` at warn naming the file, with a hint to delete it because
the build writes the record at the current `record` path. The file at the
current `record` path is excluded as before and raises nothing.

One consequence worth stating for the `{ns}` layout, where `{locale}` is a
directory segment: with `locales` unset, the discovered directories **are** the
locale set, and not every plausible directory name is rejected.
`Intl.getCanonicalLocales('shared')` does not throw, so
`locales/shared/common.json` declares a locale called `shared`. It does not do
so quietly: a discovered locale whose primary subtag is five to eight letters,
which no ISO 639 code is, raises `LZ1006` naming the file while `locales` is
unset, and the fix is declaring `locales` explicitly, which a split-catalog
project should do anyway.

Two more discovery outcomes are reported rather than dropped. A file the glob
matched whose `{locale}` segment the token cannot spell, `locales/en_US.json`,
the spelling Java, Rails and gettext exports write, is matched a second time
with `{locale}` widened to one whole segment and `{ns}` kept strict, and
reaches `resolveConfig` as a discovered basename that is not a locale tag, so
it is `LZ1006` at warn rather than a locale going missing in silence; a dotted
namespace file such as `en/a.b.json` stays silent. And a `.json` file under the
pattern's own base directory that neither matcher claimed and that is not the
`meta` or `record` path, `locales/fr/common.json` beside a
`locales/{locale}.json` pattern, is one `LZ1006` naming the first such file and
counting the rest, with a hint that names the `{ns}` pattern when adding the
token would match it. That is every namespaced i18next tree one step into a
migration.

Discovery order at `--cwd`, first match wins: `loclizr.config.ts`,
`loclizr.config.mts`, `loclizr.config.js`, `loclizr.config.mjs`. Every one of
them is loaded through `jiti`'s own transform, so a config is never served from
Node's module cache on a second load in one process. `--config <path>` names
one file instead and skips discovery.

```ts
import { defineConfig } from 'loclizr'

export default defineConfig({
  locales: ['en', 'de', 'de-AT'],
  sourceLocale: 'en',
  groups: { errors: 'errors' },
})
```

Defaults, applied field by field:

| Field | Default |
| --- | --- |
| `locales` | every locale discovered by globbing `catalogs` |
| `sourceLocale` | `'en'` if discovered, else the single discovered locale, else `LZ1004` |
| `catalogs` | `'locales/{locale}.json'` |
| `catalogFormat` | `'auto'`, deciding per file (section 2) |
| `i18nextMarkup` | `'literal'` |
| `meta` | `'locales/{sourceLocale}.meta.json'` |
| `outDir` | `'src/loclizr'` |
| `record` | `'locales/loclizr.context.json'` |
| `cookie` | `'locale'` |
| `augmentLocale` | `true` |
| `groups` | `{}` |
| `identifiers` | `{}` |
| `fallback` | `'bcp47'` |
| `formats` | `{ number: {}, dateTime: {} }` |
| `scan.include` | `['src/**/*.{ts,tsx,js,jsx,mts,mjs,svelte,vue,astro}']` |
| `scan.exclude` | `['**/node_modules/**', '**/dist/**']` plus `outDir` |
| `severity` | `{}` |

`meta` and `record` accept `false` to switch the feature off. `outDir` must
resolve inside the project root; anything else, the root itself included, is
`LZ1007 outdir-unsafe`, because the prune step would otherwise walk the whole
project. An `outDir` that can hold a path the `catalogs` pattern matches (each
`{locale}` or `{ns}` segment standing for any directory), or the resolved
`meta` or `record` path, is `LZ1001 config-invalid` naming both fields: the
self-ignoring `.gitignore` M6 writes into it would stop the catalogs and the
record being committed. Moving `outDir` does not remove what an earlier build
wrote there, so the hint also says to delete that `.gitignore` and its
generated files. Paths compare without case, because macOS and Windows
resolve both spellings to one directory. `{sourceLocale}` resolves to the
declared `sourceLocale` when it is a valid tag, otherwise to the inferred
source locale, so the check runs once before discovery and once more after
inference. A resolved `meta` or `record` path that the `catalogs` pattern
matches is also `LZ1001`: a file is a catalog or an artifact, never both. For
`record` the hint also says to delete a record a build already wrote at that
path.

`resolveConfig` validates each field's shape and every one of these is
`LZ1001 config-invalid` with a hint naming the field: a `catalogs` pattern
carrying `{sourceLocale}`, or a glob metacharacter (`*?[]()!{}`) outside the
three tokens, since the pattern would then match nothing and `LZ1003` alone
would never say why; a `cookie` that is not an RFC 6265 cookie-name token, a
name with a space, `;`, `=` or comma, because M12 writes it verbatim into
`document.cookie` and it never reads back; a `formats.timeZone` or a named
style in `formats.number` or `formats.dateTime` that `Intl.DateTimeFormat` or
`Intl.NumberFormat` refuses to construct, probed at the fixed locale `en` so
the verdict is machine independent, with the `Intl` message as the hint; a
named style holding a non-finite number, which `Intl` would silently coerce
rather than refuse (`hour12: NaN` builds); a
`sourceLocale` that `locales` does not declare; and a top-level field the
config does not have, `outdir` for `outDir`, because a JavaScript config gets
no type check and a misspelled path field would otherwise fall back to its
default and send output, or the record CI compares, somewhere the user never
chose. Its hint names the nearest field within two edits, compared without
case, or lists the fields when none is that close. Every unknown field is its
own diagnostic, in the config's own key order. Declared locale tags are kept
verbatim, never canonicalized through `Intl.getCanonicalLocales`, because
canonicalizing would change `Config.locales`, the emitted arms and the
`AppLocale` union; `de-at` declared against `de-AT.json` on disk is therefore
`LZ1005` plus `LZ1006`, not a match. A `fallback` key that is not a locale tag
is dropped with no diagnostic: it can never name a declared locale, since
`LZ1002` is fatal for those.

`severity` re-levels any rule to `off`, `warn` or `error`, with three
exceptions. `LZ1001 config-invalid`, `LZ1007 outdir-unsafe` and
`LZ5001 output-unwritable` are **not re-levelable**: turning `outdir-unsafe`
down would let a build write outside the project root and still exit 0, and
turning `config-invalid` down is self-referential. A `severity` entry naming one
of those three is itself `LZ1001 config-invalid`, raised by `resolveConfig`.

`augmentLocale` controls one block in the generated barrel's declarations, the
`declare module 'loclizr' { interface LocaleRegistry ... }` augmentation. It is
`true` by default because that augmentation is what types `useLocale()`. Two
generated directories in one TypeScript program each declaring it is **TS2717,
"Subsequent property declarations must have the same type"**, reported inside
generated files the reader was told not to open, and it stops the app compiling
outright. Set it `false` in the second tree. `loclizr init` defaults it to
`false` when it detects an existing generated tree in the workspace.

`identifiers` maps a catalog key to a generated identifier, so a collision is
fixed without renaming a key that i18next is still reading during a migration:
`identifiers: { 'nav.home': 'navHome' }`. One map serves three lookups: an
entry is looked up by the catalog key for the message identifier, by the
top-level key segment for the namespace filename, and by the group name for a
group's export identifier, so `{ errors: 'appErrors' }` renames both the
`errors` namespace module and a group named `errors` at once. Section 7.2's
`LZ4002` escape hatch for a reserved namespace filename is the second lookup.
An entry that none of the three lookups can reach, because its key is not a
source catalog key, the top-level segment of one (`_root` for a key with no
dot) or a group name, is `LZ4007 identifier-orphan`, naming the closest of
those names by edit distance, so a typo or a key renamed after the entry was
written does not leave the build green. `_root` is never the name offered,
since no typo aims at it. A source key whose value failed to lower still
counts, because the entry is right and the value is what broke.

`groups` maps a group name to a key prefix. `{ errors: 'errors' }` takes every
key under `errors.` as a member of the group `errors`.

`formats` supplies named format styles that ICU does not define, keyed by the
name used in a message:

```ts
formats: {
  timeZone: 'UTC',
  number: { compact: { notation: 'compact', maximumFractionDigits: 1 } },
  dateTime: { weekday: { weekday: 'long', month: 'long', day: 'numeric' } },
}
```

`formats.timeZone` is merged into every resolved date and time option set before
hoisting, skeleton, named and bare forms alike, and never into a number option
set. A `timeZone` inside a user's own `formats.dateTime` named style wins over
it, so a custom style stays the way to pin one message to another zone. It
exists because a zone is not expressible in an ICU skeleton at all, skeletons
carry `timeZoneName` and never an IANA zone, so without this field the only way
to pin a zone would be rewriting every date message in every catalog to a
custom named style. Leave it unset in a browser SPA, where you want the
viewer's own zone; set it where the server renders dates and the zone must
agree across the hydration boundary.

## 4. Locale fallback

Every locale in `locales` gets its own compiled arm in every message function,
so there is no runtime chain walk and no `undefined` branch.

For a target locale `L`, the build resolves each message in two steps. **A
locale that wrote a value of its own never inherits.** If that value renders,
the locale is `translated`; if it is blank, or failed to lower, or names an
argument the source does not have (section 5.1), the locale falls back to the
source locale with reason `blank` or `invalid`, and no ancestor is consulted,
so the record never claims a translation nobody wrote. Only a locale with no
entry at all for the key walks the chain until it finds an ancestor whose own
value renders:

- `fallback: 'bcp47'` (default) gives
  `[L, ...BCP-47 subtag truncations of L that are declared locales, sourceLocale]`.
  So `de-AT` resolves through `de` and then `en`.
- `fallback: { nb: ['no'] }` replaces the middle of the chain for `nb` with the
  listed locales, still ending at `sourceLocale`. Use it where truncation cannot
  reach, such as `nb` and `no`. An entry naming a locale that is not declared
  contributes nothing: no catalog is read for it, so the walk continues past
  it.
- The source locale's own chain is `[sourceLocale]` whatever `fallback` says,
  because every chain ends there; an entry keyed by the source locale is
  ignored.

An ancestor whose own value fell back is skipped as a candidate, so `de-AT`
inheriting from a `de` that is blank on a key falls to the source and records
its **own** reason, `missing`, not `de`'s.

The resolution result is recorded as one of three origins:

| Origin | Meaning | Diagnostic |
| --- | --- | --- |
| `translated` | the locale's own catalog had a value it can render | none |
| `inherited` | no own value; resolved through a declared non-source ancestor whose own value renders | none |
| `fallback` | fell all the way through to the source locale | `LZ3001` for reason `missing`, `LZ3002` for `blank` unless the source value is blank too, and none of its own for `invalid`, whose cause M3 or M5 already reported |

This makes sparse regional overlays first class. A `de-AT.json` holding twelve
overrides on top of a complete `de.json` is a valid catalog, not 388 errors.
Only falling through to the source locale is a missing translation. A blank
overlay value under a complete ancestor is not an override, though: it is
`fallback` with reason `blank`, because the overlay wrote something and what it
wrote cannot render.

At runtime, a requested tag that is not a declared locale is matched by exact
match, then by progressive subtag truncation, then by the source locale. A
tampered cookie holding `sp` renders source text, never `undefined`.

That algorithm is RFC 4647 lookup and it stays exactly this small, but it has
one silent whole-market failure the build can see and the runtime cannot.
Truncating `de` yields nothing, so a project declaring `en` and `de-AT` serves
English to every browser sending `Accept-Language: de`. A declared locale
carrying any subtag, region or script (`zh-Hans`, `sr-Latn`), whose base tag
is not also declared is therefore `LZ1018 locale-base-missing` at warn, hint:
add `de`, or expect `Accept-Language: de` to fall back to `en`. The rule lives
in M9, where the locale list already is. It never fires on the source locale:
`Accept-Language: en` against a source `en-US` falls to `en-US`, the same
language, so the failure the rule exists for cannot occur there, and firing
would warn every `en-US` project with no fix but a fake `en` catalog.

## 5. The message model

One representation, three consumers. It lives in `src/types.ts`, owned by M1,
and is written out in full in section 15.

Every locale's lowered form is kept, not just the source locale's. `Body` holds
`nodes`, `args` and `markupTags` for one locale. That is what lets M5 compare
argument sets across locales without re-parsing anything, which invariant 5 in
section 1 requires. `Message.args` is the **unified** set used by emit for the
declaration file; the per-locale sets live in `Body.args`.

**`Message.bodies` holds each locale's own lowered body and nothing else.** A
locale whose catalog is missing this key, whose value is blank, or whose value
failed to lower has **no entry in `bodies` at all**. `bodies` is not padded, not
back-filled and never contains a copy of another locale's nodes. A locale whose
value lowered cleanly does have an entry even when that body is wrong in some
cross-locale way, because M5 needs `Body.args` and `Body.markupTags` in hand to
say so.

**The fallback decision lives in M4 alone, and it is recorded in
`Message.origins`.** M4 walks the chain, decides which locale's body each
declared locale renders, and stamps one `Origin` per declared locale. M6 then
emits arm *N* from `bodies[origin.from ?? locale]`: a `translated` origin
carries no `from` and reads its own body, and an `inherited` or `fallback`
origin names the locale whose body to print. **M6 makes no fallback decision of
its own and never inspects `bodies` for absence.** That is the seam: one module
decides, one module prints, and M8's `RecordTranslation` is a transcription of
the same `origins` array, so the emitted arms, the record's statuses and
`Summary.fellBack` cannot disagree.

### 5.1 Argument types

```
stringish   {x}              string | number
number      {x, number, S}   number
            {x, plural, ...} number
            {x, selectordinal, ...} number
            #                number (the enclosing plural's selector)
date        {x, date, S}     Date | number
            {x, time, S}     Date | number
select      {x, select, ...} a union of the source locale's non-other options
markup      <tag>...</tag>   (chunks: readonly (string | T)[]) => T
```

Unification across locales, performed by `unify(a, b)`:

- `stringish` unifies with anything and narrows to the other kind.
- Identical kinds unify to themselves. For `select`, the option union comes from
  the source locale only, so a target locale adding a branch does not widen the
  call-site type.
- Anything else fails, and `unify` returns `null`.

One case is settled before `unify` is asked. A target locale's `select` on a
name the source does not write as a `select` is skipped in the `Message.args`
fold, neither narrowing the type nor failing it: the first rule would let a
translator's branch names become required literals at every call site, which
is the breakage a bare `{x}` exists to avoid, and a third locale's genuine
narrowing to `number` or `date` still survives.

**Within one locale**, `lower` deduplicates `Body.args` by name, folding each
repeat through `unify`. `{d, date, medium} at {d, time, short}` is legitimate
and unifies cleanly to `date`. `{x, number} of {x, date, short}` does not, and
is `LZ2009 arg-type-conflict-local`, an error fatal for that message only.
Without the dedup, `Body.args` would carry two entries for one name and emit
would print an arbitrary winner into a declaration whose body formats both
ways. Argument names are normalized to NFC first, so an NFC and an NFD `café`
are one argument here and do not produce a spurious `LZ3004` / `LZ3005` pair
across locales later. Select options are never normalized, because the runtime
matches them verbatim; two options of one select that are equal under NFC but
not byte-identical are `LZ2001`, at the second option.

**`Message.args` is exactly the source locale's argument set, in
first-appearance order in the source body, with types unified across locales.**
First appearance is read in the canonical branch order of section 5.5, not the
catalog's text order: `lower` sorts a plural's branches (exact ascending, then
keywords in CLDR order) and moves a select's `other` last before it visits
their bodies, so a name first seen in a later branch lands where the printed
`normalized` form puts it. Without that the declaration's parameter order and
`Message.source` would disagree for one message, and an i18next catalog and a
hand-written ICU catalog with the same meaning would produce different records.
Two halves, both load bearing:

- *Presence* comes from the source alone. A translator typing `{{nmae}}` in
  `de.json` must not put `nmae` into the printed `.d.ts`, because that would
  make a required parameter out of a typo and break the **app's** typecheck at
  every call site. `LZ3005 arg-extra` already reports it.
- *Types* come from every locale. **M4 computes `Message.args`** by folding each
  source-locale name's type through `unify` across all locales, keeping the
  source locale's type wherever `unify` returns `null`, so emit always has a
  usable declaration to print even for a broken catalog.

The other half of the typo case is what the German arm renders. Emitting
`${args.nmae}` would ship the literal string `undefined` to users, so that arm
must render the source body instead. The worst case is untranslated text, which
is visible and recoverable, rather than `undefined` in the UI, which is neither.

**That decision belongs to M4, not to emit.** A locale whose body references a
name absent from `Message.args` is a locale M4 resolves to the source locale: it
stamps that locale's origin
`{ status: 'fallback', from: sourceLocale, reason: 'invalid' }`, the same shape
a value that failed to lower gets, because in both cases the locale's own body
is unusable. M6 then prints `bodies[origin.from]` by the ordinary rule in
section 5 and makes no substitution decision. The locale **keeps its `Body`**,
so M5 still reads `Body.args` and raises `LZ3005 arg-extra` against it, and M8
records `status: 'fallback'`, `from: 'en'`, `reason: 'invalid'` rather than
claiming a translation the app never renders. One decision, one place, three
consumers that agree.

`Message.args` order is semantic, derived from one array (the source body), so
it is deterministic without sorting. M6 prints it verbatim in the declaration
and M8 copies it into the record, which is what keeps the two from silently
disagreeing.

**M5 re-runs the same pairwise comparison** over `Body.args` and raises `LZ3004`
through `LZ3009` for the mismatches it finds, including
`LZ3006 arg-type-conflict` wherever `unify` returned `null`. This keeps every
cross-locale diagnostic in one module without making emit wait on checks, and
neither module re-parses anything.

A `select` argument types as the union of the source locale's non-`other`
options. A call site that must pass an open set, such as a value straight from
an API, writes the message as a bare `{x}` instead; a `select` with only an
`other` branch is therefore typed `string | number`.

### 5.2 Format styles

The parser is called once per message with
`{ shouldParseSkeletons: true, requiresOtherClause: true, captureLocation: true, ignoreTag: false }`.

Verified behaviour of the installed parser, version 3.5.19:

- A `::` skeleton arrives with `style.parsedOptions` already resolved to Intl
  options. `{d, date, ::yyyyMMdd}` gives
  `{ year: 'numeric', month: '2-digit', day: '2-digit' }`.
- A **named** style arrives as a bare string. `{d, date, medium}` gives
  `style: 'medium'`, not options. Named styles are the common form in real
  catalogs, so the compiler resolves them from this table.

| Message form | Intl options |
| --- | --- |
| `{x, number}` | `{}` |
| `{x, number, integer}` | `{ maximumFractionDigits: 0 }` |
| `{x, number, percent}` | `{ style: 'percent' }` |
| `{x, number, currency}` | `LZ2002`, because ICU carries no currency code. Define one in `formats.number` or use `::currency/USD`. |
| `{x, date}` | `{ dateStyle: 'medium' }` |
| `{x, date, short\|medium\|long\|full}` | `{ dateStyle: <style> }` |
| `{x, time}` | `{ timeStyle: 'medium' }` |
| `{x, time, short\|medium\|long\|full}` | `{ timeStyle: <style> }` |
| `{x, number\|date\|time, ::skeleton}` | `style.parsedOptions` verbatim, except the `unit/` and `per-measure-unit/` stems, a number skeleton's `scale`, which moves to `NumberFormatSpec.multiplier`, and a date or time skeleton's `j`, `J` and `C` (all below) |
| any other named style | looked up in `config.formats.number` or `config.formats.dateTime`, else `LZ2002 icu-style-unknown` |
| a `::` skeleton the parser rejects, that resolves to no options at all, whose `scale` is not a finite number, whose options `Intl` cannot build, that holds `per-measure-unit/` with no unit, or a date or time skeleton holding `J` or `C` | `LZ2003 icu-skeleton-invalid`, and that node falls back to the bare form |

`LZ2003` is `fatal: never`, so the message must survive a bad skeleton, and
the parser reports one as a failed parse. `lower` therefore reparses a
skeleton-shaped failure with `shouldParseSkeletons: false`; when that
succeeds, each `::` style is re-validated by its own probe, the bad one raises
`LZ2003` and lowers as the bare `{x, number}` or `{d, date}`, and the rest of
the message lowers as written. A skeleton the tokenizer accepts but that
resolves to an empty option set is the same code, so it is reported instead of
rendering unformatted. That covers a typo, `::currrency/USD`, `::percnt`,
`::foo`, and a valid ICU stem the parser maps to nothing, `::latin`,
`::permille`, `::.00+`, which the build cannot tell apart, so the hint says
each stem is misspelled or not supported by loclizr. When the parser's
resolver rejects a skeleton it throws a sentence that often names the
supported field, such as
`` `D/F/g` (day) patterns are not supported, use `d` instead `` for `::D`,
and the message quotes it after the skeleton; the text
comes from the parser dependency, not the engine, so it does not vary with the
Node version. A failure the tokenizer raises carries only an error kind name, and
the message quotes nothing. Two limits:
a multi-stem skeleton with one misspelled stem, `::percent scale/100` beside a
typo, still resolves to something and stays silent, and a failure that survives
the retry, such as an unclosed brace after the skeleton, is `LZ2001`; an empty
skeleton, `{x, number, ::}`, is `LZ2003` like the typos above. `{x, number, ::currency}` with no
code resolves to `{ style: 'currency' }`, which makes `Intl.NumberFormat` throw
in the browser, so it is `LZ2003` carrying the `currency` row's hint above,
with the bare number options as the fallback.

The parser passes unit and currency codes through unchecked, so every resolved
skeleton is probed with `new Intl.NumberFormat` or `new Intl.DateTimeFormat`
at build time, and one that throws is `LZ2003` with the bare form as the
fallback: `::unit/furlong`, `::currency/US`. The probe uses the host's default
locale, since an option's validity does not depend on the locale, and the
diagnostic never quotes the engine's error text. The parser also reads the
`unit/` stem like `measure-unit/` and drops everything up to the first hyphen
as a type prefix, but `unit/` takes a bare core unit id, so the compiler keeps
its whole option: `{x, number, ::unit/kilometer-per-hour}` resolves to
`{ style: 'unit', unit: 'kilometer-per-hour' }`, not `unit: 'per-hour'`.
The parser ignores `per-measure-unit/` outright, so the compiler composes it
with the skeleton's `unit/` or `measure-unit/` into Intl's compound id,
stripping the type prefix from the per unit the same way:
`{x, number, ::measure-unit/length-meter per-measure-unit/duration-second}`
resolves to `{ style: 'unit', unit: 'meter-per-second' }`, and
`::unit/kilometer per-measure-unit/duration-hour` to
`unit: 'kilometer-per-hour'`. A pair `Intl` does not support fails the probe
above and is `LZ2003`. A `per-measure-unit/` in a skeleton with no unit stem,
alone or beside other stems such as `::percent`, is `LZ2003` too, rather than
dropped.

The parser expands a date or time skeleton's `j`, `J` and `C`, the
locale-preferred hour fields, only when given a locale, which the call above
does not pass, so it drops them. The compiler resolves a run of `j` itself to
`hour: 'numeric'` for one `j` and `hour: '2-digit'` for two or more, with no
`hourCycle`, so `Intl` picks the locale's cycle when the message renders and
the options stay one object for every locale:
`{d, time, ::jm}` resolves to `{ hour: 'numeric', minute: 'numeric' }` and
renders `2:05 PM` in `en` and `14:05` in `de`. `J`, the locale's hour without
its day period, and `C`, the hour with a flexible day period, have no `Intl`
option, so a skeleton holding either is `LZ2003` with the hint "Write ::jm for
the locale's hour with its day period, or ::Hm for a 24-hour clock". An
explicit `h`, `H`, `k` or `K` keeps the cycle the parser gives it.

`scale/N` in a number skeleton is ICU's multiply-before-formatting, and
`Intl.NumberFormat` has no such option, so `lower` takes `scale` out of the
options and sets `NumberFormatSpec.multiplier`; the generated code formats
`value * multiplier`. `Intl`'s `percent` style already multiplies by 100, which
ICU's `percent` unit does not, so under `style: 'percent'` the multiplier is
`N / 100`, and a multiplier of 1 is omitted. `::scale/1000` renders 2 as
`2,000`, `::currency/USD scale/1000` renders 2 as `$2,000.00`, `::scale/0.01`
renders 500 as `5`, and `::percent scale/100` renders 0.25 as `25%`, exactly
like `::percent`. The parser reads `scale/abc` and a bare `scale` as `NaN`,
so a scale that is not a finite number is `LZ2003`, with the bare number
options as the fallback, instead of rendering every value as `NaN`.

A `date` or `time` argument whose resolved options contain no `timeZone` raises
`LZ3011 date-without-timezone`, **default `off`**, once per message against the
source locale. The hazard is real where a server renders a date, because the
server and the browser resolve different default zones, and `formats.timeZone`
is the remedy. It is off by default because it would otherwise fire on this
spec's own worked example, `cart.updated` resolves to `{ dateStyle: 'medium' }`
with no zone, and because the fix most of its users should apply in a browser
SPA is "do nothing, use the viewer's zone". A gate whose selling point is that
you do not have to remember to wire it cannot afford a default-on rule that
warns on its own showcase message. The `loclizr/server` documentation is where
it is named as the rule to turn on.

M6 emits the two nodes as separate shapes so `printIcu` round-trips: the node
carries `form: 'date' | 'time'` and the `style` token exactly as written
(`'medium'`, `'::yyyyMMdd'`, or `null` for the bare form) beside the resolved
options.

### 5.3 Plural semantics

The compiler follows ICU precedence exactly.

1. Exact matches (`=0`, `=7`) are tested first, against the **un-offset** value.
2. If no exact match applies, `Intl.PluralRules` selects a keyword category from
   `value - offset`.
3. `#` inside a plural body renders `value - offset` through
   `Intl.NumberFormat` with the locale's default number options.
4. `offset` arithmetic is emitted only when `offset !== 0`.

`{x, selectordinal, ...}` is the same node with `ordinal: true`, which selects
`new Intl.PluralRules(locale, { type: 'ordinal' })`.

The locale passed to `Intl.PluralRules` is the locale of the body the arm
prints, never the requesting locale. Every emitted `$plural1` call names that
locale as a literal: a translated arm names its own locale, and an inherited or
fallback arm names the locale whose text it renders, so `ja` with no catalog
renders the `en` body with English categories rather than selecting `other`
for every count and printing "1 items". `#` and the number and date styles in
that arm still format with the requesting locale, so `de-AT` falling back to
`de` shows German text with Austrian number formatting.

The set of categories a locale requires comes from
`requiredCategories(locale, ordinal)`, which is
`new Intl.PluralRules(locale, { type }).resolvedOptions().pluralCategories`
when `Intl.PluralRules.supportedLocalesOf(locale)` is non-empty and `[]`
otherwise, so there is no hand-maintained CLDR table and a locale `Intl` has no
data for never borrows the build machine's default locale's categories. `[]`
means unknown, not none: M2 keeps `_zero` as `=0` for such a locale, and M5
would read every keyword branch of it as `LZ3013`, including `other`, which is
correct only because M10 drops `LZ3007` and `LZ3013` for every locale without
plural data before reporting (section 16, M10 step 0). It lives in M1's
`src/util` because M2's suffix folding and M5's checks both need it; M3 never calls it, because
`LZ2006` tests the universal CLDR keyword set and every locale-specific rule is
M5's. A locale missing one of its required categories raises
`LZ3007 plural-category-incomplete` as a warning. Only keyword branches count:
an exact branch does not satisfy a category, so
`{count, plural, =0 {...} =1 {...} other {...}}` still warns in English about
`one`, and the fix is the keyword branch. A keyword branch that the locale can
never select is the mirror image and is `LZ3013 plural-category-unreachable`,
also a warning: an ICU-native
`de.json` holding `{c, plural, zero {...} one {...} other {...}}` passes every
other check while the `zero` body is dead forever, which is exactly the failure
section 2.1 spends three paragraphs preventing on the import path, left open on
the format we call our own. Hint: German never selects `zero`; use the exact
branch `=0`. A branch keyword that is neither a CLDR category nor `=N` is
`LZ2006 plural-category-unknown`.

`requiresOtherClause: true` makes a missing `other` a parser error with a
location, which maps to `LZ2004 plural-other-missing` and
`LZ2005 select-other-missing`.

Two exact selectors that differ as text and agree as numbers, `=0` and `=00`,
`=1` and `=+1`, are one branch at run time, and printing both would emit the
same `=N` token twice, which no ICU implementation parses. `lower` keeps the
first in source order and drops the rest, with no diagnostic: no code names a
dropped duplicate exact branch, and `LZ2001` is message-scoped fatal, so it
would delete a message the parser accepted.

`#` cannot appear outside a plural body. Verified: the parser folds a stray `#`
into literal text, and the i18next converter never emits one. There is no rule
for it, and it is the same fact that keeps `#` out of the escape's special set
outside a plural body (section 2.1 step 1): a character the parser treats as
literal must not be quoted, or the quote changes the text around it.

**`#` inside a select inside a plural is a documented divergence of the chosen
parser, and it is made visible rather than left silent.** Verified on 3.5.19:
`{a, plural, offset:1 other {# and {b, select, x {#} other {#}}}}` yields a
`PoundElement` for the first `#` and plain **literal text** `"#"` for the two
inside the select. ICU4J and ICU4C render those as the number, so the idiomatic
gender-inside-count message renders a literal `#` in production and behaves
differently from every other ICU implementation the user's TMS validates
against. We follow the parser, because inventing a second pound resolution would
make our output disagree with the parse tree we ship diagnostics against, and we
raise `LZ2008 pound-literal` at warn for any literal text node containing `#`
lexically inside a plural body. The check is free during lowering and fires
exactly on the mistake. The hint names the construct that fired it, in the
file's own syntax: inside a nested select, move the `#` out of the select or
write `{a, number}`; a quoted `'#'` with no select, write `#` without the quotes
or `{a, number}`; in an i18next file, `#` is always the character, so write
`{{a}}` for the count.

### 5.4 Markup

Markup ships in v0.1, and nesting works. The alternative is an error telling
people to split sentences, which is bad localization advice to bake into a
compiler, and a non-nesting handler type is not forward compatible with nesting:
adding it later would change every tagged signature.

`<link>the terms</link>` makes `link` a required argument typed
`(chunks: readonly (string | T)[]) => T`, and the message's return type becomes
`readonly (string | T)[]`. Tagless messages still return `string`, so the
concept appears only where it is used. Attributes inside a message are not
supported; the parser does not produce them.

`LZ3010 markup-mismatch` compares **deduplicated sorted tag sets only**, never
nesting arity. A translator legitimately renests `<b>` and `<i>`, and requiring
identical nesting would bake bad localization advice into the compiler. It fires
only in one direction: a tag the source has and the target lacks. A target-only
tag is `LZ3005 arg-extra` alone, never both, because one translator mistake
should produce one diagnostic.

**`Message.kind` is the source locale's kind, and emit coerces every arm to
it.** `LZ3010` is a non-fatal error, so a German translation that dropped
`<link>` still emits, and without coercion that arm would return a template
string while the declaration promises `readonly (string | T)[]`. `<Parts of={}>`
would then spread a string into per-character children, and TypeScript could not
see it, because the `.d.ts` is printed text rather than inferred. So a markup
message's tagless arm returns a one-element array, `` [`Lies unsere AGB...`] ``.

A tag name is an argument of kind `markup`, which means the opposite direction
needs no new rule: a target arm introducing a tag the source lacks references a
name absent from `Message.args`, so `LZ3005 arg-extra` fires and M4 resolves
that locale to the source body per section 5.1. The two directions are handled
by different modules and that is deliberate. **Coercion is M6's**, because only
emit knows what shape it is about to print. **Substitution is M4's**, because it
is a fallback decision and section 5 keeps every one of those in one place.

Generated markup code builds a plain array literal and calls no runtime helper.
`loclizr/react` exports `Parts` to render one. Where a tag sits inside a plural
or select branch, the arm is a multi-line array literal with a spread
conditional, still one literal and still no helper:

```js
      return [
        'You have ',
        ...($plural1('en', n0, false) === 'one'
          ? [args.b(['one file'])]
          : [args.b(['many files'])]),
        ' to read',
      ]
```

A markup arm with no tag anywhere keeps the one-element form section 7.6
prints.

### 5.5 Canonical ICU printing

`printIcu(nodes)` is the inverse of `lower`, and it carries three loads: it is
`Message.source`, the string shipped to translators and to a TMS; it is what
`sourceHash` hashes; and it is what `LZ3012 ambiguous-source` compares. So its
output must be **re-parseable ICU**, or a TMS is handed a string that fails its
own validation and two genuinely different messages can compare equal.

The exact form, node by node:

| Node | Printed |
| --- | --- |
| text | `escapeIcuLiteral(value, { inPlural })` |
| arg | `{name}` |
| number | `{name, number}`, or `{name, number, STYLE}` |
| dateTime | `{name, date}` / `{name, time}`, or with `, STYLE` |
| pound | `#` |
| plural | `{name, plural, BRANCHES}`, `selectordinal` when `ordinal` |
| select | `{name, select, BRANCHES}` |
| markup | `<tag>children</tag>` |

**`inPlural` comes from the walk, not from a guess.** `printIcu` already
descends through plural and selectordinal branches to print them, so it knows
whether the text node it is printing sits directly inside one, and it passes
that to the escape. "Directly inside" follows the parser: a nested select
resets it, so `'#'` inside a select inside a plural is three literal
characters, while a markup tag does not, so text inside `<b>` inside a plural
is still quoted. `markup` is left at its default here: `printIcu` prints a
`markup` node as a real tag, so any `<` still in a text node is literal text
that has to stay quoted. This is the other half of what makes the round-trip
property below hold rather than nearly hold.

`STYLE` is the node's `style` token verbatim. A plural with a non-zero `offset`
prints `offset:N ` immediately after the type keyword. Branches print as
`key {body}` joined by exactly one space: exact branches first, ascending by
value, then keyword branches in CLDR order `zero one two few many other`.
Select branches keep source order with `other` last, because no conversion path
reorders them and the author's order is worth preserving. Separators are exactly
`, ` after the name and after the type keyword, and there is no space before the
closing `}`.

Normalizing plural branch order is what makes section 14's claim true, that an
i18next catalog and an ICU-native catalog with the same meaning produce the same
record. Select branch order is recovered from each option's recorded location,
because the parser returns options as a plain object and reorders integer-like
keys, so `{rank, select, 1 {..} 0 {..} other {..}}` would otherwise arrive as
`0, 1, other`. `lower` also merges adjacent text nodes, so no body ever holds
two consecutive literals, which would print identically and re-lower as one.
M3 carries a round-trip property test over every fixture:
`lower(printIcu(lower(x).nodes))` is node-equal to `lower(x)`. It is the
cheapest guard on the record's correctness and it lives entirely inside one
module.

## 6. The runtime ABI

Generated code imports exactly four symbols from `loclizr`. They are private
API, marked by the `$` prefix, and versioned by the trailing digit.

```ts
$configure1(setup: LocaleSetup): LocaleResolver
$plural1(locale: string, value: number, ordinal: boolean): string
$number1(locale: string, value: number, options: IntlOptions): string
$dateTime1(locale: string, value: Date | number, options: IntlOptions): string
```

**The ABI is enforced by the JS import, not by types.** A stale generated tree
left over from before an upgrade fails at link time in Rollup, esbuild, Vite dev
and Node ESM, because the named import is gone. A type-level brand cannot do
this job: `skipLibCheck: true` is set in this repo's own `tsconfig.base.json`
and in every Vite template, which suppresses diagnostics inside declaration
files. So a breaking change to a helper renames it (`$plural1` becomes
`$plural2`) and the old name stays exported, deprecated, for exactly one minor
before it is removed. One minor, not an open-ended promise: the project is 0.x
and a window it cannot keep is worth nothing.

### 6.1 Formatter caching

`$number1` and `$dateTime1` cache by **object identity** of the options object,
never by a serialized key:

```
WeakMap<optionsObject, Map<locale, Intl.NumberFormat>>
```

The generated tree hoists every distinct options object into one shared module,
`outDir/messages/_formats.js`, so two namespaces that use the same format share
one cache entry. Each hoisted const is individually tree-shakeable, so an unused
format drops with its message.

**Each hoisted const is named `$f` plus `hash16(stableStringify(options))`, not
`$f1`, `$f2`, `$f3`,** with any non-finite number first replaced by a
one-element array of its `String` spelling, because JSON writes `NaN`,
`Infinity` and `-Infinity` alike as `null` and no option value is ever an
array. A positional ordinal renumbers every later const whenever
a format is added anywhere in the project, which turns one new currency style
into a whole-file diff for every team that commits `outDir` and makes
`LZ5002 output-stale` report churn instead of staleness. The hash is stable
under insertion, so only the new line appears. It is 64 bits of sha256 over the
canonical JSON, so a collision between two distinct option sets in one project
is not reachable in practice. Declaration order is by that name, by code point,
which is the section 7.5 sort.

`$plural1` caches in a `Map` keyed `locale + '\u0000' + (ordinal ? 'o' : 'c')`,
because `Intl.PluralRules` has exactly two variants per locale and no options
object to key on.

### 6.2 `$configure1`

```ts
$configure1({ locales, sourceLocale, cookie }): (options?: MessageOptions) => string
```

It does two things:

1. Returns a resolver bound to that generated directory's own `locales` and
   `sourceLocale`. The resolver reads the **raw requested tag** through
   `getRawLocale()` (or takes `options.locale` when given) and matches it
   against its own locale list with `matchLocale`. It never routes through the
   public `getLocale()`, so a second generated directory declaring a locale the
   first does not know still resolves its own messages correctly.

   **`getRawLocale()` is exactly the first three steps of `getLocale()`'s
   resolution order** in section 11.1: an active `AsyncLocalStorage` scope, then
   the stored tag if `setLocale` has run, then lazy client detection where a DOM
   exists. It performs **no matching**, consults no locale list and applies no
   source-locale default; a generated resolver matches against its own list, and
   that division is what makes two generated directories work. When all three
   steps miss it returns the empty string, and `matchLocale('', locales,
   sourceLocale)` returns `sourceLocale`, so a resolver still yields a declared
   locale. That miss on a server where `loclizr/server` has installed the scope
   handle is the escaped-scope warning of section 11.2, so a message call
   outside a request scope warns exactly as `getLocale()` does. A call given
   `options.locale` never reads `getRawLocale()` and never warns.
2. Registers `locales`, `sourceLocale` and `cookie` as the process default for
   the public `getLocale()`, **first call wins**. A second registration with a
   different set is ignored and warns once outside production.

The returned resolver is assigned to an exported const that every namespace
module imports, so no bundler can drop the call: not a `/*#__PURE__*/`
annotation, not `sideEffects: false` on the host package. The call's result is
load bearing, which is stronger than any annotation.

Registration happens inside `$configure1`, which runs only when a generated
module is first evaluated, so an app can legitimately reach `getLocale()` with
nothing registered: a server entry calling it before importing any message, or
a client importing only `getLocale` from the barrel, which lets a bundler drop
`_locale.js` because nothing references `$l`. With nothing registered,
`getLocale()` returns the raw stored tag if `setLocale` has run and the literal
`'en'` otherwise, and warns once outside production naming the missing
generated-module import. `matchLocale(requested, [], fallback)` returns
`fallback`. Silence there would be a crash report instead of a sentence.

**Two generated directories in one TypeScript program.** Each barrel declares
`declare module 'loclizr' { interface LocaleRegistry { locale: AppLocale } }`,
and two of them with different unions is **TS2717, "Subsequent property
declarations must have the same type"**, reported inside generated files the
reader was told not to open. A monorepo app consuming a shared component
package with its own catalog, or an app running two trees mid-migration, does
not compile at all. `augmentLocale: false` on the second tree omits the block
and keeps the concrete `getLocale`, `setLocale` and `locales` declarations,
which section 7.6 already relies on to gate the switcher. At run time the
second directory resolves its own messages correctly; `getLocale()` and
`useLocale()` follow the first directory's locale list.

## 7. Generated output

### 7.1 Layout

```
src/loclizr/
  .gitignore                self-ignoring: "*" then "!.gitignore"
  messages.js  messages.d.ts        the barrel
  groups.js    groups.d.ts          the typed lookup tier
  messages/
    _locale.js   _locale.d.ts       locale list, source locale, cookie name, the resolver
    _formats.js  _formats.d.ts      hoisted Intl option objects
    cart.js      cart.d.ts          one module per top-level key segment
    errors.js    errors.d.ts
    nav.js       nav.d.ts
    order.js     order.d.ts
    terms.js     terms.d.ts
```

**JS plus a hand-printed `.d.ts`, never `.ts`.** Generated code must not inherit
the host tsconfig (`jsx`, path aliases, `strict`), must serve JavaScript
consumers without `allowJs`, and must not enter the app's typecheck graph. We
print the declarations as text, so `typescript` stays a devDependency of the
package and is never needed to produce output.

**One module per top-level key segment**, not one file per message and not one
flat file. Per-message modules produce thousands of files, TS language-server
latency and unreviewable diffs, which is Paraglide's most-reacted scaling
complaint, and buy no tree-shaking, because bundlers already do intra-module
dead code elimination on side-effect-free `export function`. A single flat
module gives up the one escape hatch that matters on React Native, where Metro
does not tree-shake at all and a deep import is the only way to split by hand.
Root-level keys land in a namespace named `_root`.

**The barrel is a sibling file, not `messages/index.js`.** `./loclizr/messages`
then resolves in bundlers, and `./loclizr/messages.js` resolves under Node's ESM
resolver, with no file-versus-directory ambiguity. Every generated relative
import carries an explicit `.js`, because this code runs under Node during SSR.

**`groups.js` is deliberately not re-exported by the barrel.** Importing it is
the explicit act of paying for that group's tree-shaking.

**`outDir` is gitignored by default**, through a self-ignoring `.gitignore`
written inside it, so the app's root ignore file is never touched. The research
records generated code in `src/` as one of Paraglide's loudest complaints, and
the artifact that belongs in the pull request is the context record, not
several hundred lines of machine-written JavaScript. `loclizr init` prints the
`predev`, `prebuild` and `pretypecheck` scripts that build the tree before the
command that needs it, with `predev` on `loclizr build --no-fail` and the two
gate hooks on plain `loclizr build` (section 10). There is no `prepare` hook: it
would run on `npm ci` and rewrite the record in the CI workspace before
`loclizr check` compares it, so a fresh clone has no generated tree until the
first of the three hooks runs, and editor diagnostics until then are the price. A
team that would rather commit the tree deletes that one `.gitignore`;
`LZ5002 output-stale` then starts checking those files, because the rule fires
only when the files exist on disk.

**M6 owns that `.gitignore` and returns it as an `EmittedFile` like any other**,
so nothing in the layout has two authors. M10 writes it **only when `outDir`
itself does not exist at the start of the run**, and excludes it from both the
write-if-changed comparison and `LZ5002`. That is what makes deleting it an
escape hatch rather than a wish: recreating it unconditionally would let the
documented escape survive exactly one build.

**Every emitted file except the `.gitignore` begins with the generated header**,
`// @generated by loclizr abi=1. Do not edit; run \`loclizr build\`.`, byte for
byte, as line 1. That includes every `.d.ts`, where it sits above the imports.
Every `.js` carries `// @ts-nocheck` as line 2, so a project that typechecks
JavaScript (`checkJs`, `svelte-check`, `astro check`) never checks generated
code; the `.d.ts` files carry the types and stay fully checked.
The header is not decoration; it is the token the prune step keys on.

**`build` prunes, and it prunes only what it wrote.** After writing, it deletes
every file under `outDir` that carries the generated header and that this emit
did not produce. Without a prune, renaming a top-level key leaves
`messages/old.js` and `messages/old.d.ts` behind forever, and removing the last
`groups` entry leaves a `groups.js` importing from a namespace module that may
also be gone, which is a hard module-resolution failure in the app's build
rather than a stale-file annoyance.

**A file under `outDir` that does not carry the header is never deleted and
never overwritten.** `outDir` is a directory path a user can point anywhere
inside the project, `init` does not create it, and a recursive delete of
whatever it finds there is the one bug in this design that destroys work rather
than merely annoying someone. So a headerless file is reported as
`LZ1021 outdir-foreign-file` at warn, naming the path, in **both** `build` and
`check`, and it is left exactly as it is. If emit wanted to write that same
path, the write is skipped and the same diagnostic is raised: the generated tree
is then incomplete and the app's own build will say so, which is recoverable,
while silently clobbering a hand-written file is not. The `.gitignore` is
outside this entirely, per the paragraph above: written only into an `outDir`
the run creates, never compared, never pruned.

Two more things the prune leaves alone. A symlink or any other non-regular
entry under `outDir` is neither read nor deleted, and the prune does not report it: following one leaves `outDir`, and the header cannot prove we wrote whatever it points at. A symlink at a path emit wants to write is the exception to silence: it is skipped and reported as `LZ1021`, in both `build` and `check`, exactly like a headerless file there. A symlinked directory between `outDir` and an emitted path that resolves outside the project root is `LZ5001` in both modes, raised before that path is read. An
orphan that carries the header and still cannot be deleted is reported as
`LZ1021` with a message saying so, not as `LZ5001`: the tree this build wrote
is complete and correct, and `LZ5001` is exit 2 and not re-levelable, which is
the wrong answer for a leftover. `severity: { 'outdir-foreign-file': 'off' }`
therefore silences the undeletable case too.

`messages/_formats.js` and `messages/_formats.d.ts` are always emitted,
holding only their leading comment lines when no message uses a number, date
or `#` node, because the layout above lists them unconditionally.

`check` reports a **headered** file that emit did not produce as `LZ5002` with
reason `orphaned`, and a headerless one as `LZ1021`, so `check` never fails on a
file `build` tolerates. The delete is bounded twice over: by the header, and by
`LZ1007` already requiring `outDir` to resolve inside the project root.

### 7.2 Identifiers

`nav.home` becomes `m.nav_home()`. Flat identifiers, never `m.nav.home()`: a
namespace object literal retains every member and kills tree-shaking.

Mangling, in order:

1. Normalize the key to NFC.
2. Replace every character that is not `\p{ID_Continue}`, `$` or `_` with `_`.
   Unicode identifiers are legal JavaScript, so a CJK or Cyrillic key survives
   intact instead of collapsing into underscores.
3. If the result does not start with `\p{ID_Start}`, `_` or `$`, prefix `$`.
4. If the result is a reserved word, or `default`, or `then`, prefix `$`.
   `then` matters because a `then` export makes the module namespace thenable
   and breaks `await import()`.
5. If `config.identifiers` has an entry for this key, that value replaces the
   whole result and then passes through steps 2, 3 and 4, so an override can
   never carry a character that is illegal in an identifier.

Namespace **filenames** are mangled the same way, so a key such as `../x.y`
cannot write outside `outDir`.

An argument name that fails `LZ2007`'s predicate still reaches emit, because
that rule is `fatal: never`. It is reached by subscript in the JS, `args['9x']`,
and quoted as a property in the `.d.ts`, since dot access would be a
`SyntaxError` that takes the whole namespace module down.

Two keys that mangle to one identifier are `LZ4001 identifier-collision`, fatal,
never auto-disambiguated with a counter: a counter shifts when a key is
inserted, and output would stop being deterministic. The fix is renaming the key
or adding an `identifiers` entry. Message identifiers collide **globally**, not
per namespace, because the barrel star-exports every namespace module into one
namespace object. Two groups whose `id`s or whose `typeBase`s collide are the
same code, checked inside `groups.d.ts` and reported once per pair, naming
whichever clashed first, because `pascalCase(id)` makes the second derivative.
A group id equal to the id of any group member, in that group or another, is
the same code, because `groups.js` imports every member id into the scope that
declares the groups and a second declaration of one name is a `SyntaxError`; it
is reported once per group, anchored on the first such member's key. A group id
and an ungrouped message id never collide, because nothing imports both into
one namespace. Two
keys of one group whose suffixes mangle to one member property are also
`LZ4001`, reported only where their message ids differ (equal ids are the
global collision already named), and the hint says to rename the key: section
7.4 computes the member from the key suffix alone, so no `identifiers` entry
can reach it.

`LZ4002 identifier-reserved`, fatal, covers two sets. An **identifier** that
enters the internal `$` namespace (matching `/^\$[a-z]/`), or that is
`__proto__`, `constructor`, `prototype`, `locales`, `sourceLocale`,
`cookie`, `getLocale`, `setLocale` or `subscribe`. `__proto__`, `constructor` and
`prototype` are reserved because they are built-in properties of every
JavaScript object, so loclizr never exports a message under them; only the last
six are tied to the barrel. The `$` test runs on the identifier
**before** step 4's guard, so the guard's own output, `$then`, `$new`,
`$class`, is the intended result and not reserved; only a key or an override
that itself starts with `$` and a lowercase letter is. A group member property
that mangles to `__proto__` is the same code, because section 7.4's group
literal spends that name on `__proto__: null` to give each group a null
prototype, so no member can take it. A group id of `Object`, or a member id of
`Object`, is the same code, because the groups module calls the bare global
`Object.freeze` and either binding would shadow it. A key that takes one of
the six barrel names fails silently: verified in Node,
`export { locales } from './_locale.js'` beside `export * from './_root.js'`
shadows the star export with no error and no ambiguity warning, so a root-level
key named `locales` produces a working export nobody can reach while
`m.locales.map(...)` in the switcher keeps compiling against the locale array.
The second set is **namespace filenames**: a top-level key segment that mangles
to `_locale`, `_formats` or `_root` would write over a module the compiler
generates, and is the same code. Both sets are resolved by one `identifiers`
entry, which is the escape hatch section 3 already documents.

**Doc-comment text is escaped.** Every generated declaration carries
`/** en: "<source>" */`, and a source string containing `*/`, which is ordinary
in a code sample, a regex or a path, would terminate the comment early and
produce a syntactically broken `.d.ts` that no rule catches, because `LZ4005`
only compares the two emit passes to each other and both are equally broken. M6
replaces every `*/` in doc-comment text with `*\/` and replaces each line break TypeScript recognizes (CR, LF, a CRLF pair, U+2028 and U+2029) with a single space, so source text cannot start a comment line that reads as a `@ts-` directive or a JSDoc tag.

Two keys whose confusable skeletons are equal but whose text differs are
`LZ4003 confusable-key`. The skeleton is NFKC with U+200C, U+200D, U+2060 and
U+FEFF removed, plus a small built-in Cyrillic-and-Greek-to-Latin fold, no ICU
dependency. The rule is pairwise, so a wholly Cyrillic key never fires on its
own; it fires only when two keys differ by a homoglyph or an invisible joiner,
which is almost always a typo.

### 7.3 Call shape

Every message function has the same shape:

```ts
f(args, opts?: MessageOptions): string
```

The first parameter is exactly the ICU argument set, so the lookup tier types
against it and a message with an ICU argument literally named `locale` still
compiles. The locale override is the second parameter.

A message with no arguments is typed `(args?: EmptyArgs, opts?: MessageOptions)`
where `EmptyArgs` is `{ readonly [noArguments]?: never }` and `noArguments` is a
`unique symbol` that `loclizr` declares and does not export. Verified on the
repo's TypeScript 7.0.2: `m.nav_home()` works, `m.nav_home({}, { locale: 'de' })`
works, `m.nav_home(undefined, { locale: 'de' })` works, and `m.nav_home({ x: 1 })`
is a type error, because a type with only optional properties triggers weak-type
excess-property checking. The symbol key keeps that member out of editor
completion: inside `m.nav_home({ })` the language server suggests nothing.

`MessageOptions` is `{ locale?: Locale | undefined }`. The explicit `| undefined`
is required: this repo's `tsconfig.base.json` sets
`exactOptionalPropertyTypes: true` and `examples/vite-react/tsconfig.json`
extends it, so without it an app passing `{ locale: maybeUndefined }` is a type
error at its own call site.

### 7.4 The typed lookup tier

`groups: { errors: 'errors' }` collects every key under `errors.` and emits a
record in `groups.js`. A prefix matches on a **dot boundary**, so the prefix
`err` does not capture the key `errors.forbidden`, and the member property is
`mangle(key.slice(prefix.length + 1))`, which strips the separator. Written as
"key minus the prefix" it would be `.forbidden`, and every member property in
every group would start with an underscore.

A group carries three names and M4 computes all three. `Group.name` is the
config key verbatim. `Group.id` is the mangled, collision-checked export
identifier, the one that appears as `export const errors`. `Group.typeBase` is
the PascalCase base that M6 concatenates with `Key` and `Args` to print
`ErrorsKey` and `ErrorsArgs`: mangle first, then upper-case the first character
of each `_`-separated part and join with no separator, so `nav.main` becomes
`NavMain`. M6 depends on M1 only and may not re-derive any of them.

Typing is a mapped type, not a union and not a merged shape:

```ts
export type ErrorsKey = 'forbidden' | 'not_found' | 'rate_limited'
export interface ErrorsArgs {
  forbidden: EmptyArgs
  not_found: EmptyArgs
  rate_limited: { seconds: number }
}
export declare const errors: Readonly<{
  [K in ErrorsKey]: (args: ErrorsArgs[K], opts?: MessageOptions) => string
}>
```

A literal key gets exact argument typing. A key whose type is the union
`ErrorsKey` produces a union of call signatures, which TypeScript calls with the
**intersection** of the parameter types, so the caller must supply a superset of
every member's arguments.

That is the sound typing, and it is also the tier's cost: a dynamic call has to
pass the union of every member's arguments, so `errors[code]({ seconds: 30 })`
carries `seconds` for members it means nothing to, and adding one member that
needs `{ retryAt }` breaks every existing dynamic call site. The type does not
change, because the alternative is unsound. The cost is made visible at build
time instead of at the third member: `LZ4006 group-args-heterogeneous`, warn,
raised by M4 when a group's members do not share one argument signature, name
and `ArgType.kind` together, listing the members and the union of names it
forces. Two members using one name at two types intersect to an uncallable
parameter at a dynamic call site, which is the same hazard. Hint: split the
group by argument shape, or give the odd members bare `{x}` arguments.

Verified on TypeScript 7.0.2 with `EmptyArgs = { readonly [noArguments]?: never }`:
`errors[k]({ seconds: 5 })` compiles, `errors.rate_limited({ nope: 1 })` is an
error, `errors[k]()` is an error, and `errors[k]({})` is an error because
`seconds` is missing. `args` is **required** in the mapped type for exactly that
reason; making it optional would let `errors[k]()` compile and crash.

The mapped type above is the text-only shape. A group holding at least one
markup member cannot be typed by it, because a markup member's handler names a
type parameter and its return is `readonly (string | T)[]`, so such a group
prints `<Base>Args<T>`, a second `<Base>Return<T>` and a generic member
signature. A text-only group keeps the bytes above exactly:

```ts
export type TermsKey = 'accept' | 'plain'
export interface TermsArgs<T> {
  accept: { link: (chunks: readonly (string | T)[]) => T }
  plain: { n: string | number }
}
export interface TermsReturn<T> {
  accept: readonly (string | T)[]
  plain: string
}
export declare const terms: Readonly<{
  [K in TermsKey]: <T>(args: TermsArgs<T>[K], opts?: MessageOptions) => TermsReturn<T>[K]
}>
```

`<Base>Return` adds no collision surface: it collides only when two groups
share a `typeBase`, which `LZ4001` already makes fatal. A `typeBase` of `Empty`
prints `EmptyArgs`, the name `groups.d.ts` imports from `loclizr`; the import
then binds under a `$`-prefixed alias no local type takes
(`import type { EmptyArgs as $EmptyArgs, MessageOptions } from 'loclizr'`).

The group literal is emitted with `__proto__: null` so a member named
`constructor` or `prototype` cannot reach `Object.prototype`. A group whose
prefix matches zero keys is `LZ4004 group-empty`. It stays in `Program.groups`
with no members and is still emitted, as `export type ErrorsKey = never`, an
empty `ErrorsArgs` and a frozen object holding only `__proto__: null`, because
the rule is a non-fatal error and dropping the export would break an app that
already imports it. Only that group loses tree-shaking, and only for an app
that imports `./loclizr/groups`.

### 7.5 Determinism

Emit sorts everything itself and never relies on the order it received:

- messages by key, by Unicode code point
- namespaces by mangled filename, by code point
- hoisted format consts by their `$f<hash16>` name, by code point
- group members by member property
- groups by `id`, by code point
- locale arms by locale tag, with the source locale always last, under `default:`
- select cases by option, by code point, with `other` under `default:`
- plural keyword branches in CLDR order `zero one two few many other`, exact
  branches ascending by value

`Message.markupTags` is never printed: a tag reaches the output as an argument
of kind `markup` in `Message.args`, whose order section 5.1 fixes.

`Program.extras` and `Program.usages` are not on that list because emit never
prints either. M5 reads extras and M8 reads usages, and each sorts what it
prints (sections 13 and 14). They are still in the replay set below, where
reversing them proves emit ignores them.

`emit()` then runs itself a second time on a **replayed** `Program` and
byte-compares the two results. A difference is
`LZ4005 nondeterministic-output`, fatal. The replay reverses rather than
shuffles, because a randomized determinism test is itself nondeterministic. It
runs on every `build`, in memory, from the already-lowered representation. This
is the reason every collection in `Program` is an array and not a `Map`:
iteration order is the thing being tested.

**The replay reverses exactly this set and nothing else:**

```
Program.messages      Program.groups        Program.locales
Program.usages        Program.extras        Group.members
Message.bodies        Message.origins       Message.spans
Message.placeholders  MessageUsage.sites
```

Every other array reachable from `Program` carries meaning in its order and the
replay must leave it untouched. `Body.nodes`, `Node.children`, `Node.branches`,
`Node.exact`, `PluralBranch.body`, `ExactBranch.body`, `SelectBranch.body`,
`Body.args` and `Message.args` are all semantic: reversing `Body.nodes` reverses
the message text, reversing branches reverses the emitted switch, and reversing
`Message.args` flips the declaration's parameter order. Each of those makes the
two passes differ for the right reason, and `LZ4005` would then fire as fatal on
the first catalog holding a select or any message with more than one node.
`Message.args` is deterministic without sorting because it is derived from one
array, the source-locale body, in first-appearance order.

The set is one list in code, not a recursive walk: M6 exports
`reverseForReplay(program)` and the replay calls it, so adding a field to
`Program` is a decision somebody makes rather than a default somebody inherits.

### 7.6 Worked example

Source catalogs.

`locales/en.json`:

```json
{
  "nav": { "home": "Home", "cart": "Cart" },
  "cart": {
    "greeting": "Hi {name}, your cart is ready",
    "items": "{count, plural, =0 {Your cart is empty} one {# item in your cart} other {# items in your cart}}",
    "total": "Total: {amount, number, ::currency/USD}",
    "updated": "Updated {at, date, medium}"
  },
  "order": {
    "status": "{state, select, shipped {On its way} delivered {Delivered} other {Processing}}"
  },
  "errors": {
    "forbidden": "You do not have access",
    "not_found": "We could not find that page",
    "rate_limited": "Too many requests. Try again in {seconds, number} seconds."
  },
  "terms": { "accept": "Read our <link>terms</link> before you continue." }
}
```

`locales/de.json`, ICU throughout:

```json
{
  "nav": { "home": "Startseite", "cart": "Warenkorb" },
  "cart": {
    "greeting": "Hallo {name}, dein Warenkorb ist fertig",
    "items": "{count, plural, =0 {Dein Warenkorb ist leer} one {{count} Artikel in deinem Warenkorb} other {{count} Artikel in deinem Warenkorb}}",
    "total": "Summe: {amount, number, ::currency/USD}",
    "updated": "Aktualisiert {at, date, medium}"
  },
  "order": {
    "status": "{state, select, shipped {Unterwegs} delivered {Zugestellt} other {In Bearbeitung}}"
  },
  "errors": {
    "forbidden": "Du hast keinen Zugriff",
    "not_found": "Wir konnten die Seite nicht finden",
    "rate_limited": "Zu viele Anfragen. Versuche es in {seconds, number} Sekunden erneut."
  },
  "terms": { "accept": "Lies unsere <link>AGB</link>, bevor du fortfährst." }
}
```

`locales/de-AT.json`, a sparse overlay still in i18next form, which is what
makes this example show `'auto'` doing its job:

```json
{ "cart": { "greeting": "Servus {{name}}, dein Warenkorb ist fertig" } }
```

`locales/en.meta.json`:

```json
{
  "cart.items": {
    "description": "Badge under the cart icon on every page",
    "placeholders": { "count": "Number of line items, not total quantity" }
  },
  "order.status": { "description": "Chip in the order list. Past tense." }
}
```

Config:

```ts
import { defineConfig } from 'loclizr'

export default defineConfig({
  locales: ['en', 'de', 'de-AT'],
  sourceLocale: 'en',
  groups: { errors: 'errors' },
})
```

Note what the two German files do, because between them they are the whole of
`catalogFormat: 'auto'`.

`de.json` holds no plural-suffixed key, and its only `{{` opens a typed plural
branch straight onto an argument, `one {{count} Artikel ...}`, which section 2
carves out, so it is read as ICU and parsed as written. Its `cart.items` is
the exact shape the i18next form
`items_zero` / `items_one` / `items_other` would have converted to: the `_zero`
suffix becomes the exact branch `=0` rather than the keyword `zero`, because
German has no CLDR `zero` category and a `zero` branch would never be selected,
and the `{{count}}` those arms carried becomes a plain `{count}` argument rather
than `#`. Writing it out as ICU is the conversion's own output, which is why the
emitted German arm below is identical either way. `<link>` in `terms.accept`
lowers to real markup here, because ICU is ICU; had this file been read as
i18next, section 2.1 step 1 would have escaped it to literal text and raised
`LZ1016`.

`de-AT.json` does hold `{{`, so it is read as i18next and `{{name}}` is
converted. One catalog set, two formats, no configuration.

German therefore renders `1000 Artikel` while English renders `1,000 items`,
because German's argument is a bare `{count}` and English's is `#` through
`Intl.NumberFormat`. That is what an imported i18next catalog looks like after
conversion, written out here so the example carries it, and in an ICU file the
fix really is one character: write `{count, number}`.

Now the output.

`src/loclizr/messages/_locale.js`:

```js
// @generated by loclizr abi=1. Do not edit; run `loclizr build`.
// @ts-nocheck
import { $configure1 } from 'loclizr'

export const locales = /*#__PURE__*/ Object.freeze(['de', 'de-AT', 'en'])
export const sourceLocale = 'en'
export const cookie = 'locale'
export const $l = $configure1({ locales, sourceLocale, cookie })
```

`src/loclizr/messages/_locale.d.ts`:

```ts
// @generated by loclizr abi=1. Do not edit; run `loclizr build`.
import type { LocaleResolver } from 'loclizr'
export declare const locales: readonly ['de', 'de-AT', 'en']
export declare const sourceLocale: 'en'
export declare const cookie: 'locale'
export declare const $l: LocaleResolver
```

`src/loclizr/messages/_formats.js`:

```js
// @generated by loclizr abi=1. Do not edit; run `loclizr build`.
// @ts-nocheck
export const $f44136fa355b3678a = /*#__PURE__*/ Object.freeze({})
export const $f56d532f63ea89042 = /*#__PURE__*/ Object.freeze({ currency: 'USD', style: 'currency' })
export const $f67d978756bf2d048 = /*#__PURE__*/ Object.freeze({ dateStyle: 'medium' })
```

Those three names are `$f` plus `hash16` of `{}`,
`{"currency":"USD","style":"currency"}` and `{"dateStyle":"medium"}`, and they
are printed in name order. This block is normative: an implementation that
produces different names is not producing this output.

`src/loclizr/messages/nav.js`, the plain-string and nested-key case:

```js
// @generated by loclizr abi=1. Do not edit; run `loclizr build`.
// @ts-nocheck
import { $l } from './_locale.js'

export function nav_cart(args, opts) {
  switch ($l(opts)) {
    case 'de':
    case 'de-AT':
      return `Warenkorb`
    default:
      return `Cart`
  }
}

export function nav_home(args, opts) {
  switch ($l(opts)) {
    case 'de':
    case 'de-AT':
      return `Startseite`
    default:
      return `Home`
  }
}
```

`de-AT` shares an arm with `de` because its resolved body is byte-identical.
That is how inheritance is expressed in the output: one arm per distinct body,
not one arm per locale.

`src/loclizr/messages/nav.d.ts`:

```ts
// @generated by loclizr abi=1. Do not edit; run `loclizr build`.
import type { EmptyArgs, MessageOptions } from 'loclizr'
/** en: "Cart" */
export declare function nav_cart(args?: EmptyArgs, opts?: MessageOptions): string
/** en: "Home" */
export declare function nav_home(args?: EmptyArgs, opts?: MessageOptions): string
```

`src/loclizr/messages/cart.js`, covering interpolation, plural, number and date:

```js
// @generated by loclizr abi=1. Do not edit; run `loclizr build`.
// @ts-nocheck
import { $dateTime1, $number1, $plural1 } from 'loclizr'
import { $f44136fa355b3678a, $f56d532f63ea89042, $f67d978756bf2d048 } from './_formats.js'
import { $l } from './_locale.js'

export function cart_greeting(args, opts) {
  switch ($l(opts)) {
    case 'de':
      return `Hallo ${args.name}, dein Warenkorb ist fertig`
    case 'de-AT':
      return `Servus ${args.name}, dein Warenkorb ist fertig`
    default:
      return `Hi ${args.name}, your cart is ready`
  }
}

export function cart_items(args, opts) {
  const l = $l(opts)
  const n0 = args.count
  switch (l) {
    case 'de':
    case 'de-AT':
      if (n0 === 0) return `Dein Warenkorb ist leer`
      return `${args.count} Artikel in deinem Warenkorb`
    default:
      if (n0 === 0) return `Your cart is empty`
      switch ($plural1('en', n0, false)) {
        case 'one':
          return `${$number1(l, n0, $f44136fa355b3678a)} item in your cart`
        default:
          return `${$number1(l, n0, $f44136fa355b3678a)} items in your cart`
      }
  }
}

export function cart_total(args, opts) {
  const l = $l(opts)
  switch (l) {
    case 'de':
    case 'de-AT':
      return `Summe: ${$number1(l, args.amount, $f56d532f63ea89042)}`
    default:
      return `Total: ${$number1(l, args.amount, $f56d532f63ea89042)}`
  }
}

export function cart_updated(args, opts) {
  const l = $l(opts)
  switch (l) {
    case 'de':
    case 'de-AT':
      return `Aktualisiert ${$dateTime1(l, args.at, $f67d978756bf2d048)}`
    default:
      return `Updated ${$dateTime1(l, args.at, $f67d978756bf2d048)}`
  }
}
```

Three things to read off `cart_items`. The `=0` exact branch is tested before
`$plural1` and against the un-offset value. German's `one` and `other` bodies
are byte-identical after resolution, so the category lookup collapses away
entirely and `$plural1` is never constructed for German. German renders the
plain `{count}` argument because i18next stringified it unformatted, while
English renders `#` through `$number1`.

The collapse is conservative, and the rule is exact. Keyword branches are
dropped when every one of them renders byte-identically to `other`. An exact
branch is dropped only when the keyword branches collapsed **and** its own body
renders identically to that one survivor; German's `=0` differs, so it stays.
Dropping an exact branch whose keyword siblings differ would be wrong in any
locale whose `select(0)` is not `other` (French returns `one`). A `select`
collapses the same way, to its `other` body, when every branch renders the
same, which is what the parser's pound divergence of section 5.3 produces:
`{a, plural, offset:1 other {# and {b, select, x {#} other {#}}}}` emits the
literal `#` once with no `switch` on `b`, while `b: 'x'` stays a required
parameter in the declaration, because `Message.args` is the source's argument
set and nothing about the collapse changes the contract.

**The plural local is `n0`, one local per distinct plural selector name,
numbered by first appearance across the message's rendered arms.** A single
hoisted `const n` breaks on ordinary copy: `"{files, plural, one {# file}
other {# files}} in {folders, plural, one {# folder} other {# folders}}"` would
emit two `const n` in one function scope, which is `SyntaxError: Identifier
'n' has already been declared` in Node, taking the whole namespace module and
every other message in it down with it. Nested plurals hit the same collision
wherever both land in one block, and with shadowing the inner `#` would
silently read the outer selector. `#` resolves to the innermost enclosing
plural's local, which emit already knows from its walk. The locals are keyed
by name rather than by position because they are hoisted once above the locale
`switch` and two arms of one message may order their plurals differently, so
a per-body position is not a well-defined name at function scope; two plurals
on one selector in one arm share a local, which is correct because they read
one value. First appearance is deterministic, so section 7.5 is unaffected.
There is still exactly one `const l`, because there is exactly one resolver
call.

That message emits:

```js
export function cart_counts(args, opts) {
  const l = $l(opts)
  const n0 = args.files
  const n1 = args.folders
  switch (l) {
    default:
      return `${
        $plural1('en', n0, false) === 'one'
          ? `${$number1(l, n0, $f44136fa355b3678a)} file`
          : `${$number1(l, n0, $f44136fa355b3678a)} files`
      } in ${
        $plural1('en', n1, false) === 'one'
          ? `${$number1(l, n1, $f44136fa355b3678a)} folder`
          : `${$number1(l, n1, $f44136fa355b3678a)} folders`
      }`
  }
}
```

A plural in return position emits a `switch`; a plural inside surrounding text
emits the conditional chain above, in the same branch order. Select cases are
emitted sorted by option code point with `other` under `default:`, and plural
keyword branches in CLDR order, whatever order the catalog wrote them in; the
`order_status` output below prints `delivered` before `shipped` while the
source writes `shipped` first.

`src/loclizr/messages/cart.d.ts`:

```ts
// @generated by loclizr abi=1. Do not edit; run `loclizr build`.
import type { MessageOptions } from 'loclizr'
/** en: "Hi {name}, your cart is ready" */
export declare function cart_greeting(args: { name: string | number }, opts?: MessageOptions): string
/** en: "{count, plural, =0 {Your cart is empty} one {# item in your cart} other {# items in your cart}}" */
export declare function cart_items(args: { count: number }, opts?: MessageOptions): string
/** en: "Total: {amount, number, ::currency/USD}" */
export declare function cart_total(args: { amount: number }, opts?: MessageOptions): string
/** en: "Updated {at, date, medium}" */
export declare function cart_updated(args: { at: Date | number }, opts?: MessageOptions): string
```

`src/loclizr/messages/order.js`, the select case:

```js
// @generated by loclizr abi=1. Do not edit; run `loclizr build`.
// @ts-nocheck
import { $l } from './_locale.js'

export function order_status(args, opts) {
  switch ($l(opts)) {
    case 'de':
    case 'de-AT':
      switch (args.state) {
        case 'delivered':
          return `Zugestellt`
        case 'shipped':
          return `Unterwegs`
        default:
          return `In Bearbeitung`
      }
    default:
      switch (args.state) {
        case 'delivered':
          return `Delivered`
        case 'shipped':
          return `On its way`
        default:
          return `Processing`
      }
  }
}
```

`src/loclizr/messages/order.d.ts`:

```ts
// @generated by loclizr abi=1. Do not edit; run `loclizr build`.
import type { MessageOptions } from 'loclizr'
/** en: "{state, select, shipped {On its way} delivered {Delivered} other {Processing}}" */
export declare function order_status(args: { state: 'delivered' | 'shipped' }, opts?: MessageOptions): string
```

`src/loclizr/messages/terms.js`, markup:

```js
// @generated by loclizr abi=1. Do not edit; run `loclizr build`.
// @ts-nocheck
import { $l } from './_locale.js'

export function terms_accept(args, opts) {
  switch ($l(opts)) {
    case 'de':
    case 'de-AT':
      return ['Lies unsere ', args.link(['AGB']), ', bevor du fortfährst.']
    default:
      return ['Read our ', args.link(['terms']), ' before you continue.']
  }
}
```

`src/loclizr/messages/terms.d.ts`:

```ts
// @generated by loclizr abi=1. Do not edit; run `loclizr build`.
import type { MessageOptions } from 'loclizr'
/** en: "Read our <link>terms</link> before you continue." */
export declare function terms_accept<T>(
  args: { link: (chunks: readonly (string | T)[]) => T },
  opts?: MessageOptions,
): readonly (string | T)[]
```

Had the German translator dropped `<link>`, `LZ3010 markup-mismatch` would fire
and the arm would still emit, coerced to the message's kind:

```js
    case 'de':
    case 'de-AT':
      return [`Lies unsere AGB, bevor du fortfährst.`]
```

A one-element array, not a bare string, because the declaration promises
`readonly (string | T)[]` and `<Parts of={...} />` handed a string would spread
it into per-character children with nothing to catch it. That arm is part of the
acceptance set, because it is the shape any real catalog reaches.

`src/loclizr/messages/errors.js`:

```js
// @generated by loclizr abi=1. Do not edit; run `loclizr build`.
// @ts-nocheck
import { $number1 } from 'loclizr'
import { $f44136fa355b3678a } from './_formats.js'
import { $l } from './_locale.js'

export function errors_forbidden(args, opts) {
  switch ($l(opts)) {
    case 'de':
    case 'de-AT':
      return `Du hast keinen Zugriff`
    default:
      return `You do not have access`
  }
}

export function errors_not_found(args, opts) {
  switch ($l(opts)) {
    case 'de':
    case 'de-AT':
      return `Wir konnten die Seite nicht finden`
    default:
      return `We could not find that page`
  }
}

export function errors_rate_limited(args, opts) {
  const l = $l(opts)
  switch (l) {
    case 'de':
    case 'de-AT':
      return `Zu viele Anfragen. Versuche es in ${$number1(l, args.seconds, $f44136fa355b3678a)} Sekunden erneut.`
    default:
      return `Too many requests. Try again in ${$number1(l, args.seconds, $f44136fa355b3678a)} seconds.`
  }
}
```

`src/loclizr/groups.js`:

```js
// @generated by loclizr abi=1. Do not edit; run `loclizr build`.
// @ts-nocheck
import { errors_forbidden, errors_not_found, errors_rate_limited } from './messages/errors.js'

export const errors = /*#__PURE__*/ Object.freeze({
  __proto__: null,
  forbidden: errors_forbidden,
  not_found: errors_not_found,
  rate_limited: errors_rate_limited,
})
```

`src/loclizr/groups.d.ts`:

```ts
// @generated by loclizr abi=1. Do not edit; run `loclizr build`.
import type { EmptyArgs, MessageOptions } from 'loclizr'

export type ErrorsKey = 'forbidden' | 'not_found' | 'rate_limited'
export interface ErrorsArgs {
  forbidden: EmptyArgs
  not_found: EmptyArgs
  rate_limited: { seconds: number }
}
export declare const errors: Readonly<{
  [K in ErrorsKey]: (args: ErrorsArgs[K], opts?: MessageOptions) => string
}>
```

`src/loclizr/messages.js`, the barrel:

```js
// @generated by loclizr abi=1. Do not edit; run `loclizr build`.
// @ts-nocheck
export { getLocale, setLocale, subscribe } from 'loclizr'
export { cookie, locales, sourceLocale } from './messages/_locale.js'
export * from './messages/cart.js'
export * from './messages/errors.js'
export * from './messages/nav.js'
export * from './messages/order.js'
export * from './messages/terms.js'
```

`src/loclizr/messages.d.ts`, the barrel declarations:

```ts
// @generated by loclizr abi=1. Do not edit; run `loclizr build`.
import type { SetLocaleOptions } from 'loclizr'

export type AppLocale = 'de' | 'de-AT' | 'en'

declare module 'loclizr' {
  interface LocaleRegistry {
    locale: AppLocale
  }
}

export declare function getLocale(): AppLocale
export declare function setLocale(locale: AppLocale, options?: SetLocaleOptions): void
export declare function subscribe(listener: () => void): () => void
export { cookie, locales, sourceLocale } from './messages/_locale.js'
export * from './messages/cart.js'
export * from './messages/errors.js'
export * from './messages/nav.js'
export * from './messages/order.js'
export * from './messages/terms.js'
```

The local alias is `AppLocale`, never `Locale`. Verified on TypeScript 7.0.2:
naming it `Locale` inside a file that also augments `loclizr` resolves against
the augmented module's own conditional alias and produces TS2456 and TS2502 in
the app's build. With the alias renamed, the augmentation works through the
package's type re-export and narrows the union everywhere: `setLocale('sp')` is
TS2345, `m.nav_home(undefined, { locale: 'sp' })` is TS2322, and
`const l: 'de' | 'de-AT' | 'en' = getLocale()` compiles. This is what makes the
locale union real rather than asserted, and it is why the generated barrel also
declares `getLocale` and `setLocale` concretely: the augmentation is the nicety
that types `useLocale()`, and the concrete declarations do the gating at the
switcher. Under `augmentLocale: false` the `declare module` block is omitted and
everything else in this file is unchanged, which is why a second generated tree
costs only `useLocale()`'s narrowing and not the app's compile.

## 8. Usage from an app

```tsx
import * as m from './loclizr/messages'
import { errors } from './loclizr/groups'
import { useLocale } from 'loclizr/react'
import { Parts } from 'loclizr/react'

function Cart({ count, code }: { count: number; code: keyof typeof errors }) {
  return (
    <>
      <h1>{m.nav_cart()}</h1>
      <p>{m.cart_items({ count })}</p>
      <p>{m.cart_total({ amount: 42.5 })}</p>
      <p>{errors[code]({ seconds: 30 })}</p>
      <p>
        <Parts of={m.terms_accept({ link: (chunks) => <a href="/terms">{chunks}</a> })} />
      </p>
    </>
  )
}

function Switcher() {
  const locale = useLocale()
  return (
    <select value={locale} onChange={(e) => m.setLocale(e.target.value as typeof locale)}>
      {m.locales.map((l) => (
        <option key={l} value={l}>
          {l}
        </option>
      ))}
    </select>
  )
}
```

**A component that calls `m.*()` does not subscribe to the locale.** A message
call is a plain function call that reads the store once and returns a string;
there is no context, no provider and no hook inside it. `Cart` above re-renders
when React re-renders it and at no other time, so `setLocale('de')` on its own
changes nothing on screen in that subtree. This is the direct cost of "generated
code is framework free", and it is stated here rather than under a React
Compiler heading, because it is true with no compiler anywhere near the project.

So the root keys the tree on the locale:

```tsx
import { createRoot } from 'react-dom/client'
import { useLocale } from 'loclizr/react'

function Root() {
  return <App key={useLocale()} />
}

createRoot(document.getElementById('root')!).render(<Root />)
```

`Root` subscribes through `useLocale`, and the `key` change remounts `App`, so
every string below it is computed again. **The cost is named, not hidden: a
remount discards local component state.** Open accordions collapse, uncommitted
form input is lost, scroll position inside a virtualized list resets. For most
apps a language switch is a page-level event and that is acceptable. For a
component where it is not, the per-call override is the escape and it needs no
remount:

```tsx
function Draft({ count }: { count: number }) {
  const locale = useLocale()
  return <p>{m.cart_items({ count }, { locale })}</p>
}
```

That component subscribes to the locale itself, re-renders in place on a switch,
and keeps its state. Section 11.4 has the same two patterns with the React
Compiler reason for the second one.

## 9. Emit-on-error policy

Stated once, because everything else depends on it.

Fatality has **three scopes**, not two, so `Rule.fatal` is
`'never' | 'always' | 'ifSource' | 'message'` and every `Diagnostic` carries a
resolved `fatal: boolean` stamped by the module that produced it, because only
that module knows the locale and the key. `hasFatal` reads
`d.fatal && d.severity === 'error'`. A boolean on the rule alone cannot express
this: it would make an unreadable `de.json` block the whole build, contradicting
the second bullet below, and it could not express a per-message failure at all.

- **`always`** blocks emission entirely: config invalid, an invalid declared
  locale tag, an unsafe `outDir`, no catalogs found, the source
  catalog missing, an identifier collision, a reserved identifier,
  nondeterministic output, output unwritable. In each of those we cannot produce
  a correct artifact at all, so emit does not run: `BuildResult.files` is empty
  on `LZ4001` or `LZ4002`, and the replay re-emit is never attempted on a
  program already known to be unusable.
- **`ifSource`** blocks only when the file in question is the source catalog. An
  unreadable or malformed `de.json` is an error that still emits; the same
  problem in `en.json` is fatal.
- **`message`** drops that one message from `Program.messages` and blocks
  nothing. It is how a message whose **source body** failed to lower is handled:
  `LZ2001`, `LZ2004`, `LZ2005` and `LZ2009`. Emit never receives a message whose
  source body failed to lower, so it never has to decide what an unparseable
  message returns. An empty source string is not this case; `""` lowers to zero
  nodes legitimately and emits an empty string.
- A **target locale** that fails to lower is not dropped. It resolves through the
  fallback chain exactly as a blank value does, with origin reason `invalid`,
  and raises no additional cross-locale diagnostic, because M3 already reported
  the syntax error against that locale's own file.
- A **non-fatal error** still emits. Twelve missing German translations write
  `messages.js` anyway, fill those twelve from the build-time fallback chain,
  print twelve `LZ3001` diagnostics, and exit 1. Emitting nothing would break
  the app's typecheck under a pile of "cannot find module" and bury the real
  error, which is the worst possible moment to lose a new user.
- **The exit code is the contract.** `loclizr init` prints the CI snippet that
  checks it, and the build summary names how many messages fell back and to
  which locale.
- A fatal rule turned down to `warn` or to `off` prints as a warning and still
  blocks output: a rule scoped `always` says no correct artifact exists, and a
  label cannot make one, and `off` cannot hide the one reason the run wrote
  nothing and exited 1. A run that blocked output exits 1 even when every printed
  diagnostic is a warning, so nothing ever exits 0 having written nothing. The
  three rules that exit 2 are not re-levelable at all (section 3).
- Outside `--quiet` (section 10), every run that exits 0 or 1 closes the human
  report on the counts line, a blocked one included; only a run that exits 2
  having built no program (`LZ1001`, `LZ1007`) prints no summary, and `LZ5001`,
  raised after analysis, keeps it. A run blocked before analysis built no
  program, so the line names no source locale and counts what the JSON summary
  counts: zero messages, and the configured locales, or zero when the config
  itself did not resolve (`LZ1002`, `LZ1003`, `LZ1004`). A malformed source
  catalog under `'catalog-json-syntax': 'off'` closes on
  `0 messages, 1 locale, 0 errors, 1 warning`.

## 10. CLI

Argument parsing uses `node:util.parseArgs`. No argument-parsing dependency.

| Command | Behaviour |
| --- | --- |
| `loclizr init` | writes `loclizr.config.ts` if absent, with `meta` and `record` beside the catalogs when they live outside `locales/`, and, when it wrote that config over the default catalog layout, `locales/{sourceLocale}.json` if absent; never overwrites; then prints the install note, naming the config it wrote or found, the `package.json` scripts and the CI snippet rather than editing `package.json` |
| `loclizr build` | read, lower, analyze, check, emit, scan, write the record, prune orphans. Takes `--no-fail` |
| `loclizr check` | everything `build` does, with no writes, plus `LZ5002` and `LZ5003`. Does **not** take `--no-fail`: it is the gate |

Global flags: `--cwd <dir>`, `--config <path>`, `--reporter human|json`,
`--max-warnings <n>`, `--quiet`, `--version` or `-v`, which prints the version
from the package's own `package.json` and a newline to stdout and exits 0, and
`--help` or `-h`, which prints the one usage text to stdout and exits 0 and
wins when both are given. There is no per-command help: `loclizr build --help`
prints the same usage. Invalid usage prints the
message and the usage to stderr and exits 2. Reporter output, human and JSON,
and `init`'s text go to stdout, so `loclizr check --reporter json | jq
'.summary'` works; the catch-all error path goes to stderr.

**`--quiet`** drops warn-level diagnostics from the human reporter and keeps
errors. The summary's artifact lines are dropped too, and the counts line is
printed only when the filter dropped something, so a run that exits 1 under
`--max-warnings`, or because a fatal rule turned down to `warn` or `off`
blocked output, never produces zero bytes on both streams. The blocked line
(section 10.1) prints under `--quiet` too, because a fatal rule turned down to
`warn` is filtered out with the other warnings and would otherwise leave exit 1
with no cause on screen. The JSON reporter
is untouched by it (section 10.1), and so is the exit code, because M10 never
sees the flag. **`--max-warnings`** takes an integer; the no-cap value is
written `--max-warnings=-1`, because `node:util.parseArgs` cannot tell a
detached `-1` from a flag and rejects it with Node's own message. Absent is
the same no-cap default, so the sentinel is never required.

**`build --no-fail` is the dev loop's flag, and it changes the exit code and
nothing else.** Every diagnostic is produced, re-levelled and printed exactly as
without it: same text, same severities, same count, same reporter. What changes
is that a build which got as far as writing output exits 0 instead of 1. One
untranslated key must not stop `vite dev` from starting, and the alternative
people reach for otherwise is deleting the `predev` hook, which loses them the
generated tree entirely.

The flag is not an escape from the gate, because the gate is elsewhere:
`prebuild` and `pretypecheck` run plain `loclizr build`, CI runs
`loclizr check`, and neither takes the flag. `predev` is the one hook whose job
is to make a working tree exist for a dev server, so it alone runs
`loclizr build --no-fail`. That is the split `init` prints:

```json
"predev": "loclizr build --no-fail",
"prebuild": "loclizr build",
"pretypecheck": "loclizr build"
```

`init` prints no `prepare` hook. `prepare` runs on `npm ci`, so a CI job that
installed and then ran `loclizr check` would compare a record its own install
had just rewritten, and the gate would pass on a stale record. The CI snippet
`init` prints says to run `check` before any step that runs `build` for the
same reason.

There is no `--watch`. Section 1 says why, and the README documents both
`nodemon -w locales -x 'loclizr build --no-fail'` and the inline Vite plugin
that section 16's M13 ships, for anyone who wants the loop today.

`loclizr init` reads the tree before it writes. It looks for catalog layouts
already on disk under the usual directories, and when it finds one the config it
writes names that layout in `catalogs`, best match first, listing any others it
saw so the user can pick a different one. `sourceLocale` is `en` when that
locale is on disk, otherwise the first discovered locale by code point, which is
exactly what `LZ1004`'s hint pastes; declaring `en` over a project whose only
catalog is `locales/de.json` would turn a working tree into one
missing-translation error per key. With nothing on disk the config names the
default layout and `en`. A layout under a directory no `catalogs` pattern can
spell (a glob metacharacter, or a backslash on POSIX) is listed after every
other layout with a note to move it; when it is all there is, the config names
the default layout with `sourceLocale` taken from that layout, the
`ambiguous-source` line commented out, and no seed catalog. The written config
always carries `sourceLocale`, `catalogs` and `outDir: 'src/loclizr'`. When it
names a discovered layout carrying `{ns}`, it also carries `locales`, the
discovered list: with `locales` unset every name in the locale position is a
locale (section 3), and discovery only takes a name there that has the shape of
a language tag, so `public/locales/shared/` stays out of the list
and the build reports it as `LZ1006`. A flat layout gets no `locales` line, so a
later `fr.json` is a locale with no config edit. When the named layout's base
directory is not `locales`, the config also carries
`meta: '<base>/{sourceLocale}.meta.json'` and
`record: '<base>/loclizr.context.json'`, so the sidecar and the record sit
beside the catalogs, and the commented-out `ambiguous-source` note names that
resolved path. The section 3 defaults stay under `locales/` whatever `catalogs`
says, so without the two lines a `lang/{locale}.json` project would get a new
`locales/` holding only the record, and its `lang/en.meta.json` would be
skipped as `LZ1006` rather than read.

The seed catalog is written only when `init` wrote the config in the same run
and the layout it found is the default one, or it found none. When a config is
already on disk, whichever of the four discovery filenames it has,
`sourceLocale` and `catalogs` are that config's to declare, so `init` writes no
seed and prints why rather than guessing a path the existing config may never
read; and over a discovered non-default layout, `locales/en.json` beside a
`public/locales/{locale}/{ns}.json` tree would compile the demo strings and
leave every real catalog invisible. `init --config <path>` is the config write
target, resolved against `--cwd`, and it skips the four-filename shadow check
because the user pointed somewhere explicitly.

`init` makes two decisions inside the config skeleton. It sets
`augmentLocale: false` when it finds an existing generated tree in the
workspace, per section 6.2. The workspace is the nearest ancestor directory
holding `pnpm-workspace.yaml`, a `workspaces` field in `package.json`, or
`.git`, falling back to `--cwd` when none is found, and the search excludes the
`src/loclizr` this config is about to declare, so the documented `build` then
`init` order on one project does not read its own tree as a second one. And it
decides the `ambiguous-source` line by looking at the catalog it is pointed
at: a greenfield project (no existing source catalog, or an empty one) gets
`severity: { 'ambiguous-source': 'error' }`, so the gate is hard from the first
commit and costs nothing; a retrofit, which includes any project whose catalogs
are laid out some other way, gets the same line commented out with a note to
enable it once descriptions are in. The rule's default is `warn` (section 13),
so a user who never runs `init` gets the punch list rather than a red first
build.

**The seed catalog `init` writes is ICU**, and the config it writes never
carries `catalogFormat`. A greenfield project's first `en.json` gets an ICU
example, a plural written `{count, plural, one {...} other {...}}` rather than
an `_one` / `_other` pair, so the file classifies as ICU under `'auto'` from the
first commit and the first message the user writes by hand is in the format the
compiler calls native. `init` never emits a `catalogFormat` line, because
`'auto'` is right for a greenfield tree and stays right after the user drops an
imported i18next file in beside it.

The CI snippet `init` prints runs **`loclizr check`**, not `loclizr build`.
`prebuild` running `build` is there to make a fresh clone work, and it is not
the gate: `build` writes the record rather than comparing it, so a pipeline
whose only invocation is `pnpm build` would silently rewrite the record in the
CI workspace and pass. The snippet says so in a comment.

Exit codes, three of them, matching the `tsc` and `eslint` mental model:

| Code | Meaning |
| --- | --- |
| 0 | clean, or warnings only and at or under `--max-warnings` |
| 1 | at least one error, or warnings over `--max-warnings` |
| 2 | the tool could not run: invalid usage, invalid config, unsafe `outDir`, unwritable output |

**`--no-fail` moves exactly one of those three, and only downward.** With the
flag, a run that reached the write step, meaning nothing fatal survived and
output was produced, exits **0** even when errors were reported and even when
warnings went over `--max-warnings`. Exit **2** is untouched: the tool could not
run at all, so there is nothing to keep working with. A run that produced no
output still exits **1**, because `LZ4001`, `LZ4005`, `LZ1003` and their
siblings mean no generated tree was written and `vite dev` is going to fail on a
missing module anyway; reporting 0 there would be a lie the next command
uncovers. Write-if-changed writing zero bytes is still a run that reached the
write step. `exitCodeFor` computes the ordinary code and M10 lowers 1 to 0 under
this rule; the flag is never consulted by any other module.

**`--max-warnings` defaults to no cap**, matching eslint's `-1`, so warnings
alone never produce exit 1. `exitCodeFor` receives `Number.POSITIVE_INFINITY`
when the flag is absent. That default decides whether a fresh i18next import
exits 0 or 1, since twenty-one rules default to `warn`, so it is stated here
rather than left for M10 and M11 to each pick one.

### 10.1 Diagnostics

```ts
interface Diagnostic {
  code: string                      // 'LZ3012'
  rule: RuleName                    // 'ambiguous-source'
  severity: 'warn' | 'error'
  fatal: boolean                    // resolved by the producing module
  message: string
  hint: string | null
  file: string | null               // POSIX, relative to Config.root
  locale: string | null
  key: string | null
  span: Span | null                 // 1-based line and column
  related: readonly Related[]
}
```

**`file` is always POSIX and relative to `Config.root`.** Nine modules produce
diagnostics and must all pick the same answer with no way to ask each other, and
a mismatch is invisible until the human reporter prints a mix of absolute and
relative paths in one run, by which time the JSON reporter's sort by file is
also unstable across machines. Every producer computes it as
`toPosix(path.relative(config.root, abs))`. `renderHuman` therefore takes no
`root` option at all, which makes the ambiguity unrepresentable rather than
merely discouraged. If a flag ever needs absolute output, it arrives as a render
option named `absolutePrefix`.

Human reporter, from a project whose `loclizr init` wrote
`severity: { 'ambiguous-source': 'error' }`:

```
error  LZ3012  ambiguous-source  locales/en.json:12:5

  3 keys share the source text "Open" and 2 have no description.
  A translator sees one string with no way to tell the meanings apart.

    dialog.open    locales/en.json:12:5     no description
    file.open      locales/en.json:31:7     no description
    status.open    locales/en.json:58:3     "Badge on a ticket that is not closed"

  fix  add descriptions in locales/en.meta.json:
         "dialog.open": { "description": "" }
         "file.open":   { "description": "" }
  or   turn the rule down in loclizr.config.ts:
         severity: { 'ambiguous-source': 'warn' }
```

The paste block leaves each description empty, because the compiler cannot
write one, and the second line is the same sentence for every collision,
because what distinguishes the meanings is exactly what no compiler knows.
Where the rule is left at its default it renders identically with `warn` in the
severity column and the `or` line reading `make this a hard gate` and naming
`'error'`.

**The `or` pair is chosen by M5, when it builds the hint.** It is the one place
an analysis module looks at `config.severity`, and it looks at exactly one key,
`config.severity['ambiguous-source']`: `'error'` prints the turn-it-down pair,
anything else prints the harden-it pair. The alternative is a structured hint
that M10 completes while re-levelling, which buys nothing, because the sentence
is English rather than a decision. The load-bearing half of the seam is
untouched: M5 still **stamps** the diagnostic at the rule's default severity,
`warn`, and M10 still re-levels the whole set. M5 reads the setting to name it,
never to decide whether or at what level to emit.

**A repeat prints once, with every file listed.** `renderHuman` folds
diagnostics that agree on severity, code, key, message and hint, and that carry
a `file` and no `related` rows, into one report at the position of the first.
Its header names the key and the number of distinct files in place of the
location and locale, and under the message one row per diagnostic gives its
locale and `file:line:column`:

```
error  LZ1013  i18next-format-unsupported  cart.total  3 files

  The placeholder {{amount, number}} carries an i18next formatter, which has no ICU equivalent. It renders as the raw value.

    de    locales/de.json:4:15
    en    locales/en.json:4:15
    fr    locales/fr.json:4:15

  fix  name the style in formats.number, convert this file to ICU, and write {amount, number, yourStyle}.
```

An imported i18next tree carries its own copy of `$t()` and `{{x, fmt}}` in
every locale file, and M2 checks each file on its own content, so `LZ1012` and
`LZ1013` repeat once per file. Each file needs its own edit, so no row is
dropped; folding removes only the repeated text. A diagnostic with `related`
rows keeps its own report, because two tables under one header would not say
which rows belong to which file. The JSON reporter and the summary counts are
untouched: they still hold one diagnostic per file.

The human summary closes the report on every run except one that exits 2
having built no program (section 9); a run blocked before analysis prints it
without a source locale. Its lines come in
this order. First, on `build`, the `wrote` line naming the generated tree and
the record, when write-if-changed wrote anything, and the reminder to commit the
record unless `LZ5007` already says so. A run that blocked
output instead prints `nothing generated: N fatal (LZ4001, LZ4002)` there,
counting every diagnostic whose `fatal` is true and naming each distinct code
once in report order, keyed on the stamped fatality as the write decision is,
so a fatal rule turned down to `warn` or `off` still names itself. `LZ5001` is
left out: the write step raises it after the decision to write, so the tree
may be on disk and the `wrote` line still names it. It names
codes, not keys, since a key is catalog text that only `renderHuman` sanitizes.
This line is what tells a blocked run from an unchanged rerun, which also
writes nothing. Then the counts line. Then `fell back to source text: de 2,
de-AT 1` from `summary.fellBack`, left out when nothing fell back and on a
blocked run, which rendered no tree for anything to fall back in.

JSON reporter prints `{ "schema": 1, "diagnostics": [...], "summary": {...} }`,
diagnostics sorted by severity, then code, then file, then locale, then key,
then offset. `summary` carries `{ errors, warnings, messages, locales, fellBack }`
where `fellBack` lists each locale with the number of messages that resolved to
source text, sorted by code point, and only locales whose count is above zero,
so the source locale never appears in it. The JSON payload is the same under
every flag: `--quiet` thins the human reporter only, because the summary counts
have to agree with the diagnostics printed beside them. `summary` carries no
blocked field: `diagnostics[].fatal` already says which entries blocked output.

Every module emits a `Diagnostic` at its rule's **default** severity, stamping
`RULES[rule].severity === 'off' ? 'warn' : RULES[rule].severity`, because
`Diagnostic.severity` is `'warn' | 'error'` and a default-`off` rule has no
representable stamp. **No analysis module re-levels a diagnostic, and M10 alone
applies `config.severity`.** It runs `applySeverity` over the whole set once,
before reporting: the effective severity is `overrides[rule] ??
RULES[rule].severity`, the diagnostic is dropped when that is `off` unless it is
fatal (`Diagnostic.fatal` true), in which case it is kept at `warn`, because
`off` cannot unblock the tree and so must not hide why a run wrote nothing and
exited 1; otherwise its severity is rewritten to it. That is what makes a
default-`off` rule work with no severity decision reaching its producing module:
M7 always emits `LZ5005`, and M10 always drops it unless the user asked for it.

The invariant is about **deciding**, not about reading, and the difference is
worth stating because the frozen wording read as the second and no module could
keep it. Analysis modules do read configuration where the spec tells them to:
M5 resolves `LZ3001`'s `file` from `config.catalogs`, gates `LZ3011` on
`config.formats.timeZone`, and names `config.severity['ambiguous-source']` in
`LZ3012`'s hint. What none of them may do is change whether a diagnostic is
raised, or at what severity it is stamped, based on `config.severity`. Exactly
one rule reaches into that field at all, for one key, to write a sentence.

## 11. Locale store, SSR and hydration

### 11.1 The store

There is exactly one store, in `loclizr`. The generated tree creates none; it
calls `$configure1` and the barrel re-exports the store's functions. A second
store would mean `useLocale()` watching the wrong thing.

**The store's mutable state lives behind
`globalThis[Symbol.for('loclizr.store')]`, the same immutable-handle pattern
section 11.2 uses on the server.** The first module instance to load creates
`{ raw, listeners, setup }` and every later one attaches to it. Module-level
state alone would break the same way the server does: a pnpm tree where an app
and a component library resolve different `loclizr` versions, or a Vite dev
server loading the package through two specifiers, produces two subscriber
lists, so `setLocale` from the switcher updates one while `useLocale()` in the
library's components watches the other and half the UI never switches, with no
error anywhere. That is Paraglide #601 on the client, and it costs one symbol to
close.

The store holds a raw requested tag, a string. Public API:

```ts
getLocale(): Locale
setLocale(locale: Locale, options?: SetLocaleOptions): void
subscribe(listener: () => void): () => void
```

`getLocale()` resolves in this order:

1. the server request scope, if one is installed and active
2. the raw stored tag, if `setLocale` has been called
3. the detected initial value, where a DOM exists (section 11.3), evaluated
   once on the first read and latched, a miss included
4. the registered `sourceLocale`
5. the literal `'en'`, when nothing has been registered

and then matches the result against the registered locale list, so it always
returns a declared locale. Step 5 is reachable and is specified rather than left
to the implementer: registration happens inside `$configure1`, so an app that
imports `getLocale` without importing any message module gets there, which is
exactly what the current example app does. It warns once outside production,
naming the missing generated-module import.
`matchLocale(requested, [], fallback)` returns `fallback`.

**`getRawLocale()` is steps 1 through 3 of that list and stops there.** It runs
the active `AsyncLocalStorage` scope, then the stored tag if `setLocale` has
run, then lazy client detection where a DOM exists, and returns the **raw
requested tag** with no matching against any locale list and no source-locale
default. When all three miss it returns the empty string, and it owns the one
warning a miss can raise: section 11.2's escaped-scope warning, since every
locale read, a message call's included, passes through it. It is
the store's contract with generated code: `$configure1`'s resolver calls it and
matches the result against its own `locales`, which is what lets two generated
directories with different locale lists each resolve correctly from one store
(section 6.2). `matchLocale('', locales, sourceLocale)` returns `sourceLocale`,
so the resolver still yields a declared locale when nothing has been requested.
Section 11.3's step 2, "`document.documentElement.lang`, if it is a known
locale", reads as "if it is a plausible tag" here: deciding whether a tag is
known is the matching step, and matching belongs to the caller.

### 11.2 Server

`loclizr/server` exports:

```ts
runWithLocale<T>(locale: string, fn: () => T): T
withLocale<A extends unknown[]>(
  handler: (request: Request, ...rest: A) => Response | Promise<Response>,
  options: NegotiateOptions,
): (request: Request, ...rest: A) => Promise<Response>
withLocale<A extends unknown[]>(
  handler: (request: Request, ...rest: A) => Response | undefined | Promise<Response | undefined>,
  options: NegotiateOptions,
): (request: Request, ...rest: A) => Promise<Response | undefined>
negotiate(accepted: readonly string[], options: NegotiateOptions): string
localeFromRequest(request: Request, options: NegotiateOptions): string
localeFromHeaders(
  headers: { readonly cookie?: string | undefined; readonly acceptLanguage?: string | undefined },
  options: NegotiateOptions,
): string
export type { NegotiateOptions }
```

**`localeFromHeaders` is the primitive and `localeFromRequest` is a wrapper over
it**, reading `request.headers.get('cookie')` and
`request.headers.get('accept-language')` and passing them straight through. The
two cannot drift, because there is only one implementation. It takes a plain
object of two optional strings rather than a `Headers`, so nothing outside a
Fetch runtime has to construct one: Express hands it
`{ cookie: req.headers.cookie, acceptLanguage: req.headers['accept-language'] }`,
Fastify the same, and a Next Pages Router handler the same, and each then wraps
the whole request in `runWithLocale`. Section 1 excludes Next as a first-class target
and this does not change that; it removes the reason the exclusion would have
been a wall rather than a missing example.

**Every function here takes its locale list explicitly, in `NegotiateOptions`,
and that is by construction rather than by accident.** `loclizr` and
`loclizr/server` are built as separate platform groups, so `src/runtime/**` is
bundled into both and the two entries hold two module instances of the client
store. The `Symbol.for` handle covers the `AsyncLocalStorage`; nothing makes
`registerDefaults`' state shared across the two. Passing the locale list in
means the server half never reads that state, so the duplication is harmless.
The cookie name travels the same way: `_locale.js` exports `cookie` beside
`locales` and `sourceLocale` and the barrel re-exports all three, so
`{ locales: m.locales, sourceLocale: m.sourceLocale, cookie: m.cookie }` is the
whole options object. Without `cookie` the server reads the default `locale`
while the client store reads the configured name, and the two disagree across
the hydration boundary.

`runWithLocale` installs an `AsyncLocalStorage`-backed scope on first call,
idempotently, and runs `fn` inside it. Installing a resolver once at boot is not
per-request mutable state; the per-request value lives in the ALS.

**The scope handle lives in `globalThis[Symbol.for('loclizr.locale')]`, and it
holds an immutable `AsyncLocalStorage` instance, never a locale.** This is the
one piece of the design that exists purely for a named production bug. Next
loads the package twice: the RSC graph receives the server install and the
SSR-of-client-components graph never does, so that second module instance falls
back to a process-wide variable shared across concurrent requests and renders
the wrong language for somebody. That is Paraglide #601. A well-known symbol
holding an immutable handle closes it structurally, survives duplicated module
graphs and duplicate pnpm installs, and needs no `node:async_hooks` import in
the root entry, which keeps the browser bundle clean.

`setLocale` throws **when and only when
`globalThis[Symbol.for('loclizr.locale')]` holds an active scope**. There is no
correct meaning for mutating a process-wide locale mid-request, so the rule is
structural rather than a convention, and the test is structural too. A
`typeof window` test would be wrong: React Native defines `global.window` and
has no `document`, so it would be classified as a server and could never switch
language, while an unguarded `document` read would be a `TypeError` on the first
`getLocale()`. Section 11.3's DOM access is gated on
`typeof document !== 'undefined'` for the same reason. With no `document`,
client detection returns the registered source locale and `setLocale` updates
the in-memory store and notifies subscribers, persisting nothing. React Native
is then a first-class in-memory store and `useLocale()` keeps working.

`withLocale` sets two response headers. `Content-Language`, naming the locale it
negotiated, which is the documented handle for the `<html lang>` agreement in
section 11.3. And `Vary: Accept-Language, Cookie`, because with URL-prefix
routing excluded those two request headers are the only locale inputs, so a
shared cache in front of the handler would otherwise store one viewer's
localized HTML under the unlocalized URL and serve it to the next viewer in the
wrong language. Both fields go on every response, whichever of them decided
this one: `Vary` names the inputs the selection reads, and listing `Cookie` only
when the cookie decided would let a cache store a page rendered without a cookie
and serve it to a viewer who has one. A field already listed, in any case, is
not repeated. **Do not rely on `Vary` alone**: Cloudflare and most CDNs ignore
it outside `Accept-Encoding`, so the documentation states the real requirement,
which is that a shared cache must honour `Vary` or key on the locale cookie, and
otherwise the response carries `Cache-Control: private`. A network error from
`Response.error()` has neither mutable headers nor a status a rebuilt response
can carry, so `withLocale` returns it unchanged.
A handler that returns `undefined` has no response at all: Bun's `fetch`
returns it after `server.upgrade(request)` takes the socket for a WebSocket and
answers the handshake itself. `withLocale` resolves to that `undefined`
unchanged, and the second overload types it, so the upgrade still runs inside
the negotiated scope, while a handler typed to return only `Response` still gets
`Promise<Response>` from the first overload.

A locale read on the server outside any scope, from `getLocale()` or from a
message call given no `options.locale`, returns the source locale and warns once
per process outside production, one warning shared by both, raised in
`getRawLocale()` once the scope handle is installed. It does **not** throw. Static
prerender, background jobs, scripts and error boundaries all run with no
request; turning those into a 500 where source-locale text would have degraded
gracefully is the wrong trade, and behaviour that depends on whether a request
has run yet is worse than either consistent choice. The warning tells the reader
to wrap the whole request (loaders, actions and the render) in `runWithLocale`,
because a framework that runs loaders before the render leaves them outside a
scope that wraps the render alone.

`negotiate` implements RFC 4647 lookup by subtag truncation, hand-rolled, no
dependency. It parses the `;q=` parameter itself, drops a range with `q=0`,
skips `*`, and tries the remaining ranges by descending quality and then
header order. A weight that is not a plain decimal (`Infinity`, `5e0`,
`0.95xyz`) counts as `q=0` and drops the range, and one above 1 counts as 1,
so a malformed weight never outranks a range listed earlier at full quality;
`localeFromHeaders` splits `Accept-Language` on `,` and hands the ranges over.
`localeFromHeaders` reads the configured cookie first, then
`Accept-Language`, then the source locale, and `localeFromRequest` inherits
that order by construction. A cookie that is present but matches no declared
locale resolves to the source locale and does **not** fall through to
`Accept-Language`, because the client resolver runs `matchLocale` over the
same cookie and the two sides have to agree across the hydration boundary; a
fall-through would render German on the server and English on the client for
one tampered cookie. Both sides read the value with one reader: a value inside
one pair of double quotes, the RFC 6265 quoted form, loses the quotes, then it is
percent-decoded, so `locale="de"` and `locale=de` both resolve to `de`.

### 11.3 Client initial value and hydration

Client detection order, evaluated once on the first `getRawLocale()`, which
is the first `getLocale()` or the first generated resolver call, whichever
comes first, never at module load, and only where
`typeof document !== 'undefined'`:

1. the configured cookie, default name `locale`
2. `document.documentElement.lang`, if it is a known locale
3. the registered source locale

The result is latched, a miss included, so a cookie written after that first
read cannot move a snapshot `useSyncExternalStore` has already handed out with
no notification; `setLocale` is the way to change the locale afterwards.

Never `navigator.languages`. Never `localStorage`. The server saw neither, so
either one guarantees a hydration mismatch.

`setLocale` persists to that same cookie by default (`path=/`, one year,
`SameSite=Lax`) and updates `document.documentElement.lang`. The cookie is the
only persistence channel, because it is the only one the server can read.
A `file://` page (Electron `loadFile`) or a page with cookies blocked takes the
write and keeps nothing while `navigator.cookieEnabled` still reports `true`, so
the choice lasts only until reload and the app has to persist it itself and
call `setLocale` on startup. Outside production `setLocale` therefore reads
the cookie back after writing it and warns once when it does not hold the
written value.
`setLocale(locale, { persist: false })` skips the cookie write only;
`document.documentElement.lang` is still updated, because `lang` is live
document state rather than persistence. When step 1 of client detection finds
the cookie, the store makes the same `document.documentElement.lang` write
with the locale the cookie resolves to, with no cookie write and no listener
notification. If no generated module has registered a locale list yet, the
write waits for the first registration; if `setLocale` runs first, its own
write stands and the pending one is dropped.

**The hydration agreement is a single invariant: the client reads the same
cookie the server negotiated from, and the server renders `<html lang={locale}>`.**
`localeFromRequest` is cookie-first and the client is cookie-first, so the two
agree in every case this version supports:

| Case | Server renders | Client reads | Agree |
| --- | --- | --- | --- |
| cookie present | the cookie's locale | the same cookie | yes |
| no cookie, `Accept-Language` matched | that locale, into `<html lang>` | cookie absent, so `<html lang>` | yes |
| no server at all (Vite SPA) | frozen `lang="en"` in `index.html` | the cookie, so a switched locale survives reload | yes |

This is why the order is cookie before `<html lang>` and not the other way
round: the SPA case is the demo target, and `<html lang>` there is a constant in
`index.html` that would permanently defeat the cookie.

The invariant holds only because the locale never comes from the URL path. That
is stated as an exclusion in section 1, not assumed.

**Case 2's second half is the app's job, so it gets an enforcement rather than a
sentence.** Rendering `<html lang={locale}>` is what the client reads when no
cookie exists, and a Vite SSR template ships a hardcoded `<html lang="en">`; with
`Accept-Language: de` the server then renders German, the client hydrates
English, and nothing in the library says a word. `useLocale` therefore runs one
`useEffect`, **outside production only**, that compares
`document.documentElement.lang` against the resolved locale, warns once when
they differ other than in letter case naming the `Content-Language` header
`withLocale` already set, and assigns it. Case 3 needs no effect: on a SPA
reload with cookie `de`, detection assigns `lang` itself when it resolves the
cookie, so the effect finds the two in agreement and stays silent. The cost is
that a visitor with a cookie never surfaces a template that hardcodes
`<html lang="en">`: the store has already corrected `lang` before the effect
runs, although the server HTML still paints with the template's value. The
no-cookie disagreement above still warns and remains the signal that points at
the template.

### 11.4 React

`loclizr/react` emits **no `'use client'` directive** in v0.1. The directive
exists for Next, which section 1 defers to v0.2, and an app that needs one puts
it on its own component file. Dropping it also lets `Parts`, which is nothing
but `createElement(Fragment, null, ...)`, be called from a server component
instead of forcing a client boundary to render a fragment.

```ts
useLocale(): Locale
useSetLocale(): (locale: Locale, options?: SetLocaleOptions) => void
Parts(props: { of: readonly (string | ReactNode)[] }): ReactElement
export type { Locale, SetLocaleOptions }
```

`useLocale` is `useSyncExternalStore(subscribe, getLocale, getLocale)` with
module-level function references, so there is no resubscribe on every render and
no tearing. The snapshot is a primitive string, so snapshot identity is stable
by construction.

`Parts` is `createElement(Fragment, null, ...props.of)`. React validates keys
only for an array passed as a single child, so a positional spread needs no keys
and warns about nothing. That is the whole component.

**`useLocale` is the only subscription there is.** A message call is not one. `m.cart_items({ count })` is a plain function call into generated code that reads
the store once and returns a string, so a component that calls messages and no
hook re-renders when its parent re-renders it and at no other time. Nothing in
`loclizr/react` can change that, because generated code imports nothing from
React by design (invariant 2). An app therefore has to arrange its own
re-render, and there are exactly two sanctioned ways to do it. This is true with
no React Compiler in the project; the compiler only adds a second reason for the
second pattern.

| Pattern | Shape | Cost |
| --- | --- | --- |
| Whole tree | `<App key={useLocale()} />` at the root | the tree remounts, so local component state resets on a switch |
| Precise | `m.cart_items({ count }, { locale: useLocale() })` | that component subscribes and re-renders in place, keeping its state |

Section 8 shows both. The whole-tree pattern is the default because it needs no
per-component discipline and switches every visible string; the precise form is
the escape for a component that cannot afford to lose its state.

**React Compiler.** The hazard is not in `useLocale`. It is that `m.greeting()`
reads mutable external state with no arguments, so a memoizing compiler may
legitimately cache its result across renders of one component instance. The two
patterns above are the answer to that as well, for a different reason: the
precise form makes the locale a visible reactive dependency the compiler can
see.

The whole-tree pattern is sound because React Compiler's memo caches are
per-instance and a remount discards them, so a cached string cannot survive the
switch. It has two documented holes: it does not reach a second `createRoot`,
such as a separately mounted toast layer, and it does not reach values computed
once at module scope. Both are documentation and lint, not structure. The
precise form is the escape for both, and that is the actual reason the per-call
`{ locale }` override exists. It is a correctness mechanism, not a convenience.

## 12. Usage scan

The scan is a scan, not a type checker. It adds no dependency beyond
`tinyglobby`, which is already installed.

A hand-rolled single-pass tokenizer walks each matched file tracking line
comments, block comments, all three string kinds with `${}` nesting depth,
regular-expression literals resolved by a previous-token heuristic, and brace depth. A regular expression cannot escape a line break, so a backslash before one ends the attempt, and once 64 attempts on one line have failed to close, every further `/` on that line reads as division until the next line break, wherever that break falls, inside a comment, string or template included, so a line of unclosed classes costs its length rather than its square. Skipping those kills nearly every false positive without an AST.

**In `.jsx`, `.tsx`, `.svelte`, `.vue` and `.astro`, string lexing is narrowed,
not skipped.** JSX text is
not a string to any JS tokenizer, so `<p>Don't forget</p>` presents a bare
apostrophe that a full lexer reads as an opening quote and does not close until
the next apostrophe, possibly hundreds of lines later, and every `m.*`
reference in between vanishes. The loss is silent, because `LZ5005` is `off`
and `LZ5004` fires only when no matched file imports the generated tree at
all. Usage sites are the record's highest-value field and the payload the
thesis is sold on, so the trade goes the other way here: a false positive
costs one extra usage site, which is still a real source location a translator
can read, and a false negative costs the payload. So in those extensions a
quote opens a literal only in expression position, where the previous
significant character is one of `= ( [ { , : ; ?`, an `=>`, or a keyword that
ends in expression position such as `return`, **and** only when it closes before the next newline; template holes stay live. Once 64 quotes on one line have failed to close, that line opens no more literals until the next line break, wherever it falls, so a line of unclosed holes costs its length rather than its square. No regular expression is
lexed there, because `<p>a</p><p>b</p>` offers `/p><p>b</` as one. A `//`
immediately preceded by `:` does not open a comment, or `href="https://x"` in
JSX text would blank the rest of its line and every usage beside the link, and
an unterminated block comment ends at the end of its own line instead of the
end of the file. Four residuals remain and are accepted: a `//` in JSX text
with no `:` before it still blanks its line, a `/*` in JSX text still loses its
own line, an apostrophe in JSX text that follows a comma or colon and closes on
the same line past a usage loses that usage, and in `.vue` and `.svelte` a
quoted attribute value is still a string, so a usage inside a directive such as
`:title="m.nav_home()"` or `title="{m.nav_home()}"` is lost; interpolation and
`<script>` are found. Full string lexing
stays for `.ts`, `.js`, `.mts` and `.mjs`.

Pass one binds the generated module per file: `import * as m from '<spec>'`
records the namespace alias, and `import { nav_home as h }` records the bare
binding `h`. An `export ... from '<spec>'` and a bare side-effect
`import '<spec>'` bind nothing callable but do count as reaching the generated
tree, so a barrel re-export or a switcher importing only `locales` never makes
`LZ5004` blame the glob. An import statement quoted inside a string literal
binds nothing: the match is accepted only where the keyword survives the
string-blanked scrub, so a docs or fixture string cannot flip the verdict.

**A specifier binds by suffix, not by resolution.** Strip any extension from
`<spec>`, then bind it when what remains **ends with**
`<basename(outDir)>/messages`, `<basename(outDir)>/groups` or
`<basename(outDir)>/messages/<ns>`, whatever comes before. With the default
`outDir` that basename is `loclizr`, so `./loclizr/messages`,
`../../loclizr/messages`, `@/loclizr/messages`, `~/loclizr/messages` and
`#app/loclizr/groups` all bind, and no `tsconfig.json`, `vite.config.ts` or
`package.json` `imports` map is read to get there. Path aliases are the norm in
every app template the scan will meet, and a resolver that handled them
correctly would be a second module resolution implementation to keep in step
with four bundlers.

This errs toward false positives, which is the direction section 12 has already
chosen once: a file importing `other-package/loclizr/messages` binds too, and
the cost is a usage site attributed to a message that may not exist, which the
`ids` set filters out anyway. The cost of the other direction is the record's
highest-value field going silently empty for every project that aliases its
imports, which is most of them.

Pass two records every `m.<id>` member access and every bound bare identifier
followed by `(`. Each site carries the file (POSIX, relative to `root`), 1-based
line and column, the name of the enclosing declaration (the deepest function,
method, class or variable declaration at a lower brace depth) and the trimmed
source line capped at 160 characters. The enclosing declaration name is the
highest-value token a translator receives: "this string is in `CheckoutButton`"
beats a line number. The column is the start of the access expression, the `m`
of `m.nav_home` or the `errors` of `errors[code]`, not the member name. A
usage at the top level of a module has `scope: null`; a braceless arrow body,
`const Label = () => m.nav_home()`, names the arrow. Optional chaining,
`m?.nav_home` and `errors?.[code]`, resolves like plain access. A reference in
type position, `typeof m.nav_home`, is a member access like any other and is
recorded as a usage, because the tokenizer does not know a type from a value.
The scan follows symbolic links; a path whose target is not a regular file is
skipped, and the type is checked on the open handle, opened non-blocking where
the platform allows, so a link to a FIFO or a device can neither block the
build nor stream into it.
A matched file that cannot be read is skipped with no diagnostic; neither
`LZ5004` nor `LZ5005` covers an unreadable source file, and nothing else is
M7's to raise.

**Groups resolve to their members**, which is why `scan` receives group
membership and not a list of group ids. A **computed** access on a bound group,
`errors[code]`, records a usage against every `memberId`. A **static** member
access, `errors.forbidden`, records it against the single id that `memberProps`
maps that property to. Without membership, every member of a group only ever
accessed dynamically would be reported unused and would carry an empty `usage`
array in the record. Both forms count whether the group arrived as
`m.errors[...]` through the barrel or as `import { errors } from './loclizr/groups'`
followed by `errors.forbidden(...)`, which is the common static shape and
matches neither of pass two's two plain rules on its own.

Documented limits: renamed re-exports are not followed and computed access on a
plain namespace is not resolved. That is exactly what the typed lookup tier
exists for.

**Because the scan is a heuristic, nothing it produces can fail a build by
default, and that is a promise the record gate has to keep too.** The two rules
that read the scan directly, `LZ5004` and `LZ5005`, default to `warn` and `off`.
The third path is indirect and was the one that could break the promise: the
scan's output lands in the record's `usage` field, and `LZ5003` is an error. So
`LZ5003` and `LZ5007` compare the record with `usage` projected out entirely
(section 13). A renamed component, a moved file or a tokenizer improvement
therefore cannot fail anyone's build, and the sentence above is true rather than
nearly true.

`outDir` is always excluded from the scan, since generated files reference their
own identifiers.

## 13. Rule catalog

Fifty-nine rules. Every code is stable forever. `severity` in the config
re-levels any of them to `off`, `warn` or `error`, except `LZ1001`, `LZ1007` and
`LZ5001`, which are not re-levelable (section 3).

**Fatal** is the `Rule.fatal` scope from section 9: `never`, `always`,
`ifSource` (only when the file is the source catalog) or `message` (drops that
one message and blocks nothing). Re-levelling never changes the scope: a fatal
rule at `warn` still blocks output and the run exits 1 (section 9).

Each code has exactly one producing module, so two engineers can never both
claim one. Ranges are thematic and a range may span two owners.

### LZ1xxx, configuration and catalogs

| Code | Rule | Default | Fatal | Owner | Trigger |
| --- | --- | --- | --- | --- | --- |
| LZ1001 | `config-invalid` | error | always, exit 2 | M9 | the config file threw, a field failed validation or is not a config field, or `severity` names `config-invalid`, `outdir-unsafe` or `output-unwritable` |
| LZ1002 | `locale-tag-invalid` | error | always | M9 | a locale **declared** in `locales`, or the declared `sourceLocale`, is rejected by `Intl.getCanonicalLocales`; one tag in both places is reported once |
| LZ1003 | `no-catalogs-found` | error | always | M9 | the `catalogs` pattern matched nothing |
| LZ1004 | `source-catalog-missing` | error | always | M9 | no catalog file for the source locale, or the source locale could not be inferred |
| LZ1005 | `catalog-missing` | error | never | M9 | a declared locale has no catalog file |
| LZ1006 | `catalog-undeclared` | warn | never | M9 | a catalog file exists for a locale absent from `locales`; a discovered basename is not a valid locale tag and was skipped, `en_US.json` included; a discovered locale's primary subtag is five to eight letters while `locales` is unset; a discovered file parses to an object with `schema: 1`, a context record left under the pattern; or a `.json` file under the pattern's base directory matches neither the pattern nor `meta` nor `record` (section 3) |
| LZ1007 | `outdir-unsafe` | error | always, exit 2 | M9 | `outDir` resolves outside the project root, or to the root itself |
| LZ1008 | `catalog-unreadable` | error | ifSource | M2 | the file exists and could not be read. A missing file is `LZ1005`. Never fatal for the meta sidecar |
| LZ1009 | `catalog-json-syntax` | error | ifSource | M2 | the JSON scan failed, or the file nests more than 256 levels deep. Never fatal for the meta sidecar |
| LZ1010 | `catalog-shape-invalid` | error | never | M2 | non-object root, or an array, number or boolean leaf, in a catalog; a root, entry, `description`, `placeholders` map or note of the wrong shape in the meta sidecar. A `null` leaf in a target catalog is a missing translation, not this; in the source catalog it is this, unless another route to the same key ends in a message string |
| LZ1011 | `duplicate-key` | error | never | M2 | the same flat key path from a nested and a dotted form where both end in a message string, from a JSON key written twice in one object whatever the values, from a bare `X` beside a group that folds to `X`, or from two namespace files of one locale. `JSON.parse` silently keeps the last one, which is how a translation disappears with no diff |
| LZ1012 | `i18next-nesting-unsupported` | error | never | M2 | a value contains `$t(` |
| LZ1013 | `i18next-format-unsupported` | error | never | M2 | a placeholder carries an inline formatter, `{{val, fmt}}`, or a name ICU cannot read as an argument, `{{user.name}}` |
| LZ1014 | `plural-suffix-orphan` | warn | never | M2 | a CLDR-suffixed key with no `_other` sibling, or an `X_plural` beside a bare `X` (i18next JSON v3). A lone `X_other` is not this: it folds, or stays a key beside a sibling that says it is not a plural (section 2.1 step 4) |
| LZ1015 | `meta-orphan` | warn | never | M2 | a meta entry for a key absent from the source catalog |
| LZ1016 | `i18next-markup-literal` | warn | never | M2 | an i18next value contained tag-shaped text, which was escaped to literal text |
| LZ1017 | `i18next-context-detected` | warn | never | M2 | a key `X_male` or `X_female` beside a bare `X`, which i18next picked at run time and which is now its own message with no selector. No other suffix is a context, because `X_<word>` beside `X` is ordinary snake_case naming |
| LZ1018 | `locale-base-missing` | warn | never | M9 | a declared non-source locale carries a subtag, region or script, whose base tag is not also declared |
| LZ1019 | `icu-data-incomplete` | warn | never | M10 | the build machine's `Intl` has truncated ICU data |
| LZ1020 | `icu-in-i18next-file` | warn | never | M2 | a file read as i18next contains a single-brace run shaped like a typed ICU argument, which will render as literal text |
| LZ1021 | `outdir-foreign-file` | warn | never | M10 | a file under `outDir` does not carry the generated header, so it was neither overwritten nor pruned; or a symlink sits at an emitted path, so it was neither read nor replaced; or a headered orphan the prune could not delete |
| LZ1022 | `meta-placeholder-orphan` | warn | never | M8 | a `placeholders` key in the meta sidecar whose NFC name is no argument of its message, so the note reaches no `RecordArg`; the message names the arguments the message does take |

`LZ1020` is the one mistake `catalogFormat: 'auto'` can make invisible, so it is
the one it reports. A run is any `{`, not doubled, followed by an argument name,
a comma and one of `plural`, `select`, `selectordinal`, `number`, `date` or
`time`. Under `'auto'` the hint names what classified the file, the first value
holding a `{{` or the first CLDR-suffixed key, verbatim, which is **why** the
file classified as i18next; under `catalogFormat: 'i18next'` nothing classified
it, so the hint names the setting instead. Either way it states that the run will
render as literal text because section 2.1 step 1 quoted it, and gives the fix:
convert that file to ICU, or set `severity: { 'icu-in-i18next-file': 'off' }` if
the literal text is what you meant. No `catalogFormat` value silences it.
It is a warning rather than an error because the output is well defined and
matches what i18next itself rendered; it is not silent because nobody writes
`{count, plural, ...}` meaning it literally.

`LZ1021` is the prune step's safety catch (section 7.1). It fires in both
`build` and `check`, it never blocks anything, and its existence is what lets
`build` delete files at all: the compiler deletes what it can prove it wrote and
reports everything else.

`LZ1019` is a single startup probe:
`new Intl.PluralRules('ru').resolvedOptions().pluralCategories.length < 4`. A
Node built `--with-intl=small-icu`, or a slim container image, silently resolves
unknown locales to English data and returns `['one','other']` for Russian
without throwing, so `LZ3007` goes quiet on exactly the catalogs it exists for
and a developer's machine disagrees with CI, which is invariant 5 failing for
the diagnostic set. When the probe fires, the diagnostic names `NODE_ICU_DATA`
and a full-icu Node, and M10 forces `LZ3007` and `LZ3013` to `off` for that run,
so a truncated ICU makes **no** category claims rather than wrong ones.

### LZ2xxx, message syntax

| Code | Rule | Default | Fatal | Owner | Trigger |
| --- | --- | --- | --- | --- | --- |
| LZ2001 | `icu-syntax` | error | message | M3 | any parser `ErrorKind` other than the two below, or two options of one select equal under NFC |
| LZ2002 | `icu-style-unknown` | error | never | M3 | a named style absent from the built-in table and from `config.formats` |
| LZ2003 | `icu-skeleton-invalid` | error | never | M3 | a `::` skeleton the parser rejects or resolves to no options, `::currency` with no code, a `scale` that is not a finite number, options `Intl` cannot build, a `per-measure-unit/` with no unit, or a date or time skeleton holding `J` or `C`; the node falls back to its bare form (section 5.2) |
| LZ2004 | `plural-other-missing` | error | message | M3 | `MISSING_OTHER_CLAUSE` on a plural or selectordinal |
| LZ2005 | `select-other-missing` | error | message | M3 | `MISSING_OTHER_CLAUSE` on a select |
| LZ2006 | `plural-category-unknown` | error | never | M3 | a branch keyword that is neither a CLDR category nor `=N` |
| LZ2007 | `arg-name-invalid` | error | never | M3 | an argument name outside the predicate below |
| LZ2008 | `pound-literal` | warn | never | M3 | a literal text node containing `#` lexically inside a plural body (section 5.3) |
| LZ2009 | `arg-type-conflict-local` | error | message | M3 | one name used at two irreconcilable types inside **one** value, such as `{x, number} of {x, date, short}` |

`LZ2001`'s span depends on the format the file was read as, which
`RawCatalog.format` carries and `LowerContext.catalogFormat` passes through, so
it is never re-derived. For a file read as ICU, M3 composes `context.span` with
the parser's offset into the ICU string. For one read as i18next, M3 reports
`context.span` verbatim and appends the parser's own message to the hint,
because section 2.1 rewrote the value twice and JSON unescaping had already
shifted everything before that, so any offset arithmetic would point at the
wrong column for every converted catalog. Precise spans on converted catalogs
would need `toIcu` to return an offset map, which is a change to M2's signature
and a new major.

`LZ2007`'s predicate is exact, because "not a usable JavaScript property" does
not pick out a set. After NFC normalization, an argument name is valid when it
matches `/^[\p{ID_Start}$_][\p{ID_Continue}$]*$/u` and is not `__proto__`.
Everything else is `LZ2007`. Verified on 3.5.19: `{user.name}`, `{user-name}`
and `{$}` are already `MALFORMED_ARGUMENT` at parse time so the rule never sees
them, while `{9x}`, `{__proto__}`, `{constructor}`, `{toString}` and `{ä}` all
parse cleanly. The predicate keeps `ä` and rejects `9x`, which would be a syntax
error in the emitted module. `__proto__` is the silent one: a call site writing
`m.f({ __proto__: x })` sets the prototype rather than a property, so the read
returns `Object.prototype` and the message renders `[object Object]` with
nothing reporting it anywhere.

### LZ3xxx, the cross-locale contract

| Code | Rule | Default | Fatal | Owner | Trigger |
| --- | --- | --- | --- | --- | --- |
| LZ3001 | `missing-translation` | error | never | M5 | the locale resolved by falling through to the source locale, reason `missing` |
| LZ3002 | `blank-translation` | error | never | M5 | the same, reason `blank`: an empty or whitespace-only value. Not raised where the source value is blank by the same test, since the fallback renders the same blank text |
| LZ3003 | `extra-translation` | warn | never | M5 | a key present in a target catalog and absent from the source, read off `Program.extras` |
| LZ3004 | `arg-missing` | error | never | M5 | a source argument absent from a translation |
| LZ3005 | `arg-extra` | error | never | M5 | a translation introduces an argument, or a markup tag, the source does not have |
| LZ3006 | `arg-type-conflict` | error | never | M5 | `unify` failed across locales |
| LZ3007 | `plural-category-incomplete` | warn | never | M5 | the locale's `pluralCategories` requires a category the message provides no keyword branch for; an exact branch does not count |
| LZ3008 | `select-option-missing` | warn | never | M5 | a target collapses a source branch into `other`. Compared only on a name that carries a `select` in both bodies; a target that keeps the argument bare raises neither this nor `LZ3009` |
| LZ3009 | `select-option-extra` | error | never | M5 | a target branch is unreachable from the source-derived type, read as the union of every `select` on that name in the target body |
| LZ3010 | `markup-mismatch` | error | never | M5 | the deduplicated sorted tag **set** differs from the source. Nesting arity is not compared |
| LZ3011 | `date-without-timezone` | off | never | M5 | a date or time argument whose resolved options carry no `timeZone`, once per message against the source locale, and only while `formats.timeZone` is unset |
| LZ3012 | `ambiguous-source` | warn | never | M5 | see below |
| LZ3013 | `plural-category-unreachable` | warn | never | M5 | a keyword branch absent from `requiredCategories(locale, ordinal)`, so the locale can never select it |
| LZ3014 | `bidi-control-unpaired` | warn | never | M5 | a value, source or target, holds an embedding, override or isolate control (U+202A to U+202E, U+2066 to U+2069) with no partner: an opener never closed, or a closer with nothing open. Once per control per value |

`LZ3012 ambiguous-source` is the thesis expressed as a default-on rule, and it
is the gettext `msgctxt` problem: "Open" can be a verb or an adjective, and a
translator handed the bare string cannot tell. It fires when two or more keys
share byte-identical normalized ICU source text and **any one of them** lacks a
description. Firing only when all of them lack one under-fires: two keys sharing
"Open" where one is described leaves the other just as ambiguous. Comparison is
case sensitive, on the normalized ICU form, so an i18next catalog and an
ICU-native catalog behave identically. One diagnostic is raised per source text,
listing every colliding key with its file position and its description status.

This is the rule an imported catalog hits first, so its message text is part of
the adoption story, not an afterthought. The rendering in section 10.1 is
normative: name every key, show which have descriptions, print the exact meta
entries to paste and the exact `severity` line that moves it.

**Its default is `warn`, and only its exit code moves.** It is not in the decided
exit-non-zero set, and at `error` it fires on every app-sized catalog as a
matter of course: "Open", "Save", "Cancel", "Close", "Name", "Yes" collide
routinely, the rule fires when any one of a colliding set lacks a description,
and a freshly imported i18next catalog has no descriptions at all. So at `error`
it is also the rule that makes the first `loclizr build` after an import exit 1
with dozens of diagnostics, which points the go-to-market inversion the wrong
way: the research's strongest finding is that developers do not react to context
loss, and handing them the context rule as their first red build is the one move
guaranteed to lose them. `loclizr init` writes the `error` line for a greenfield
project, where the gate is free and permanent, and writes it commented out for a
retrofit. Section 10 has the exact behaviour.

`LZ3014` exists because an override left open does not stop at the end of the
message: in HTML it runs to the end of the paragraph and reverses the text the
page puts after it, and the character is invisible in the catalog diff. Pairing
follows UAX #9: U+202C closes the innermost embedding or override and never an
isolate, and U+2069 closes the innermost isolate along with every embedding
opened inside it. Only one branch of a plural or select renders, so a pair
balances inside its branch; a markup tag renders inline, so a pair may span one.
The marks U+200E, U+200F and U+061C open nothing and are never reported. The
hint names the closer, U+202C for an embedding or override and U+2069 for an
isolate.

### LZ4xxx, identity and output

| Code | Rule | Default | Fatal | Owner | Trigger |
| --- | --- | --- | --- | --- | --- |
| LZ4001 | `identifier-collision` | error | always | M4 | two keys mangle to one identifier, two groups share an `id` or a `typeBase`, a group `id` equals a member's id, or two keys of one group mangle to one member property |
| LZ4002 | `identifier-reserved` | error | always | M4 | a mangled identifier is reserved, a group id or group member id is `Object`, a group member property is `__proto__`, or a namespace filename is `_locale`, `_formats` or `_root` (section 7.2) |
| LZ4003 | `confusable-key` | error | never | M4 | two keys differ but share a confusable skeleton |
| LZ4004 | `group-empty` | error | never | M4 | a group prefix matched zero keys; the group is still emitted with `Key = never` (section 7.4) |
| LZ4005 | `nondeterministic-output` | error | always | M6 | the replayed re-emit differs byte-wise |
| LZ4006 | `group-args-heterogeneous` | warn | never | M4 | a group's members do not share one argument signature, names and kinds, so every dynamic call site carries the union |
| LZ4007 | `identifier-orphan` | warn | never | M4 | an `identifiers` entry whose key is not a source catalog key, a top-level segment of one, or a group name (section 3); one per entry in code point order, the hint naming the closest of those names other than `_root` by edit distance, ties to the first in code point order |

### LZ5xxx, artifacts and context

| Code | Rule | Default | Fatal | Owner | Trigger |
| --- | --- | --- | --- | --- | --- |
| LZ5001 | `output-unwritable` | error | always, exit 2 | M10 | a generated file or the record could not be written, or the record path holds a file that is not a context record (section 16, M10 step 9) |
| LZ5002 | `output-stale` | error | never | M10 | `check` only: an emitted file that exists on disk differs, or a headered file under `outDir` this emit did not produce, reason `orphaned` |
| LZ5003 | `record-stale` | error | never | M10 | `check` only: the committed context record is absent, or differs from the record this build would write, **compared with every message's `usage` and `translations` projected out** |
| LZ5004 | `scan-found-nothing` | warn | never | M7 | the scan matched files but found zero generated-module imports anywhere. A glob that matched no file at all stays silent |
| LZ5005 | `unused-message` | off | never | M7 | a message the scan never saw referenced |
| LZ5006 | `missing-description` | off | never | M8 | a message with arguments or markup and no description (absent, empty or whitespace only, as for LZ3012); the message says `takes a, b` for values and `carries markup b, link` where every argument is a tag |
| LZ5007 | `record-rewritten` | warn | never | M10 | `build` only: a committed record existed and differed from the one this build just wrote, under the same projection as `LZ5003`. A first build has nothing to rewrite and stays silent |

`LZ5003` is what makes "context lands in the same pull request as the string
change" a gate rather than an aspiration. The record is committed, so `check`
always compares it.

**The gate compares a projection, and the file on disk is still the whole
record.** Both `LZ5003` and `LZ5007` drop every message's `usage` array and
every message's `translations` array from both sides before comparing, and
compare what is left: keys, ids, modules, kinds, sources, hashes, descriptions,
args, variants, markup, and the header fields. That residue is the contract
between code and translations, and it is the only thing a stale record actually
loses.

The two arrays come out because neither tracks a change to source copy, and both
move on their own:

- `usage` moves when a component is renamed, a file is moved, or the tokenizer
  gets better. Section 12 promises no scan-dependent rule can fail a build by
  default, and with `usage` in the comparison that promise was false.
- `translations` moves when a translator commits, when a TMS sync bot lands a
  batch, or when a locale's coverage changes for any reason other than the
  source. A pull request that adds twelve German strings and touches no source
  copy would otherwise fail `check` and be told to regenerate a file it has no
  reason to think about.

Neither projection weakens the gate. Editing copy changes `source` and
`sourceHash`, adding or removing a message changes the message list, and
changing an argument changes `args`: every one of those is in the residue.

**`build` still writes the full record whenever any byte differs**, `usage` and
`translations` included, so the committed file stays complete and a
translator-facing tool reading it gets coverage and render sites as always. The
write decision is a byte comparison; the rule decision is the projected
comparison. They are deliberately different questions and the spec keeps them
apart.

`LZ5007` is the same comparison in `build`, and it exists because the documented
wiring is `predev` / `prebuild` / `pretypecheck` running `build` rather than
`check`. A pipeline whose only invocation is `pnpm build` would
rewrite the record in the CI workspace and pass, so a pull request that changed
copy without regenerating would land with a stale record and the context would
never arrive with the string change, which is precisely the punchline the thesis
claims to defeat. `--no-fail` does not move this: that flag changes an exit code
and nothing else, and a `predev` run still rewrites the record and still warns.
M10 already holds the committed bytes and the fresh record at write time, so the
comparison costs one parse of the committed file. A committed record that fails
to parse counts as differing. It is a separate code rather than `LZ5003` at a
different severity because `applySeverity` resolves severity from `RULES` and
one rule cannot hold two defaults.

`LZ5005` is suppressed entirely whenever `LZ5004` fires. A wrong `scan.include`
glob then costs one warning instead of four hundred.

## 14. The context record

Written to the `record` path, `locales/loclizr.context.json` by default whatever
`catalogs` says (`loclizr init` points it beside a layout elsewhere, section
10), committed to git. A user-supplied `record` path may carry `{sourceLocale}`, which is
substituted before the file is written; `Config.record` itself keeps the token,
per section 3.

**It is a pure function of the current tree**: the catalogs, the meta sidecar,
the scanned sources and the config. It never reads its own previous value. That
is deliberate, and it is the property the thesis defends against an agent that
re-derives context per run: same inputs, same bytes, free, reviewable in the
diff. Carrying a sticky staleness flag would make the record a fold over its own
history, so a fresh regenerate and an incremental regenerate would disagree and
two branches editing the same string would merge-conflict inside a generated
file. We do not do that.

Staleness is still available, and it is available for free, because the record
is in git. The record carries `sourceHash` and does **not** carry translation
text or translation hashes, so:

- a pull request that edits copy changes `sourceHash` in the record and does not
  touch `de.json`
- a pull request that translates changes `de.json` and does not touch the
  record, unless coverage changed

Which is to say the gettext fuzzy signal is a two-file diff, and the part of the
record the gate compares changes only when the contract changes. Per-locale
status is carried in the file because coverage is what a translator-facing tool
reads, and projected out of the gate because a translator landing a batch is not
a contract change. Per-locale text is carried nowhere, because polishing a
German sentence is not one either.

**The file carries more than the gate compares, and the difference is
deliberate.** `LZ5003` in `check` and `LZ5007` in `build` compare the committed
record against the fresh one with every message's `usage` and `translations`
projected out of both, and `build` writes the whole record whenever any byte
differs. So the committed file keeps coverage and render sites for any tool
reading it, while the thing that can fail a pull request is only the contract:
keys, ids, modules, kinds, `source`, `sourceHash`, descriptions, args, variants
and markup.

Both projected fields move without any source copy changing. `usage` moves when
a component is renamed or a file is moved, and section 12 already promises no
scan-dependent rule fails a build by default. `translations` moves when a
translator commits or a TMS sync bot lands a batch, and failing that pull
request would punish the exact contribution the record exists to make easier.
Neither projection can hide an edited string, because an edited string changes
`source` and `sourceHash`, which are in the comparison.

Determinism rules: messages sorted by key by code point, locales sorted,
arguments printed in `Message.args` order verbatim, usage sites deduplicated and
sorted by file then scope, two-space indent, POSIX separators, LF endings, a trailing newline, U+202A-U+202E, U+2066-U+2069, U+2028 and U+2029 written as lowercase `\uXXXX` escapes so a reviewed diff cannot be reordered by a file name or source string, no timestamps, no absolute paths, no tool version. A version
field would turn every release into a whole-file diff.

**A usage entry carries `file` and `scope`, and deliberately not `line`,
`column` or `snippet`.** Adding one import at the top of `src/Cart.tsx` shifts
every line below it, so a position-carrying record churns on a pull request that
touched no string. The gate already projects `usage` out, so that churn cannot
fail `check`, but it still lands in the diff as generated noise, and two pull
requests editing the same component then both rewrite the same `usage` entries
and merge-conflict inside a generated JSON file, which this section explicitly
says we do not do. Precise positions stay where they cost nothing: the JSON
reporter's diagnostics, and `BuildResult.program.usages`, where `UsageSite`
keeps all five fields for any tool that wants them. A committed sidecar of
precise sites is a v0.2 question, not a v0.1 file the user has to remember to
ignore.

Three mappings, stated so M8's owner does not have to invent them. `ArgType`'s
`stringish` maps to `RecordArgType` `'text'`. A plural node maps to
`RecordVariant.kind` `'selectordinal'` when `ordinal` is true and `'plural'`
otherwise. `RecordVariant.matches` merges the node's two branch arrays into one
list: exact branches first as `=N`, ascending by value, then keyword branches in
CLDR order `zero, one, two, few, many, other`. That is the same order
`printIcu` uses, so the record and `source` agree.

Schema, with the worked example's `cart.items` and `nav.home`:

```json
{
  "schema": 1,
  "sourceLocale": "en",
  "locales": ["de", "de-AT", "en"],
  "messages": [
    {
      "key": "cart.items",
      "id": "cart_items",
      "module": "messages/cart.js",
      "kind": "text",
      "source": "{count, plural, =0 {Your cart is empty} one {# item in your cart} other {# items in your cart}}",
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
        { "arg": "count", "kind": "plural", "matches": ["=0", "one", "other"] }
      ],
      "markup": [],
      "translations": [
        { "locale": "de", "status": "translated", "from": null, "reason": null },
        { "locale": "de-AT", "status": "inherited", "from": "de", "reason": null },
        { "locale": "en", "status": "translated", "from": null, "reason": null }
      ],
      "usage": [{ "file": "src/Cart.tsx", "scope": "Cart" }]
    },
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
        { "locale": "de", "status": "translated", "from": null, "reason": null },
        { "locale": "de-AT", "status": "inherited", "from": "de", "reason": null },
        { "locale": "en", "status": "translated", "from": null, "reason": null }
      ],
      "usage": []
    }
  ]
}
```

`source` is `printIcu(nodes)` per section 5.5, so an i18next catalog and an
ICU-native catalog with the same meaning produce the same record. `sourceHash`
is sha256 of `source` encoded as UTF-8, with an unpaired surrogate written as
its own three-byte WTF-8 sequence (`ED A0 80` for U+D800) rather than as
U+FFFD, truncated to 16 hex characters, from `node:crypto`. The
two values above are the real hashes of the two strings printed beside them and
are normative: an implementation producing different ones is printing a
different canonical form.

## 15. Shared types: `src/types.ts`, complete

One file holds every shared type. M1 owns it and is the only module that edits
it. It is printed here in full, so nobody waits on it and no module needs to
guess a field.

Two conventions inside it. The compiler-side types use plain `string` for a
locale, because narrowing is a generated-code concern. The runtime-side types at
the end carry `Locale`, and they live in this same file because M12 re-exports
them from `src/index.ts` and the `LocaleRegistry` augmentation has to target the
`loclizr` entry. Verified: the augmentation merges correctly through such a
re-export.

```ts
export type Severity = 'off' | 'warn' | 'error'

export type RuleName =
  | 'config-invalid'
  | 'locale-tag-invalid'
  | 'no-catalogs-found'
  | 'source-catalog-missing'
  | 'catalog-missing'
  | 'catalog-undeclared'
  | 'outdir-unsafe'
  | 'catalog-unreadable'
  | 'catalog-json-syntax'
  | 'catalog-shape-invalid'
  | 'duplicate-key'
  | 'i18next-nesting-unsupported'
  | 'i18next-format-unsupported'
  | 'plural-suffix-orphan'
  | 'meta-orphan'
  | 'i18next-markup-literal'
  | 'i18next-context-detected'
  | 'locale-base-missing'
  | 'icu-data-incomplete'
  | 'icu-in-i18next-file'
  | 'outdir-foreign-file'
  | 'meta-placeholder-orphan'
  | 'icu-syntax'
  | 'icu-style-unknown'
  | 'icu-skeleton-invalid'
  | 'plural-other-missing'
  | 'select-other-missing'
  | 'plural-category-unknown'
  | 'arg-name-invalid'
  | 'pound-literal'
  | 'arg-type-conflict-local'
  | 'missing-translation'
  | 'blank-translation'
  | 'extra-translation'
  | 'arg-missing'
  | 'arg-extra'
  | 'arg-type-conflict'
  | 'plural-category-incomplete'
  | 'select-option-missing'
  | 'select-option-extra'
  | 'markup-mismatch'
  | 'date-without-timezone'
  | 'ambiguous-source'
  | 'plural-category-unreachable'
  | 'bidi-control-unpaired'
  | 'identifier-collision'
  | 'identifier-reserved'
  | 'confusable-key'
  | 'group-empty'
  | 'nondeterministic-output'
  | 'group-args-heterogeneous'
  | 'identifier-orphan'
  | 'output-unwritable'
  | 'output-stale'
  | 'record-stale'
  | 'scan-found-nothing'
  | 'unused-message'
  | 'missing-description'
  | 'record-rewritten'

export type ModuleId = 'M2' | 'M3' | 'M4' | 'M5' | 'M6' | 'M7' | 'M8' | 'M9' | 'M10'

export type FatalScope = 'never' | 'always' | 'ifSource' | 'message'

export interface Rule {
  readonly code: string
  readonly name: RuleName
  readonly severity: Severity
  readonly fatal: FatalScope
  readonly exitTwo: boolean
  readonly owner: ModuleId
}

export interface Span {
  readonly line: number
  readonly column: number
  readonly offset: number
  readonly length: number
}

export interface Related {
  readonly file: string | null
  readonly locale: string | null
  readonly key: string | null
  readonly span: Span | null
  readonly message: string
}

export interface Diagnostic {
  readonly code: string
  readonly rule: RuleName
  readonly severity: 'warn' | 'error'
  readonly fatal: boolean
  readonly message: string
  readonly hint: string | null
  readonly file: string | null
  readonly locale: string | null
  readonly key: string | null
  readonly span: Span | null
  readonly related: readonly Related[]
}

export interface DiagnosticFields {
  readonly message: string
  readonly hint?: string | undefined
  readonly file?: string | undefined
  readonly locale?: string | undefined
  readonly key?: string | undefined
  readonly span?: Span | undefined
  readonly related?: readonly Related[] | undefined
  readonly fatal?: boolean | undefined
}

export type IntlOptions = Readonly<Record<string, string | number | boolean>>

export interface NumberFormatSpec {
  readonly kind: 'number'
  readonly options: IntlOptions
  // An ICU skeleton's scale, which Intl has no option for, so the generated
  // code multiplies the value by it before formatting. Absent means 1.
  readonly multiplier?: number | undefined
}

export interface DateTimeFormatSpec {
  readonly kind: 'dateTime'
  readonly options: IntlOptions
}

export type FormatSpec = NumberFormatSpec | DateTimeFormatSpec

export type ArgType =
  | { readonly kind: 'stringish' }
  | { readonly kind: 'number' }
  | { readonly kind: 'date' }
  | { readonly kind: 'select'; readonly options: readonly string[] }
  | { readonly kind: 'markup' }

export interface Arg {
  readonly name: string
  readonly type: ArgType
}

export interface PluralBranch {
  readonly keyword: string
  readonly body: readonly Node[]
}

export interface ExactBranch {
  readonly value: number
  readonly body: readonly Node[]
}

export interface SelectBranch {
  readonly option: string
  readonly body: readonly Node[]
}

export type Node =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'arg'; readonly name: string }
  | {
      readonly kind: 'number'
      readonly name: string
      readonly style: string | null
      readonly format: NumberFormatSpec
    }
  | {
      readonly kind: 'dateTime'
      readonly name: string
      readonly form: 'date' | 'time'
      readonly style: string | null
      readonly format: DateTimeFormatSpec
    }
  | { readonly kind: 'pound' }
  | {
      readonly kind: 'plural'
      readonly name: string
      readonly ordinal: boolean
      readonly offset: number
      readonly exact: readonly ExactBranch[]
      readonly branches: readonly PluralBranch[]
    }
  | { readonly kind: 'select'; readonly name: string; readonly branches: readonly SelectBranch[] }
  | { readonly kind: 'markup'; readonly name: string; readonly children: readonly Node[] }

export type FallbackReason = 'missing' | 'blank' | 'invalid'

export type Origin =
  | { readonly status: 'translated' }
  | { readonly status: 'inherited'; readonly from: string }
  | { readonly status: 'fallback'; readonly from: string; readonly reason: FallbackReason }

export interface Body {
  readonly locale: string
  readonly nodes: readonly Node[]
  readonly args: readonly Arg[]
  readonly markupTags: readonly string[]
  // RawCatalog.format of the file this body came from, so a hint can speak that
  // file's syntax under catalogFormat 'auto'.
  readonly format: 'icu' | 'i18next'
}

export interface LocaleOrigin {
  readonly locale: string
  readonly origin: Origin
}

export interface LocaleSpan {
  readonly locale: string
  readonly file: string
  readonly span: Span
}

export interface Message {
  readonly key: string
  readonly id: string
  // Already mangled and filename safe, `_root` for a root-level key.
  readonly namespace: string
  // `messages/${namespace}.js`. M6 and M8 read this field; neither derives it.
  readonly module: string
  // The source locale's kind. Emit coerces every arm to it.
  readonly kind: 'text' | 'markup'
  readonly source: string
  readonly sourceHash: string
  readonly args: readonly Arg[]
  readonly markupTags: readonly string[]
  readonly description: string | null
  readonly placeholders: readonly PlaceholderNote[]
  // Each locale's OWN lowered body, and nothing else. A locale whose key is
  // missing, whose value is blank, or whose value failed to lower has no entry
  // here. Never padded, never back-filled with another locale's nodes.
  readonly bodies: readonly Body[]
  // One entry per declared locale, always. M4 decides every fallback here and
  // M6 emits arm N from bodies[origin.from ?? locale].
  readonly origins: readonly LocaleOrigin[]
  readonly spans: readonly LocaleSpan[]
}

export interface PlaceholderNote {
  readonly name: string
  readonly note: string
}

export interface GroupMember {
  readonly key: string
  readonly id: string
  readonly member: string
}

export interface Group {
  // The config key verbatim.
  readonly name: string
  // The mangled, collision-checked export identifier: `export const errors`.
  readonly id: string
  // The PascalCase base M6 concatenates with 'Key' and 'Args'.
  readonly typeBase: string
  readonly prefix: string
  readonly members: readonly GroupMember[]
}

export interface UsageSite {
  readonly file: string
  readonly line: number
  readonly column: number
  readonly scope: string | null
  readonly snippet: string
}

export interface MessageUsage {
  readonly id: string
  readonly sites: readonly UsageSite[]
}

export interface RawEntry {
  // Post-fold, and prefixed with the namespace segment when `catalogs` carries
  // `{ns}`. This is the key every diagnostic, the meta sidecar and the record
  // print.
  readonly key: string
  // Always ICU MessageFormat. In a file read as i18next, M2 has already
  // converted it; in a file read as ICU it is the catalog text verbatim. M4
  // lowers this directly and never calls toIcu.
  readonly value: string
  readonly span: Span
}

export interface RawCatalog {
  readonly locale: string
  readonly ns: string | null
  readonly file: string
  // The format this one file was read as. Under catalogFormat 'auto' M2
  // classified it from that one file's entries; otherwise it is the configured
  // value. M4 passes it into LowerContext and nobody re-derives it.
  readonly format: 'icu' | 'i18next'
  readonly entries: readonly RawEntry[]
}

export interface CatalogExtra {
  readonly locale: string
  readonly key: string
  readonly file: string
  readonly span: Span
}

export interface MetaEntry {
  readonly key: string
  readonly description: string | null
  readonly placeholders: readonly PlaceholderNote[]
  readonly span: Span
}

export interface CatalogMeta {
  readonly file: string
  readonly entries: readonly MetaEntry[]
}

export interface DiscoveredCatalog {
  readonly locale: string
  readonly ns: string | null
  readonly file: string
}

export interface ScanConfig {
  readonly include: readonly string[]
  readonly exclude: readonly string[]
}

export interface FormatsConfig {
  readonly timeZone: string | null
  readonly number: Readonly<Record<string, IntlOptions>>
  readonly dateTime: Readonly<Record<string, IntlOptions>>
}

// `root` is an absolute POSIX path. Every other path-valued field below is
// POSIX and relative to it, with `{locale}`, `{sourceLocale}` and `{ns}` left
// unsubstituted.
export interface Config {
  readonly root: string
  readonly locales: readonly string[]
  readonly sourceLocale: string
  readonly catalogs: string
  // 'auto' decides per file in M2. 'icu' and 'i18next' force every file.
  readonly catalogFormat: 'auto' | 'icu' | 'i18next'
  readonly i18nextMarkup: 'literal' | 'tags'
  readonly meta: string | false
  readonly outDir: string
  readonly record: string | false
  readonly cookie: string
  readonly augmentLocale: boolean
  readonly groups: Readonly<Record<string, string>>
  readonly identifiers: Readonly<Record<string, string>>
  readonly fallback: 'bcp47' | Readonly<Record<string, readonly string[]>>
  readonly formats: FormatsConfig
  readonly scan: ScanConfig
  readonly severity: Readonly<Partial<Record<RuleName, Severity>>>
}

export interface LoclizrConfig {
  readonly locales?: readonly string[] | undefined
  readonly sourceLocale?: string | undefined
  readonly catalogs?: string | undefined
  readonly catalogFormat?: 'auto' | 'icu' | 'i18next' | undefined
  readonly i18nextMarkup?: 'literal' | 'tags' | undefined
  readonly meta?: string | false | undefined
  readonly outDir?: string | undefined
  readonly record?: string | false | undefined
  readonly cookie?: string | undefined
  readonly augmentLocale?: boolean | undefined
  readonly groups?: Readonly<Record<string, string>> | undefined
  readonly identifiers?: Readonly<Record<string, string>> | undefined
  readonly fallback?: 'bcp47' | Readonly<Record<string, readonly string[]>> | undefined
  readonly formats?:
    | {
        readonly timeZone?: string | undefined
        readonly number?: Readonly<Record<string, IntlOptions>> | undefined
        readonly dateTime?: Readonly<Record<string, IntlOptions>> | undefined
      }
    | undefined
  readonly scan?:
    | {
        readonly include?: readonly string[] | undefined
        readonly exclude?: readonly string[] | undefined
      }
    | undefined
  readonly severity?: Readonly<Partial<Record<RuleName, Severity>>> | undefined
}

export interface Program {
  readonly config: Config
  readonly sourceLocale: string
  readonly locales: readonly string[]
  // Keyed by the source catalog's post-fold, post-prefix key set. A key present
  // only in a target catalog cannot be a Message and lives in `extras`.
  readonly messages: readonly Message[]
  readonly extras: readonly CatalogExtra[]
  readonly groups: readonly Group[]
  readonly usages: readonly MessageUsage[]
  readonly diagnostics: readonly Diagnostic[]
}

export interface EmittedFile {
  readonly path: string
  readonly contents: string
}

export interface EmitResult {
  readonly files: readonly EmittedFile[]
  readonly diagnostics: readonly Diagnostic[]
}

export interface Summary {
  readonly errors: number
  readonly warnings: number
  readonly messages: number
  readonly locales: number
  readonly fellBack: readonly { readonly locale: string; readonly count: number }[]
}

export interface BuildResult {
  readonly ok: boolean
  readonly exitCode: 0 | 1 | 2
  readonly program: Program | null
  readonly diagnostics: readonly Diagnostic[]
  readonly files: readonly EmittedFile[]
  readonly record: ContextRecord | null
  readonly written: readonly string[]
  readonly summary: Summary
}

export type RecordArgType = 'text' | 'number' | 'date' | 'select' | 'markup'

export interface RecordArg {
  readonly name: string
  readonly type: RecordArgType
  readonly options: readonly string[] | null
  readonly note: string | null
}

export interface RecordVariant {
  readonly arg: string
  readonly kind: 'plural' | 'selectordinal' | 'select'
  readonly matches: readonly string[]
}

export interface RecordTranslation {
  readonly locale: string
  readonly status: 'translated' | 'inherited' | 'fallback'
  readonly from: string | null
  readonly reason: FallbackReason | null
}

// No line, column or snippet: a position churns the record on every unrelated
// edit above it. `UsageSite` keeps all five and reaches a caller through
// `BuildResult.program.usages`.
export interface RecordUsage {
  readonly file: string
  readonly scope: string | null
}

export interface RecordMessage {
  readonly key: string
  readonly id: string
  readonly module: string
  readonly kind: 'text' | 'markup'
  readonly source: string
  readonly sourceHash: string
  readonly description: string | null
  readonly args: readonly RecordArg[]
  readonly variants: readonly RecordVariant[]
  readonly markup: readonly string[]
  readonly translations: readonly RecordTranslation[]
  readonly usage: readonly RecordUsage[]
}

export interface ContextRecord {
  readonly schema: 1
  readonly sourceLocale: string
  readonly locales: readonly string[]
  readonly messages: readonly RecordMessage[]
}

// Runtime side. M12 re-exports every type below from `src/index.ts`, which is
// what makes the `LocaleRegistry` augmentation in generated code take effect.

export interface LocaleRegistry {}

export type Locale = LocaleRegistry extends { locale: infer L extends string } ? L : string

export interface MessageOptions {
  readonly locale?: Locale | undefined
}

// The lone optional member makes `EmptyArgs` a weak type, so `f({ x: 1 })` is
// rejected while it still intersects cleanly in a group's dynamic call. Keying it
// by an unexported symbol keeps it out of editor completion and out of reach.
declare const noArguments: unique symbol

export interface EmptyArgs {
  readonly [noArguments]?: never
}

export interface SetLocaleOptions {
  readonly persist?: boolean | undefined
}

export type LocaleListener = () => void

export type LocaleResolver = (options?: MessageOptions | undefined) => string

export interface LocaleSetup {
  readonly locales: readonly string[]
  readonly sourceLocale: string
  readonly cookie: string
}

export interface NegotiateOptions {
  readonly locales: readonly string[]
  readonly sourceLocale: string
  readonly cookie?: string | undefined
}
```

## 16. Module ownership map

Twelve modules inside `packages/loclizr/src`, plus the example app. Every path
belongs to exactly one module. Every cross-module dependency is on a signature
written out in this document.

### The bootstrap commit

Nothing in `src/` exists today except seven scaffold stubs, so "no module edits
another's files" and "everyone starts the same morning" contradict each other on
day one: M4 depends on M3, so M4's owner would have to create `src/icu/index.ts`,
and the integration seat would have to create seven files belonging to seven
other people before lunch. Ownership is therefore **transferred by one commit,
not assumed**.

M1 lands that commit, alone, before anyone else starts. It contains:

- `src/types.ts`, complete, exactly as section 15 prints it.
- `src/diagnostics/index.ts` and `src/util/index.ts`, real, because `RULES` is a
  transcription of section 13 and is M1's work anyway.
- One stub file per module M2 through M12, every file named in the blocks below:
  the nine `src/<module>/index.ts`, `src/cli/index.ts`, and M12's six
  (`src/index.ts`, `src/runtime/define-config.ts`, `src/runtime/store.ts`,
  `src/runtime/abi.ts`, `src/server/index.ts`, `src/react/index.ts`). Each holds
  the **exact signatures printed below** with bodies that
  `throw new Error('not implemented')`. Under `isolatedDeclarations` every export
  needs an explicit return type; a `throw` body satisfies any of them.
- `passWithNoTests: true` in `vitest.config.ts`. Verified in this repo:
  `vitest run src/catalog` with no matching file prints "No test files found"
  and exits 1, so without this every module's stated test command fails until
  its first test exists, and M12's three-directory command passes as soon as any
  one of three has a test.
- `"exclude": ["test/typecheck-fixture"]` in `packages/loclizr/tsconfig.json`.

Ownership transfers on merge of that commit, and M1 never touches those files
again. **After bootstrap, no module edits another module's file, with no
exceptions.** A module that needs a dependency's behaviour in a test writes a
local test double under its own `__fixtures__/`; it never edits the dependency's
source.

Rules of engagement:

- Tests are colocated `*.test.ts` beside the code they test.
- Fixtures live in `<module dir>/__fixtures__/` and are **never shared**. A
  shared catalog fixture is the first place disjointness breaks.
- Every module emits diagnostics at the rule's **default** severity, stamping
  `warn` where that default is `off`, and no module re-levels. M10 alone applies
  `config.severity`, once, over the whole set. The single read of that field
  outside M10 is M5 naming `config.severity['ambiguous-source']` in `LZ3012`'s
  hint (section 10.1), which changes a sentence and not a severity.
- `packages/loclizr/package.json` is frozen. No module adds a dependency. The
  freeze is scoped to that one file; `examples/vite-react/package.json` belongs
  to M13.
- `packages/loclizr/vitest.config.ts`, `tsdown.config.ts` and `tsconfig.json`
  belong to M10 and are frozen for everyone else after the bootstrap commit's
  two changes above.
- The scaffold stubs that exist today (`src/index.ts`, `src/runtime/locale.ts`,
  `src/runtime/locale.test.ts`, `src/react/index.ts`, `src/server/index.ts`,
  `src/compiler/index.ts`, `src/cli/bin.ts`) are owned and replaced by the module
  that owns their path below.

| Module | Paths | Depends on | Test command |
| --- | --- | --- | --- |
| M1 contracts | `src/types.ts`, `src/types.test.ts`, `src/diagnostics/**`, `src/util/**` | none | `pnpm --filter loclizr exec vitest run src/types.test.ts src/diagnostics src/util` |
| M2 catalog | `src/catalog/**` | M1 | `pnpm --filter loclizr exec vitest run src/catalog` |
| M3 icu | `src/icu/**` | M1 | `pnpm --filter loclizr exec vitest run src/icu` |
| M4 analyze | `src/analyze/**` | M1, M3 | `pnpm --filter loclizr exec vitest run src/analyze` |
| M5 check | `src/check/**` | M1, M3 | `pnpm --filter loclizr exec vitest run src/check` |
| M6 emit | `src/emit/**`, `test/typecheck-fixture/**` | M1 | `pnpm --filter loclizr exec vitest run src/emit && pnpm --filter loclizr build && pnpm --filter loclizr exec tsc -p test/typecheck-fixture/tsconfig.json` |
| M7 scan | `src/scan/**` | M1 | `pnpm --filter loclizr exec vitest run src/scan` |
| M8 record | `src/record/**` | M1 | `pnpm --filter loclizr exec vitest run src/record` |
| M9 config | `src/config/**` | M1 | `pnpm --filter loclizr exec vitest run src/config` |
| M10 compiler | `src/compiler/**`, `vitest.config.ts`, `tsdown.config.ts`, `tsconfig.json` | M1 through M9 | `pnpm --filter loclizr exec vitest run src/compiler` |
| M11 cli | `src/cli/**` | M1, M10 | `pnpm --filter loclizr exec vitest run src/cli` |
| M12 runtime | `src/index.ts`, `src/runtime/**`, `src/react/**`, `src/server/**` | M1 (types only) | `pnpm --filter loclizr exec vitest run src/runtime src/react src/server` |
| M13 example | `examples/vite-react/**` | the published entries only | `pnpm --filter vite-react-example build` |

Package entry ownership, stated explicitly:

| Entry | File | Owner |
| --- | --- | --- |
| `loclizr` | `src/index.ts` | M12 |
| `loclizr/react` | `src/react/index.ts` | M12 |
| `loclizr/server` | `src/server/index.ts` | M12 |
| `loclizr/compiler` | `src/compiler/index.ts` | M10 |
| bin `loclizr` | `src/cli/bin.ts` | M11 |

Start order: M1's bootstrap commit lands first and alone. Every other module
starts the morning after it merges, against the throwing stubs it created, and
nobody waits on anybody's implementation because every signature is printed
here. M10 is the integration seat. M13 is the one module that cannot start on
day one: its test command needs `pnpm --filter loclizr build` to have produced a
working `loclizr` binary first.

### M1, contracts and diagnostics

Owns `src/types.ts` exactly as printed in section 15, including the runtime
types at the end of that file, plus:

```ts
// src/diagnostics/index.ts
import type { Config, Diagnostic, DiagnosticFields, Rule, RuleName, Summary } from '../types'

export declare const RULES: Readonly<Record<RuleName, Rule>>
export declare function diag(rule: RuleName, fields: DiagnosticFields): Diagnostic
export declare function applySeverity(
  diagnostics: readonly Diagnostic[],
  overrides: Config['severity'],
): readonly Diagnostic[]
export declare function sortDiagnostics(diagnostics: readonly Diagnostic[]): readonly Diagnostic[]
export declare function hasError(diagnostics: readonly Diagnostic[]): boolean
export declare function hasFatal(diagnostics: readonly Diagnostic[]): boolean
export declare function exitCodeFor(diagnostics: readonly Diagnostic[], maxWarnings: number): 0 | 1 | 2
export declare function renderHuman(
  diagnostics: readonly Diagnostic[],
  options: { readonly color: boolean },
): string
export declare function renderJson(diagnostics: readonly Diagnostic[], summary: Summary): string
```

```ts
// src/util/index.ts
export declare function hash16(input: string): string
export declare function stableStringify(value: unknown): string
export declare function compareCodepoint(a: string, b: string): number
export declare function toPosix(path: string): string
export declare function escapeIcuLiteral(
  text: string,
  options?: {
    // True for text landing directly inside a plural or selectordinal branch
    // body, which is the only place the parser unquotes `#`.
    readonly inPlural?: boolean | undefined
    // 'tags' takes `<` out of the special set, per i18nextMarkup.
    readonly markup?: 'literal' | 'tags' | undefined
  },
): string
export declare function requiredCategories(locale: string, ordinal: boolean): readonly string[]
```

`RULES` is the table in section 13, transcribed field for field.

`diag` computes `Diagnostic.fatal` from `RULES[rule].fatal`: `'always'` is
`true`, `'never'` and `'message'` are `false` (a message-scoped failure drops
its message and blocks nothing), and `'ifSource'` reads `fields.fatal ?? true`.
Only M2 passes `fields.fatal`, because only M2 knows whether the file it failed
on is the source catalog, and it passes `false` for a target catalog. The
default is `true` so that a forgotten field blocks the build rather than letting
it emit against a source catalog it could not read. `hasFatal` is
`d.fatal && d.severity === 'error'`.

`applySeverity` resolves each diagnostic's effective severity as
`overrides[rule] ?? RULES[rule].severity`, drops it when that is `off` and the
diagnostic is not fatal, rewrites a fatal one asked for `off` to `warn`, and
otherwise rewrites `severity` to it. It never consults the stamped severity, so
a default-`off` rule stays silent without its producing module knowing anything
about configuration. It skips `config-invalid`, `outdir-unsafe` and
`output-unwritable` entirely; `resolveConfig` has already rejected any override
naming one of them.

`exitCodeFor` receives `Number.POSITIVE_INFINITY` when `--max-warnings` is
absent, and treats any negative cap the same way, so `-1` passed through
`build({ maxWarnings })` is no cap rather than a cap of minus one.
`renderHuman` uses `picocolors`, honours `NO_COLOR`, and takes no `root` option
because `Diagnostic.file` is already relative to it.

`stableStringify` sorts object keys by code point and emits standard
`JSON.stringify` output with no whitespace. It is what canonicalizes format
option sets, and `hash16` of its output is what names them, so its exact output
is part of the generated bytes.

`hash16` hashes the same bytes `sourceHash` does: UTF-8, with each unpaired
surrogate as its three-byte WTF-8 sequence, so two sources that differ only in
a lone surrogate never share a hash and every well-formed string hashes as
plain UTF-8.

`escapeIcuLiteral` implements section 2.1 step 1 and lives here because M2 needs
it for conversion and M3 needs it for `printIcu`, and M3 may not import M2.
**Both of its options exist so that there is exactly one implementation of that
step.** `inPlural` is the parser's own rule about `#`, which M3 supplies from
its node walk; `markup` is `i18nextMarkup`, which M2 supplies from the config.
Neither is inferable from `text` alone, so without the parameters M2 would have
to fork the function to express `'tags'` and M3 would have to fork it to avoid
quoting a `#` the parser reads as literal. Both default to the conservative
choice, `inPlural: false` and `markup: 'literal'`, so a one-argument call is
still correct for top-level text.
`requiredCategories` is
`new Intl.PluralRules(locale, { type }).resolvedOptions().pluralCategories`, or
`[]` (unknown) when `Intl.PluralRules.supportedLocalesOf(locale)` is empty, and
lives here for the same reason: M2's suffix folding and M5's checks both call
it, and neither may import the other.

### M2, catalog

```ts
// src/catalog/index.ts
import type {
  CatalogMeta, Config, Diagnostic, RawCatalog, RawEntry, Span,
} from '../types'

export interface CatalogReadResult {
  readonly catalogs: readonly RawCatalog[]
  readonly meta: CatalogMeta | null
  readonly diagnostics: readonly Diagnostic[]
}

export declare function readCatalogs(config: Config): Promise<CatalogReadResult>

export declare function parseJsonWithSpans(
  text: string,
  file: string,
): {
  readonly value: unknown
  readonly spans: ReadonlyMap<string, Span>
  readonly duplicates: readonly string[]
  readonly diagnostics: readonly Diagnostic[]
}

export declare function flatten(input: {
  readonly value: unknown
  readonly file: string
  readonly locale: string
  readonly ns: string | null
  readonly spans: ReadonlyMap<string, Span>
}): { readonly entries: readonly RawEntry[]; readonly diagnostics: readonly Diagnostic[] }

export declare function toIcu(
  value: string,
  context: {
    readonly key: string
    readonly locale: string
    readonly file: string
    readonly span: Span
    readonly markup: 'literal' | 'tags'
  },
): { readonly icu: string; readonly diagnostics: readonly Diagnostic[] }

export declare function foldPluralSuffixes(
  entries: readonly RawEntry[],
  locale: string,
  file: string,
): { readonly entries: readonly RawEntry[]; readonly diagnostics: readonly Diagnostic[] }

export declare function classifyFormat(entries: readonly RawEntry[]): {
  readonly format: 'icu' | 'i18next'
  // The first `{{` value or CLDR-suffixed key that decided 'i18next', verbatim,
  // for LZ1020's hint. Null when the file classified as ICU.
  readonly because: string | null
}
```

`parseJsonWithSpans` is a hand-rolled JSON scanner, not `JSON.parse`, because
positions and duplicate-key detection both need the token stream. It records
every leaf path, so `duplicates` covers both a key written twice in one object
and a dotted key beside a nested one that end in the same message string, and
it caps nesting at 256 levels, reporting `LZ1009` with a span rather than
letting a `RangeError` escape. It takes no locale, so `readCatalogs` re-stamps
`fatal` on its `LZ1009` from the locale it is reading. `flatten` prefixes every
key with `ns` when it is not null and keeps the last value of a collision. A
file that does not exist is skipped with no diagnostic, because that is M9's
`LZ1005`; any other read failure is `LZ1008`. The meta sidecar follows section
2.2: absent is `meta: null` and silent, unreadable or malformed is `LZ1008` or
`LZ1009` with `fatal: false`, and wrong shapes are `LZ1010`. `toIcu`
implements section 2.1
steps 1 through 3 using M1's `escapeIcuLiteral`, passing `context.markup`
straight through as that call's `markup` option so `i18nextMarkup: 'tags'` needs
no second implementation of step 1, and `foldPluralSuffixes` does step 4 using
M1's `requiredCategories`. `toIcu` passes no `inPlural`: it runs before any
parse, so there is no plural body to be inside yet, and the `#` in an i18next
value is always literal text. `readCatalogs` returns one `RawCatalog`
per matched **file**, so a `{ns}` pattern yields several per locale.

**M2 decides each file's format and records it on `RawCatalog.format`.** Under
`catalogFormat: 'auto'`, `readCatalogs` runs `classifyFormat` over the file's
**flattened** entries, after `flatten` and before `toIcu` or
`foldPluralSuffixes`, so both of those run only on a file classified as
i18next. Under an explicit `'icu'` or `'i18next'`, `classifyFormat` is not
called and the configured value is stamped on every catalog. `classifyFormat` is
pure and takes only the entries, which is what makes section 2's rule unit
testable: a `{{` outside a typed ICU argument run in any value, or a key that
belongs to an `X_other`-plus-sibling group, means i18next; otherwise ICU. A lone
`X_other` never decides the format even though `foldPluralSuffixes` folds it in
a file read as i18next (section 2).

Section 2.1 and `LZ1012` through `LZ1014`, `LZ1016` and `LZ1017` therefore apply
to a file read as i18next and to no other. `readCatalogs` raises `LZ1020` per
entry of every file read as i18next whose value holds a single-brace run shaped
like a typed ICU argument. Under `'auto'` the hint carries `because`; under
`catalogFormat: 'i18next'` `because` is null and the hint names the setting
instead.

`RawEntry.value` is always ICU: M2 has converted it before anyone downstream
sees it, and M4, which does not depend on M2, never calls `toIcu` itself.

Raises LZ1008 through LZ1017 and LZ1020, and is the only module that passes
`fields.fatal` to `diag`, for LZ1008 and LZ1009 when the file is the source
catalog.

### M3, icu

```ts
// src/icu/index.ts
import type { Arg, ArgType, Diagnostic, FormatsConfig, IntlOptions, Node, Span } from '../types'

export interface LowerContext {
  readonly key: string
  readonly locale: string
  readonly file: string
  readonly span: Span
  // The format the entry's own file was read as: RawCatalog.format, passed
  // through by M4. Never re-derived here.
  readonly catalogFormat: 'i18next' | 'icu'
  readonly formats: FormatsConfig
}

export interface LowerResult {
  readonly nodes: readonly Node[]
  readonly args: readonly Arg[]
  readonly markupTags: readonly string[]
  readonly kind: 'text' | 'markup'
  readonly normalized: string
  readonly diagnostics: readonly Diagnostic[]
}

export declare function lower(icu: string, context: LowerContext): LowerResult
export declare function unify(a: ArgType, b: ArgType): ArgType | null
export declare function printIcu(nodes: readonly Node[]): string

export declare const NAMED_NUMBER_STYLES: Readonly<Record<string, IntlOptions>>
export declare const NAMED_DATE_STYLES: Readonly<Record<string, IntlOptions>>
export declare const NAMED_TIME_STYLES: Readonly<Record<string, IntlOptions>>
```

`LowerContext` carries `catalogFormat`, because `LZ2001`'s span composition
differs between the two (section 13), and `formats.timeZone` reaches it through
`FormatsConfig`. It is the **file's** format from `RawCatalog.format`, so under
`catalogFormat: 'auto'` two locales of one project can reach `lower` with
different values in the same run.

`lower` never throws. On a failed parse it returns `nodes: []` with a diagnostic
whose rule is message-scoped fatal, so M4 drops that message when the failure is
in the source locale and falls the locale through the chain with reason
`invalid` otherwise. A skeleton-shaped failure is not that case: it is retried
with `shouldParseSkeletons: false` and each `::` style probed on its own, so
`LZ2003` lowers the rest of the message (section 5.2). It deduplicates `args`
by NFC-normalized name, folding each repeat through `unify` and raising
`LZ2009` where that returns null, and it orders `args` by first appearance in
the canonical branch order rather than the text order (section 5.1). It merges
adjacent text nodes. It never calls `requiredCategories`: `LZ2006` tests the
universal CLDR keyword set, and every locale-specific category rule is M5's.

The span `LZ2001` and every body-scoped diagnostic carry for a file read as
ICU is `context.span` offset by the parser's position, but only when every
character before the error point is one a JSON string holds verbatim. A
control character, `"` or `\` before it is more bytes on disk than in the
decoded value, so the offset would land on a line the value does not occupy;
the diagnostic then carries `context.span` verbatim, as a converted file
always does. A `\uXXXX` escape of an ordinary character, or a lone surrogate,
cannot be detected from the decoded value and still drifts.

`printIcu` emits **re-parseable** ICU in the exact canonical form of section
5.5, applying `escapeIcuLiteral` to every text node and passing `inPlural` from
its own walk, which already tracks whether it is inside a plural or
selectordinal branch body. It passes no `markup`, because it prints markup nodes
as real tags and any `<` surviving in a text node is literal. `normalized` is
`printIcu(nodes)` and is what the record and `ambiguous-source` compare, so M3
carries a round-trip property test over every fixture:
`lower(printIcu(lower(x).nodes))` is node-equal to `lower(x)`.

Implements sections 5.1 through 5.5. Raises LZ2001 through LZ2009.

### M4, analyze

```ts
// src/analyze/index.ts
import type { CatalogMeta, Config, Program, RawCatalog } from '../types'

export declare function analyze(input: {
  readonly config: Config
  readonly catalogs: readonly RawCatalog[]
  readonly meta: CatalogMeta | null
}): Program

export declare function mangle(key: string, overrides: Readonly<Record<string, string>>): string
export declare function namespaceOf(key: string): string
export declare function pascalCase(mangled: string): string
export declare function fallbackChain(locale: string, config: Config): readonly string[]
export declare function confusableSkeleton(value: string): string
```

`analyze` produces a `Program` with `usages: []`; M10 fills usages from M7 and
hands the completed `Program` to M6 and M8. It groups the catalogs it receives
by locale, since a `{ns}` pattern gives several per locale. It calls M3's
`lower` once per message per locale, passing that catalog's own
`RawCatalog.format` as `LowerContext.catalogFormat`, and keeps every result as a
`Body`, so `Body.args` and `Body.markupTags` survive for M5 to compare.

**M4 is the only module that decides a fallback, and `Message.origins` is where
it says so** (section 5). `Message.bodies` gets one `Body` per locale that had a
lowerable value of its own and nothing more: a locale whose key is missing,
whose value is blank, or whose value failed to lower contributes no `Body` at
all, and M4 never copies another locale's nodes into the gap. `origins` then
carries one entry per **declared** locale, always, naming which locale's body
that arm renders.

Three cases produce a `fallback` origin, and M4 resolves all three:

- `reason: 'missing'`, the locale has no value for this key anywhere in its
  chain;
- `reason: 'blank'`, the value is empty or whitespace only;
- `reason: 'invalid'`, the locale's value failed to lower, **or** it lowered but
  references a name absent from `Message.args`, per section 5.1.

That last case is the only one where the locale keeps its `Body`: the body
exists and M5 needs its `args` to raise `LZ3005`, but nothing may render it, so
the origin points at the source locale. M6 then prints the source body by the
ordinary rule and makes no decision of its own, and M8 transcribes the same
origin into `RecordTranslation`, so the emitted arm, the record and
`Summary.fellBack` cannot disagree about what a user will see.

`Program.messages` is keyed by the **source** catalog's post-fold key set. A key
present only in a target catalog has no source body, so no `source`, no
`sourceHash`, no `id` and no `namespace`; it cannot be a `Message` at all. M4
puts it in `Program.extras`, which it can do for free because it already holds
every catalog, and M5 raises `LZ3003` from there.

It resolves fallback chains, assigns identifiers, namespaces and `module`,
builds groups with all three of `name`, `id` and `typeBase`, and computes
`Message.args` per section 5.1. Raises LZ4001 through LZ4004, LZ4006 and LZ4007. It does
not run cross-locale checks; that is M5.

### M5, check

```ts
// src/check/index.ts
import type { Diagnostic, Program } from '../types'

export declare function runChecks(program: Program): readonly Diagnostic[]
```

Pure, synchronous, no filesystem, and it never re-parses: every cross-locale
comparison reads `Message.bodies[].args`, `Message.bodies[].markupTags`,
`Message.origins`, `Message.spans` and `Program.extras`, all of which M4 already
filled. It calls M3's `unify` to detect `LZ3006` and M1's `requiredCategories`
for `LZ3007` and `LZ3013`. `LZ3001` for a key absent from a target catalog has
no entry in `Message.spans`, so its `file` is `config.catalogs` with
`{locale}` substituted and `{ns}` replaced by the key's first segment,
which it can do because section 3 fixes what that pattern is relative to and
section 2 fixes every key of a split catalog as `<ns>.<rest>`. `LZ3008` and
`LZ3009` read the source's reachable option set from the `select` `ArgType` in
`comparison.source.args`, already deduplicated through `unify`, and the
target's from the union of every `select` node on that name in the target
body, because a second target `select` on one name renders branches the
target's own arg-level dedup would hide.

It reads exactly four fields of `Config`, each of them for a string it has to
print: `config.catalogs` for `LZ3001`'s `file`, `config.meta` for the path
`LZ3012`'s fix line tells the user to edit, `config.formats.timeZone` to gate
`LZ3011`, and `config.severity['ambiguous-source']` to pick the `or` pair in
`LZ3012`'s hint (section 10.1). It stamps every diagnostic at the rule's default
severity and re-levels nothing. The source locale comes from
`Program.sourceLocale`, not from the config. Every message or hint that spells
an argument or a plural fix reads `Body.format` and spells it in that file's
syntax, so under `catalogFormat: 'auto'` an i18next file is told `{{count}}`
where an ICU file is told `{count}`.

`Message.bodies` is sparse by design (section 5), so every comparison here
iterates `bodies` rather than `locales` and a locale with no entry is simply not
compared; `Message.origins` already says why it has none. A locale whose origin
M4 stamped `fallback` / `invalid` **for an unknown argument** does still have a
`Body`, and `LZ3005 arg-extra` is raised from its `Body.args` exactly as before.
M5 raises no additional diagnostic for the fallback itself, because `LZ3001` and
`LZ3002` cover the reasons that carry one and M3 already reported a lowering
failure against that locale's own file.

Raises LZ3001 through LZ3014.

### M6, emit

```ts
// src/emit/index.ts
import type { EmitResult, Program } from '../types'

export declare function emit(program: Program): EmitResult
export declare function reverseForReplay(program: Program): Program
```

Returns every file in section 7.1 as `{ path, contents }` with `path` relative
to `config.outDir`, POSIX separators, **including the self-ignoring
`.gitignore`**, which is an `EmittedFile` like any other so that nothing in the
layout has two authors, and including `messages/_formats.js` and its `.d.ts`
even when they hold only their leading comment lines. Every file except that
`.gitignore` starts with the generated header of section 7.1 as line 1, `.d.ts`
files included, because M10's prune keys on it, and every `.js` carries
`// @ts-nocheck` as line 2. A group holding a markup member prints the
generic tier of section 7.4; an argument name outside `LZ2007`'s predicate is
reached by subscript (section 7.2).

**M6 makes no fallback decision.** It emits arm *N* from
`bodies[origin.from ?? locale]`, where a `translated` origin carries no `from`
and reads the locale's own body, and it never inspects `bodies` for a missing
entry: M4 guarantees the body an origin names exists. One arm per **distinct
body** is still the output shape, so locales resolving to one body share a
`case` (section 7.6). What stays M6's is **coercion**: an arm whose body is a
different `kind` from `Message.kind` is coerced to the message's kind, per
section 5.4, because only emit knows what shape it is about to print.

`reverseForReplay` reverses exactly the arrays section 7.5 names and nothing
else, so that set is one list in code rather than a recursive walk. `emit` calls
it, re-emits, byte-compares, and raises LZ4005 itself; no other module
participates in that check. Sorts everything per section 7.5.

It also owns `test/typecheck-fixture/`: a small app importing the section 7.6
declarations, plus a negative file of `@ts-expect-error` lines, with its own
`tsconfig.json`. That directory sits outside `src` and is excluded from the
package `tsconfig.json`, because the fixture's
`declare module 'loclizr' { interface LocaleRegistry { locale: AppLocale } }`
would otherwise join the package's own program and narrow `Locale` to a
three-member union everywhere, breaking `src/runtime/store.ts`, whose
`getLocale(): Locale` returns a computed string. The fixture resolves `'loclizr'`
by package self-reference through `exports`, so it needs `dist/index.d.ts` to
exist, which is why its command runs after a build.

### M7, scan

```ts
// src/scan/index.ts
import type { Config, Diagnostic, MessageUsage, UsageSite } from '../types'

export interface ScanResult {
  readonly usages: readonly MessageUsage[]
  readonly diagnostics: readonly Diagnostic[]
}

export interface ScanGroup {
  readonly id: string
  readonly memberIds: readonly string[]
  readonly memberProps: Readonly<Record<string, string>>
}

export declare function scan(input: {
  readonly config: Config
  readonly ids: readonly string[]
  readonly groups: readonly ScanGroup[]
}): Promise<ScanResult>

export declare function scanFile(input: {
  readonly text: string
  readonly file: string
  readonly outDir: string
  readonly ids: ReadonlySet<string>
  readonly groups: readonly ScanGroup[]
}): readonly (UsageSite & { readonly id: string })[]
```

Implements section 12. Group **membership** is the parameter, not a list of
group ids, because a `MessageUsage.id` is a message id and there is no other way
to attribute `errors[code]` to anything. A computed access on a bound group
records a usage against every `memberId`; a static member access records it
against the one id `memberProps` maps that property to.

**Pass one binds a specifier by suffix**, per section 12: strip any extension,
then bind when the remainder ends with `<basename(outDir)>/messages`,
`<basename(outDir)>/groups` or `<basename(outDir)>/messages/<ns>`, whatever the
prefix. `scanFile` already receives `outDir` and needs nothing more, so no
signature changes and no `tsconfig.json` is ever read. Named test:
`import * as m from '@/loclizr/messages'` followed by `m.nav_home()` yields the
usage, alongside the `~/`, `../../` and bare-relative forms.

Raises LZ5004 and LZ5005. `ScanResult.usages` holds one `MessageUsage` per id
with at least one site and omits the rest, so M8 reads an absent id as
`usage: []`. `scanFile` is synchronous and pure so it can be unit tested
against string literals with no filesystem, and its tests include a `.tsx`
fixture with an apostrophe in JSX text above a usage.

### M8, record

```ts
// src/record/index.ts
import type { ContextRecord, Diagnostic, Program } from '../types'

export declare function buildRecord(program: Program): ContextRecord
export declare function serializeRecord(record: ContextRecord): string
export declare function checkDescriptions(program: Program): readonly Diagnostic[]
```

Implements section 14. It reads `Message.module` and `Message.args` rather than
deriving either, which is what keeps the record and the emitted tree from
drifting apart. **`RecordTranslation` is a transcription of `Message.origins`**,
one entry per declared locale, with `status`, `from` and `reason` copied across:
M8 makes no fallback decision and never consults `Message.bodies` to infer one,
so the record's coverage and the emitted arms come from the same array
(section 5).

`serializeRecord` produces the exact bytes written to disk, including the
trailing newline, and M10 byte-compares those bytes to decide whether to
**write**. The `LZ5003` and `LZ5007` **rules** are a different comparison, over
the projection in section 13, and M10 owns it; M8's signatures are unchanged by
it. A `RecordArg.note` is looked up by the argument's NFC name, with the
tie-break of section 2.2 when two sidecar spellings land on one argument, so
the winner never depends on `Message.placeholders` order, which the replay
reverses. Raises LZ5006, and LZ1022 for each note no argument matches, sorted
by note name within each message.

### M9, config

```ts
// src/config/index.ts
import type { Config, Diagnostic, DiscoveredCatalog, LoclizrConfig } from '../types'

export interface LoadConfigResult {
  readonly config: Config | null
  readonly diagnostics: readonly Diagnostic[]
}

export declare function loadConfig(input: {
  readonly cwd: string
  readonly configPath?: string | undefined
}): Promise<LoadConfigResult>

export declare function discoverCatalogs(
  root: string,
  pattern: string,
): Promise<readonly DiscoveredCatalog[]>

export declare function resolveConfig(input: {
  readonly user: LoclizrConfig
  readonly root: string
  readonly discovered: readonly DiscoveredCatalog[]
}): LoadConfigResult

export declare const CONFIG_FILENAMES: readonly [
  'loclizr.config.ts',
  'loclizr.config.mts',
  'loclizr.config.js',
  'loclizr.config.mjs',
]
```

Owns `jiti`. Implements section 3. Raises LZ1001 through LZ1007 and LZ1018.

`discoverCatalogs` expands `{locale}` and `{ns}` per section 3 and returns what
the pattern matched; its signature carries neither the config nor a
diagnostics channel, so the exclusion of the resolved `meta` and `record` paths
and the `LZ1006` skip of a discovered basename that `Intl.getCanonicalLocales`
rejects both live in `resolveConfig`, which receives the discovered list and
already knows both paths. The pattern layer still refuses `en.meta.json` and
`loclizr.context.json` on its own, because `{locale}` never crosses a dot, so
the belt holds at both layers. The `LZ1006` skip of a discovered file that
parses to a context record lives in `loadConfig`, because it reads the file and
`resolveConfig` touches no filesystem; `loadConfig` passes `resolveConfig` the
discovered list without those files and reports each one once the resolved
`record` path is known. `resolveConfig` is pure and takes the
already-discovered catalog list, so it is unit testable with no filesystem. It
normalizes every path-valued field to POSIX relative to `root`, checks
`LZ1007` on the resolved absolute form, applies every field check section 3
names, and rejects a `severity` entry naming `config-invalid`, `outdir-unsafe`
or `output-unwritable` with `LZ1001`.

### M10, compiler

```ts
// src/compiler/index.ts
import type { BuildResult } from '../types'

export interface BuildOptions {
  readonly cwd?: string | undefined
  readonly configPath?: string | undefined
  readonly emit?: boolean | undefined
  readonly maxWarnings?: number | undefined
  // Default true. False is `build --no-fail`: diagnostics are unchanged and a
  // run that reached the write step reports exit 0. `check` ignores it.
  readonly failOnError?: boolean | undefined
}

export declare function build(options?: BuildOptions): Promise<BuildResult>
export declare function check(options?: BuildOptions): Promise<BuildResult>

export type {
  BuildResult, ContextRecord, Diagnostic, EmittedFile, Program, Summary,
} from '../types'
```

`maxWarnings` absent means no cap, and so does any negative value, the
programmatic spelling of `--max-warnings=-1`: `build` and `check` pass
`Number.POSITIVE_INFINITY` to `exitCodeFor` in both cases.

The type re-export is not decoration. This entry exists so a programmatic
consumer can call `build()`, and without it that consumer cannot name the return
type or write a function taking a `Diagnostic`. It is M10 re-exporting M1's
types, exactly as M12 already does for the runtime half, so it moves no file
ownership.

This is the `loclizr/compiler` entry and the integration seat. It is the only
module that touches the filesystem for **output**, the only one that **applies**
`config.severity`, and the only one that decides the exit code. M5 reads one key
of that field to name it in `LZ3012`'s hint (section 10.1) and re-levels
nothing, so `applySeverity` here stays the single point where severity is
decided. Sequence:

0. Probe `Intl` once and raise `LZ1019` if the build machine's ICU data is
   truncated, which also forces `LZ3007` and `LZ3013` to `off` for this run,
   over any `severity` entry the user wrote for them. A declared locale that
   `Intl` has no plural data for, answering with the build machine's own rules,
   is the same code per locale and silences the two category rules for that
   locale alone.
1. `loadConfig` (M9). A fatal diagnostic stops here, and the exit code is
   `exitCodeFor`'s: 2 for `LZ1001` and `LZ1007`, which carry `exitTwo`, and 1
   for `LZ1002`, `LZ1003` and `LZ1004`, which do not (section 10).
2. `readCatalogs` (M2). A fatal diagnostic that survives, an unreadable or
   malformed source catalog, stops here too: analyzing with no source catalog
   would turn every target key into an extra and bury the real error under
   `LZ3003` noise.
3. `analyze` (M4).
4. `runChecks` (M5) and `checkDescriptions` (M8).
5. `scan` (M7), passing group membership from `Program.groups`.
6. `emit` (M6), producing files and the determinism verdict, **unless** an
   `always` fatality is already in hand, in which case emit and its replay are
   skipped and `BuildResult.files` is empty (section 9). Fatality after
   analyze otherwise never halts: emit still runs and only the write is
   skipped.
7. `buildRecord` and `serializeRecord` (M8). The record path has
   `{sourceLocale}` substituted here.
8. `applySeverity` over every diagnostic collected, then `exitCodeFor`.
9. If nothing fatal survives and `emit !== false`, write. Writes are
   write-if-changed and atomic through a temporary file plus rename; the
   temporary is `<target>.loclizr<pid36><seq36>.tmp` and the prune skips that
   suffix, so two overlapping builds (`predev` plus `nodemon -w locales` is a
   supported pattern) cannot unlink each other's in-flight file and fail the
   rename with `LZ5001`. The cost is that a crashed build's leftover `.tmp` is
   never pruned and never reported; it sits inside the gitignored `outDir` and
   is harmless. A path already occupied by a file that does **not** carry the generated header, or by a symlink, is not written: the write is skipped and
   `LZ1021 outdir-foreign-file` names it. The `.gitignore` M6 emitted is
   written **only when `outDir` did not exist before this step began** and is
   excluded from both the changed comparison and `LZ5002`. Then prune: delete
   every regular file under `outDir` that **carries the generated header** and
   that this emit
   did not produce, excluding that `.gitignore`; a headerless file is left
   alone and reported as `LZ1021`, an orphan that will not delete is `LZ1021`
   too, and the prune neither reads, deletes nor reports a symlink (section 7.1). The
   record is compared against what is on disk before it is written, and a
   difference under the section 13 projection is `LZ5007`; with no committed
   record there is nothing to rewrite and nothing is raised. `build` writes
   over a committed file only when it parses (a leading byte order mark is
   allowed) to an object with `schema: 1`, or when it carries merge conflict markers and still has a line holding only the `"schema": 1` key, which is how a conflicted record heals under `LZ5007`; that match is textual, because conflicted text does not parse. Any other
   file at the record path, a catalog, a tsconfig, a source file, is not
   written over: the write is skipped and `LZ5001` names it. `emit: false`
   skips this whole step in both modes, so `check` with `emit: false` runs no
   on-disk comparison.
10. Resolve the exit code. `exitCodeFor` gives the ordinary answer; when
    `failOnError` is false and step 9 ran, a 1 becomes a 0. A 2 is never
    lowered, and a 1 from a run that emitted nothing is never lowered.

`BuildResult.ok` is "no error-severity diagnostic survived",
`!hasError(diagnostics)`, and is independent of `failOnError`; `exitCode` is
the flag-sensitive contract. `BuildResult.written` carries POSIX paths relative
to `Config.root`, not to `outDir`, because it also names the record, which
lives outside `outDir`.

Raises LZ1019, LZ1021 and LZ5001 through LZ5003 and LZ5007. Under `check`, step
9 compares instead of writing, reports a **headered** file emit did not produce
as `LZ5002` with reason `orphaned`, reports a headerless one as `LZ1021` exactly
as `build` does, raises no `LZ5002` for an emitted file missing from disk
(section 7.1), and reports a record that is absent or differs under the
projection as `LZ5003`, because the record is specified as committed and the
gate's job is to say so. `check` ignores `failOnError`.

**The record gate's comparison lives here.** `serializeRecord` gives the bytes
to write and the byte comparison decides *whether to write*. `LZ5003` and
`LZ5007` are decided separately: parse the committed record, drop every
message's `usage` and `translations` from both it and the fresh one, compare
what is left. A committed record that fails to parse counts as differing:
under `check` that is `LZ5003`, and under `build` only a record carrying merge
conflict markers takes the `LZ5007` rewrite (step 9). The
projection is M10's own, inline, and adds nothing to M8's signatures.

Integration assertions that belong here and nowhere else, because this is the
one place every half of the build is in hand at once.

- Every `RecordMessage.module` appears in `EmitResult.files`, the cheapest guard
  on the record naming a file emit did not write.
- **`fallback-seam`**: three locales, `en` (source), `de`, `de-AT`, and three
  keys. `de-AT` is missing key one, which `de` has. `de` has a blank value for
  key two. `de` references an unknown argument on key three. Assert, exactly:
  key one's `de-AT` arm renders `de`'s body with origin `inherited` from `de`
  and no diagnostic; key two's `de` arm renders the source body with origin
  `fallback` from `en` reason `blank`, one `LZ3002`, and `de-AT` inherits that
  same resolution; key three's `de` arm renders the source body with origin
  `fallback` from `en` reason `invalid` and exactly one `LZ3005`. Each
  diagnostic appears **exactly once** across the whole run. The three
  `RecordTranslation.status` values for `de` are `translated`, `fallback`,
  `fallback`, and `Summary.fellBack` is `de: 2`, `de-AT: 2`. A locale whose only
  ancestor itself fell back records its own reason, not the ancestor's: `de-AT`
  has no value of its own on keys two and three, so its reason is `missing`.
- **`prune-keeps-foreign`**: `outDir` contains `keep.ts`, written by the user
  and carrying no generated header. After `build`, `keep.ts` still exists
  byte-identical, the build reports `LZ1021` naming it, and the exit code is
  unchanged by it.

### M11, cli

```ts
// src/cli/index.ts
export declare function run(argv: readonly string[]): Promise<number>
```

`src/cli/bin.ts` is the shebang wrapper that calls `run(process.argv.slice(2))`
and sets `process.exitCode`. Owns `node:util.parseArgs`, the `init` templates and
the printed `package.json` scripts and CI snippet. Implements section 10.

`--no-fail` is parsed here and nowhere else: `run` accepts it on `build` only,
rejects it on `check` as invalid usage (exit 2), and passes
`failOnError: false` into `build`. M11 does not compute exit codes; it forwards
the flag and returns what M10 decided. `--quiet` is likewise M11's alone: it
filters what the human reporter prints (section 10) and reaches neither M10
nor the JSON reporter. The four config discovery filenames, the default `meta`
path, the record's file name and the generated header marker `init` looks for are defined here again
rather than imported,
so M11's dependency edge stays at M1 plus M10. A mistyped `--cwd` is invalid
usage, so the compiler never reports the catalog layout of a directory that
does not exist.

The `init` templates write an **ICU** seed catalog and never emit a
`catalogFormat` line, per section 10, and the `package.json` scripts it prints
are the three in that section: `predev` on `loclizr build --no-fail`,
`prebuild` and `pretypecheck` on `loclizr build`, and no `prepare`. The install
note names a regular dependency (`npm i loclizr`), because the generated
functions import the locale store from `loclizr` at run time, and it names the
config `init` wrote or left unchanged, relative to `--cwd`, so a
`loclizr.config.js` project or a `--config` target is never told about a
`loclizr.config.ts` it does not have.

### M12, runtime and bindings

Imports every shared type from M1's `src/types.ts` and owns no type file of its
own. Its one obligation to the rest of the world is that `src/index.ts`
re-exports the runtime types, because that re-export is what makes the
`LocaleRegistry` augmentation in generated code take effect.

`loclizr/react` and `loclizr/server` likewise re-export every shared type their
signatures name: `Locale` and `SetLocaleOptions` from the first,
`NegotiateOptions` from the second. A consumer built with `declaration: true`
that exports `() => useSetLocale()` has its inferred type named through the
entry it imported, and a type that entry does not export can only be named
through tsdown's content-hashed chunk, which is TS2742 (TS2883 on 7.x). A test
asserts that each runtime entry, in `src` and in `dist` when it exists, exports
every type it imports from `types` or from a shared chunk.

```ts
// src/index.ts
export type {
  EmptyArgs, IntlOptions, Locale, LocaleListener, LocaleRegistry, LocaleResolver,
  LocaleSetup, LoclizrConfig, MessageOptions, NegotiateOptions, SetLocaleOptions,
} from './types'
export { defineConfig } from './runtime/define-config'
export { getLocale, setLocale, subscribe } from './runtime/store'
export { $configure1, $dateTime1, $number1, $plural1 } from './runtime/abi'
```

```ts
// src/runtime/define-config.ts
import type { LoclizrConfig } from '../types'
export declare function defineConfig(config: LoclizrConfig): LoclizrConfig
```

```ts
// src/runtime/store.ts
import type { Locale, LocaleListener, SetLocaleOptions } from '../types'
export declare function getLocale(): Locale
export declare function setLocale(locale: Locale, options?: SetLocaleOptions): void
export declare function subscribe(listener: LocaleListener): () => void
// The first three steps of getLocale's resolution order: active scope, stored
// tag, lazy client detection. No matching, no locale list, no default; the
// empty string when all three miss.
export declare function getRawLocale(): string
export declare function registerDefaults(setup: {
  readonly locales: readonly string[]
  readonly sourceLocale: string
  readonly cookie: string
}): void
export declare function matchLocale(
  requested: string,
  known: readonly string[],
  fallback: string,
): string
```

```ts
// src/runtime/abi.ts
import type { IntlOptions, LocaleResolver, LocaleSetup } from '../types'
export declare function $configure1(setup: LocaleSetup): LocaleResolver
export declare function $plural1(locale: string, value: number, ordinal: boolean): string
export declare function $number1(locale: string, value: number, options: IntlOptions): string
export declare function $dateTime1(locale: string, value: Date | number, options: IntlOptions): string
```

```ts
// src/server/index.ts
import type { NegotiateOptions } from '../types'
export declare function runWithLocale<T>(locale: string, fn: () => T): T
// withLocale sets Content-Language and lists Accept-Language and Cookie in Vary
// on the response.
export declare function withLocale<A extends unknown[]>(
  handler: (request: Request, ...rest: A) => Response | Promise<Response>,
  options: NegotiateOptions,
): (request: Request, ...rest: A) => Promise<Response>
// Bun's fetch handler returns undefined once server.upgrade() has taken the
// socket, and Bun answers the handshake itself.
export declare function withLocale<A extends unknown[]>(
  handler: (request: Request, ...rest: A) => Response | undefined | Promise<Response | undefined>,
  options: NegotiateOptions,
): (request: Request, ...rest: A) => Promise<Response | undefined>
export declare function negotiate(accepted: readonly string[], options: NegotiateOptions): string
export declare function localeFromRequest(request: Request, options: NegotiateOptions): string
// The primitive. localeFromRequest is a thin wrapper that reads the two headers
// off a Fetch Request and calls this, so the two cannot drift.
export declare function localeFromHeaders(
  headers: {
    readonly cookie?: string | undefined
    readonly acceptLanguage?: string | undefined
  },
  options: NegotiateOptions,
): string
```

```ts
// src/react/index.ts
import type { ReactElement, ReactNode } from 'react'
import type { Locale, SetLocaleOptions } from '../types'
export declare function useLocale(): Locale
export declare function useSetLocale(): (locale: Locale, options?: SetLocaleOptions) => void
export declare function Parts(props: { readonly of: readonly (string | ReactNode)[] }): ReactElement
```

`defineConfig` is the identity function and imports `LoclizrConfig` type-only, so
the browser entry stays free of compiler code. It lives in M12 rather than M9
precisely so `src/index.ts` never imports a file another module owns.

Implements sections 6 and 11. Acceptance criteria that belong to this module and
nobody else:

- `dist/index.js` imports nothing from `node:*`. The ALS handle is reached only
  through `globalThis[Symbol.for('loclizr.locale')]`; `node:async_hooks` is
  imported by `src/server/**` alone.
- A gzip ceiling on **`dist/index.js` plus every chunk it transitively
  imports**, when `dist` exists, skipped otherwise. Resolve the entry's relative
  imports, concatenate, gzip, assert. Measuring `dist/index.js` alone would
  pass vacuously no matter how large the runtime grew: `index` and
  `react/index` are entries of one rolldown build and both import
  `src/runtime/store.ts`, so the store is hoisted into a shared chunk and the
  entry is reduced to re-exports. The budget is 900 bytes and it is **not
  met**: the shipped runtime, a store, an RFC 4647 matcher, a cookie reader,
  five warning strings and four ABI helpers, measures about 2420 bytes in the
  shape tsdown ships, and about 1500 minified. The test keeps the 900-byte
  assertion verbatim as an expected failure, so the suite turns red the day
  the budget is met and the number can be tightened, and a second, ordinary
  assertion holds a 2460-byte ceiling so a regression still fails; its message
  prints budget, measured and ceiling together. A green suite here therefore
  says the runtime has not grown, not that the budget is met.
- React tests carry `// @vitest-environment jsdom` as a file docblock, so the
  shared `vitest.config.ts` stays on `node` and is never edited.
- **`getRawLocale` is the store's contract with generated code** (sections 6.2
  and 11.1) and carries two named tests. **`als-scopes-are-isolated`**: two
  interleaved `runWithLocale('de')` and `runWithLocale('en')` scopes, each
  awaiting inside the other's window, each observing its own locale through a
  resolver built by `$configure1`, with no leakage either way.
  **`cookie-without-prior-getLocale`**: with `document.cookie = 'locale=de'` set
  and `getLocale()` never called, a `$configure1` resolver returns `de`, which is
  what proves detection runs in `getRawLocale` rather than being latched by the
  public `getLocale()`. It is latched by `getRawLocale` itself on that first
  read, a miss included (section 11.3).
- `localeFromRequest` is implemented **as** a call to `localeFromHeaders`, and a
  test asserts the two agree on a request carrying both headers, both, and
  neither.

Its one obligation to any other module is keeping `src/index.ts`'s type
re-export list intact, because that re-export is what makes the
`LocaleRegistry` augmentation in generated code take effect. Nothing about the
section 7.6 declarations is M12's to verify; that fixture belongs to M6.

### M13, example

Owns `examples/vite-react/**`: the catalogs under `examples/vite-react/locales/`,
`loclizr.config.ts`, the React source, and the `.gitignore` for its generated
tree. Depends only on the published entries, never on `packages/loclizr/src`.

Delivers a Vite 8 plus React 19 single-page app with three locales
(`en`, `de`, `de-AT`), a working language switcher, and at least one message of
every kind in section 7.6. Acceptance: **after switching language, every visible
string changes, with no reload.** That is the section 8 root pattern,
`<App key={useLocale()} />`, and the example uses it rather than describing it,
with one component carrying the per-call `{ locale: useLocale() }` form so both
patterns are on screen.

`examples/vite-react/package.json` belongs to M13 outright, because no other
module reads it and the three scripts it must gain are not there today. Its
dependency list stays frozen; these three entries are added:

```json
"predev": "loclizr build --no-fail",
"prebuild": "loclizr build",
"pretypecheck": "loclizr build"
```

`predev` carries `--no-fail` for the reason section 10 gives: one untranslated
key must not stop `vite dev`. The two gate hooks do not.

`vite.config.ts`, `index.html` and `tsconfig.json` are also this module's to
change, and `vite.config.ts` carries **the edit loop**: a small inline plugin,
declared in that file, no published package and no new dependency, whose
`configureServer` adds `locales/` to the dev server's watcher and calls `build`
from `loclizr/compiler` when a file under it changes. The compiler rewrites
`src/loclizr/**`, which is inside Vite's own module graph, so HMR picks the
change up with no further help. Editing a catalog then updates the running app.
It reruns the compiler and touches no app source, so section 1's narrowed
promise holds exactly: no plugin is required, and app code is never
transformed. Note the ordering consequence: the root `check` script runs `pnpm build`
before `pnpm typecheck`, which is what makes a `loclizr` binary exist for those
hooks to call, and it is why M13's test command cannot pass on day one. Its
**first commit still can**: the three scripts above, `loclizr.config.ts` and the
three catalogs need no working binary, so the owner has something to land while
the compiler is still stubs.

The example is the proof that the whole thing works, so it is a module with an
owner, not an afterthought at the end.

## 17. What was verified before this spec was frozen

Every claim below was run against this repository's own installed toolchain,
Node 22.22.2, TypeScript 7.0.2 and
`@formatjs/icu-messageformat-parser` 3.5.19. They are stated here so no module
owner has to re-derive them, and so a future change that breaks one is
recognisable as a breaking change.

**Parser behaviour**

- A named style arrives as a bare string: `{d, date, medium}` gives
  `style: 'medium'`. A `::` skeleton arrives resolved: `{d, date, ::yyyyMMdd}`
  gives `parsedOptions: { year: 'numeric', month: '2-digit', day: '2-digit' }`,
  and `{p, number, ::.00 percent}` gives
  `{ minimumFractionDigits: 2, maximumFractionDigits: 2, style: 'percent' }`.
  This is why section 5.2 needs a named-style table.
- A plural node carries `pluralType: 'cardinal' | 'ordinal'` and a numeric
  `offset`, so `selectordinal` is the same node shape.
- `requiresOtherClause: true` throws a `SyntaxError` with
  `kind: 'MISSING_OTHER_CLAUSE'` and a `location`, for both plural and select.
- Nested tags parse: `<a>x<b>y</b></a>` returns one tag node whose children
  include another tag node. Banning nesting would be a choice made by the
  handler type, not a limit of the grammar.
- A stray `#` outside a plural folds into literal text, and `C# rocks` stays one
  literal. There is no reachable pound-outside-plural error.
- **`#` is not universally quotable.** Read out of the parser's
  `tryParseQuote`: it opens a quoted section before `#` **only** when the
  enclosing argument is a plural or a selectordinal. Everywhere else `'#'` is
  three literal characters, so quoting a `#` at the top level both corrupts the
  text and binds its closing apostrophe forward:
  `escapeIcuLiteral('Order #') + '{id}'` under an unconditional rule yields
  `Order '#'{id}`, which parses as one literal and loses the `id` argument.
  This is why section 2.1 step 1's special set is conditional and
  `escapeIcuLiteral` takes `inPlural`.
- `#` inside a select inside a plural is **literal text**, not a pound element:
  `{a, plural, offset:1 other {# and {b, select, x {#} other {#}}}}` returns a
  `PoundElement` for the first and `{type: 0, value: "#"}` for the other two.
  ICU4J and ICU4C render those as the number, so this is a divergence, and
  section 5.3 makes it visible with `LZ2008` rather than silent.
- Escaping is load bearing. Without section 2.1's escape step, `Don''t {{x}}`
  parses to `Don't ` and silently loses an apostrophe, and
  `Set {color} in CSS` invents a required argument named `color`. A lone
  apostrophe not adjacent to `{`, `}`, `#` or another apostrophe is literal to
  the parser, so `Don't panic` survives unescaped. The escape doubles it
  anyway, to `Don''t panic`, which parses back to the same text: doubling every
  apostrophe unconditionally is what keeps the function safe under
  concatenation, where the character that follows decides whether that
  apostrophe opens a quote.
- `<` is in that set for the same reason. `Click <b>here</b> {x}` unescaped
  returns a tag node, so `b` becomes a required argument and the return type
  changes shape; `Line<br>break` is `UNCLOSED_TAG`; `Read <a href="/t">terms</a>`
  is `INVALID_TAG`. Both `'<b>'` and `'<'b'>'` lower to literal text, so the
  escape works.
- **Doubling apostrophes and quoting specials must be one pass, not two.**
  Doubling first and wrapping second prints `{'}` as `'{''''}'`, which
  re-parses as `{''}`, because the parser reads `'''` as an escaped apostrophe
  still inside the quote. Quoting the apostrophes together with the specials
  they sit among prints `'{''}'` and round-trips. The doubling inside a quoted
  run must stay exhaustive: a lone trailing apostrophe left undoubled opens a
  quote that swallows the enclosing plural branch's closing brace.
- **The amended escape is exhaustively verified.** Every string of length 1
  through 4 over the alphabet `a ' { } < #` round-trips through
  `escapeIcuLiteral` and the parser in four positions: at the top level, inside
  a plural branch body, inside a select inside a plural, and concatenated with
  a following `{id}`. Zero failures. The pre-amendment context-free algorithm
  fails 108 of those at the top level alone, which is the evidence behind
  section 2.1 step 1's current form.
- Argument names that reach `LZ2007` at all: `{user.name}`, `{user-name}` and
  `{$}` are `MALFORMED_ARGUMENT` at parse time, while `{9x}`, `{__proto__}`,
  `{constructor}`, `{toString}` and `{ä}` all parse cleanly. That is why section
  13 spells the predicate out.

**Intl behaviour**

- `new Intl.PluralRules(locale, { type }).resolvedOptions().pluralCategories`
  returns the real per-locale set, for example six categories for Arabic
  cardinal and four for English ordinal. No CLDR table is needed.
- `select(0)` returns `other` for German and English, `many` for Russian and
  `zero` only for Arabic and Latvian. Also verified: `PluralRules('lv')` has
  categories `['one','zero','other']` and `.select(10)` and `.select(20)` both
  return `zero`. This is why section 2.1 decides `_zero` per locale rather than
  globally: German keeps `=0` because a `zero` branch would never be selected,
  and Latvian and Arabic keep the keyword because `=0` would drop counts 10, 20
  and 11 through 19 into `other`.
- `Intl.getCanonicalLocales` normalizes `de-at` to `de-AT` and throws
  `RangeError` on a malformed tag, which is how `LZ1002` is implemented. It also
  throws on `'en.meta'` and on `'loclizr.context'`, which is why section 3's
  `{locale}` token never expands to `*` and why discovery excludes the resolved
  `meta` and `record` paths.

**The one claim here that is documented rather than probed**: i18next's own
`_zero` selection. Section 2.1 matches the CLDR-suffix lookup of i18next v21 and
later, taken from its documentation, not from a probe against an installed copy.
It is flagged because everything else on this page was run, and because the
per-locale rule above makes the two behaviours agree wherever the locale has a
`zero` category, so the exposure is narrow.

**JavaScript and bundlers**

- `export { m_new as new }` is legal ESM and works under Node 22, and
  `import { new as brandNew } from './messages.js'` works. Only the unaliased
  `import { new }` is illegal. Reserved words still get the `$` prefix from
  section 7.2, because the aliasing tax is not worth exposing.
- esbuild bundling a module with a retained top-level side-effecting call still
  drops every unused named export from that same module. A side effect does not
  cost per-export dead code elimination.
- Two `const n` in one function scope is
  `SyntaxError: Identifier 'n' has already been declared`, which takes the whole
  module with it. That is why section 7.6 gives each plural selector name its
  own local.
- `export { locales } from './_locale.js'` beside `export * from './_root.js'`
  shadows the star export silently, with no error and no ambiguity warning. That
  is why `LZ4002` reserves the barrel's own export names.
- Canonical JSON sorts `{"currency":"USD","style":"currency"}` before
  `{"dateStyle":"medium"}` before `{}`, because `"` precedes `}`. Naming the
  hoisted format consts by hash rather than by sort position removes the
  question entirely, and removes the renumbering churn that a positional
  ordinal would push into every `outDir` diff.

**This repository**

- `vitest run src/catalog` with no matching test file prints "No test files
  found" and exits 1. `passWithNoTests: true` in the bootstrap commit is what
  keeps every module's stated test command honest before its first test lands.

**TypeScript declaration emit in a consumer**, `tsc --declaration` under
`nodenext` on a module exporting `() => useSetLocale()`, `() => build()` and a
function returning `NegotiateOptions`

- With the subpath type re-exports in M12 and M10, TypeScript 5.4.5, 5.9.3 and
  7.0.2 emit clean and name `import("loclizr/react").SetLocaleOptions`,
  `import("loclizr/compiler").BuildResult` and
  `import("loclizr/server").NegotiateOptions`. Without the react and server
  re-exports, the `useSetLocale` and `NegotiateOptions` exports fail on each of
  those versions with TS2742 (TS2883 on 7.x) naming a `types-*.js` chunk.
- TypeScript 5.0.4 and 5.3.3 fail with TS2742 on all three even with the
  re-exports in place: before 5.4, declaration emit names a type only through
  the file that declares it, and that file is a hashed chunk outside `exports`.
  Declaration emit through a subpath entry therefore needs TypeScript 5.4 or
  later; on 5.0 to 5.3 a consumer annotates the exported function instead.

**TypeScript, against this repo's own `tsconfig.base.json`**

- The `LocaleRegistry` augmentation works, including through the package's type
  re-export (`export type { LocaleRegistry } from './types'` in
  `src/index.ts`), and it
  applies program-wide with no explicit import of the generated declaration.
  With it loaded, `setLocale('sp')` is TS2345 and
  `cart_items({ count: 1 }, { locale: 'sp' })` is TS2322.
- The local alias in the generated barrel must not be named `Locale`. Naming it
  `Locale` inside the file that augments `loclizr` produces TS2456 and TS2502.
  `AppLocale` compiles.
- `exactOptionalPropertyTypes: true` is on and is inherited by
  `examples/vite-react/tsconfig.json`, so `MessageOptions.locale` needs the
  explicit `| undefined`. Without it, an app passing a possibly-undefined locale
  is a type error at its own call site.
- `EmptyArgs` must be `{ readonly [noArguments]?: never }`, keyed by an unexported
  `unique symbol`. `Record<string, never>` makes the lookup tier's dynamic call
  uncallable, because the intersection requires `seconds: never & number`. The
  weak-type form both rejects excess properties on a fresh literal and
  intersects cleanly. A string key such as `$?` does both too, but completion
  inside `f({ })` offers it and accepting it yields `f({ $: undefined })`; a
  `@deprecated` tag only strikes it through. Completion skips a symbol key.
  The cost is identity: two different `loclizr` versions in one program declare
  two symbols, so a value typed with one version's `EmptyArgs`, or a function
  typed with it, is not assignable to the other's. `f()`, `f({})` and a group's
  dynamic call across that boundary still compile; two copies of one version
  resolve to one declaration.
- The lookup tier's mapped type needs `args` **required**. With `args?` optional,
  `errors[k]()` compiles for a dynamic key and crashes at runtime.
- The full set of generated declarations in section 7.6 compiles as printed, and
  these eight calls are all type errors, as intended: `setLocale('sp')`,
  `{ locale: 'sp' }`, `nav_home({ x: 1 })`, `errors[k]({})`, `errors[k]()`,
  `errors.rate_limited({ nope: 1 })`, `order_status({ state: 'pending' })`,
  `cart_total({})`.

The last item is M6's acceptance test, and M6's alone: a fixture app containing
the section 7.6 declarations plus a negative file of `@ts-expect-error` lines
must typecheck clean. It lives in `packages/loclizr/test/typecheck-fixture/`
with its own `tsconfig.json`, excluded from the package's, and it runs after
`pnpm --filter loclizr build`, for the reasons in section 16's M6 block. Its
acceptance set also carries the four shapes any real catalog reaches: two
sibling plurals in one message, a nested plural, a markup message whose target
arm dropped its tag, and a source string containing `*/`.
