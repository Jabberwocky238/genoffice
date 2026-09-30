import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { run, tempDir } from './helpers'

function opsFile(dir: string, name: string, ops: unknown[]): string {
  const path = join(dir, name)
  writeFileSync(path, JSON.stringify(ops))
  return path
}

async function document(dir: string): Promise<string> {
  const md = join(dir, 'a.md')
  writeFileSync(md, '# Title\n\nBody.\n\nMore.\n')
  const docx = join(dir, 'a.docx')
  expect((await run(['create', '--type', 'docx', '--from', md, '--out', docx])).code).toBe(0)
  return docx
}

describe('batch modes on docs apply', () => {
  const ops = (dir: string) =>
    opsFile(dir, 'ops.json', [
      { op: 'findReplace', find: 'Body', replace: 'Text' },
      { op: 'deleteBlocks', target: { blockIndexes: [999] } },
      { op: 'findReplace', find: 'More', replace: 'Extra' },
    ])
  const text = async (docx: string) => {
    const r = await run(['docs', 'read', docx, '--full', '--json'])
    return JSON.stringify(r.json().detail.items)
  }

  it('atomic: nothing written, counts in the error', async () => {
    const dir = tempDir()
    const docx = await document(dir)
    const before = readFileSync(docx)
    const r = await run(['docs', 'apply', docx, '--ops', ops(dir), '--json'])
    expect(r.code).toBe(1)
    expect(r.json().detail.batch).toEqual({ total: 3, applied: 0, failed: 1, skipped: 2 })
    expect(readFileSync(docx).equals(before)).toBe(true)
  })

  it('best effort: applies ops 0 and 2', async () => {
    const dir = tempDir()
    const docx = await document(dir)
    const r = await run(['docs', 'apply', docx, '--ops', ops(dir), '--best-effort', '--json'])
    expect(r.code).toBe(0)
    expect(r.json().status).toBe('partial')
    expect(r.json().detail.batch).toEqual({ total: 3, applied: 2, failed: 1, skipped: 0 })
    expect(r.json().detail.failures[0]).toMatchObject({ index: 1, op: 'deleteBlocks' })
    expect(r.json().detail.results.map((x: { index: number }) => x.index)).toEqual([0, 2])
    const t = await text(docx)
    expect(t).toContain('Text')
    expect(t).toContain('Extra')
  })

  it('stop on error: applies op 0 only', async () => {
    const dir = tempDir()
    const docx = await document(dir)
    const r = await run(['docs', 'apply', docx, '--ops', ops(dir), '--stop-on-error', '--json'])
    expect(r.code).toBe(0)
    expect(r.json().detail.batch).toEqual({ total: 3, applied: 1, failed: 1, skipped: 1 })
    const t = await text(docx)
    expect(t).toContain('Text')
    expect(t).toContain('More')
    expect(t).not.toContain('Extra')
  })
})
