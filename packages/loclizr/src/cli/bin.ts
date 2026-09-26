#!/usr/bin/env node
import { run } from './index'

run(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code
  },
  (error: unknown) => {
    process.stderr.write(`loclizr: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 2
  },
)
