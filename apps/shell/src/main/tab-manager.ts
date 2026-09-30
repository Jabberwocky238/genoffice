import { basename } from 'node:path'
import { realpathSync } from 'node:fs'
import { BrowserWindow } from 'electron'
import type { Rectangle, WebContents, WebContentsView } from 'electron'

import {
  createDocsView,
  docsQueryDirty,
  markDocsNewBlank,
  queueDocsAiContent,
  requestDocsClose,
  setActiveDocsResolver,
  teardownDocsRenderer,
} from '../../../docs/src/main/docs-main'
import type { AiDocContent } from '../../../docs/src/shared/ipc'
import type { DocumentTabKind, OpenDocumentTab, TabKind, TabSummary } from '../shared/tabs-api'

interface TabRecord {
  id: string
  kind: TabKind
  /** null for the Home tab — it's rendered by the shell window's own webContents */
  view: WebContentsView | null
  title: string
  filePath?: string
}

/** must match the tab strip's rendered height (apps/shell/src/renderer/src/TabBar.tsx) */
const TAB_STRIP_HEIGHT = 40
const HOME_ID = 'home'

/**
 * Owns every open tab (Home + docs) inside the shell's single BrowserWindow.
 * Docs tabs are WebContentsView children of that window; only the active one is visible at a time. Home has no view of its
 * own — hiding every other tab reveals the shell window's own content.
 */
export class TabManager {
  private readonly tabs: TabRecord[] = [
    { id: HOME_ID, kind: 'home', view: null, title: 'GenOffice' },
  ]
  private activeId: string = HOME_ID
  private nextId = 1
  /** tab whose page entered HTML fullscreen — its view covers the tab strip */
  private htmlFullScreenId: string | null = null
  /** tabs mid unsaved-changes prompt, so a second close click doesn't stack dialogs */
  private readonly closingIds = new Set<string>()

  constructor(
    private readonly shellWindow: BrowserWindow,
    private readonly onChanged: () => void,
    private readonly applyMenuFor: (kind: TabKind) => void,
    /** localized placeholder title for a tab that has no file yet */
    private readonly untitledTitleFor?: (kind: TabKind) => string,
  ) {
    // Layout once synchronously for macOS/Windows (bounds are already correct),
    // then once more on the next tick. On Linux/X11, `resize` fires before the
    // window manager applies the new size, so getContentBounds() is still the
    // pre-maximize size inside the handler and a follow-up layout is required.
    // See https://github.com/genspark-ai/genoffice/issues/15
    shellWindow.on('resize', () => {
      this.layout()
      setImmediate(() => this.layout())
    })
  }

  private untitled(kind: TabKind, fallback: string): string {
    return this.untitledTitleFor?.(kind) ?? fallback
  }

  private contentBounds(): Rectangle {
    const { width, height } = this.shellWindow.getContentBounds()
    if (this.htmlFullScreenId !== null && this.htmlFullScreenId === this.activeId) {
      return { x: 0, y: 0, width, height }
    }
    return { x: 0, y: TAB_STRIP_HEIGHT, width, height: Math.max(0, height - TAB_STRIP_HEIGHT) }
  }

  /**
   * When a tab's page enters HTML fullscreen (requestFullscreen),
   * grow its view over the tab strip so nothing of the shell chrome shows;
   * restore the normal bounds on leave.
   */
  private trackHtmlFullScreen(id: string, view: WebContentsView): void {
    view.webContents.on('enter-html-full-screen', () => {
      this.htmlFullScreenId = id
      this.layout()
    })
    view.webContents.on('leave-html-full-screen', () => {
      if (this.htmlFullScreenId === id) this.htmlFullScreenId = null
      this.layout()
    })
  }

  /** re-fit the active tab's view after a window resize */
  layout(): void {
    // Deferred resize layouts can land after the shell window was closed.
    if (this.shellWindow.isDestroyed()) return
    const active = this.tabs.find((t) => t.id === this.activeId)
    if (active?.view) active.view.setBounds(this.contentBounds())
  }

