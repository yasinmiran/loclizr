# vue-example

A Vite and Vue 3 app whose templates follow `setLocale`: a `useLocale` composable over `subscribe` and `getLocale`, a `computed` that reads the ref, and a root keyed on the locale. `src/locale.test.ts` checks both forms under jsdom.

```bash
pnpm --filter vue-example dev
pnpm --filter vue-example build
pnpm --filter vue-example test
```

Walkthrough: [Vue guide](../../apps/web/src/content/docs/guides/vue.mdx).
