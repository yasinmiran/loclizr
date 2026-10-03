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
  const body = asidesToBlockquotes(stripComponentImports(props.entry.body ?? ''))
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
