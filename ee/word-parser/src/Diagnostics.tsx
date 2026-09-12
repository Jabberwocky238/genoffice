import { useEffect, useState } from 'react'
import type { WordParserDiagnosticsProps } from '../../../apps/docs/src/renderer/extensions/word-parser'
import { openWordDocument, type WordDocument } from './index'
import './styles.css'

type Report = {
  version: WordDocument['version']
  blocks: number
  warnings: number
  truncated: boolean
  identical: boolean
}

export function WordParserDiagnostics({ bytes, dirty, language }: WordParserDiagnosticsProps) {
  const [open, setOpen] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<{
    bytes: Uint8Array
    report?: Report
    error?: string
  } | null>(null)
  const chinese = language.startsWith('zh')
  useEffect(() => {
    if (!open || !bytes || dirty) return
    let active = true
    const controller = new AbortController()
    let document: WordDocument | undefined
    setResult(null)
    async function check() {
      try {
        document = await openWordDocument(bytes!, { signal: controller.signal })
        if (!active) return
        const model = await document.document({ blockRange: { from: 0, to: 500 }, depth: 8 })
        const diagnostics = await document.diagnostics()
        // This exercises the Rust writer in memory; never writes to the user's file.
        const saved = await document.save()
        const identical =
          saved.length === bytes!.length && saved.every((value, index) => value === bytes![index])
        const report: Report = {
          version: document.version,
          blocks: model.totalBlocks,
          truncated: model.truncated,
          identical,
          warnings: Array.isArray(diagnostics.diagnostics) ? diagnostics.diagnostics.length : 0,
        }
        if (active) setResult({ bytes: bytes!, report })
      } catch (error) {
        if (active) {
          const code =
            error && typeof error === 'object' && 'code' in error
              ? String(error.code)
              : 'RSWORD_ERROR'
          setResult({
            bytes: bytes!,
            error: `${code}: ${error instanceof Error ? error.message : String(error)}`,
          })
        }
      } finally {
        document?.close()
      }
    }
    void check()
    return () => {
      active = false
      controller.abort()
      document?.close()
    }
  }, [open, bytes, dirty, attempt])

  if (!bytes) return null
  const current = !dirty && result?.bytes === bytes ? result : null
  return (
    <aside className="ee-rsword" aria-label={chinese ? 'Rust 解析检查' : 'Rust parser check'}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}>
        {chinese ? 'Rust 解析检查' : 'Rust parser check'}
      </button>
      {open && (
        <section className="ee-rsword-panel" role="region" aria-live="polite">
          <strong>rsWordParser</strong>
          <p>
            {chinese
              ? '检查当前已载入文件的 Rust 解析和无编辑保存结果。'
              : 'Checks Rust parsing and unchanged saving of the loaded file.'}
          </p>
          {dirty ? (
            <p>
              {chinese
                ? '文档已修改，请保存后重新检查。'
                : 'The document has changed. Save before checking again.'}
            </p>
          ) : current?.error ? (
            <p role="alert">{current.error}</p>
          ) : current?.report ? (
            <>
              <p>
                {chinese ? '正文块' : 'Body blocks'}: {current.report.blocks}
              </p>
              <p>
                {chinese ? '诊断数' : 'Diagnostics'}: {current.report.warnings}
              </p>
              <p>
                {current.report.identical
                  ? chinese
                    ? '无编辑保存：字节完全一致'
                    : 'Unchanged save: byte-identical'
                  : chinese
                    ? '无编辑保存：字节不一致'
                    : 'Unchanged save: bytes differ'}
              </p>
              {current.report.truncated && (
                <p>
                  {chinese
                    ? '模型查询已按预算截断，不代表完整覆盖。'
                    : 'The model query was budgeted; coverage is partial.'}
                </p>
              )}
              <small>
                {current.report.version.protocol} · {current.report.version.git}
              </small>
            </>
          ) : (
            <p>{chinese ? '正在检查…' : 'Checking…'}</p>
          )}
          <p>
            {chinese
              ? '编辑与文件保存仍使用现有引擎。'
              : 'Editing and file saving still use the existing engine.'}
          </p>
          <button
            type="button"
            disabled={dirty || !current}
            onClick={() => setAttempt(attempt + 1)}
          >
            {chinese ? '重新检查' : 'Check again'}
          </button>
          <button type="button" onClick={() => setOpen(false)}>
            {chinese ? '关闭' : 'Close'}
          </button>
        </section>
      )}
    </aside>
  )
}
