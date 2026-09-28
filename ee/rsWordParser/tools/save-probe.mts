// Save probe: one generated paragraph per property, saved by TS saveDocx and rsWordParser;
// reports properties whose written <w:p> differs (or that rsword rejects).
// Usage: npx tsx ee/rsWordParser/tools/save-probe.mts [--json out.json]
import { writeFileSync } from 'node:fs'
import JSZip from 'jszip'
import { buildBlankDocx } from '../../../packages/docx-engine/src/blank'
import { parseDocx } from '../../../packages/docx-engine/src/parse'
import { saveDocx } from '../../../packages/docx-engine/src/patch'
import { loadRswordNode, wordBackend } from '../node'

type Probe = { area: string; name: string; block: Record<string, unknown> }
const run = (props: Record<string, unknown>) => ({ type: 'paragraph', runs: [{ text: 'probe', ...props }] })
const para = (format: Record<string, unknown>) => ({ type: 'paragraph', format, runs: [{ text: 'probe' }] })

const RUN: Record<string, unknown> = {
  bold: true, italic: true, underline: true, strike: true, color: 'FF0000', sizeHalfPoints: 28,
  font: 'Arial', fontAscii: 'Arial', eastAsiaFont: 'SimSun', eastAsiaLang: 'zh-CN', fontCs: 'Arial',
  themeColor: 'accent1', csFont: 'Arial', rtl: true, charSpacingTwips: 20, kernHalfPoints: 24,
  caps: 'small', vanish: true, charScalePct: 150, highlight: 'yellow', shading: 'FFFF00',
  textOutline: { color: '000000', widthPt: 0.75 }, textEffect: 'outline', dstrike: true,
  glow: { color: 'FF0000', radiusPt: 5 }, positionHalfPoints: 6,
  bdr: { val: 'single', sz: 4, color: '000000', space: 1 }, cs: true, vertAlign: 'superscript',
  em: 'dot', link: { href: 'https://example.com/' }, styleId: 'Strong',
  sym: { font: 'Symbol', char: 'F0B7' }, instrField: 'DATE', fldDirty: true,
  xeTerm: 'Index term', refField: 'bm1', refInstr: 'REF bm1 \\h',
}
const PARA: Record<string, unknown> = {
  align: 'center', lineSpacing: 1.5, lineRule: 'auto', indentLeft: 720, indentRight: 360,
  indentFirstLine: 240, charIndents: { firstLine: 200 }, spaceBefore: 120, spaceAfter: 240,
  spaceBeforeAuto: true, spaceAfterAuto: true, pageBreakBefore: true, keepNext: true, keepLines: true,
  suppressLineNumbers: true, widowControl: false, snapToGrid: false, autoSpace: false,
  wordWrap: false, overflowPunct: false, eastAsiaLang: 'zh-CN', contextualSpacing: true,
  shadingFill: 'FFFF00', shadingClear: true, borders: 'tb',
  borderStyle: { color: 'FF0000', szEighths: 8, spacePt: 1 }, borderReset: 'tlr',
  tabStops: [{ pos: 1440, val: 'right', leader: 'dot' }], dropCap: { type: 'drop', lines: 3 },
  frame: { wTwips: 1440, hTwips: 720, hRule: 'exact' }, textDirection: 'tbRl', bidi: true,
  emptyRunSizeHalfPoints: 28, emptyRunFontFamily: 'Arial', markSizeHalfPoints: 28,
}
const BLOCK: Record<string, Record<string, unknown>> = {
  heading: { type: 'heading', level: 2, runs: [{ text: 'probe' }] },
  outlineOnly: { type: 'heading', level: 2, outlineOnly: true, runs: [{ text: 'probe' }] },
  listItem: { type: 'listItem', list: { kind: 'bullet', numId: '1', ilvl: 1 }, runs: [{ text: 'probe' }] },
  styleId: { type: 'paragraph', styleId: 'Title', runs: [{ text: 'probe' }] },
  bookmarks: { type: 'paragraph', bookmarks: ['probe_bm'], runs: [{ text: 'probe' }] },
  hiddenBookmarks: { type: 'paragraph', hiddenBookmarks: ['_Ref1'], runs: [{ text: 'probe' }] },
  pPrChange: { type: 'paragraph', format: { align: 'center' }, pPrChange: '<w:pPr/>', runs: [{ text: 'probe' }] },
  blockRevision: { type: 'paragraph', blockRevision: { kind: 'ins', author: 'A', date: '2026-01-01T00:00:00Z' }, runs: [{ text: 'probe' }] },
}
const probes: Probe[] = [
  ...Object.entries(RUN).map(([name, v]) => ({ area: 'Run', name, block: run({ [name]: v }) })),
  ...Object.entries(PARA).map(([name, v]) => ({ area: 'ParaFormat', name, block: para({ [name]: v }) })),
  ...Object.entries(BLOCK).map(([name, block]) => ({ area: 'GeneratedBlock', name, block })),
]

const lastPara = async (bytes: Uint8Array) => {
  const xml = await (await JSZip.loadAsync(bytes)).file('word/document.xml')!.async('string')
  const ps = xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []
  return (ps.at(-1) ?? '').replace(/ w14:\w+="[^"]*"| w:rsid\w*="[^"]*"/g, '')
}

await loadRswordNode()
const base = await buildBlankDocx()
const parsed = await parseDocx(base)
const originals = parsed.blocks
  .filter((b) => !b.hidden)
  .map((b) => ({ kind: 'original' as const, docxIndex: b.docxIndex! }))
const rows: Array<Record<string, string>> = []
for (const p of probes) {
  const blocks = [...originals, { kind: 'generated', block: p.block }] as never
  let ts: string
  try {
    ts = await lastPara(await saveDocx(parsed, blocks))
  } catch (e) {
    ts = `TS ERROR ${String(e).slice(0, 160)}`
  }
  let rs: string
  try {
    rs = await lastPara(await wordBackend.save(await wordBackend.parse(base), blocks))
  } catch (e) {
    rs = `RSWORD ERROR ${(e as { code?: string }).code}: ${String(e).slice(0, 160)}`
  }
  if (ts !== rs) rows.push({ area: p.area, name: p.name, ts, rs })
}
for (const r of rows) console.log(`${r.area}.${r.name}\n  ts: ${r.ts.slice(0, 260)}\n  rs: ${r.rs.slice(0, 260)}`)
console.log(`${rows.length} of ${probes.length} probes differ`)
const at = process.argv.indexOf('--json')
if (at > 0) writeFileSync(process.argv[at + 1], JSON.stringify(rows, null, 1))
