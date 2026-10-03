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
  | 'identifier-collision'
  | 'identifier-reserved'
  | 'confusable-key'
  | 'group-empty'
  | 'nondeterministic-output'
  | 'group-args-heterogeneous'
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

export interface EmptyArgs {
  readonly $?: never
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
