import { createRequire } from 'node:module'
import { join } from 'node:path'

/**
 * pdfium.wasm for the local PDF → Word conversion: node_modules in dev/tests; the
 * packaged app ships no node_modules, so electron-builder copies it into
 * Resources/wasm (see electron-builder.cjs extraResources).
 */
export function pdfiumWasmPath(): string {
  try {
    return createRequire(import.meta.url).resolve('@embedpdf/pdfium/pdfium.wasm')
  } catch {
    return join(process.resourcesPath, 'wasm', 'pdfium.wasm')
  }
}
