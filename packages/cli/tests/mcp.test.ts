import { copyFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { defaultRegistry } from '../src/cli'
import { loadCatalog } from '../src/commands/guide'
import { forbiddenConstructs } from '../src/mcp/op-schemas'
import { createContext, disposeContext, runJson, type McpContext } from '../src/mcp/run'
import { createMcpServer } from '../src/mcp/server'
import {
  buildArgv,
  resolveTool,
  resolveTools,
  stripVerbPrefix,
  toolShape,
  TOOLS,
} from '../src/mcp/tools'
import { tempDir, writeMinimalPdf } from './helpers'

const REPO = resolve(__dirname, '../../..')
const DOCX = join(REPO, 'apps/docs/tests/pagination-corpus/docx/01-simple-english.docx')

const registry = defaultRegistry()

describe('mcp tool table', () => {
  it('names every command option it exposes and builds a schema for each tool', () => {
    const tools = resolveTools(registry)
    expect(tools.length).toBe(TOOLS.length)
    const names = tools.map((t) => t.name)
    expect(new Set(names).size).toBe(names.length)
    for (const name of names) expect(name).toMatch(/^[a-z][a-z0-9_]*$/)
    for (const tool of tools) {
      const shape = toolShape(tool)
      for (const p of tool.params) expect(shape[p.key]).toBeDefined()
      for (const p of tool.positionals ?? []) expect(shape[p.key]).toBeDefined()
    }
  })

  it('rejects a tool that names an option the command does not have', () => {
    expect(() =>
      resolveTool({ name: 'x', command: 'info', description: '', options: ['nope'] }, registry),
    ).toThrow('has no --nope')
  })

  it('drops the verb prefix from option descriptions', () => {
    expect(stripVerbPrefix('read: block index range (default: all)')).toBe(
      'block index range (default: all)',
    )
    expect(stripVerbPrefix('pptx --spec <dir>: the deck outline')).toBe('the deck outline')
    expect(stripVerbPrefix('worksheet (default: the active one)')).toBe(
      'worksheet (default: the active one)',
    )
    expect(stripVerbPrefix('auto | 0.5k | 1k')).toBe('auto | 0.5k | 1k')
  })

  it('turns tool arguments into the command line, with inline JSON and text as files', () => {
    const tools = new Map(resolveTools(registry).map((t) => [t.name, t]))
    const apply = buildArgv(tools.get('docs_apply')!, {
      file: 'a.docx',
      ops: [{ op: 'findReplace', find: 'a', replace: 'b' }],
      dry_run: true,
      force: false,
      author: 'me',
    })
    expect(apply.argv).toEqual(['docs', 'apply', 'a.docx', '--author', 'me', '--dry-run'])
    expect(apply.inline).toEqual([
      { option: 'ops', ext: '.json', text: '[{"op":"findReplace","find":"a","replace":"b"}]' },
    ])

    const docx = buildArgv(tools.get('create_docx')!, { markdown: '# Hi', out: 'x.docx' })
    expect(docx.argv).toEqual(['create', '--type', 'docx', '--out', 'x.docx'])
    expect(docx.inline).toEqual([{ option: 'from', ext: '.md', text: '# Hi' }])

    const guide = buildArgv(tools.get('guide')!, { domain: 'docs' })
    expect(guide.argv).toEqual(['guide', 'docs'])
    expect(() => buildArgv(tools.get('info')!, {})).toThrow('missing file')
  })

  it('marks open and selection as stdio-only', () => {
    const local = TOOLS.filter((t) => t.localOnly).map((t) => t.name)
    expect(local.sort()).toEqual(['open', 'selection'])
  })
})

describe('mcp server', () => {
  let ctx: McpContext
  let client: Client
  let dir: string

  beforeAll(async () => {
    dir = tempDir()
    ctx = createContext({
      cwd: dir,
      env: { ...process.env, GENOFFICE_AUDIT_LOG: 'off' },
      log: () => {},
    })
    const server = await createMcpServer(ctx, { registry })
    const [a, b] = InMemoryTransport.createLinkedPair()
    await server.connect(a)
    client = new Client({ name: 'test', version: '0' })
    await client.connect(b)
  })

  afterAll(async () => {
    await client.close()
    disposeContext(ctx)
  })

  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await client.callTool({ name, arguments: args })
    const content = r.content as { type: string; text?: string }[]
    const text = content.find((c) => c.type === 'text')?.text ?? ''
    return { isError: r.isError === true, content, text, json: () => JSON.parse(text) }
  }

  it('lists the command tools with schemas', async () => {
    const { tools } = await client.listTools()
    const names = tools.map((t) => t.name)
    expect(names).toEqual(
      expect.arrayContaining(['info', 'docs_read', 'docs_apply', 'pdf_read', 'guide']),
    )
    expect(names).not.toContain('mcp')
    expect(names).not.toContain('install')
    expect(names).toEqual(expect.arrayContaining(['open', 'selection']))
    const selection = tools.find((t) => t.name === 'selection')!
    expect(selection.annotations?.readOnlyHint).toBe(true)
    expect(selection.inputSchema.required).toEqual(['file'])
    const apply = tools.find((t) => t.name === 'docs_apply')!
    const props = apply.inputSchema.properties as Record<
      string,
      { type?: unknown; anyOf?: unknown }
    >
    expect(apply.inputSchema.required).toEqual(expect.arrayContaining(['file', 'ops']))
    expect(props.dry_run?.type).toBe('boolean')
    expect(props.ops?.type).toBe('array')
    expect(apply.annotations?.readOnlyHint).toBe(false)
    expect(apply.annotations?.openWorldHint).toBe(false)
    expect(tools.find((t) => t.name === 'search')!.annotations?.openWorldHint).toBe(true)
    expect(tools.find((t) => t.name === 'docs_read')!.annotations?.readOnlyHint).toBe(true)
    expect(tools.find((t) => t.name === 'pdf_read')!.annotations?.readOnlyHint).toBe(true)
  })

  type Schema = {
    type?: unknown
    enum?: unknown[]
    items?: Schema
    anyOf?: Schema[]
    properties?: Record<string, Schema>
    required?: string[]
    description?: string
  }
  const OPS_TOOLS = { docs_apply: 'docs' } as const
  const opsParam = async (tool: string): Promise<Schema> => {
    const { tools } = await client.listTools()
    const props = tools.find((t) => t.name === tool)!.inputSchema.properties as Record<
      string,
      Schema
    >
    return props.ops!
  }

  it('advertises ops as one object variant per callable op of guide <domain> --json', async () => {
    for (const [tool, domain] of Object.entries(OPS_TOOLS)) {
      const ops = await opsParam(tool)
      expect(ops.type).toBe('array')
      const variants = ops.items!.anyOf!
      const guide = await runJson(['guide', domain, '--json'], ctx)
      const callable = (guide.ok!.detail!.ops as { op: string; available?: false }[])
        .filter((o) => o.available !== false)
        .map((o) => o.op)
      expect(variants.map((v) => v.properties!.op!.enum![0])).toEqual(callable)
      expect(callable).toEqual(
        (await loadCatalog()).ops.filter((o) => o.available !== false).map((o) => o.op),
      )
      for (const v of variants) {
        expect(v.type).toBe('object')
        expect(v.required).toContain('op')
        expect(v.properties!.op).toEqual({ enum: [v.properties!.op!.enum![0]] })
        if (v.description) expect(v.description.length).toBeLessThanOrEqual(60)
      }
    }
    const docs = (await opsParam('docs_apply')).items!.anyOf!
    const setHeading = docs.find((v) => v.properties!.op!.enum![0] === 'setHeadingLevel')!
    expect(setHeading.required).toEqual(['op', 'target', 'level'])
    expect(setHeading.properties!.level).toEqual({ type: 'number' })
  })

  it('types merge data as an object', async () => {
    const { tools } = await client.listTools()
    const props = tools.find((t) => t.name === 'merge')!.inputSchema.properties as Record<
      string,
      Schema
    >
    expect(props.data!.type).toBe('object')
  })

  it('emits no schema construct that Gemini or strict clients reject, within the size budget', async () => {
    const list = await client.listTools()
    for (const tool of list.tools) {
      const { $schema: _draft, ...schema } = tool.inputSchema as Record<string, unknown>
      expect(forbiddenConstructs(schema), tool.name).toEqual([])
    }
    const bytes = JSON.stringify(list).length
    expect(bytes).toBeLessThanOrEqual(45 * 1024)
    expect(bytes).toBeGreaterThan(25 * 1024)
  })

  it('leaves op validation to the CLI: a typo or a wrong field type gets the structured op error', async () => {
    const docx = join(dir, 'typed.docx')
    copyFileSync(DOCX, docx)
    const docsTypo = await call('docs_apply', {
      file: docx,
      ops: [{ op: 'findReplac', find: 'a', replace: 'b' }],
    })
    expect(docsTypo.isError).toBe(true)
    expect(docsTypo.json().detail.failures[0]).toMatchObject({
      reason: 'unknown_op',
      did_you_mean: 'findReplace',
    })
  })

  it('falls back to untyped arrays with compactSchemas', async () => {
    const ctx2 = createContext({
      cwd: dir,
      env: { ...process.env, GENOFFICE_AUDIT_LOG: 'off' },
      log: () => {},
    })
    const server = await createMcpServer(ctx2, { registry, compactSchemas: true })
    const [a, b] = InMemoryTransport.createLinkedPair()
    await server.connect(a)
    const client2 = new Client({ name: 'test3', version: '0' })
    await client2.connect(b)
    try {
      const { tools } = await client2.listTools()
      const props = tools.find((t) => t.name === 'docs_apply')!.inputSchema.properties as Record<
        string,
        Schema
      >
      expect(props.ops!.anyOf!.map((v) => v.type)).toEqual(['array', 'object'])
      expect(props.ops!.items).toBeUndefined()
      expect(JSON.stringify(tools).length).toBeLessThan(40 * 1024)
    } finally {
      await client2.close()
      disposeContext(ctx2)
    }
  })

  it('reads one PDF page headless through pdf_read', async () => {
    const pdf = writeMinimalPdf(join(dir, 'two.pdf'), ['First page', 'Second page'])
    const r = await call('pdf_read', { file: pdf, page: 2, max_chars: 6 })
    expect(r.isError).toBe(false)
    expect(r.json().detail).toMatchObject({
      pages: 2,
      range: '2-2',
      pages_read: [{ page: 2, text: 'Second…(+5 chars)', truncated: true }],
    })
  })

  it('runs a read-only command and returns the JSON envelope', async () => {
    const r = await call('info', { file: DOCX })
    expect(r.isError).toBe(false)
    expect(r.json()).toMatchObject({ status: 'ok', command: 'info', detail: { format: 'docx' } })
  })

  it('returns command errors as isError with the machine-readable reason', async () => {
    const r = await call('info', { file: join(dir, 'missing.docx') })
    expect(r.isError).toBe(true)
    expect(r.json()).toMatchObject({ status: 'error', code: 2, error: 'file_not_found' })
  })

  it('applies inline ops to a document without any file from the client', async () => {
    const copy = join(dir, 'edit.docx')
    copyFileSync(DOCX, copy)
    const before = await call('docs_read', { file: copy, range: '0', full: true })
    const first = (before.json().detail.items[0].text as string).split(' ')[0]!
    const r = await call('docs_apply', {
      file: copy,
      ops: [{ op: 'findReplace', find: first, replace: 'GENOFFICE' }],
    })
    expect(r.isError).toBe(false)
    expect(r.json()).toMatchObject({ status: 'ok', command: 'docs', output_path: copy })
    const after = await call('docs_read', { file: copy, range: '0', full: true })
    expect(after.json().detail.items[0].text).toContain('GENOFFICE')
  })

  it('serves the guides as plain text tools and as resources', async () => {
    const r = await call('guide', { domain: 'docs' })
    expect(r.isError).toBe(false)
    expect(r.text).toContain('Word ops')
    expect(() => r.json()).toThrow()
    const { resources } = await client.listResources()
    expect(resources.map((x) => x.uri)).toEqual(['genoffice://guide/docs'])
    const spec = await client.readResource({ uri: 'genoffice://guide/docs' })
    expect((spec.contents[0] as { text: string }).text.length).toBeGreaterThan(200)
  })
})
