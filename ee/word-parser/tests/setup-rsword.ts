import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadRsword } from '../src/backend'

// a path, not import.meta.url: under jsdom that URL is not file://
const wasm = join(import.meta.dirname, '../vendor/rsword-jsbinding/rsword_js_bg.wasm')
await loadRsword(() => ({ module_or_path: readFileSync(wasm) }))
