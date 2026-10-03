import starlight from '@astrojs/starlight'
import { defineConfig } from 'astro/config'
import starlightThemeBlack from 'starlight-theme-black'

export default defineConfig({
  site: 'https://loclizr.dev',
  integrations: [
    starlight({
      title: 'loclizr',
      plugins: [
        starlightThemeBlack({
          navLinks: [{ label: 'Docs', link: '/start/introduction/' }],
        }),
      ],
      description:
        'A compiler for the contract between code and translations. Typed ESM message functions from JSON catalogs, catalog checks inside the build, and a context record per message.',
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/loclizr/loclizr' },
      ],
      credits: false,
      customCss: ['./src/styles/custom.css'],
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
