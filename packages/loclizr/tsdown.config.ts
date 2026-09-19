import { defineConfig } from 'tsdown'

const shared = { format: 'esm', target: 'es2022', dts: true } as const

export default defineConfig([
  {
    ...shared,
    entry: { index: 'src/index.ts', 'react/index': 'src/react/index.ts' },
    platform: 'neutral',
    external: ['react'],
    clean: true,
  },
  {
    ...shared,
    entry: {
      'server/index': 'src/server/index.ts',
      'compiler/index': 'src/compiler/index.ts',
      'cli/bin': 'src/cli/bin.ts',
    },
    platform: 'node',
    fixedExtension: false,
    clean: false,
  },
])