  /** files open in any tab, for the open-documents registry */
  openFilePaths(): string[] {
    return this.tabs.flatMap((t) => (t.filePath ? [t.filePath] : []))
  }

  list(): TabSummary[] {
    return this.tabs.map((t) => ({
      id: t.id,
      kind: t.kind,
      title: t.title,
      closable: t.id !== HOME_ID,
      active: t.id === this.activeId,
      ...(t.filePath ? { filePath: t.filePath } : {}),
    }))
  }

  /**
   * Documents an MCP agent may act on: every editor tab except Home (no file).
   * Docs answers dirtiness from its renderer, hence the async signature.
   */
  async openDocuments(): Promise<OpenDocumentTab[]> {
    const tabs = this.tabs.filter((tab) => tab.kind !== 'home' && tab.view)
    return Promise.all(
      tabs.map(async (tab) => ({
        id: tab.id,
        kind: tab.kind as DocumentTabKind,
        title: tab.title,
        ...(tab.filePath ? { filePath: tab.filePath } : {}),
        active: tab.id === this.activeId,
        dirty: await this.tabIsDirty(tab),
      })),
    )
  }

  /** unsaved-changes state of one tab */
  private async tabIsDirty(tab: TabRecord): Promise<boolean> {
    const wc = tab.view?.webContents
    if (!wc || wc.isDestroyed()) return false
    return tab.kind === 'docs' ? docsQueryDirty(wc) : false
  }

  openHomeTab(): void {
    this.activateTab(HOME_ID)
  }

  openDocsTab(
    openPath?: string,
    options?: { newBlank?: boolean; aiContent?: AiDocContent },
  ): string {
    const view = createDocsView(openPath)
    const id = `t${this.nextId++}`
    if (options?.newBlank) markDocsNewBlank(view.webContents.id)
    if (options?.aiContent) queueDocsAiContent(view.webContents.id, options.aiContent)
    this.shellWindow.contentView.addChildView(view)
    view.setVisible(false)
    this.trackHtmlFullScreen(id, view)
    this.tabs.push({
      id,
      kind: 'docs',
      view,
      title: openPath ? basename(openPath) : this.untitled('docs', 'GenOffice Docs'),
      filePath: openPath,
    })
    this.activateTab(id)
    return id
  }

  /** Remount the tab's renderer so it re-reads its file from disk (View > Reload). */
  reloadTab(id: string): void {
    const tab = this.tabs.find((t) => t.id === id)
    const wc = tab?.view?.webContents
    if (!wc || wc.isDestroyed()) return
    wc.reload()
  }

  activateTab(id: string): void {
    const target = this.tabs.find((t) => t.id === id)
    if (!target) return
    for (const t of this.tabs) t.view?.setVisible(t.id === id)
    if (target.view) target.view.setBounds(this.contentBounds())
    this.activeId = id
    this.refreshActiveTargets()
    this.focusActiveView()
    this.onChanged()
  }

  /** Hand keyboard focus to the active tab's view. The click that opened or
   *  switched a tab lands on the chrome webContents (tab strip, Home list),
   *  and a WebContentsView made visible does not take focus on its own — so
   *  without this, typing after every open/switch keeps going to a hidden
   *  view. Home has no view of its own; the shell window's webContents is
   *  the focus target there. Skipped while the window is unfocused
   *  (background opens must not steal OS focus); the window's `focus`
   *  handler re-runs it. */
  focusActiveView(): void {
    if (this.shellWindow.isDestroyed() || !this.shellWindow.isFocused()) return
    const target = this.tabs.find((t) => t.id === this.activeId)
    if (!target) return
    if (target.view) target.view.webContents.focus()
    else this.shellWindow.webContents.focus()
  }

