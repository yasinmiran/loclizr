import { readFileSync } from 'node:fs'
import { sidebar } from './sidebar'

const site = 'https://loclizr.dev'

function frontmatter(slug: string): { title: string; description: string } {
  const file = slug === 'index' ? 'src/content/docs/index.mdx' : `src/content/docs/${slug}.mdx`
  const head = readFileSync(new URL(file, import.meta.url), 'utf8').split('\n---')[0] ?? ''
  const field = (name: string): string =>
    (head.match(new RegExp(`^${name}: *(.*)$`, 'm'))?.[1] ?? '').trim().replace(/^(['"])(.*)\1$/, '$2')
  return { title: field('title'), description: field('description') }
}

function line(slug: string): string {
  const { title, description } = frontmatter(slug)
  return `- [${title}](${site}/${slug}.md)${description ? `: ${description}` : ''}`
}

// The page list for llms.txt, in sidebar order, one Markdown twin per page.
// The plugin prints it after the description and before its own file list.
export function llmsIndex(): string {
  const sections = [
    'Every link below is a Markdown rendering of the page at the same path without `.md`.',
    `## Landing\n\n${line('index')}`,
    ...sidebar.map((group) => `## ${group.label}\n\n${group.items.map((item) => line(item.slug)).join('\n')}`),
  ]
  return sections.join('\n\n')
}
