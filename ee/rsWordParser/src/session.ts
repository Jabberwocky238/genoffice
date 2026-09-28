import lock from '../engine.lock.json'
import { ParserClient, ParserError, type Transport } from './client'

export { ParserError } from './client'
export interface NativeDocument {
  main: Array<{ kind: string; node?: number; [key: string]: unknown }>
  mainPart: number
  totalBlocks: number
  truncated: boolean
  [key: string]: unknown
}

function object(json: string): Record<string, unknown> {
  const value: unknown = JSON.parse(json)
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ParserError('RSWORD_BAD_RESPONSE', 'Expected a native protocol object')
  }
  return value as Record<string, unknown>
}

/** A document owns its worker, native session, and original package state. */
export class WordDocument {
  constructor(
    private readonly client: ParserClient,
    private readonly id: string,
    readonly version: { version: string; git: string; protocol: string },
  ) {}

  async document(options?: Record<string, unknown>): Promise<NativeDocument> {
    const model = object(await this.client.call('document', this.id, JSON.stringify(options)))
    if (
      !Array.isArray(model.main) ||
      !Number.isInteger(model.mainPart) ||
      !Number.isInteger(model.totalBlocks) ||
      typeof model.truncated !== 'boolean'
    ) {
      throw new ParserError(
        'RSWORD_BAD_RESPONSE',
        'Document query omitted required identity/coverage fields',
      )
    }
    return model as unknown as NativeDocument
  }

  async apply(operation: Record<string, unknown>, context?: Record<string, unknown>) {
    return object(
      await this.client.call('apply', this.id, JSON.stringify(operation), JSON.stringify(context)),
    )
  }

  save(options?: Record<string, unknown>): Promise<Uint8Array> {
    return this.client.call('save', this.id, JSON.stringify(options))
  }

  async diagnostics() {
    return object(await this.client.call('diagnostics', this.id))
  }
  media(id: number) {
    return this.client.call('media', this.id, id)
  }
  addMedia(bytes: Uint8Array, mime: string) {
    return this.client.call('addMedia', this.id, bytes, mime)
  }
  nodeXml(node: number, part?: number) {
    return this.client.call('nodeXml', this.id, node, part)
  }
  partBytes(part: number) {
    return this.client.call('partBytes', this.id, part)
  }

  async resolve(
    kind: 'runs' | 'paras' | 'cells' | 'sections' | 'table',
    ids: number[],
    part?: number,
  ): Promise<unknown[]> {
    const methods = {
      runs: 'resolveRuns',
      paras: 'resolveParas',
      cells: 'resolveCells',
      sections: 'resolveSections',
      table: 'resolveTable',
    } as const
    const result: unknown = JSON.parse(
      await this.client.call(methods[kind], this.id, JSON.stringify(ids), part),
    )
    if (!Array.isArray(result))
      throw new ParserError('RSWORD_BAD_RESPONSE', 'Expected resolve results')
    return result
  }

  // Each document has its own worker; termination releases the complete WASM heap.
  close(): void {
    this.client.close()
  }
}

export async function openWordDocument(
  bytes: Uint8Array,
  options: {
    signal?: AbortSignal
    worker?: () => Transport
    timeoutMs?: number
  } = {},
): Promise<WordDocument> {
  if (options.signal?.aborted) throw new ParserError('RSWORD_CLOSED', 'Opening was cancelled')
  const client = new ParserClient(
    options.worker?.() ??
      new Worker(new URL('./parser.worker.ts', import.meta.url), {
        type: 'module',
        name: 'rsword-parser',
      }),
    options.timeoutMs,
  )
  const cancel = () => client.close()
  options.signal?.addEventListener('abort', cancel, { once: true })
  try {
    const version = object(await client.call('version'))
    if (
      version.protocol !== lock.protocol ||
      typeof version.version !== 'string' ||
      typeof version.git !== 'string' ||
      !/^[a-f0-9]{12,40}$/.test(version.git) ||
      !lock.commit.startsWith(version.git)
    ) {
      throw new ParserError('RSWORD_VERSION_MISMATCH', 'Parser does not match engine.lock.json')
    }
    const id = await client.call('open', bytes, JSON.stringify({ expectProtocol: lock.protocol }))
    return new WordDocument(client, id, version as WordDocument['version'])
  } catch (error) {
    client.close()
    throw error
  } finally {
    options.signal?.removeEventListener('abort', cancel)
  }
}
