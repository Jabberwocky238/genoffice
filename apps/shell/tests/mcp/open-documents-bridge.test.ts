import { describe, expect, it, vi } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WebContents } from 'electron'
import type { OpenDocumentTab } from '../../src/shared/tabs-api'
import {
  createOpenDocumentsControl,
  createOpenTargetResolver,
} from '../../src/main/mcp/open-documents-bridge'
import type { OpenDocumentsBridgeDeps } from '../../src/main/mcp/open-documents-bridge'
import { createOpenDocumentTools } from '../../src/main/mcp/tools/open-documents-tools'

/**
 * `open_documents` close/read through the shell-side control: which writer a
 * close-save reaches and what a discard leaves behind.
 */

function tab(overrides: Partial<OpenDocumentTab> & { id: string }): OpenDocumentTab {
  return { kind: 'docs', title: 'notes.docx', active: false, dirty: true, ...overrides } as never
}

/** minimal stand-in for the WebContents the bridges address */
function contentsFor(): WebContents {
  return { id: 7, isDestroyed: () => false } as unknown as WebContents
}

async function controlWith(
  documents: OpenDocumentTab[],
  overrides: Partial<OpenDocumentsBridgeDeps> = {},
): Promise<{
  call: (args: Record<string, unknown>) => Promise<Record<string, unknown>>
  deps: OpenDocumentsBridgeDeps
}> {
  const dir = await mkdtemp(join(tmpdir(), 'genoffice-mcp-bridge-'))
  const deps: OpenDocumentsBridgeDeps = {
    list: async () => documents,
    webContentsFor: () => contentsFor(),
    closeTab: () => true,
    defaultSaveDir: () => dir,
    ...overrides,
  }
  const control = createOpenDocumentsControl(deps)
  const [tool] = createOpenDocumentTools({ control, defaultSaveDir: () => dir })
  return {
    deps,
    call: async (args) => {
      const result = await tool!.handler(args)
      return result as Record<string, unknown>
    },
  }
}

describe('open_documents close', () => {
  it('saves an untitled dirty docs tab into the default folder before closing it', async () => {
    const runCommand = vi.fn(async () => ({ ok: true }))
    const doc = tab({ id: 't1', title: 'untitled docs' })
    const { call } = await controlWith([doc], {
      docs: { openBlankTab: async () => 1, runCommand },
    })

    const result = await call({ action: 'close', target: 't1' })
    expect(result.closed).toBe(true)
    expect(String(result.savedTo).endsWith('.docx')).toBe(true)
    expect(runCommand).toHaveBeenCalledWith(7, 'save_document', {
      path: result.savedTo,
      overwrite: true,
    })
  })

  it('discards without saving', async () => {
    const runCommand = vi.fn(async () => ({ ok: true }))
    const doc = tab({ id: 't2', title: 'a.docx', filePath: 'C:/docs/a.docx' })
    const { call } = await controlWith([doc], {
      docs: { openBlankTab: async () => 1, runCommand },
    })

    const result = await call({ action: 'close', target: 't2', unsaved: 'discard' })
    expect(result.closed).toBe(true)
    expect(result.discardedUnsavedChanges).toBe(true)
    expect(runCommand).not.toHaveBeenCalled()
  })

  it('reports the Word editor as unavailable when the build has no docs bridge', async () => {
    const doc = tab({ id: 't3', title: 'b.docx', filePath: 'C:/docs/b.docx' })
    const { call } = await controlWith([doc])
    await expect(call({ action: 'close', target: 't3' })).rejects.toThrow(/Word editor/)
  })
})

describe('open target resolver: focusing the document the agent edits', () => {
  it('activates the named tab and reveals the window', async () => {
    const activate = vi.fn()
    const revealWindow = vi.fn()
    const doc = tab({ id: 't9', title: 'book.docx', filePath: 'C:/docs/book.docx' })
    const resolve = createOpenTargetResolver({
      list: async () => [doc],
      webContentsFor: () => contentsFor(),
      activate,
      revealWindow,
    })

    await expect(resolve('t9', 'docx', { focus: true })).resolves.toBe(7)
    expect(activate).toHaveBeenCalledWith('t9')
    expect(revealWindow).toHaveBeenCalledTimes(1)
  })

  it('leaves the UI alone for a read, and for a tab already in front', async () => {
    const activate = vi.fn()
    const revealWindow = vi.fn()
    const back = tab({ id: 't1', title: 'back.docx' })
    const front = tab({ id: 't2', title: 'front.docx', active: true })
    const resolve = createOpenTargetResolver({
      list: async () => [back, front],
      webContentsFor: () => contentsFor(),
      activate,
      revealWindow,
    })

    // read tools pass no focus option
    await resolve('t1', 'docx')
    expect(activate).not.toHaveBeenCalled()

    // an already-active tab needs no switch
    await resolve('t2', 'docx', { focus: true })
    expect(activate).not.toHaveBeenCalled()
    expect(revealWindow).not.toHaveBeenCalled()
  })

  it('still resolves the edit when the UI call fails', async () => {
    const doc = tab({ id: 't3', title: 'x.docx' })
    const resolve = createOpenTargetResolver({
      list: async () => [doc],
      webContentsFor: () => contentsFor(),
      activate: () => {
        throw new Error('no such tab')
      },
    })
    // showing the tab is a courtesy: the caller's edit must still go through
    await expect(resolve('t3', 'docx', { focus: true })).resolves.toBe(7)
  })
})
