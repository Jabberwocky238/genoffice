import { readFileSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { flagBool, flagString } from '../args'
import { resolveInput } from '../fs'
import { contactSheet } from '../formats/png'
import { outputDirectory, parseScale, RENDERABLE, renderToPngs } from '../formats/render'
import type { CommandDef } from '../registry'
import { CliError, EXIT, type CommandResult } from '../result'

const DEFAULT_GRID_COLS = 4
const DEFAULT_TILE_PX = 320

export const renderCommand: CommandDef = {
  name: 'render',
  summary:
    'One PNG per page of a document, as the GenOffice renderer lays it out: the picture an agent looks at to check a Word document or a PDF it just made.',
  usage: 'render <file> --out <dir> [--page n] [--scale n] [--grid [--cols n] [--tile px]]',
  options: [
    { name: 'out', value: 'dir', description: 'directory for the PNGs (<stem>-NN.png; required)' },
    { name: 'page', value: 'n', description: 'only this 1-based page (default: every page)' },
    {
      name: 'scale',
      value: 'n',
      description: 'pixels per PDF point, 0 < n <= 4 (default 1 = 72 dpi; 2 = 144 dpi)',
    },
    {
      name: 'grid',
      description:
        'also write <stem>-grid.png: every rendered page downscaled onto one contact sheet',
    },
    {
      name: 'cols',
      value: 'n',
      description: `--grid: tiles per row (default ${DEFAULT_GRID_COLS})`,
    },
    { name: 'tile', value: 'px', description: `--grid: tile width (default ${DEFAULT_TILE_PX})` },
  ],
  async run(args, ctx) {
    const path = resolveInput(args.positionals[0], ctx)
    const outDir = outputDirectory(flagString(args, 'out'), ctx)
    const only = pageIndex(flagString(args, 'page'))
    const files = await renderToPngs(path, ctx, {
      outDir,
      scale: parseScale(flagString(args, 'scale')),
      only,
      range: { flag: 'page', oneBased: true },
      log: ctx.log,
    })
    const stem = basename(path, extname(path))
    const detail: Record<string, unknown> = {
      files: files.map((f) => ({ ...f, page: f.page + 1 })),
      formats: RENDERABLE,
      via: path.toLowerCase().endsWith('.pdf') ? 'pdfium' : 'genoffice --headless-export + pdfium',
    }
    if (flagBool(args, 'grid')) {
      const sheet = contactSheet(
        files.map((f) => ({ page: f.page + 1, png: readFileSync(f.path) })),
        positive(flagString(args, 'cols'), DEFAULT_GRID_COLS, 'cols'),
        positive(flagString(args, 'tile'), DEFAULT_TILE_PX, 'tile'),
      )
      const out = join(outDir, `${stem}-grid.png`)
      writeFileSync(out, sheet.png)
      detail.grid = {
        path: out,
        width: sheet.width,
        height: sheet.height,
        cols: sheet.cols,
        rows: sheet.rows,
        tiles: sheet.tiles,
      }
    }
    const result: CommandResult = {
      summary: `rendered ${files.length} page(s) of ${basename(path)} to ${outDir}${flagBool(args, 'grid') ? ' plus a contact sheet' : ''}`,
      outputPath: outDir,
      detail,
    }
    return result
  },
}

function pageIndex(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1) {
    throw new CliError(EXIT.usage, '--page must be 1 or more', undefined, {
      reason: 'invalid_argument',
    })
  }
  return n - 1
}

function positive(raw: string | undefined, fallback: number, flag: string): number {
  return whole(raw, fallback, flag, 1)
}

function whole(raw: string | undefined, fallback: number, flag: string, min: number): number {
  if (raw === undefined) return fallback
  const n = Number(raw)
  if (!Number.isInteger(n) || n < min) {
    throw new CliError(
      EXIT.usage,
      `--${flag} must be a whole number of ${min} or more`,
      undefined,
      {
        reason: 'invalid_argument',
      },
    )
  }
  return n
}
