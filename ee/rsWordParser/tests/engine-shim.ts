// Test-time stand-in for @genoffice/docx-engine: everything from the TS engine except the
// package reader/writer, so the Docs suite exercises rsWordParser's parse and patch-save.
import { wordBackend } from '..'

export * from '../../../packages/docx-engine/src/index'
export const parseDocx = wordBackend.parse
export const saveDocx = wordBackend.save
export const buildBlankDocx = wordBackend.blank
