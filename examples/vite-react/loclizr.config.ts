import { defineConfig } from 'loclizr'

export default defineConfig({
  locales: ['en', 'de', 'de-AT'],
  sourceLocale: 'en',
  groups: { errors: 'errors' },
  severity: {
    'ambiguous-source': 'error',
    // The errors group mixes a message that takes {seconds} with two that take
    // nothing, on purpose: the app shows the union call site that produces.
    'group-args-heterogeneous': 'off',
  },
})
