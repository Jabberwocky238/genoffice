import initialize, { SessionTable } from '../vendor/rsword-jsbinding/rsword_js.js'
import type { Request, Response } from './client'

let table: SessionTable | undefined
async function getTable(): Promise<SessionTable> {
  if (!table) {
    await initialize({
      module_or_path: new URL('../vendor/rsword-jsbinding/rsword_js_bg.wasm', import.meta.url),
    })
    table = new SessionTable()
  }
  return table
}

const methods = new Set([
  'version',
  'open',
  'close',
  'document',
  'apply',
  'save',
  'diagnostics',
  'media',
  'addMedia',
  'resolveRuns',
  'resolveParas',
  'resolveCells',
  'resolveSections',
  'resolveTable',
  'nodeXml',
  'partBytes',
])

// Initialization and all calls are serialized; native sessions are not concurrent.
let queue = Promise.resolve()
self.onmessage = ({ data }: MessageEvent<Request>) => {
  queue = queue.then(async () => {
    let response: Response
    try {
      if (!methods.has(data.method)) throw new Error('Unknown parser method')
      const binding = await getTable()
      response = { id: data.id, result: Reflect.apply(binding[data.method], binding, data.args) }
    } catch (error) {
      response = {
        id: data.id,
        error: {
          code:
            error && typeof error === 'object' && 'code' in error
              ? String(error.code)
              : 'RSWORD_ERROR',
          message: error instanceof Error ? error.message : String(error),
        },
      }
    }
    self.postMessage(response)
  })
}
