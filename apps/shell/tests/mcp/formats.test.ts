import { describe, expect, it } from 'vitest'
import {
  capabilityReport,
  familyLabel,
  FORMAT_FAMILIES,
  formatFamily,
  withSaveExtension,
} from '../../src/main/mcp/tools/formats'

/**
 * The format registry is the MCP layer's single source of truth for what the
 * Word editor can open/save/export vs. what this server exposes. These tests pin
 * the matrix to the shell routing and the editor's Save-As dialog so a drift is
 * caught here rather than in a live session.
 */

describe('format registry', () => {
  it('mirrors the shell open routing for the Word editor', () => {
    expect(formatFamily('docx').editorOpen).toEqual(['docx'])
    expect(FORMAT_FAMILIES.map((f) => f.family)).toEqual(['docx'])
  })

  it('records the editor export capabilities', () => {
    expect(formatFamily('docx').editorExport).toEqual(['pdf'])
  })

  it('never advertises an mcp save format the editor cannot write', () => {
    for (const f of FORMAT_FAMILIES) {
      for (const ext of f.mcp?.save ?? []) {
        expect(f.editorSave).toContain(ext)
      }
    }
  })

  it('reports labels for guided errors', () => {
    expect(familyLabel('docx')).toBe('Word document')
    expect(() => familyLabel('nope' as never)).toThrow(/unknown format family/)
  })
})

describe('withSaveExtension', () => {
  it('keeps a correct family extension, case-insensitively', () => {
    expect(withSaveExtension('docx', 'C:/x/Report.DOCX')).toBe('C:/x/Report.DOCX')
  })

  it('appends the family extension when the path has none', () => {
    expect(withSaveExtension('docx', '/tmp/report')).toBe('/tmp/report.docx')
  })

  it('rejects a mismatched extension rather than silently rewriting it', () => {
    expect(() => withSaveExtension('docx', '/tmp/report.pdf')).toThrow(
      /Word document session must be saved as \.docx \(got "\.pdf"\)/,
    )
  })
})

describe('capabilityReport', () => {
  it('exposes editor truth alongside the mcp subset', () => {
    const report = capabilityReport()
    expect(report.map((r) => r.family)).toEqual(['docx'])
    const docx = report[0]
    expect(docx.editor.open).toEqual(['docx'])
    expect(docx.editor.export).toEqual(['pdf'])
    expect(docx.mcp).toEqual({ generate: 'docx', save: ['docx'], read: 'docx' })
  })

  it('hides the headless generate format while generation is off', () => {
    expect(capabilityReport({ generating: false })[0].mcp).toEqual({
      save: ['docx'],
      read: 'docx',
    })
  })
})
