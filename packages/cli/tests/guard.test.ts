import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { auditLogPath } from '../src/audit'
import { redactArgv } from '../src/cli'
import { allowedRoots, realizedPath } from '../src/fs'
import { run, tempDir } from './helpers'

const DOCX = resolve(
  __dirname,
  '../../../apps/docs/tests/pagination-corpus/docx/01-simple-english.docx',
)

const env = (over: Record<string, string>) => ({
  ...process.env,
  GENOFFICE_AUDIT_LOG: 'off',
  ...over,
})

describe('GENOFFICE_ALLOWED_ROOTS', () => {
  it('is unrestricted when unset and blank', () => {
    expect(allowedRoots({})).toBeNull()
    expect(allowedRoots({ GENOFFICE_ALLOWED_ROOTS: '  ' })).toBeNull()
  })

  it('refuses inputs and outputs outside the roots (exit 2, roots in detail)', async () => {
    const inside = tempDir()
    const outside = tempDir()
    const md = join(outside, 'a.md')
    writeFileSync(md, '# x\n\ny\n')
    const e = env({ GENOFFICE_ALLOWED_ROOTS: inside })
    const read = await run(['info', md, '--json'], { env: e })
    expect(read.code).toBe(2)
    expect(read.json().message).toContain('refusing to read')
    expect(read.json().detail.allowed_roots).toEqual([realizedPath(inside)])

    writeFileSync(join(inside, 'b.md'), '# x\n\ny\n')
    const write = await run(
      ['convert', join(inside, 'b.md'), '--to', 'html', '--out', join(outside, 'b.html'), '--json'],
      { env: e },
    )
    expect(write.code).toBe(2)
    expect(write.json().message).toContain('refusing to write')
    expect(existsSync(join(outside, 'b.html'))).toBe(false)

    const ok = await run(
      [
        'convert',
        join(inside, 'b.md'),
        '--to',
        'html',
        '--out',
        join(inside, 'sub/b.html'),
        '--json',
      ],
      { env: e },
    )
    expect(ok.code).toBe(0)
    expect(existsSync(join(inside, 'sub/b.html'))).toBe(true)
  })

  it.skipIf(process.platform === 'win32')('follows symlinks before comparing', async () => {
    const inside = tempDir()
    const outside = tempDir()
    writeFileSync(join(outside, 'real.md'), '# x\n')
    symlinkSync(join(outside, 'real.md'), join(inside, 'link.md'))
    mkdirSync(join(inside, 'escape-dir'))
    symlinkSync(outside, join(inside, 'escape'), 'dir')
    const e = env({ GENOFFICE_ALLOWED_ROOTS: inside })
    expect((await run(['info', join(inside, 'link.md'), '--json'], { env: e })).code).toBe(2)
    writeFileSync(join(inside, 'b.md'), '# x\n')
    const viaLink = await run(
      ['convert', join(inside, 'b.md'), '--to', 'html', '--out', join(inside, 'escape/new/b.html')],
      { env: e },
    )
    expect(viaLink.code).toBe(2)
    expect(realizedPath(join(inside, 'escape/new/b.html'))).toBe(
      join(realizedPath(outside), 'new/b.html'),
    )
  })

  it('keeps names that merely start with ".." inside the root', async () => {
    const inside = tempDir()
    mkdirSync(join(inside, '..hidden'))
    writeFileSync(join(inside, '..hidden', 'a.md'), '# x\n')
    const e = env({ GENOFFICE_ALLOWED_ROOTS: inside })
    expect((await run(['info', join(inside, '..hidden', 'a.md'), '--json'], { env: e })).code).toBe(
      0,
    )
  })

  it('does not create the output folder on a dry run', async () => {
    const dir = tempDir()
    const docx = join(dir, 't.docx')
    copyFileSync(DOCX, docx)
    const ops = join(dir, 'ops.json')
    writeFileSync(ops, JSON.stringify([{ op: 'findReplace', find: 'a', replace: 'b' }]))
    const r = await run(
      [
        'docs',
        'apply',
        docx,
        '--ops',
        ops,
        '--dry-run',
        '--out',
        join(dir, 'new-dir/out.docx'),
        '--json',
      ],
      { env: env({}) },
    )
    expect(r.code).toBe(0)
    expect(existsSync(join(dir, 'new-dir'))).toBe(false)
  })

  it('accepts several roots separated by the platform delimiter', async () => {
    const a = tempDir()
    const b = tempDir()
    writeFileSync(join(b, 'a.md'), '# x\n')
    const e = env({
      GENOFFICE_ALLOWED_ROOTS: [a, b].join(process.platform === 'win32' ? ';' : ':'),
    })
    expect((await run(['info', join(b, 'a.md'), '--json'], { env: e })).code).toBe(0)
  })
})

describe('audit log', () => {
  it('redacts secret flag values in both spellings', () => {
    expect(redactArgv(['convert', 'a.pdf', '--password', 'hunter2', '--to', 'docx'])).toEqual([
      'convert',
      'a.pdf',
      '--password',
      '***',
      '--to',
      'docx',
    ])
    expect(redactArgv(['info', 'a.pdf', '--password=hunter2'])).toEqual([
      'info',
      'a.pdf',
      '--password=***',
    ])
    expect(redactArgv(['info', 'a.pdf', '--password'])).toEqual(['info', 'a.pdf', '--password'])
  })

  it('defaults under ~/.genoffice and honours GENOFFICE_AUDIT_LOG', () => {
    expect(auditLogPath({})).toMatch(/[\\/]\.genoffice[\\/]cli-audit\.jsonl$/)
    expect(auditLogPath({ GENOFFICE_AUDIT_LOG: 'off' })).toBeNull()
    expect(auditLogPath({ GENOFFICE_AUDIT_LOG: '/x/y.jsonl' })).toBe('/x/y.jsonl')
  })

  it('appends one line per executed command, success or failure', async () => {
    const dir = tempDir()
    const log = join(dir, 'nested/audit.jsonl')
    const md = join(dir, 'a.md')
    writeFileSync(md, '# x\n\ny\n')
    const e = { ...process.env, GENOFFICE_AUDIT_LOG: log }
    expect((await run(['info', md, '--json'], { env: e })).code).toBe(0)
    expect((await run(['convert', md, '--to', 'html', '--json'], { env: e })).code).toBe(0)
    expect((await run(['info', join(dir, 'missing.md'), '--json'], { env: e })).code).toBe(2)
    expect((await run(['help', 'info'], { env: e })).code).toBe(0)
    const lines = readFileSync(log, 'utf-8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l))
    expect(lines).toHaveLength(3)
    expect(lines[0]).toMatchObject({
      command: 'info',
      status: 'ok',
      code: 0,
      argv: ['info', md, '--json'],
    })
    expect(lines[1]).toMatchObject({
      command: 'convert',
      status: 'ok',
      output_path: join(dir, 'a.html'),
    })
    expect(lines[2]).toMatchObject({ command: 'info', status: 'error', code: 2 })
    expect(typeof lines[0].ts).toBe('string')
    expect(typeof lines[0].ms).toBe('number')
  })
})
