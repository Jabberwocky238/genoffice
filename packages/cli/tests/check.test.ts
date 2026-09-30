import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { run, tempDir } from './helpers'

async function patchZip(
  path: string,
  edits: Record<string, (xml: string) => string>,
): Promise<void> {
  const zip = await JSZip.loadAsync(readFileSync(path))
  for (const [name, edit] of Object.entries(edits)) {
    zip.file(name, edit(await zip.file(name)!.async('string')))
  }
  writeFileSync(path, await zip.generateAsync({ type: 'nodebuffer' }))
}

describe('docs check', () => {
  it('finds unevaluated TOC fields, heading skips, placeholders and broken anchors', async () => {
    const dir = tempDir()
    const md = join(dir, 'doc.md')
    writeFileSync(
      md,
      '# Report\n\n### Deep dive\n\nTODO fill this in\n\n## Findings\n\nAll good.\n',
    )
    const out = join(dir, 'doc.docx')
    expect((await run(['convert', md, '--to', 'docx', '--out', out])).code).toBe(0)
    const ops = join(dir, 'ops.json')
    writeFileSync(ops, JSON.stringify([{ op: 'insertToc', afterBlockIndex: 0 }]))
    expect((await run(['docs', 'apply', out, '--ops', ops, '--json'])).code).toBe(0)
    await patchZip(out, {
      'word/document.xml': (xml) =>
        xml.replace(
          '<w:sectPr',
          '<w:p><w:hyperlink w:anchor="nowhere"><w:r><w:t>see above</w:t></w:r></w:hyperlink></w:p>' +
            '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGEREF </w:instrText></w:r>' +
            '<w:r><w:instrText xml:space="preserve">split_target \\h </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
            '<w:r><w:t>3</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>' +
            '<w:p><w:fldSimple w:instr=" REF &quot;quoted_target&quot; \\h "><w:r><w:t>4</w:t></w:r></w:fldSimple></w:p>' +
            '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> PAGE </w:instrText></w:r>' +
            '<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p><w:sectPr',
        ),
    })
    const r = await run(['docs', 'check', out, '--json'])
    expect(r.code).toBe(0)
    const issues = r.json().detail.issues as {
      code: string
      level: string
      blockIndex?: number
      message: string
    }[]
    const codes = issues.map((i) => i.code)
    expect(codes).toContain('field_not_evaluated')
    expect(codes).toContain('heading_skip')
    expect(codes).toContain('placeholder_left')
    expect(codes).toContain('broken_ref')
    expect(codes).not.toContain('toc_stale')
    expect(issues.find((i) => i.code === 'broken_ref')).toMatchObject({
      level: 'error',
      message: 'hyperlink points at bookmark "nowhere", which does not exist',
    })
    expect(issues.find((i) => i.code === 'heading_skip')?.message).toContain('from 1 to 3')
    expect(issues.map((i) => i.message)).toContain(
      'PAGEREF points at bookmark "split_target", which does not exist',
    )
    expect(issues.map((i) => i.message)).toContain(
      'REF points at bookmark "quoted_target", which does not exist',
    )
    const empty = issues.filter((i) => i.message.includes('has no cached result'))
    expect(empty.map((i) => i.message)).toEqual([
      'PAGE has no cached result; it shows empty until Word updates fields',
    ])
    const clean = await run(['docs', 'check', join(dir, 'doc.docx')])
    expect(clean.code).toBe(0)
    expect(clean.stdout).toContain('issue(s)')
  })
})
