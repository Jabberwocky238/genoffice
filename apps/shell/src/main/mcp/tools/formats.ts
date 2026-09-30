/**
 * Format capability registry — the MCP layer's single source of truth for
 * "which document formats each editor can open, save and export".
 *
 * The authority is the shell's own routing and the Word editor's Save-As dialog:
 *   - open routing:      apps/shell/src/main/index.ts  (routeDocumentPath,
 *                        OPEN_DIALOG_EXTENSIONS, UNSUPPORTED_DOC_RE)
 *   - save/export filters: apps/docs/src/main/*
 *
 * `editor` mirrors that matrix exactly; `mcp` is the subset this server exposes
 * today. Keeping both side by side makes the gap explicit and reviewable: MCP
 * never advertises a format it cannot actually produce, and widening it is a
 * one-line change here plus the matching driver/bridge.
 *
 * To add a format: complete the entry below and, for a new family, add a
 * FamilyDriver and register it in app-mcp.ts.
 */

/** families with a visible editing session: the Word editor only */
export type SessionFamily = 'docx'

/** every family the app can edit */
export type EditorFamily = SessionFamily

export interface McpFormats {
  /** format the headless `create_*` tool writes, when exposed */
  generate?: string
  /** extensions `save_session` accepts for this family (session families only) */
  save?: readonly string[]
  /** format the file reader tool understands, when exposed */
  read?: string
}

export interface FormatFamily {
  family: EditorFamily
  /** noun used in tool copy ("a Word document is open") */
  label: string
  /** extensions the shell routes into this family's tab when opened */
  editorOpen: readonly string[]
  /** extensions the editor's Save As offers */
  editorSave: readonly string[]
  /** aside formats the editor can export (not editable in place) */
  editorExport: readonly string[]
  /** what MCP exposes; omitted entirely while a family is editor-only */
  mcp?: McpFormats
}

/** The editor's format matrix. */
export const FORMAT_FAMILIES: readonly FormatFamily[] = [
  {
    family: 'docx',
    label: 'Word document',
    editorOpen: ['docx'],
    editorSave: ['docx'],
    editorExport: ['pdf'],
    mcp: { generate: 'docx', save: ['docx'], read: 'docx' },
  },
]

const BY_FAMILY = new Map(FORMAT_FAMILIES.map((f) => [f.family, f]))

export function formatFamily(family: EditorFamily): FormatFamily {
  const found = BY_FAMILY.get(family)
  if (!found) throw new Error(`unknown format family "${family}"`)
  return found
}

export function familyLabel(family: EditorFamily): string {
  return formatFamily(family).label
}

/** the extension a family's headless `create_*` tool writes (no leading dot's neighbour) */
export function generateExtension(family: SessionFamily): string {
  const ext = formatFamily(family).mcp?.generate
  if (!ext) throw new Error(`family "${family}" has no MCP generation format`)
  return ext
}

/**
 * Normalize a `save_session` path to the family's MCP save format.
 *
 * A path with no extension gets the family's primary extension appended (the
 * same convenience the headless `create_*` tools and the sheets/slides bridges
 * already offered). A path with a *different* extension is refused rather than
 * silently rewritten: saving a docx session to `.pdf` would produce a corrupt
 * file, so the agent is told what the family can actually save.
 */
export function withSaveExtension(family: SessionFamily, filePath: string): string {
  const formats = formatFamily(family).mcp?.save ?? []
  const ext = filePath.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]
  if (ext === undefined) return `${filePath}.${formats[0] ?? family}`
  if (formats.includes(ext)) return filePath
  const wanted = formats.map((e) => `.${e}`).join(' or ')
  throw new Error(`a ${familyLabel(family)} session must be saved as ${wanted} (got ".${ext}")`)
}

/**
 * Compact capability report for get_app_info: editor truth plus the MCP subset.
 *
 * The static `mcp` block is what this server *can* expose; the runtime options
 * narrow it to what is actually registered right now, so the report never
 * advertises a tool the client cannot call (`generating: false` hides the
 * headless `create_*` tools, which are opt-in).
 */
export function capabilityReport(options: { generating?: boolean } = {}): Array<{
  family: EditorFamily
  label: string
  editor: { open: readonly string[]; save: readonly string[]; export: readonly string[] }
  mcp?: McpFormats
}> {
  const generating = options.generating !== false
  return FORMAT_FAMILIES.map((f) => {
    const mcp = f.mcp ? { ...f.mcp } : undefined
    if (mcp && !generating) delete mcp.generate
    return {
      family: f.family,
      label: f.label,
      editor: { open: f.editorOpen, save: f.editorSave, export: f.editorExport },
      ...(mcp && Object.keys(mcp).length > 0 ? { mcp } : {}),
    }
  })
}
