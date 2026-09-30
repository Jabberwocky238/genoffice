import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { connect } from 'node:net'
import { join, resolve } from 'node:path'
import { launchShell, closeAndSaveVideo, waitForPageWithUrl } from './helpers'

/**
 * The genoffice CLI's control channel (`open --slide/--el`, `selection`):
 * the shell publishes userData/control.json, a token-checked local socket
 * takes one request per connection and relays it to the tab's renderer.
 * This drives the socket the way packages/cli/src/control.ts does.
 */

const DOC = resolve(__dirname, 'assets/justify-pagegap-fr.docx')

interface Endpoint {
  endpoint: string
  token: string
}

async function waitForEndpoint(userDataDir: string): Promise<Endpoint> {
  const deadline = Date.now() + 30_000
  for (;;) {
    try {
      return JSON.parse(readFileSync(join(userDataDir, 'control.json'), 'utf8')) as Endpoint
    } catch {
      if (Date.now() > deadline) throw new Error('control.json never appeared')
      await new Promise((r) => setTimeout(r, 200))
    }
  }
}

function request(ep: Endpoint, token: string, body: unknown): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const socket = connect(ep.endpoint)
    let reply = ''
    socket.setEncoding('utf8')
    socket.on('error', reject)
    socket.on('connect', () => socket.write(JSON.stringify({ token, request: body }) + '\n'))
    socket.on('data', (chunk: string) => (reply += chunk))
    socket.on('close', () => resolvePromise(reply))
  })
}

test.describe('cli control channel', () => {
  test('goto selects a docx block and selection reports the block range', async () => {
    test.setTimeout(120_000)
    const launched = await launchShell({
      onboardingSeen: true,
      videoDir: 'cli-control-docs',
      openFile: DOC,
    })
    try {
      await waitForPageWithUrl(launched.app, '://docs/')
      const ep = await waitForEndpoint(launched.userDataDir)
      const moved = JSON.parse(
        await request(ep, ep.token, {
          cmd: 'open',
          path: DOC,
          target: { kind: 'block', block: 2 },
        }),
      )
      expect(moved).toMatchObject({ ok: true, result: { block: 2 } })
      const sel = JSON.parse(await request(ep, ep.token, { cmd: 'selection', path: DOC }))
      expect(sel).toMatchObject({ ok: true, result: { blocks: [2, 2] } })
      const tooFar = JSON.parse(
        await request(ep, ep.token, {
          cmd: 'open',
          path: DOC,
          target: { kind: 'block', block: 9999 },
        }),
      )
      expect(tooFar).toMatchObject({ ok: false, error: { reason: 'out_of_range' } })
    } finally {
      await closeAndSaveVideo(launched, 'cli-control-docs')
    }
  })
})
