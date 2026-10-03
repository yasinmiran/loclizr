import { readdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

// Markdown links such as [Catalogs](/guides/catalogs/) are written from the
// site root, and Astro leaves them as written. Under a base path they must
// carry it, so this prefixes the configured base to every root-relative href
// and src, the props of MDX components such as <LinkCard href="/..."> included.
// Astro 7 renders Markdown and MDX with Sätteri, which takes hast plugins on
// its processor rather than markdown.rehypePlugins; Starlight registers its
// own transforms the same way.
//
// starlight-llms-txt turns the rendered pages back into Markdown, so
// llms-full.txt and llms-small.txt carry those links as /base/... paths. An
// agent reads that text with no page URL to resolve them against, so after
// the build they become absolute on the configured site.
export default function baseLinks() {
  let prefix = ''
  let origin = ''
  return {
    name: 'base-links',
    hooks: {
      'astro:config:setup': ({ config, logger }) => {
        prefix = config.base.replace(/\/+$/, '')
        origin = config.site?.replace(/\/+$/, '') ?? ''
        if (prefix === '') return
        const hastPlugins = config.markdown.processor?.options?.hastPlugins
        if (!Array.isArray(hastPlugins)) {
          logger.warn('The Markdown processor takes no hast plugins; content links will lack the base path.')
          return
        }
        hastPlugins.push(baseLinksPlugin(prefix))
      },
      'astro:build:done': async ({ dir }) => {
        if (origin === '') return
        const root = fileURLToPath(dir)
        const rootLink = new RegExp(`\\]\\(${prefix}/(?!/)`, 'g')
        const files = await readdir(root, { recursive: true })
        for (const file of files.filter((name) => /^(?:llms[^/]*|_llms-txt\/[^/]+)\.txt$/.test(name))) {
          const path = `${root}/${file}`
          const text = await readFile(path, 'utf8')
          await writeFile(path, text.replace(rootLink, `](${origin}${prefix}/`))
        }
      },
    },
  }
}

function baseLinksPlugin(prefix) {
  const needsBase = (value) =>
    typeof value === 'string' &&
    value.startsWith('/') &&
    !value.startsWith('//') &&
    value !== prefix &&
    !value.startsWith(`${prefix}/`)

  const jsx = {
    filter: [],
    visit(node, ctx) {
      for (const attribute of node.attributes ?? []) {
        if (attribute.type !== 'mdxJsxAttribute' || (attribute.name !== 'href' && attribute.name !== 'src')) continue
        if (needsBase(attribute.value)) ctx.setProperty(node, attribute.name, `${prefix}${attribute.value}`)
      }
    },
  }

  return {
    name: 'base-links',
    element: {
      filter: [],
      visit(node, ctx) {
        for (const name of ['href', 'src']) {
          const value = node.properties?.[name]
          if (needsBase(value)) ctx.setProperty(node, name, `${prefix}${value}`)
        }
      },
    },
    mdxJsxFlowElement: jsx,
    mdxJsxTextElement: jsx,
  }
}
