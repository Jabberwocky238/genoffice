import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { genofficeUserDataDir, guiOpenDocuments } from '../src/gui'
import { run, tempDir } from './helpers'

function writeRegistry(dir: string, pid: number, paths: string[]): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'open-documents.json'),
    JSON.stringify({ pid, updatedAt: new Date().toISOString(), paths }),
  )
}

function registry(dir: string, pid: number, paths: string[]): Record<string, string> {
  writeRegistry(dir, pid, paths)
  return { ...process.env, GENOFFICE_AUDIT_LOG: 'off', GENOFFICE_USER_DATA: dir }
}

const DOCX = resolve(
  __dirname,
  '../../../apps/docs/tests/pagination-corpus/docx/01-simple-english.docx',
)

function document(dir: string): string {
  const docx = join(dir, 't.docx')
  copyFileSync(DOCX, docx)
  return docx
}

describe('GUI-open documents', () => {
  it('locates the shell userData directory and honours the override', () => {
    expect(genofficeUserDataDir({ GENOFFICE_USER_DATA: '/u' })).toBe('/u')
    expect(genofficeUserDataDir({}).endsWith('GenOffice')).toBe(true)
  })

  it('ignores a missing, malformed or crash-leftover registry', () => {
    const dir = tempDir()
    expect(guiOpenDocuments({ GENOFFICE_USER_DATA: dir })).toEqual([])
    writeFileSync(join(dir, 'open-documents.json'), '{not json')
    expect(guiOpenDocuments({ GENOFFICE_USER_DATA: dir })).toEqual([])
    registry(dir, 2 ** 22 + 12345, ['/x.docx'])
    expect(guiOpenDocuments({ GENOFFICE_USER_DATA: dir })).toEqual([])
    registry(dir, process.pid, ['/x.docx'])
    expect(guiOpenDocuments({ GENOFFICE_USER_DATA: dir })).toEqual([
      { pid: process.pid, paths: ['/x.docx'] },
    ])
  })

  it('refuses a file open in the dev registry after finding a live packaged registry', async () => {
    const dir = tempDir()
    const docx = document(dir)
    const ops = join(dir, 'ops.json')
    writeFileSync(ops, JSON.stringify([{ op: 'findReplace', find: 'a', replace: 'b' }]))
    const appRoot = tempDir()
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      APPDATA: appRoot,
      GENOFFICE_AUDIT_LOG: 'off',
      HOME: appRoot,
      XDG_CONFIG_HOME: appRoot,
    }
    delete env.GENOFFICE_USER_DATA
    const packagedDir = genofficeUserDataDir(env)
    // The in-process CLI must resolve userData from this env, never the real home directory.
    expect(packagedDir.startsWith(appRoot)).toBe(true)
    writeRegistry(packagedDir, process.pid, [join(dir, 'packaged.docx')])
    writeRegistry(`${packagedDir} Dev`, process.pid, [docx])

    const refused = await run(['docs', 'apply', docx, '--ops', ops, '--json'], { env })

    expect(refused.code).toBe(2)
    expect(refused.json().detail).toMatchObject({ gui_pid: process.pid })
  })

  it('refuses an in-place edit of an open file unless --force, other files pass', async () => {
    const dir = tempDir()
    const docx = document(dir)
    const ops = join(dir, 'ops.json')
    writeFileSync(ops, JSON.stringify([{ op: 'findReplace', find: 'a', replace: 'b' }]))
    const env = registry(join(dir, 'userData'), process.pid, [docx])
    const refused = await run(['docs', 'apply', docx, '--ops', ops, '--json'], { env })
    expect(refused.code).toBe(2)
    expect(refused.json().message).toContain('has this file open')
    expect(refused.json().detail.gui_pid).toBe(process.pid)
    const elsewhere = await run(
      ['docs', 'apply', docx, '--ops', ops, '--out', join(dir, 'copy.docx'), '--json'],
      { env },
    )
    expect(elsewhere.code).toBe(0)
    const forced = await run(['docs', 'apply', docx, '--ops', ops, '--force', '--json'], { env })
    expect(forced.code).toBe(0)
  })

  it('applies to convert and create outputs too', async () => {
    const dir = tempDir()
    const md = join(dir, 'a.md')
    writeFileSync(md, '# x\n')
    const env = registry(join(dir, 'userData'), process.pid, [join(dir, 'a.html')])
    expect((await run(['convert', md, '--to', 'html', '--json'], { env })).code).toBe(2)
    expect((await run(['convert', md, '--to', 'html', '--force', '--json'], { env })).code).toBe(0)
  })
})
