import { buildBlankDocx, parseDocx, saveDocx } from '@genoffice/docx-engine'

export interface WordParserDiagnosticsProps {
  bytes?: Uint8Array
  dirty: boolean
  language: string
}

// The enterprise build alias selects the implementation; public builds ship no WASM.
export function WordParserDiagnostics(_props: WordParserDiagnosticsProps): null {
  return null
}

/** The package reader/writer behind Docs: parse on open, patch-save, blank template. */
export interface WordBackend {
  readonly name: string
  parse: typeof parseDocx
  save: typeof saveDocx
  blank: typeof buildBlankDocx
}

export const wordBackend: WordBackend = {
  name: 'ts',
  parse: parseDocx,
  save: saveDocx,
  blank: buildBlankDocx,
}
