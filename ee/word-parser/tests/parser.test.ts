import { readFileSync } from 'node:fs'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import initialize, { SessionTable } from '../vendor/rsword-jsbinding/rsword_js.js'
import { buildBlankDocx } from '../../../packages/docx-engine/src/blank'
import { parseDocx } from '../../../packages/docx-engine/src/parse'
import { openWordDocument, type WordDocument } from '../src/index'
import { ParserClient, type Request, type Transport } from '../src/client'
import { wordParserBuild } from '../vite'

// Only transport is in-process: all parsing/editing/saving uses the downloaded WASM.
function transport(): Transport {
  const table = new SessionTable()
  let closed = false
  const worker = {
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    terminate: vi.fn(() => {
      if (!closed) {
        closed = true
        table.free()
      }
    }),
    postMessage(request: Request) {
      queueMicrotask(() => {
        if (closed) return
        const response: { id: number; result?: unknown; error?: unknown } = { id: request.id }
        try {
          response.result = Reflect.apply(
            table[request.method],
            table,
            structuredClone(request.args),
          )
        } catch (error) {
          response.error = { code: (error as { code: string }).code, message: String(error) }
        }
        worker.onmessage?.call(
          worker as unknown as Worker,
          new MessageEvent('message', { data: response }),
        )
      })
    },
  } as Transport
  return worker
}

let bytes: Uint8Array
const documents: WordDocument[] = []
beforeAll(async () => {
  await initialize({
    module_or_path: new Uint8Array(
      readFileSync(new URL('../vendor/rsword-jsbinding/rsword_js_bg.wasm', import.meta.url)),
    ),
  })
  bytes = await buildBlankDocx()
})
afterEach(() => {
  documents.splice(0).forEach((doc) => doc.close())
  vi.useRealTimers()
  vi.unstubAllEnvs()
})
async function open() {
  const doc = await openWordDocument(bytes, { worker: transport })
  documents.push(doc)
  return doc
}

describe('downloaded native/0 binding', () => {
  it('opens, queries, saves identical bytes and closes idempotently', async () => {
    const doc = await open()
    expect(doc.version.git).toBe('e70bc13e139a')
    expect(doc.version.protocol).toBe('native/0')
    expect((await doc.document()).truncated).toBe(false)
    expect(await doc.save()).toEqual(bytes)
    doc.close()
    doc.close()
    await expect(doc.document()).rejects.toMatchObject({ code: 'RSWORD_CLOSED' })
  })

  it('edits Unicode text, resolves nodes and reopens saved bytes in both engines', async () => {
    const doc = await open()
    const model = await doc.document()
    const para = model.main.find((block) => block.kind === 'text')!.node!
    await doc.apply({ op: 'insertText', at: { para, offset: 0 }, text: '中文😀 roundtrip' })
    expect(await doc.nodeXml(para, model.mainPart)).toContain('中文😀 roundtrip')
    expect(await doc.resolve('paras', [para], model.mainPart)).toHaveLength(1)
    const saved = await doc.save()
    const reopened = await openWordDocument(saved, { worker: transport })
    documents.push(reopened)
    expect(JSON.stringify(await reopened.document())).toContain('中文😀 roundtrip')
    const existing = await parseDocx(saved)
    expect(
      existing.blocks
        .flatMap((block) => block.runs ?? [])
        .map((run) => run.text)
        .join(''),
    ).toContain('中文😀 roundtrip')
    expect(bytes).not.toEqual(saved)
  })

  it('retains state after a rejected edit and reports native errors', async () => {
    const doc = await open()
    const before = await doc.save()
    await expect(
      doc.apply({ op: 'insertText', at: { para: 0xffffffff, offset: 0 }, text: 'bad' }),
    ).rejects.toHaveProperty('code')
    expect(await doc.save()).toEqual(before)
    const worker = transport()
    await expect(
      openWordDocument(new Uint8Array([1, 2, 3]), { worker: () => worker }),
    ).rejects.toHaveProperty('code')
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it('preserves query coverage and media ownership', async () => {
    const doc = await open()
    const model = await doc.document({ blockRange: { from: 0, to: 0 } })
    expect(model.main).toEqual([])
    expect(model.truncated).toBe(true)
    const image = new Uint8Array([1, 2, 3])
    const id = await doc.addMedia(image, 'image/png')
    expect(await doc.media(id)).toEqual(image)
    expect(image.byteLength).toBe(3)
    expect(await doc.diagnostics()).toHaveProperty('xmlEscapeCount', 0)
  })
})

it('invalidates all pending calls on timeout', async () => {
  vi.useFakeTimers()
  const worker = {
    postMessage: vi.fn(),
    terminate: vi.fn(),
    onmessage: null,
    onerror: null,
    onmessageerror: null,
  } as Transport
  const client = new ParserClient(worker, 50)
  const results = Promise.allSettled([client.call('version'), client.call('open', bytes)])
  await vi.advanceTimersByTimeAsync(51)
  expect((await results).map((result) => result.status)).toEqual(['rejected', 'rejected'])
  expect(worker.terminate).toHaveBeenCalledOnce()
  await expect(client.call('version')).rejects.toMatchObject({ code: 'RSWORD_CLOSED' })
})

it('cancels initialization without leaking a worker', async () => {
  const controller = new AbortController()
  const worker = {
    postMessage: vi.fn(),
    terminate: vi.fn(),
    onmessage: null,
    onerror: null,
    onmessageerror: null,
  } as Transport
  const opening = openWordDocument(bytes, { worker: () => worker, signal: controller.signal })
  controller.abort()
  await expect(opening).rejects.toMatchObject({ code: 'RSWORD_CLOSED' })
  expect(worker.terminate).toHaveBeenCalledOnce()
})

it('keeps the default build independent and enables verified assets explicitly', () => {
  vi.stubEnv('GENOFFICE_WORD_PARSER', 'off')
  expect(wordParserBuild().plugins).toEqual([])
  vi.stubEnv('GENOFFICE_WORD_PARSER', 'shadow')
  const build = wordParserBuild()
  expect(build.alias['@genoffice/word-parser-extension']).toContain('Diagnostics.tsx')
  expect(build.plugins[0].transformIndexHtml("script-src 'self';")).toContain("'wasm-unsafe-eval'")
})
