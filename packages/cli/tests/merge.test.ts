import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { run, tempDir } from './helpers'

const DATA = { name: 'Ada', amount: 12.5, due: { date: '2026-10-01' }, item: 'Widget', extra: 'x' }

async function documentXml(path: string): Promise<string> {
  const zip = await JSZip.loadAsync(readFileSync(path))
  return zip.file('word/document.xml')!.async('string')
}

function dataFile(dir: string, data: unknown): string {
  const path = join(dir, 'data.json')
  writeFileSync(path, JSON.stringify(data))
  return path
}

async function templateDocx(dir: string): Promise<string> {
  const md = join(dir, 'template.md')
  writeFileSync(
    md,
    '# Invoice for {{name}}\n\nAmount due: **{{ amount }}** by {{due.date}}.\n\nRef {{na**me**}} is split.\n\n| Item | Cost |\n| --- | --- |\n| {{item}} | {{missing}} |\n\n| Untouched |\n| --- |\n| {{absent}} |\n',
  )
  const out = join(dir, 'template.docx')
  expect((await run(['create', '--type', 'docx', '--from', md, '--out', out])).code).toBe(0)
  return out
}

describe('genoffice merge', () => {
  it('fills a docx template, keeps table cells and reports split and unknown placeholders', async () => {
    const dir = tempDir()
    const template = await templateDocx(dir)
    const out = join(dir, 'invoice.docx')
    const r = await run(['merge', template, '--data', dataFile(dir, DATA), '--out', out, '--json'])
    expect(r.code).toBe(0)
    const j = r.json()
    expect(j.summary).toBe('4 placeholders filled, 3 unresolved')
    expect(j.detail).toMatchObject({
      format: 'docx',
      filled: 4,
      used_keys: ['name', 'amount', 'due.date', 'item'],
      unused_keys: ['extra'],
    })
    expect(j.detail.unresolved_placeholders).toEqual([
      {
        placeholder: '{{name}}',
        key: 'name',
        reason: 'split_placeholder',
        location: { block: 2 },
      },
      { placeholder: '{{missing}}', key: 'missing', reason: 'no_key', location: { block: 3 } },
      { placeholder: '{{absent}}', key: 'absent', reason: 'no_key', location: { block: 4 } },
    ])
    expect(j.warnings[0]).toMatchObject({ code: 'unresolved_placeholder' })
    expect(j.warnings[0].message).toContain('{{missing}} (block 3)')
    // a table nothing fills is never round-tripped through HTML: its XML is the template's
    const tables = async (path: string) =>
      [...(await documentXml(path)).matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>/g)].map((m) => m[0])
    expect((await tables(out))[1]).toBe((await tables(template))[1])

    const read = await run(['docs', 'read', out, '--full', '--json'])
    const texts = read.json().detail.items.map((b: { text: string }) => b.text)
    expect(texts[0]).toBe('Invoice for Ada')
    expect(texts[1]).toBe('Amount due: 12.5 by 2026-10-01.')
    expect(texts[2]).toBe('Ref {{name}} is split.')
    expect(texts[3]).toContain('Widget')
    expect(texts[3]).toContain('{{missing}}')
    expect(read.json().detail.items[3].table.rows).toBe(2)
    expect(texts[4]).toContain('{{absent}}')
  })

  it('refuses to write with --strict, takes inline data and flattens nested objects', async () => {
    const dir = tempDir()
    const template = await templateDocx(dir)
    const out = join(dir, 'strict.docx')
    const strict = await run([
      'merge',
      template,
      '--data',
      JSON.stringify(DATA),
      '--out',
      out,
      '--strict',
      '--json',
    ])
    expect(strict.code).toBe(1)
    expect(strict.json()).toMatchObject({ status: 'error', error: 'unresolved_placeholder' })
    expect(strict.json().detail.unresolved_placeholders).toHaveLength(3)
    expect(existsSync(out)).toBe(false)

    const full = { ...DATA, missing: 'now here', absent: 'here too', name: 'Grace' }
    const ok = await run([
      'merge',
      template,
      '--data',
      JSON.stringify(full),
      '--out',
      out,
      '--json',
    ])
    expect(ok.code).toBe(0)
    expect(ok.json().detail.unresolved_placeholders).toEqual([
      expect.objectContaining({ key: 'name', reason: 'split_placeholder' }),
    ])
    expect(ok.json().detail.used_keys).toContain('missing')

    const again = await run(['merge', template, '--data', JSON.stringify(full), '--out', out])
    expect(again.code).toBe(2)
    expect(again.stderr).toContain('output exists')
  })

  it('treats placeholder-shaped text inside a value as output', async () => {
    const dir = tempDir()
    const md = join(dir, 'lit.md')
    writeFileSync(md, 'Hello {{name}} and {{missing}}\n')
    const docx = join(dir, 'lit.docx')
    expect((await run(['create', '--type', 'docx', '--from', md, '--out', docx])).code).toBe(0)

    const data = JSON.stringify({ name: '{{literal}}' })
    const both = JSON.stringify({ name: '{{literal}}', missing: 'm' })
    for (const template of [docx]) {
      const out = template.replace('lit.', 'lit-out.')
      const r = await run(['merge', template, '--data', data, '--out', out, '--json'])
      expect(r.code, template).toBe(0)
      expect(r.json().summary, template).toBe('1 placeholders filled, 1 unresolved')
      expect(r.json().detail.used_keys, template).toEqual(['name'])
      expect(r.json().detail.unresolved_placeholders.map((u: { key: string }) => u.key)).toEqual([
        'missing',
      ])
      const strict = await run([
        'merge',
        template,
        '--data',
        data,
        '--out',
        out,
        '--strict',
        '--force',
        '--json',
      ])
      expect(strict.json().error, template).toBe('unresolved_placeholder')
      expect(
        strict.json().detail.unresolved_placeholders.map((u: { key: string }) => u.key),
      ).toEqual(['missing'])
      const ok = await run([
        'merge',
        template,
        '--data',
        both,
        '--out',
        out,
        '--strict',
        '--force',
        '--json',
      ])
      expect(ok.code, template).toBe(0)
      expect(ok.json().summary, template).toBe('2 placeholders filled, 0 unresolved')
    }
    const docText = (
      await run(['docs', 'read', docx.replace('lit.', 'lit-out.'), '--full', '--json'])
    ).json().detail.items[0].text
    expect(docText).toBe('Hello {{literal}} and m')
  })

  it('fills a body paragraph with a multi-line value as line breaks and strips NUL', async () => {
    const dir = tempDir()
    const md = join(dir, 'addr.md')
    writeFileSync(md, 'Ship to: **{{addr}}**\n\nRef {{ref}}\n')
    const template = join(dir, 'addr.docx')
    expect((await run(['create', '--type', 'docx', '--from', md, '--out', template])).code).toBe(0)
    const out = join(dir, 'addr-out.docx')
    const data = JSON.stringify({ addr: 'Line 1\nLine 2', ref: 'A\u0000B' })
    const r = await run(['merge', template, '--data', data, '--out', out, '--strict', '--json'])
    expect(r.code).toBe(0)
    expect(r.json().summary).toBe('2 placeholders filled, 0 unresolved')
    const read = await run(['docs', 'read', out, '--full', '--json'])
    const texts = read.json().detail.items.map((b: { text: string }) => b.text)
    expect(texts[0]).toContain('Line 1')
    expect(texts[0]).toContain('Line 2')
    expect(texts[1]).toBe('Ref AB')
    const xml = await documentXml(out)
    expect(xml).toContain('<w:br/>')
    expect(xml).not.toContain('{{')
  })

  it('keeps a multi-line value literal when its text names a placeholder filled elsewhere', async () => {
    const dir = tempDir()
    const md = join(dir, 'routes.md')
    writeFileSync(md, '{{addr}}\n\n{{name}}\n')
    const template = join(dir, 'routes.docx')
    expect((await run(['create', '--type', 'docx', '--from', md, '--out', template])).code).toBe(0)
    const out = join(dir, 'routes-out.docx')
    const data = JSON.stringify({ addr: 'A\nB {{name}}', name: 'X' })
    const r = await run(['merge', template, '--data', data, '--out', out, '--strict', '--json'])
    expect(r.code).toBe(0)
    expect(r.json().summary).toBe('2 placeholders filled, 0 unresolved')
    expect(r.json().detail.used_keys).toEqual(['addr', 'name'])
    const read = await run(['docs', 'read', out, '--full', '--json'])
    const texts = read.json().detail.items.map((b: { text: string }) => b.text)
    expect(texts[0]).toMatch(/^A.?B \{\{name\}\}$/)
    expect(texts[1]).toBe('X')
    expect(await documentXml(out)).toContain('<w:br/>')
  })

  it('substitutes in one pass: a value that reads like another placeholder is output', async () => {
    const dir = tempDir()
    const md = join(dir, 'pass.md')
    writeFileSync(md, '{{a}} {{b}}\n')
    const docx = join(dir, 'pass.docx')
    expect((await run(['create', '--type', 'docx', '--from', md, '--out', docx])).code).toBe(0)

    const data = JSON.stringify({ a: '{{b}}', b: 'X' })
    for (const template of [docx]) {
      const out = template.replace('pass.', 'pass-out.')
      const r = await run(['merge', template, '--data', data, '--out', out, '--strict', '--json'])
      expect(r.code, template).toBe(0)
      expect(r.json().summary, template).toBe('2 placeholders filled, 0 unresolved')
      expect(r.json().detail.used_keys, template).toEqual(['a', 'b'])
    }
    const doc = (
      await run(['docs', 'read', docx.replace('pass.', 'pass-out.'), '--full', '--json'])
    ).json()
    expect(doc.detail.items[0].text).toBe('{{b}} X')
  })

  it('rejects data that is not an object and templates of other types', async () => {
    const dir = tempDir()
    const template = await templateDocx(dir)
    const list = await run([
      'merge',
      template,
      '--data',
      '[1,2]',
      '--out',
      join(dir, 'x.docx'),
      '--json',
    ])
    expect(list.json()).toMatchObject({ status: 'error', error: 'invalid_argument' })
    const bad = await run([
      'merge',
      template,
      '--data',
      '{oops',
      '--out',
      join(dir, 'x.docx'),
      '--json',
    ])
    expect(bad.json()).toMatchObject({ status: 'error', error: 'invalid_json' })
    const none = await run(['merge', template, '--out', join(dir, 'x.docx'), '--json'])
    expect(none.json()).toMatchObject({ status: 'error', error: 'missing_argument' })
    const md = join(dir, 'template.md')
    const other = await run(['merge', md, '--data', '{}', '--out', join(dir, 'x.md'), '--json'])
    expect(other.json()).toMatchObject({ status: 'error', error: 'unsupported' })
    expect(other.json().detail.supported).toEqual(['docx'])
  })
})
