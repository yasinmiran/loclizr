import type { APIRoute, GetStaticPaths } from 'astro'
import { getCollection, type CollectionEntry } from 'astro:content'

interface Props {
  entry: CollectionEntry<'docs'>
}

export const prerender = true

// Starlight adds a `404` entry to the collection; it is not a doc.
export const getStaticPaths = (async () => {
  const docs = await getCollection('docs', (entry) => entry.id !== '404' && !entry.data.draft)
  return docs.map((entry) => ({ params: { slug: entry.id }, props: { entry } }))
}) satisfies GetStaticPaths

export const GET: APIRoute<Props> = ({ props }) => {
  const { title, description } = props.entry.data
  const body = componentsToMarkdown(asidesToBlockquotes(stripComponentImports(props.entry.body ?? '')))
  const head = description ? `# ${title}\n\n${description}` : `# ${title}`
  return new Response(`${head}\n\n${body.trim()}\n`, {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  })
}

const asideLabels: Record<string, string> = {
  note: 'Note',
  tip: 'Tip',
  caution: 'Caution',
  danger: 'Danger',
}

// Component imports sit at the top of every page, before any content line.
// Imports inside fenced code samples come later and must survive.
function stripComponentImports(body: string): string {
  const lines = body.split('\n')
  let start = 0
  while (start < lines.length) {
    const line = lines[start] ?? ''
    if (line.trim() !== '' && !line.startsWith('import ')) break
    start++
  }
  return lines.slice(start).join('\n')
}

function asidesToBlockquotes(body: string): string {
  return body.replace(
    /<Aside\b([^>]*)>\n?([\s\S]*?)\n?<\/Aside>/g,
    (_match, attrs: string, inner: string) => {
      const type = /type="([^"]*)"/.exec(attrs)?.[1] ?? 'note'
      const title = /title="([^"]*)"/.exec(attrs)?.[1] ?? asideLabels[type] ?? type
      const quoted = inner
        .split('\n')
        .map((line) => (line === '' ? '>' : `> ${line}`))
        .join('\n')
      return `> **${title}**\n>\n${quoted}`
    },
  )
}

// Wrappers whose content is already Markdown: the tags go and the content stays.
const wrapperTag = /^\s*<\/?(?:Steps|FileTree|Tabs|CardGrid)>\s*$/
const tabOpen = /^\s*<TabItem\b[^>]*\blabel="([^"]*)"[^>]*>\s*$/
const tabClose = /^\s*<\/TabItem>\s*$/
// Interactive widgets such as <LanguageDemo /> have no Markdown form.
const widget = /^\s*<[A-Z][A-Za-z]*\s*\/>\s*$/
// A styling wrapper such as <div class="comparison"> around a table.
const wrapperDiv = /^\s*(?:<div class="[\w -]+">|<\/div>)\s*$/

function componentsToMarkdown(body: string): string {
  const flattened = body
    .replace(/^[ \t]*<Card\b([^>]*)>\n([\s\S]*?)\n\s*<\/Card>/gm, (_match, attrs: string, inner: string) => {
      const title = /title="([^"]*)"/.exec(attrs)?.[1] ?? ''
      // Card bodies are indented inside the grid, which Markdown would read as a code block.
      const text = inner
        .split('\n')
        .map((line) => line.trim())
        .join(' ')
      return `**${title}**\n\n${text}\n`
    })
    .replace(/^[ \t]*<LinkCard\b([^>]*?)\s*\/>/gm, (_match, attrs: string) => {
      const field = (name: string): string => new RegExp(`\\b${name}="([^"]*)"`).exec(attrs)?.[1] ?? ''
      const description = field('description')
      return `- [${field('title')}](${field('href')})${description ? `: ${description}` : ''}`
    })
  // A code sample may show these tags literally, so fenced lines pass through untouched.
  let fenced = false
  const lines: string[] = []
  for (const line of flattened.split('\n')) {
    if (/^\s*(?:```|~~~)/.test(line)) fenced = !fenced
    if (!fenced) {
      if (wrapperTag.test(line) || tabClose.test(line) || widget.test(line) || wrapperDiv.test(line)) continue
      const tab = tabOpen.exec(line)
      if (tab) {
        lines.push(`**${tab[1]}**`)
        continue
      }
    }
    lines.push(line)
  }
  return lines.join('\n')
}
