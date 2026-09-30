import { readFileSync } from 'node:fs'
import { basename, extname } from 'node:path'
import { flagBool, flagString } from '../args'
import { resolveInput, resolveOutput, writeOutput } from '../fs'
import { exportViaApp } from '../formats/app-export'
import { blankDocument, closeDocument, fillFromHtml, saveDocument } from '../formats/docx'
import { markdownToDocx } from '../formats/markdown'
import type { CommandContext, CommandDef } from '../registry'
import { CliError, EXIT } from '../result'

/** Document types that can be built here. */
const TYPES = ['docx', 'pdf'] as const

export const createCommand: CommandDef = {
  name: 'create',
  summary: 'Create a new Word document (or a PDF of one).',
  usage: 'create --type <docx|pdf> --from <file> --out <path> [--force]',
  options: [
    { name: 'type', value: 'type', description: `document type: ${TYPES.join(', ')}` },
    {
      name: 'from',
      value: 'file',
      description:
        'docx: a .md file, or a .html file holding a restricted-HTML fragment (see `genoffice guide docs`). pdf: a .docx file, printed by the GenOffice renderer',
    },
    { name: 'out', value: 'path', description: 'output file (required)' },
    { name: 'force', description: 'overwrite an existing output file' },
  ],
  async run(args, ctx) {
    const type = flagString(args, 'type')?.toLowerCase()
    if (!type)
      throw new CliError(EXIT.usage, 'missing --type <type>', undefined, {
        reason: 'missing_argument',
      })
    if (!(TYPES as readonly string[]).includes(type)) {
      throw new CliError(
        EXIT.usage,
        `cannot create .${type}`,
        { supported: [...TYPES] },
        { reason: 'unsupported', suggestion: 'pick a type from detail.supported' },
      )
    }
    const output = resolveOutput(flagString(args, 'out'), ctx, {
      force: flagBool(args, 'force'),
      fresh: true,
    })
    if (type === 'pdf') {
      const from = flagString(args, 'from')
      if (!from)
        throw new CliError(EXIT.usage, 'pdf needs --from <document.docx>', undefined, {
          reason: 'missing_argument',
        })
      const source = resolveInput(from, ctx)
      const r = await exportViaApp(source, 'pdf', output, { env: ctx.env, log: ctx.log })
      return {
        summary: `created ${basename(output)}`,
        outputPath: output,
        detail: { via: 'genoffice --headless-export', summary: r.summary },
      }
    }
    const r = await createDocx(args, ctx)
    writeOutput(output, r.bytes)
    return { summary: `created ${basename(output)}`, outputPath: output, detail: r.detail }
  },
}

async function createDocx(
  args: Parameters<CommandDef['run']>[0],
  ctx: CommandContext,
): Promise<{ bytes: Uint8Array; detail: Record<string, unknown> }> {
  const from = flagString(args, 'from')
  if (!from)
    throw new CliError(EXIT.usage, 'docx needs --from <content.md|fragment.html>', undefined, {
      reason: 'missing_argument',
    })
  const source = resolveInput(from, ctx)
  const text = readFileSync(source, 'utf-8')
  const ext = extname(source).toLowerCase()
  if (ext === '.md' || ext === '.markdown') {
    return {
      bytes: await markdownToDocx(text, { file: source, ctx }),
      detail: { source: 'markdown' },
    }
  }
  if (ext === '.html' || ext === '.htm') {
    const doc = await blankDocument()
    try {
      const blocks = fillFromHtml(doc, text)
      return { bytes: await saveDocument(doc), detail: { source: 'html', blocks } }
    } finally {
      closeDocument(doc)
    }
  }
  throw new CliError(
    EXIT.usage,
    `docx --from needs a .md or .html file, got ${ext || 'no extension'}`,
    undefined,
    { reason: 'unsupported' },
  )
}
