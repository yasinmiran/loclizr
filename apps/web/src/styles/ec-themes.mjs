import { ExpressiveCodeTheme } from '@astrojs/starlight/expressive-code'

/**
 * Two colours in code and nothing else: accent for keywords, bold ink for the
 * names you declared, dim italic for comments, and one step down for
 * punctuation. Token colours come from the shiki theme, so they cannot be
 * reached through `styleOverrides` and have to live here.
 *
 * `useStarlightUiThemeColors: false` is set in astro.config.mjs, because
 * Starlight's own pass assigns `styleOverrides.frames` wholesale and would
 * drop every frame colour stated below.
 */
function ledgerTheme({ name, type, ink, ink2, ink3, accent, panel, panel2, rule, ruleStrong }) {
  return new ExpressiveCodeTheme({
    name,
    type,
    colors: {
      'editor.background': panel,
      'editor.foreground': ink,
      'editorLineNumber.foreground': ink3,
      'editorLineNumber.activeForeground': ink2,
      'titleBar.activeBackground': panel2,
      'titleBar.activeForeground': ink2,
      'titleBar.border': rule,
      'editorGroupHeader.tabsBackground': panel2,
      'editorGroupHeader.tabsBorder': rule,
      'tab.activeBackground': panel,
      'tab.activeForeground': ink,
      'tab.activeBorder': '#00000000',
      'tab.activeBorderTop': '#00000000',
      'terminal.background': panel2,
      'terminal.foreground': ink,
      'scrollbarSlider.background': ruleStrong,
      'scrollbarSlider.hoverBackground': ink3,
      'focusBorder': accent,
    },
    settings: [
      { scope: ['comment', 'punctuation.definition.comment', 'string.comment'], settings: { foreground: ink3, fontStyle: 'italic' } },
      {
        scope: [
          'keyword',
          'storage',
          'storage.type',
          'storage.modifier',
          'keyword.control',
          'keyword.operator.expression',
          'keyword.operator.new',
          'variable.language',
          'constant.language',
          'support.type.primitive',
          'entity.name.tag',
        ],
        settings: { foreground: accent },
      },
      {
        scope: [
          'entity.name.function',
          'support.function',
          'entity.name.type',
          'entity.name.class',
          'support.class',
          'meta.definition.variable entity.name.function',
        ],
        settings: { foreground: ink, fontStyle: 'bold' },
      },
      { scope: ['constant.numeric', 'constant.language.boolean', 'constant.language.null'], settings: { foreground: accent } },
      { scope: ['punctuation', 'meta.brace', 'punctuation.separator', 'punctuation.terminator'], settings: { foreground: ink3 } },
      { scope: ['support.type.property-name.json', 'meta.object-literal.key'], settings: { foreground: ink3 } },
      { scope: ['string', 'string.quoted', 'punctuation.definition.string'], settings: { foreground: ink } },
      { scope: ['variable', 'variable.other', 'meta.object-literal.key string'], settings: { foreground: ink } },
    ],
  })
}

export const ledgerLight = ledgerTheme({
  name: 'ledger-light',
  type: 'light',
  ink: '#15191b',
  ink2: '#474f52',
  ink3: '#565f62',
  accent: '#2c3e8c',
  panel: '#f2f4f1',
  panel2: '#e2e6e2',
  rule: '#c4cbc6',
  ruleStrong: '#7a837e',
})

export const ledgerDark = ledgerTheme({
  name: 'ledger-dark',
  type: 'dark',
  ink: '#dce3e4',
  ink2: '#9aa5a8',
  ink3: '#828d90',
  accent: '#9fb3ff',
  panel: '#171c20',
  panel2: '#1d2429',
  rule: '#2f383c',
  ruleStrong: '#59666a',
})
