import type {
  BlankDocxOptions,
  ParsedDocFull,
  SaveBlock,
  SaveOptions,
} from '@genoffice/docx-engine'
import type { WordBackend } from '../../../apps/docs/src/renderer/extensions/word-parser'
import initialize, { blank, parse, save, version } from '../vendor/rsword-jsbinding/rsword_js.js'
import lock from '../engine.lock.json'

type WasmSource = Parameters<typeof initialize>[0]

let loading: Promise<void> | undefined

/** Load the compat WASM once per realm (UI thread and parse worker each own one). */
export function loadRsword(
  source: () => WasmSource = () => ({
    module_or_path: new URL('../vendor/rsword-jsbinding/rsword_js_bg.wasm', import.meta.url),
  }),
): Promise<void> {
  loading ??= initialize(source()).then(() => {
    const v = JSON.parse(version()) as { git: string; protocol: string }
    if (v.protocol !== lock.compatProtocol || !lock.commit.startsWith(v.git))
      throw new Error(`rsWordParser ${v.git}/${v.protocol} does not match engine.lock.json`)
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
    return save(parsed.internal.originalBytes, JSON.stringify(blocks), JSON.stringify(options))
  },
  async blank(options?: BlankDocxOptions) {
    await loadRsword()
    return blank(options ? JSON.stringify(options) : undefined)
  },
}