  /** Re-point the process-global active-editor targets and the app menu at this
   *  window's active tab. Called on every activation and on shell-window focus:
   *  a detached editor window ("Open in New Window") claims the same globals
   *  while it is focused. */
  refreshActiveTargets(): void {
    const target = this.tabs.find((t) => t.id === this.activeId)
    if (!target) return
    setActiveDocsResolver(target.kind === 'docs' ? () => target.view!.webContents : () => null)
    this.applyMenuFor(target.kind)
  }

  /** move a tab to a new index in the strip; Home is pinned at index 0 */
  reorderTab(id: string, toIndex: number): void {
    if (id === HOME_ID) return
    const fromIndex = this.tabs.findIndex((t) => t.id === id)
    if (fromIndex < 0) return
    const clamped = Math.min(Math.max(Math.trunc(toIndex), 1), this.tabs.length - 1)
    if (clamped === fromIndex) return
    const [moved] = this.tabs.splice(fromIndex, 1)
    this.tabs.splice(clamped, 0, moved)
    this.onChanged()
  }

  tabIdForWebContents(webContentsId: number): string | undefined {
    return this.tabs.find((t) => t.view?.webContents.id === webContentsId)?.id
  }

  /** a module opened a file inside an existing tab (⌘O / queued path) — sync title + dedupe path */
  setTabFileFor(webContentsId: number, filePath: string): void {
    const tab = this.tabs.find((t) => t.view?.webContents.id === webContentsId)
    if (!tab) return
    tab.filePath = filePath
    tab.title = basename(filePath)
    this.onChanged()
  }

  /** an untitled document named itself before its first save */
  setTabTitleFor(webContentsId: number, title: string): void {
    const tab = this.tabs.find((t) => t.view?.webContents.id === webContentsId)
    if (!tab || tab.filePath || tab.title === title) return
    tab.title = title
    this.onChanged()
  }

  /** a file was renamed on disk (rename from the Home list) — sync any open tab's title/path;
   *  returns the affected views so callers can notify the embedded editors */
  renameTabFile(
    oldPath: string,
    newPath: string,
  ): Array<{ kind: TabKind; webContents: WebContents }> {
    const affected: Array<{ kind: TabKind; webContents: WebContents }> = []
    for (const tab of this.tabs) {
      if (tab.filePath !== oldPath) continue
      tab.filePath = newPath
      tab.title = basename(newPath)
      if (tab.view) affected.push({ kind: tab.kind, webContents: tab.view.webContents })
    }
    if (affected.length > 0) this.onChanged()
    return affected
  }

  /** all live docs tabs — dirtiness lives renderer-side, caller queries async (shell-close guard) */
  docsTabs(): Array<{ id: string; webContents: WebContents }> {
    return this.tabs
      .filter((t) => t.kind === 'docs' && t.view)
      .map((t) => ({ id: t.id, webContents: t.view!.webContents }))
  }

  /** closes whichever tab is currently active; no-op for Home (Cmd+W target) */
  closeActiveTab(): void {
    void this.closeTab(this.activeId)
  }

  async closeTab(id: string): Promise<void> {
    if (id === HOME_ID) return
    const tab = this.tabs.find((t) => t.id === id)
    if (!tab || this.closingIds.has(id)) return
    let closeGuard: typeof requestDocsClose | null = null
    // docs dirty state lives in the renderer and needs an async query; skip the guard when clean (avoids a flash activation)
    if (tab.kind === 'docs' && tab.view) {
      this.closingIds.add(id)
      try {
        if (await docsQueryDirty(tab.view.webContents)) closeGuard = requestDocsClose
      } finally {
        this.closingIds.delete(id)
      }
    }
    if (closeGuard && tab.view) {
      // Bring the tab into view so the save prompt has visible context.
      if (this.activeId !== id) this.activateTab(id)
      this.closingIds.add(id)
      try {
        if (!(await closeGuard(tab.view.webContents, this.shellWindow))) return
      } finally {
        this.closingIds.delete(id)
      }
    }
    this.removeTab(id)
  }

