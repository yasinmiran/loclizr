import starlight from '@astrojs/starlight'
import { defineConfig } from 'astro/config'
import starlightLlmsTxt from 'starlight-llms-txt'
import starlightThemeBlack from 'starlight-theme-black'
import { llmsIndex } from './llms-index'
import { sidebar } from './sidebar'

export default defineConfig({
  site: 'https://loclizr.dev',
  integrations: [
    starlight({
      title: 'loclizr',
      plugins: [
        starlightThemeBlack({
          navLinks: [{ label: 'Docs', link: '/start/introduction/' }],
          docs: { showMarkdownActions: true },
        }),
        starlightLlmsTxt({
          projectName: 'loclizr',
          description:
            'A compiler for the contract between code and translations. `loclizr build` reads JSON catalogs, writes typed ESM message functions, runs catalog checks inside the build, and writes a context record per message that is committed with the string change. `loclizr check` is the CI gate.',
          details: llmsIndex(),
          customSelectors: { all: ['.sl-anchor-link'] },
          exclude: ['404'],
        }),
      ],
      description:
        'A compiler for the contract between code and translations. Typed ESM message functions from JSON catalogs, catalog checks inside the build, and a context record per message.',
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/loclizr/loclizr' },
      ],
      credits: false,
      customCss: ['./src/styles/custom.css'],
      sidebar,
    }),
  ],
})
