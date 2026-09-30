import { mkdtempSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseArgs } from '../src/args'
import { parseTarget } from '../src/commands/open'
import { controlEndpoint, controlRequest } from '../src/control'
import type { ControlReply } from '../src/control-protocol'
import { run } from './helpers'

const REPO = resolve(__dirname, '../../..')
const OTHER = join(REPO, 'apps/docs/tests/pagination-corpus/docx/02-chinese-long-docgrid.docx')
const DOCX = join(REPO, 'apps/docs/tests/pagination-corpus/docx/01-simple-english.docx')

const servers: Server[] = []
afterEach(() => {
  while (servers.length) servers.pop()!.close()
})

/** A stand-in shell: publishes control.json into `dir` and answers with `reply`. */
async function fakeShell(
  dir: string,
  reply: (request: unknown) => ControlReply,
): Promise<{ env: NodeJS.ProcessEnv; requests: unknown[] }> {
  const requests: unknown[] = []
  const endpoint =
    process.platform === 'win32'
      ? `\\\\.\\pipe\\genoffice-test-${process.pid}-${servers.length}`
      : join(dir, 'control.sock')
  const server = createServer((socket) => {
    let buffer = ''
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => {
      buffer += chunk
      if (!buffer.includes('\n')) return
      const envelope = JSON.parse(buffer.slice(0, buffer.indexOf('\n')))
      if (envelope.token !== 'secret') return socket.destroy()
      requests.push(envelope.request)
      socket.end(JSON.stringify(reply(envelope.request)) + '\n')
    })
  })
  servers.push(server)
  await new Promise<void>((r) => server.listen(endpoint, r))
  writeFileSync(
    join(dir, 'control.json'),
    JSON.stringify({ protocol: 1, pid: process.pid, endpoint, token: 'secret' }),
  )
  return { env: { ...process.env, GENOFFICE_AUDIT_LOG: 'off', GENOFFICE_USER_DATA: dir }, requests }
}

describe('open targets', () => {
  const target = (argv: string[], file: string) => parseTarget(parseArgs(argv), file)

  it('maps --block to a block target on a Word document', () => {
    expect(target([], '/d.docx')).toBeUndefined()
    expect(target(['--block', '4'], '/d.docx')).toEqual({ kind: 'block', block: 4 })
  })

  it('refuses bad numbers and targets on other file types', () => {
    expect(() => target(['--block', '-1'], '/d.docx')).toThrow(/integer >= 0/)
    expect(() => target(['--block', '1'], '/notes.md')).toThrow(/supported for docx/)
  })
})

describe('control endpoint', () => {
  it('ignores a missing, malformed or dead-pid control.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'genoffice-ctl-'))
    expect(controlEndpoint({ GENOFFICE_USER_DATA: dir })).toBeNull()
    writeFileSync(join(dir, 'control.json'), '{')
    expect(controlEndpoint({ GENOFFICE_USER_DATA: dir })).toBeNull()
    writeFileSync(
      join(dir, 'control.json'),
      JSON.stringify({ protocol: 1, pid: 2 ** 22 - 1, endpoint: '/x', token: 't' }),
    )
    expect(controlEndpoint({ GENOFFICE_USER_DATA: dir })).toBeNull()
    writeFileSync(
      join(dir, 'control.json'),
      JSON.stringify({ protocol: 1, pid: process.pid, endpoint: '/x', token: 't' }),
    )
    expect(controlEndpoint({ GENOFFICE_USER_DATA: dir })).toMatchObject({
      pid: process.pid,
      token: 't',
    })
  })

  it('fails with app_unavailable when nobody listens', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'genoffice-ctl-'))
    await expect(
      controlRequest(
        { protocol: 1, pid: process.pid, endpoint: join(dir, 'missing.sock'), token: 't' },
        { cmd: 'selection', path: '/a.docx' },
        2_000,
      ),
    ).rejects.toMatchObject({ reason: 'app_unavailable', code: 4 })
  })
})

describe('open / selection through the control channel', () => {
  it('open --block asks the running shell instead of spawning the app', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'genoffice-ctl-'))
    const shell = await fakeShell(dir, () => ({
      ok: true,
      result: { blocks: [1, 1] },
    }))
    const r = await run(['open', DOCX, '--block', '1', '--json'], { env: shell.env })
    expect(r.code).toBe(0)
    expect(r.json()).toMatchObject({
      status: 'ok',
      summary: expect.stringContaining('block 1'),
      detail: { blocks: [1, 1], gui_pid: process.pid },
    })
    expect(shell.requests).toEqual([
      { cmd: 'open', path: DOCX, target: { kind: 'block', block: 1 } },
    ])
  })

  it('relays renderer errors as structured CLI errors', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'genoffice-ctl-'))
    const shell = await fakeShell(dir, () => ({
      ok: false,
      error: {
        reason: 'out_of_range',
        message: 'no block 99',
        detail: { valid_range: '0-3' },
      },
    }))
    const r = await run(['open', DOCX, '--block', '99', '--json'], { env: shell.env })
    expect(r.code).toBe(1)
    expect(r.json()).toMatchObject({
      status: 'error',
      error: 'out_of_range',
      detail: { valid_range: '0-3' },
      suggestion: expect.stringContaining('0-3'),
    })
  })

  it('selection returns the editor selection and explains when the file is not open', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'genoffice-ctl-'))
    const shell = await fakeShell(dir, (request) =>
      (request as { path: string }).path === DOCX
        ? { ok: true, result: { blocks: [2, 2], text: 'Second paragraph', collapsed: false } }
        : {
            ok: false,
            error: {
              reason: 'file_not_open_in_gui',
              message: 'not open',
              detail: { suggestion: 'genoffice open x' },
            },
          },
    )
    const ok = await run(['selection', DOCX, '--json'], { env: shell.env })
    expect(ok.code).toBe(0)
    expect(ok.json()).toMatchObject({
      summary: 'block 2: Second paragraph',
      detail: { blocks: [2, 2], text: 'Second paragraph' },
    })
    const notOpen = await run(['selection', OTHER, '--json'], { env: shell.env })
    expect(notOpen.code).toBe(2)
    expect(notOpen.json()).toMatchObject({
      error: 'file_not_open_in_gui',
      suggestion: 'genoffice open x',
    })
  })

  it('selection without a running shell is app_unavailable with an open hint', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'genoffice-ctl-'))
    const r = await run(['selection', DOCX, '--json'], {
      env: { ...process.env, GENOFFICE_AUDIT_LOG: 'off', GENOFFICE_USER_DATA: dir },
    })
    expect(r.code).toBe(4)
    expect(r.json()).toMatchObject({
      error: 'app_unavailable',
      suggestion: expect.stringContaining(`genoffice open ${DOCX}`),
    })
  })
})
