import type {
  BlankDocxOptions,
  ParsedDocFull,
  SaveBlock,
  SaveOptions,
} from '@genoffice/docx-engine'
import type { WordBackend } from '../../../apps/docs/src/renderer/extensions/word-parser'
import initialize, { blank, parse, save, version } from '@lilleapo/rs-word-parser'

type WasmSource = Parameters<typeof initialize>[0]

let loading: Promise<void> | undefined

/** Surface this backend is written against; the package version itself is pinned by npm. */
export const COMPAT_PROTOCOL = 'compat/1'

/** Load the compat WASM once per realm (UI thread and parse worker each own one). Without a
 *  source the glue fetches rsword_js_bg.wasm next to itself (import.meta.url). */
export function loadRsword(source: () => WasmSource = () => undefined): Promise<void> {
  loading ??= initialize(source()).then(() => {
    const v = JSON.parse(version()) as { git: string; protocol: string }
    if (v.protocol !== COMPAT_PROTOCOL)
      throw new Error(`rsWordParser ${v.git} speaks ${v.protocol}, expected ${COMPAT_PROTOCOL}`)
  })
  return loading
}

/** compat JSON → the in-memory ParsedDocFull shape (Maps, owner-held source bytes). */
function revive(json: string, bytes: Uint8Array): ParsedDocFull {
  const raw = JSON.parse(json)
  return {
    ...raw,
    styles: new Map(Object.entries(raw.styles)),
    numbering: new Map(Object.entries(raw.numbering)),
    headingStyleIds: new Map(
      Object.entries(raw.headingStyleIds as Record<string, string>).map(([k, v]) => [+k, v]),
    ),
    internal: { ...raw.internal, originalBytes: bytes },
    extras: { opaqueRegions: [], lazyMediaHashes: [], ...raw.extras },
  }
}

export const wordBackend: WordBackend = {
  name: 'rsword',
  async parse(bytes: Uint8Array) {
    await loadRsword()
    return revive(parse(bytes), bytes)
  },
  async save(parsed: ParsedDocFull, blocks: SaveBlock[], options: SaveOptions = {}) {
    await loadRsword()
    const source = parsed.internal.originalBytes
    const out = save(source, JSON.stringify(blocks), JSON.stringify(options))
    // like saveDocx: an unchanged save hands back the source buffer itself, not a copy
    return out.length === source.length && out.every((b, i) => b === source[i]) ? source : out
  },
  async blank(options?: BlankDocxOptions) {
    await loadRsword()
    return blank(options ? JSON.stringify(options) : undefined)
  },
}
