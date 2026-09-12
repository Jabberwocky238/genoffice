export interface WordParserDiagnosticsProps {
  bytes?: Uint8Array
  dirty: boolean
  language: string
}

// The enterprise build alias selects the implementation; public builds ship no WASM.
export function WordParserDiagnostics(_props: WordParserDiagnosticsProps): null {
  return null
}
