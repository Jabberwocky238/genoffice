// Differential parse: TS parseDocx vs rsWordParser compat projection over a corpus.
// Usage: npx tsx ee/word-parser/tools/diff.mts <dir|file.docx>... [--json out.json]
// Paths aggregate with indices collapsed to [*]; each row counts the documents it hits.
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseDocx } from '../../../packages/docx-engine/src/parse'
import { loadRsword, wordBackend } from '../src/backend'

type Kind = 'missing' | 'extra' | 'differs'

class Report {
  readonly rows = new Map<string, { kind: Kind; docs: Set<string>; sample?: string }>()
  readonly failures: Array<{ doc: string; side: string; error: string }> = []
  total = 0
  identical = 0

  hit(kind: Kind, path: string, doc: string, sample?: string) {
    const key = `${kind} ${path
      .replace(/\[\d+\]/g, '[*]')
      .replace(
        /^(styles|numbering|hfParts|chartParts|noteNumbers|headingStyleIds)\.[^.]+/,
        '$1.*',
      )}`
    const row = this.rows.get(key) ?? { kind, docs: new Set(), sample }
    row.docs.add(doc)
    this.rows.set(key, row)
  }

  // TS is the reference: "missing" = rsword lacks it, "extra" = only rsword has it
  compare(ts: unknown, rs: unknown, path: string, doc: string): boolean {
    if (ts === rs) return true
    if (ts === undefined) return (this.hit('extra', path, doc), false)
    if (rs === undefined) return (this.hit('missing', path, doc), false)
    if (typeof ts === 'number' && typeof rs === 'number' && Math.abs(ts - rs) < 1e-6) return true
    if (Array.isArray(ts) && Array.isArray(rs)) {
      if (ts.length !== rs.length)
        this.hit('differs', `${path}.length`, doc, `${ts.length}≠${rs.length}`)
      let same = ts.length === rs.length
      for (let i = 0; i < Math.min(ts.length, rs.length); i++)
        same = this.compare(ts[i], rs[i], `${path}[${i}]`, doc) && same
      return same
    }
    if (ts && rs && typeof ts === 'object' && typeof rs === 'object') {
      let same = true
      const keys = new Set([...Object.keys(ts), ...Object.keys(rs)])
      for (const k of keys)
        same =
          this.compare(
            (ts as Record<string, unknown>)[k],
            (rs as Record<string, unknown>)[k],
            path ? `${path}.${k}` : k,
            doc,
          ) && same
      return same
    }
    this.hit('differs', path, doc, `${String(ts).slice(0, 60)} ≠ ${String(rs).slice(0, 60)}`)
    return false
  }

  async run(file: string) {
    const bytes = new Uint8Array(readFileSync(file))
    const [ts, rs] = await Promise.allSettled([parseDocx(bytes), wordBackend.parse(bytes)])
    this.total++
    if (ts.status === 'rejected' || rs.status === 'rejected') {
      for (const [side, r] of [
        ['ts', ts],
        ['rsword', rs],
      ] as const)
        if (r.status === 'rejected')
          this.failures.push({ doc: file, side, error: String(r.reason) })
      return
    }
    if (this.compare(normalize(ts.value), normalize(rs.value), '', file)) this.identical++
  }

  print(limit = 80) {
    const rows = [...this.rows].sort((a, b) => b[1].docs.size - a[1].docs.size)
    console.log(
      `${this.total} documents, ${this.identical} identical, ${this.failures.length} parse failures`,
    )
    for (const f of this.failures.slice(0, 20)) console.log(`FAIL ${f.side} ${f.doc}: ${f.error}`)
    for (const [key, row] of rows.slice(0, limit))
      console.log(
        `${String(row.docs.size).padStart(5)}  ${key}${row.sample ? `   e.g. ${row.sample}` : ''}`,
      )
    if (rows.length > limit) console.log(`… ${rows.length - limit} more paths`)
  }

  toJSON() {
    return {
      total: this.total,
      identical: this.identical,
      failures: this.failures,
      rows: [...this.rows].map(([key, r]) => ({ key, docs: [...r.docs], sample: r.sample })),
    }
  }
}

// Maps → objects, bytes → length; the source bytes are held by the caller on both sides
function normalize(value: unknown): unknown {
  if (value instanceof Map) return normalize(Object.fromEntries(value))
  if (value instanceof Uint8Array) return `<${value.byteLength} bytes>`
  if (Array.isArray(value)) return value.map(normalize)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([k, v]) => v !== undefined && k !== 'originalBytes')
        .map(([k, v]) => [k, normalize(v)]),
    )
  return value
}

function docxFiles(path: string): string[] {
  if (statSync(path).isFile()) return path.endsWith('.docx') ? [path] : []
  return readdirSync(path).flatMap((name) => docxFiles(join(path, name)))
}

const args = process.argv.slice(2)
const jsonAt = args.indexOf('--json')
const jsonOut = jsonAt >= 0 ? args.splice(jsonAt, 2)[1] : undefined
const wasm = new URL('../vendor/rsword-jsbinding/rsword_js_bg.wasm', import.meta.url)
await loadRsword(() => ({ module_or_path: readFileSync(wasm) }))
const report = new Report()
for (const file of args.flatMap(docxFiles)) await report.run(file)
report.print()
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(report.toJSON(), null, 1))
