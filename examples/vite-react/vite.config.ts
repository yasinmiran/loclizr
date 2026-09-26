import react from '@vitejs/plugin-react'
import { defineConfig, normalizePath, type Plugin } from 'vite'

function loclizrCatalogs(): Plugin {
  return {
    name: 'loclizr-catalogs',
    configureServer(server) {
      const root = server.config.root
      const catalogs = normalizePath(`${root}/locales`)
      const record = `${catalogs}/loclizr.context.json`
      let pending = Promise.resolve()
      const rebuild = (changed: string): void => {
        const file = normalizePath(changed)
        if (!file.startsWith(`${catalogs}/`) || file === record) return
        pending = pending
          .then(async () => {
            const { build } = await import('loclizr/compiler')
            const { summary } = await build({ cwd: root, failOnError: false })
            const counts = `${summary.messages} messages, ${summary.errors} errors, ${summary.warnings} warnings`
            server.config.logger.info(`loclizr rebuilt ${file.slice(root.length + 1)}: ${counts}`)
          })
          .catch((error: unknown) => {
            server.config.logger.error(`loclizr rebuild failed: ${String(error)}`)
          })
      }
      server.watcher.add(catalogs)
      server.watcher.on('add', rebuild)
      server.watcher.on('change', rebuild)
      server.watcher.on('unlink', rebuild)
    },
  }
}

export default defineConfig({
  plugins: [react(), loclizrCatalogs()],
})
