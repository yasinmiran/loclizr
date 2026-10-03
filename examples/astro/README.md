# astro-example

Astro prerendering `/de/` and `/en/` with loclizr: a middleware wraps each render in `runWithLocale`, so every page and child component renders in its route's language.

- `pnpm --filter astro-example dev` starts the dev server at `/en/` and `/de/`
- `pnpm --filter astro-example build` writes `dist/de/index.html` and `dist/en/index.html`
- `pnpm --filter astro-example test` builds and checks both pages

Guide: [Astro](https://loclizr.dev/guides/astro/) (`apps/web/src/content/docs/guides/astro.mdx`).
