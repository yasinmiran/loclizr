import starlight from '@astrojs/starlight'
import { defineConfig } from 'astro/config'

import { ledgerDark, ledgerLight } from './src/styles/ec-themes.mjs'

export default defineConfig({
  site: 'https://loclizr.dev',
  integrations: [
    starlight({
      title: 'loclizr',
      description:
        'A compiler for the contract between code and translations. Typed ESM message functions from JSON catalogs, catalog checks inside the build, and a context record per message.',
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/loclizr/loclizr' },
      ],
      credits: false,
      customCss: ['./src/styles/fonts.css', './src/styles/ledger.css', './src/styles/landing.css'],
      components: {
        Hero: './src/components/LedgerHero.astro',
      },
      head: [
        {
          tag: 'link',
          attrs: {
            rel: 'preload',
            href: '/fonts/plexmono-600-normal-latin.woff2',
            as: 'font',
            type: 'font/woff2',
            crossorigin: 'anonymous',
          },
        },
        {
          tag: 'link',
          attrs: {
            rel: 'preload',
            href: '/fonts/archivo-400-700-normal-latin.woff2',
            as: 'font',
            type: 'font/woff2',
            crossorigin: 'anonymous',
          },
        },
      ],
      expressiveCode: {
        themes: [ledgerDark, ledgerLight],
        useStarlightUiThemeColors: false,
        useStarlightDarkModeSwitch: true,
        styleOverrides: {
          borderRadius: '0',
          borderColor: 'var(--rule)',
          codeBackground: 'var(--panel)',
          codeFontFamily: 'var(--sl-font-mono)',
          uiFontFamily: 'var(--sl-font-mono)',
          codeFontSize: '0.8125rem',
          codeLineHeight: '1.68',
          codePaddingBlock: '0.875rem',
          codePaddingInline: '1rem',
          frames: {
            frameBoxShadowCssValue: 'none',
            editorTabBorderRadius: '0',
            editorTabBarBackground: 'var(--panel-2)',
            editorTabBarBorderBottomColor: 'var(--rule)',
            editorActiveTabBackground: 'var(--panel)',
            editorActiveTabForeground: 'var(--ink)',
            editorActiveTabBorderColor: 'var(--rule)',
            editorActiveTabIndicatorTopColor: 'transparent',
            editorActiveTabIndicatorBottomColor: 'transparent',
            editorBackground: 'var(--panel)',
            // A dark terminal in a light theme would put the theme's ink on it,
            // and there is no terminal foreground override to correct that. The
            // plate treatment stays on the landing, where every colour is ours.
            terminalBackground: 'var(--panel)',
            terminalTitlebarBackground: 'var(--panel-2)',
            terminalTitlebarForeground: 'var(--ink-3)',
            terminalTitlebarBorderBottomColor: 'var(--rule)',
            terminalTitlebarDotsForeground: 'var(--rule-strong)',
            terminalTitlebarDotsOpacity: '1',
            inlineButtonForeground: 'var(--ink-2)',
            inlineButtonBorderOpacity: '0',
            tooltipSuccessBackground: 'var(--accent)',
            tooltipSuccessForeground: 'var(--on-accent)',
          },
        },
      },
      sidebar: [
        {
          label: 'Start here',
          items: [
            { label: 'Introduction', slug: 'start/introduction' },
            { label: 'Quickstart', slug: 'start/quickstart' },
            { label: 'How it works', slug: 'start/how-it-works' },
          ],
        },
        {
          label: 'Guides',
          items: [
            { label: 'Catalogs and ICU messages', slug: 'guides/catalogs' },
            { label: 'Importing i18next catalogs', slug: 'guides/i18next-import' },
            { label: 'Language switching', slug: 'guides/language-switching' },
            { label: 'React', slug: 'guides/react' },
            { label: 'Server rendering', slug: 'guides/server-rendering' },
            { label: 'Dynamic keys', slug: 'guides/dynamic-keys' },
            { label: 'Continuous integration', slug: 'guides/continuous-integration' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'CLI', slug: 'reference/cli' },
            { label: 'Configuration', slug: 'reference/configuration' },
            { label: 'Generated code', slug: 'reference/generated-code' },
            { label: 'Runtime API', slug: 'reference/runtime-api' },
            { label: 'Checks', slug: 'reference/checks' },
            { label: 'Context record', slug: 'reference/context-record' },
          ],
        },
        {
          label: 'Project',
          items: [
            { label: 'Why loclizr', slug: 'project/why' },
            { label: 'Comparison', slug: 'project/comparison' },
            { label: 'Honest limits', slug: 'project/limits' },
            { label: 'Roadmap', slug: 'project/roadmap' },
            { label: 'Continuity', slug: 'project/continuity' },
            { label: 'FAQ', slug: 'project/faq' },
          ],
        },
      ],
    }),
  ],
})