  /**
   * Close a tab with no save prompt. The caller must have already settled the
   * document's unsaved changes (the MCP close tool saves or discards first):
   * this is the plain removal step of `closeTab`, so a dialog never appears in
   * a flow the user did not start.
   * Returns false when there is no such tab (already closed) or one is mid-prompt.
   */
  closeTabWithoutPrompt(id: string): boolean {
    if (id === HOME_ID) return false
    const tab = this.tabs.find((t) => t.id === id)
    if (!tab || this.closingIds.has(id)) return false
    this.removeTab(id)
    return true
  }

  /** detach + drop one tab and re-activate a neighbour (no guards, no prompts) */
  private removeTab(id: string): void {
    const idx = this.tabs.findIndex((t) => t.id === id)
    if (idx < 0) return
    if (this.htmlFullScreenId === id) this.htmlFullScreenId = null
    const [removed] = this.tabs.splice(idx, 1)
    if (this.activeId === id) {
      const fallback = this.tabs[idx - 1] ?? this.tabs[0]
      this.activateTab(fallback.id)
    } else {
      this.onChanged()
    }
    if (removed.view) {
      removed.view.setVisible(false)
      this.shellWindow.contentView.removeChildView(removed.view)
      if (removed.kind === 'docs') {
        // webContents.close()/.destroy() on a closed docs tab wedges Electron's whole
        // UI thread in a native modal run loop (reproduced consistently; survives
        // close() vs destroy(), teardown ordering, deferring, and disabling
        // accessibility support — looks like an upstream WebContentsView/Chromium
        // issue, not something fixable from here). Detaching without destroying
        // avoids the freeze; the orphaned webContents is reclaimed when the app quits.
        teardownDocsRenderer(removed.view.webContents)
      } else {
        removed.view.webContents.close()
      }
    }
  }

  /** Remove a tab from the strip WITHOUT destroying its WebContentsView and
   *  hand it to the caller ("Open in New Window" — the live document, unsaved
   *  edits included, moves into a detached editor window). Null while a close
   *  prompt is pending on the tab. */
  detachTab(
    id: string,
  ): { view: WebContentsView; kind: TabKind; title: string; filePath?: string } | null {
    if (id === HOME_ID) return null
    const idx = this.tabs.findIndex((t) => t.id === id)
    const tab = idx >= 0 ? this.tabs[idx] : undefined
    if (!tab?.view || this.closingIds.has(id)) return null
    this.tabs.splice(idx, 1)
    if (this.htmlFullScreenId === id) this.htmlFullScreenId = null
    const view = tab.view
    view.setVisible(false)
    this.shellWindow.contentView.removeChildView(view)
    if (this.activeId === id) {
      const fallback = this.tabs[idx - 1] ?? this.tabs[0]
      this.activateTab(fallback.id)
    } else {
      this.onChanged()
    }
    return { view, kind: tab.kind, title: tab.title, filePath: tab.filePath }
  }

  /** the editor tab showing this file, whichever module owns it (path compared after resolving links) */
  findTabByPath(
    path?: string,
  ): { id: string; kind: TabKind; webContents: WebContents } | undefined {
    const wanted = canonicalPath(path)
    const tab = this.tabs.find((t) => t.view && t.filePath && canonicalPath(t.filePath) === wanted)
    return tab?.view ? { id: tab.id, kind: tab.kind, webContents: tab.view.webContents } : undefined
  }

  webContentsForTab(id: string): WebContents | undefined {
    return this.tabs.find((t) => t.id === id)?.view?.webContents
  }

  private findTabOfKindByPath(kind: TabKind, path?: string): string | undefined {
    const wanted = canonicalPath(path)
    return this.tabs.find(
      (t) => t.kind === kind && t.view && t.filePath && canonicalPath(t.filePath) === wanted,
    )?.id
  }

  findDocsTabByPath(path?: string): string | undefined {
    return this.findTabOfKindByPath('docs', path)
  }
}

export function canonicalPath(path: string | undefined): string | undefined {
  if (path === undefined) return undefined
  try {
    return realpathSync.native(path)
  } catch {
    return path
  }
}
