// Node-side loader (tests, tools): read the installed package's WASM from disk.
// Browser and Worker code call loadRsword() with no source; the glue finds the WASM itself.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { loadRsword } from './src/backend'

export { wordBackend } from './src/backend'

export const rswordWasmPath = createRequire(import.meta.url).resolve(
  '@lilleapo/rs-word-parser/rsword_js_bg.wasm',
)

export function loadRswordNode(): Promise<void> {
  return loadRsword(() => ({ module_or_path: readFileSync(rswordWasmPath) }))
}
