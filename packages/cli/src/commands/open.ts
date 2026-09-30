import { spawn } from 'node:child_process'
import { extname } from 'node:path'
import { flagString, type ParsedArgs } from '../args'
import { controlEndpoint, controlRequest, waitForControlEndpoint } from '../control'
import type { ControlTarget } from '../control-protocol'
import { resolveInput } from '../fs'
import type { CommandContext, CommandDef } from '../registry'
import { appLaunch } from '../resources'
import { CliError, EXIT } from '../result'

const APP_START_TIMEOUT_MS = 45_000

/** The shell's second-instance handler forwards the path when the app is already running. */
export const openCommand: CommandDef = {
  name: 'open',
  summary:
    'Open a document in the GenOffice app (starts the app if needed); with a target, also select that spot for the user.',
  usage: 'open <file> [--block n]',
  options: [
    { name: 'block', value: 'n', description: 'docx: select block n (0-based, as in `docs read`)' },
  ],
  async run(args, ctx) {
    const path = resolveInput(args.positionals[0], ctx)
    const target = parseTarget(args, path)
    let endpoint = controlEndpoint(ctx.env)
    if (!endpoint) {
      const launch = await spawnApp(path, ctx)
      if (!target) return { summary: `opening ${path} in GenOffice`, detail: { app: launch } }
      endpoint = await waitForControlEndpoint(ctx.env, APP_START_TIMEOUT_MS)
      if (!endpoint) {
        throw new CliError(
          EXIT.app,
          'GenOffice started but did not publish its control endpoint',
          undefined,
          {
            reason: 'app_unavailable',
            suggestion: 'retry once the app window is up',
          },
        )
      }
    }
    const result = await controlRequest(endpoint, {
      cmd: 'open',
      path,
      ...(target ? { target } : {}),
    })
    return {
      summary: target
        ? `${path}: showing ${describe(target)} in GenOffice`
        : `opened ${path} in GenOffice`,
      detail: { ...result, gui_pid: endpoint.pid },
    }
  },
}

async function spawnApp(path: string, ctx: CommandContext): Promise<string> {
  const launch = appLaunch(ctx.env)
  if (!launch) {
    throw new CliError(EXIT.app, 'GenOffice app not found', { hint: 'set GENOFFICE_APP_BIN' })
  }
  const env = { ...ctx.env }
  delete env.ELECTRON_RUN_AS_NODE
  await new Promise<void>((resolve, reject) => {
    const child = spawn(launch.command, [...launch.args, path], {
      detached: true,
      stdio: 'ignore',
      env,
    })
    child.once('error', (err) =>
      reject(new CliError(EXIT.app, `failed to start GenOffice: ${err.message}`)),
    )
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
  return launch.command
}

const TARGET_FLAGS = ['block'] as const

export function parseTarget(args: ParsedArgs, path: string): ControlTarget | undefined {
  const given = TARGET_FLAGS.filter((f) => args.flags[f] !== undefined)
  if (given.length === 0) return undefined
  const ext = extname(path).toLowerCase()
  const expect = (flags: readonly string[], kind: string) => {
    const wrong = given.filter((f) => !flags.includes(f))
    if (wrong.length) {
      throw new CliError(
        EXIT.usage,
        `--${wrong[0]} does not apply to a ${ext || 'file without extension'}; a ${kind} takes ${flags.map((f) => `--${f}`).join(' / ')}`,
        { supported: flags.map((f) => `--${f}`) },
        {
          reason: 'invalid_argument',
          suggestion: `use ${flags.map((f) => `--${f}`).join(' or ')}`,
        },
      )
    }
  }
  const int = (name: string, min: number) => {
    const raw = flagString(args, name)
    const n = Number(raw)
    if (raw === undefined || !Number.isInteger(n) || n < min) {
      throw new CliError(
        EXIT.usage,
        `--${name} must be an integer >= ${min}, got ${raw ?? '(none)'}`,
        undefined,
        {
          reason: 'invalid_argument',
        },
      )
    }
    return n
  }
  if (ext === '.docx' || ext === '.docm' || ext === '.dotx') {
    expect(['block'], 'Word document')
    return { kind: 'block', block: int('block', 0) }
  }
  throw new CliError(
    EXIT.usage,
    `targets are supported for docx files, not ${ext || 'this file'}`,
    { supported: ['.docx'] },
    { reason: 'unsupported', suggestion: 'run `genoffice open <file>` without a target' },
  )
}

function describe(target: ControlTarget): string {
  return `block ${target.block}`
}
