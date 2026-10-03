import starlight from '@astrojs/starlight'
import { defineConfig } from 'astro/config'
import starlightLlmsTxt from 'starlight-llms-txt'
import starlightThemeBlack from 'starlight-theme-black'
import { llmsIndex } from './llms-index'
import baseLinks from './rehype-base-links.mjs'
import { sidebar } from './sidebar'

// GitHub Pages serves the site under the repository path. For the custom
// domain: set site to 'https://loclizr.dev', set base to '/' and add
// public/CNAME, and drop the /loclizr prefix from the hero links in
// src/content/docs/index.mdx. Everything else follows these two.
const site = 'https://yasinmiran.github.io'
const base = '/loclizr'

// The theme's Head override renders <Font> for --font-geist and
// --font-geist-mono only, so a family registered under any other variable
// never reaches the page. Rebind those two variables to the families we want.
// The theme also registers them at the provider default of weight 400 alone,
// which left every heading, link and table header in a synthesized bold; the
// variable range fixes that in one file per style. The plugin must stay after
// starlightThemeBlack: its integration has to run after the theme's adds fonts.
const fonts = {
  '--font-geist': { name: 'Schibsted Grotesk', weights: ['400 700'] },
  '--font-geist-mono': { name: 'Geist Mono', weights: ['400 700'], fallbacks: ['monospace'] },
}

function rebindThemeFonts(families) {
  return {
    name: 'rebind-theme-fonts',
    hooks: {
      'config:setup': ({ addIntegration }) => {
        addIntegration({
          name: 'rebind-theme-fonts',
          hooks: {
            'astro:config:setup': ({ config }) => {
              for (const family of config.fonts ?? []) {
                Object.assign(family, families[family.cssVariable])
              }
            },
          },
        })
      },
    },
  }
}

export default defineConfig({
  site,
  base,
  integrations: [
    baseLinks(),
    starlight({
      title: 'loclizr',
      plugins: [
        starlightThemeBlack({
          navLinks: [{ label: 'Docs', link: '/start/introduction/' }],
          docs: {
            showMarkdownActions: {
              prompt:
                'I am reading the loclizr documentation at {url}. loclizr compiles JSON translation catalogs into typed ESM message functions, checks the catalogs inside the build, and writes a context record per message. Answer from this page.',
              // The theme ships four agents and enables them all by default.
              agents: { v0: false, scira: false },
            },
          },
        }),
        rebindThemeFonts(fonts),
        starlightLlmsTxt({
          projectName: 'loclizr',
          description:
            'A compiler for the contract between code and translations. `loclizr build` reads JSON catalogs, writes typed ESM message functions, runs catalog checks inside the build, and writes a context record per message that is committed with the string change. `loclizr check` is the CI gate.',
          details: llmsIndex({ site, base }),
          customSelectors: { all: ['.sl-anchor-link'] },
          exclude: ['404'],
        }),
      ],
      description:
        'A compiler for the contract between code and translations. Typed ESM message functions from JSON catalogs, catalog checks inside the build, and a context record per message.',
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/yasinmiran/loclizr' },
      ],
      credits: false,
      customCss: ['./src/styles/custom.css', './src/styles/sidebar-icons.css'],
      sidebar,
    }),
  ],
})
