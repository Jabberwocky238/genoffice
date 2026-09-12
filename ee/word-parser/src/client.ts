import type { SessionTable } from '../vendor/rsword-jsbinding/rsword_js'

// Reuse the artifact's declarations instead of maintaining a second binding API.
type Method = Exclude<keyof SessionTable, 'free' | symbol>
export type Request = { id: number; method: Method; args: unknown[] }
export type Response = { id: number; result?: unknown; error?: { code: string; message: string } }
export type Transport = Pick<
  Worker,
  'postMessage' | 'terminate' | 'onmessage' | 'onerror' | 'onmessageerror'
>

export class ParserError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ParserError'
  }
}

export class ParserClient {
  private nextId = 0
  private closed = false
  private pending = new Map<
    number,
    {
      resolve(value: unknown): void
      reject(error: Error): void
      timer: ReturnType<typeof setTimeout>
    }
  >()

  constructor(
    private readonly worker: Transport,
    private readonly timeoutMs = 30_000,
  ) {
    worker.onmessage = ({ data }: MessageEvent<Response>) => {
      const pending = this.pending.get(data.id)
      if (!pending) return
      clearTimeout(pending.timer)
      this.pending.delete(data.id)
      if (data.error) pending.reject(new ParserError(data.error.code, data.error.message))
      else pending.resolve(data.result)
    }
    worker.onerror = (event) =>
      this.close(new ParserError('RSWORD_WORKER_ERROR', event.message || 'Parser worker failed'))
    worker.onmessageerror = () =>
      this.close(new ParserError('RSWORD_MESSAGE_ERROR', 'Could not decode parser response'))
  }

  call<K extends Method>(
    method: K,
    ...args: Parameters<SessionTable[K]>
  ): Promise<ReturnType<SessionTable[K]>> {
    if (this.closed) return Promise.reject(new ParserError('RSWORD_CLOSED', 'Document is closed'))
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      // Terminating the worker is the only way to interrupt synchronous WASM.
      const timer = setTimeout(
        () =>
          this.close(new ParserError('RSWORD_TIMEOUT', 'Parser timed out; reopen the document')),
        this.timeoutMs,
      )
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer })
      try {
        // Clone the bytes: callers retain ownership of their original document.
        this.worker.postMessage({ id, method, args } satisfies Request)
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error)
      }
    })
  }

  close(error = new ParserError('RSWORD_CLOSED', 'Document is closed')): void {
    if (this.closed) return
    this.closed = true
    this.worker.terminate()
    this.worker.onmessage = null
    this.worker.onerror = null
    this.worker.onmessageerror = null
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }
}
