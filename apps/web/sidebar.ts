// One sidebar for the site config and for the llms.txt route, so the index an
// agent reads lists the pages in the order a person sees them.
export interface SidebarGroup {
  label: string
  items: { label: string; slug: string }[]
}

export const sidebar: SidebarGroup[] = [
  {
    label: 'Start here',
    items: [
      { label: 'Introduction', slug: 'start/introduction' },
      { label: 'Quickstart', slug: 'start/quickstart' },
      { label: 'Playground', slug: 'start/playground' },
      { label: 'How it works', slug: 'start/how-it-works' },
      { label: 'Coding agents', slug: 'start/agents' },
    ],
  },
  {
    label: 'Guides',
    items: [
      { label: 'Catalogs and ICU messages', slug: 'guides/catalogs' },
      { label: 'Importing i18next catalogs', slug: 'guides/i18next-import' },
      { label: 'Migrating from FormatJS', slug: 'guides/formatjs-migration' },
      { label: 'Language switching', slug: 'guides/language-switching' },
      { label: 'Server rendering', slug: 'guides/server-rendering' },
      { label: 'Dynamic keys', slug: 'guides/dynamic-keys' },
      { label: 'Continuous integration', slug: 'guides/continuous-integration' },
      { label: 'Testing', slug: 'guides/testing' },
      { label: 'Translation workflow', slug: 'guides/translation-workflow' },
      { label: 'Monorepo', slug: 'guides/monorepo' },
      { label: 'Publishing a library', slug: 'guides/publishing-a-library' },
    ],
  },
  {
    label: 'Frameworks',
    items: [
      { label: 'React', slug: 'guides/react' },
      { label: 'Svelte', slug: 'guides/svelte' },
      { label: 'Vue', slug: 'guides/vue' },
      { label: 'Solid', slug: 'guides/solid' },
      { label: 'Astro', slug: 'guides/astro' },
      { label: 'No framework', slug: 'guides/vanilla' },
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
      { label: 'Security', slug: 'project/security' },
      { label: 'Continuity', slug: 'project/continuity' },
      { label: 'Roadmap', slug: 'project/roadmap' },
      { label: 'FAQ', slug: 'project/faq' },
    ],
  },
]
