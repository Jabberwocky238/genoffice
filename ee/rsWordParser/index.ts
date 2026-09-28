// Public surface of the rsWordParser EE module; import from `@EE/rsWordParser`, never from src/.
export { wordBackend, loadRsword } from './src/backend'
export { WordParserDiagnostics } from './src/Diagnostics'
export { openWordDocument, ParserError, WordDocument, type NativeDocument } from './src/session'
